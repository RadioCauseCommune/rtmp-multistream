// ============================================================================
// Service YouTube Live Streaming API
// OAuth2 Authorization Code Flow + gestion complète des broadcasts
// ============================================================================

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TOKENS_DIR = process.env.TOKENS_DIR || '/app';
const TOKENS_FILE = path.join(TOKENS_DIR, 'youtube_tokens.json');
const YT_API = 'https://www.googleapis.com/youtube/v3';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

// ── Credentials ──────────────────────────────────────────────────────────────

function getCredentials() {
    return {
        clientId: process.env.YOUTUBE_CLIENT_ID,
        clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
        callbackBase: process.env.OAUTH_CALLBACK_BASE || '',
    };
}

function isConfigured() {
    const { clientId, clientSecret } = getCredentials();
    return !!(clientId && clientSecret);
}

// ── Token persistence ─────────────────────────────────────────────────────────

function loadTokens() {
    try {
        if (fs.existsSync(TOKENS_FILE)) {
            return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
        }
    } catch (_) {}
    return null;
}

function saveTokens(tokens) {
    try {
        fs.mkdirSync(TOKENS_DIR, { recursive: true });
        fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), 'utf-8');
    } catch (err) {
        console.error('[YouTube] Impossible de sauvegarder les tokens:', err.message);
    }
}

function revokeTokens() {
    try {
        if (fs.existsSync(TOKENS_FILE)) fs.unlinkSync(TOKENS_FILE);
    } catch (_) {}
}

// ── OAuth2 flow ───────────────────────────────────────────────────────────────

function getAuthUrl() {
    const { clientId, callbackBase } = getCredentials();
    const redirectUri = `${callbackBase}/api/broadcast/youtube/callback`;
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: [
            'https://www.googleapis.com/auth/youtube',
            'https://www.googleapis.com/auth/youtube.force-ssl',
        ].join(' '),
        access_type: 'offline',
        prompt: 'consent',
    });
    return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

async function exchangeCode(code) {
    const { clientId, clientSecret, callbackBase } = getCredentials();
    const redirectUri = `${callbackBase}/api/broadcast/youtube/callback`;
    const resp = await axios.post(OAUTH_TOKEN_URL, new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    const tokens = {
        access_token: resp.data.access_token,
        refresh_token: resp.data.refresh_token,
        expiry_date: Date.now() + resp.data.expires_in * 1000,
    };
    saveTokens(tokens);
    console.log('[YouTube] Tokens OAuth sauvegardés');
    return tokens;
}

async function refreshAccessToken() {
    const tokens = loadTokens();
    if (!tokens?.refresh_token) throw new Error('Aucun refresh_token disponible — reconnectez YouTube');

    const { clientId, clientSecret } = getCredentials();
    const resp = await axios.post(OAUTH_TOKEN_URL, new URLSearchParams({
        refresh_token: tokens.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    tokens.access_token = resp.data.access_token;
    tokens.expiry_date = Date.now() + resp.data.expires_in * 1000;
    saveTokens(tokens);
    return tokens.access_token;
}

async function getAccessToken() {
    let tokens = loadTokens();
    if (!tokens) throw new Error('YouTube non connecté — effectuez le flux OAuth');

    // Rafraîchir si expiré (marge de 2 minutes)
    if (tokens.expiry_date && Date.now() > tokens.expiry_date - 120000) {
        return await refreshAccessToken();
    }
    return tokens.access_token;
}

function getConnectionStatus() {
    const tokens = loadTokens();
    if (!tokens) return { connected: false };
    const expiresIn = tokens.expiry_date ? Math.max(0, Math.round((tokens.expiry_date - Date.now()) / 1000)) : null;
    return {
        connected: true,
        hasRefreshToken: !!tokens.refresh_token,
        expiresInSeconds: expiresIn,
    };
}

// ── Broadcast management ──────────────────────────────────────────────────────

/**
 * Créer un broadcast YouTube avec son liveStream associé.
 * Retourne { broadcastId, streamId, streamKey, ingestionAddress }
 */
async function createBroadcast({ title, description = '', scheduledStartTime, enableDvr = true, privacyStatus = 'public' }) {
    const token = await getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };

    // 1. Créer le liveStream (canal d'ingestion RTMP)
    const streamResp = await axios.post(`${YT_API}/liveStreams`, {
        snippet: { title },
        cdn: {
            frameRate: 'variable',
            ingestionType: 'rtmp',
            resolution: 'variable',
        },
        contentDetails: { isReusable: false },
    }, { headers, params: { part: 'snippet,cdn,contentDetails' } });

    const streamId = streamResp.data.id;
    const ingestion = streamResp.data.cdn?.ingestionInfo || {};
    const streamKey = ingestion.streamName || '';
    const ingestionAddress = ingestion.ingestionAddress || '';

    // 2. Créer le liveBroadcast
    const startTime = scheduledStartTime || new Date(Date.now() + 60000).toISOString();
    const broadcastResp = await axios.post(`${YT_API}/liveBroadcasts`, {
        snippet: {
            title,
            description,
            scheduledStartTime: startTime,
        },
        status: { privacyStatus, selfDeclaredMadeForKids: false },
        contentDetails: {
            enableDvr,
            enableEmbed: true,
            monitorStream: { enableMonitorStream: false },
        },
    }, { headers, params: { part: 'snippet,status,contentDetails' } });

    const broadcastId = broadcastResp.data.id;

    // 3. Lier le liveStream au liveBroadcast
    await axios.post(`${YT_API}/liveBroadcasts/bind`, null, {
        headers,
        params: { id: broadcastId, streamId, part: 'id,snippet' },
    });

    console.log(`[YouTube] Broadcast créé: ${broadcastId} | Stream: ${streamId}`);
    return { broadcastId, streamId, streamKey, ingestionAddress };
}

/**
 * Passer le broadcast en mode "live"
 */
async function transitionBroadcast(broadcastId, status) {
    const token = await getAccessToken();
    await axios.post(`${YT_API}/liveBroadcasts/transition`, null, {
        headers: { Authorization: `Bearer ${token}` },
        params: { broadcastStatus: status, id: broadcastId, part: 'id,status' },
    });
    console.log(`[YouTube] Broadcast ${broadcastId} → ${status}`);
}

/**
 * Lister les broadcasts à venir / en cours
 */
async function listBroadcasts(broadcastStatus = 'upcoming') {
    const token = await getAccessToken();
    const resp = await axios.get(`${YT_API}/liveBroadcasts`, {
        headers: { Authorization: `Bearer ${token}` },
        params: {
            part: 'snippet,status,statistics',
            broadcastStatus,
            maxResults: 10,
        },
    });
    return resp.data.items || [];
}

/**
 * Statistiques d'un broadcast (viewers concurrents)
 */
async function getBroadcastStats(broadcastId) {
    const token = await getAccessToken();
    const resp = await axios.get(`${YT_API}/liveBroadcasts`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { part: 'snippet,status,statistics', id: broadcastId },
    });
    const item = resp.data.items?.[0];
    if (!item) throw new Error(`Broadcast ${broadcastId} introuvable`);
    return {
        id: item.id,
        title: item.snippet?.title,
        status: item.status?.lifeCycleStatus,
        concurrentViewers: item.statistics?.concurrentViewers || '0',
        publishedAt: item.snippet?.publishedAt,
    };
}

/**
 * Mettre à jour le titre/description d'un broadcast
 */
async function updateBroadcast(broadcastId, { title, description }) {
    const token = await getAccessToken();
    const resp = await axios.put(`${YT_API}/liveBroadcasts`, {
        id: broadcastId,
        snippet: { title, description, scheduledStartTime: new Date().toISOString() },
    }, {
        headers: { Authorization: `Bearer ${token}` },
        params: { part: 'snippet' },
    });
    return resp.data;
}

module.exports = {
    isConfigured,
    getAuthUrl,
    exchangeCode,
    getConnectionStatus,
    revokeTokens,
    createBroadcast,
    transitionBroadcast,
    listBroadcasts,
    getBroadcastStats,
    updateBroadcast,
};
