// ============================================================================
// Service Twitch Helix API
// OAuth2 Authorization Code Flow + gestion de chaîne en direct
// ============================================================================

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TOKENS_DIR = process.env.TOKENS_DIR || '/app';
const TOKENS_FILE = path.join(TOKENS_DIR, 'twitch_tokens.json');
const HELIX = 'https://api.twitch.tv/helix';
const OAUTH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const OAUTH_AUTH_URL = 'https://id.twitch.tv/oauth2/authorize';

// ── Credentials ──────────────────────────────────────────────────────────────

function getCredentials() {
    return {
        clientId: process.env.TWITCH_CLIENT_ID,
        clientSecret: process.env.TWITCH_CLIENT_SECRET,
        callbackBase: (process.env.OAUTH_CALLBACK_BASE || '').replace(/\/$/, ''),
    };
}

function getCallbackBase() {
    const base = (process.env.OAUTH_CALLBACK_BASE || '').replace(/\/$/, '');
    if (!base || !base.startsWith('http')) {
        throw new Error(
            'OAUTH_CALLBACK_BASE non configuré ou invalide. ' +
            'Ajoutez dans .env : OAUTH_CALLBACK_BASE=https://votre-domaine.fr'
        );
    }
    return base;
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
        console.error('[Twitch] Impossible de sauvegarder les tokens:', err.message);
    }
}

function revokeTokens() {
    try {
        if (fs.existsSync(TOKENS_FILE)) fs.unlinkSync(TOKENS_FILE);
    } catch (_) {}
}

// ── OAuth2 flow ───────────────────────────────────────────────────────────────

function getAuthUrl() {
    const { clientId } = getCredentials();
    const callbackBase = getCallbackBase();
    const redirectUri = `${callbackBase}/api/broadcast/twitch/callback`;
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: [
            'channel:manage:broadcast',
            'channel:read:stream_key',
            'clips:edit',
            'user:read:broadcast',
        ].join(' '),
        force_verify: 'true',
    });
    return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

async function exchangeCode(code) {
    const { clientId, clientSecret } = getCredentials();
    const redirectUri = `${getCallbackBase()}/api/broadcast/twitch/callback`;
    const resp = await axios.post(OAUTH_TOKEN_URL, new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    // Récupérer le broadcaster_id via /helix/users
    const userId = await fetchUserId(resp.data.access_token);

    const tokens = {
        access_token: resp.data.access_token,
        refresh_token: resp.data.refresh_token,
        expiry_date: Date.now() + resp.data.expires_in * 1000,
        broadcaster_id: userId,
    };
    saveTokens(tokens);
    console.log(`[Twitch] Tokens OAuth sauvegardés (broadcaster_id: ${userId})`);
    return tokens;
}

async function fetchUserId(accessToken) {
    const { clientId } = getCredentials();
    const resp = await axios.get(`${HELIX}/users`, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': clientId },
    });
    return resp.data.data?.[0]?.id || null;
}

async function refreshAccessToken() {
    const tokens = loadTokens();
    if (!tokens?.refresh_token) throw new Error('Aucun refresh_token disponible — reconnectez Twitch');

    const { clientId, clientSecret } = getCredentials();
    const resp = await axios.post(OAUTH_TOKEN_URL, new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    tokens.access_token = resp.data.access_token;
    tokens.refresh_token = resp.data.refresh_token || tokens.refresh_token;
    tokens.expiry_date = Date.now() + resp.data.expires_in * 1000;
    saveTokens(tokens);
    return tokens.access_token;
}

async function getAccessToken() {
    let tokens = loadTokens();
    if (!tokens) throw new Error('Twitch non connecté — effectuez le flux OAuth');

    if (tokens.expiry_date && Date.now() > tokens.expiry_date - 120000) {
        return await refreshAccessToken();
    }
    return tokens.access_token;
}

function getBroadcasterId() {
    const tokens = loadTokens();
    return tokens?.broadcaster_id || null;
}

function getConnectionStatus() {
    const tokens = loadTokens();
    if (!tokens) return { connected: false };
    return {
        connected: true,
        broadcasterId: tokens.broadcaster_id,
        hasRefreshToken: !!tokens.refresh_token,
        expiresInSeconds: tokens.expiry_date ? Math.max(0, Math.round((tokens.expiry_date - Date.now()) / 1000)) : null,
    };
}

// ── Helix helpers ─────────────────────────────────────────────────────────────

function helixHeaders(token) {
    const { clientId } = getCredentials();
    return { Authorization: `Bearer ${token}`, 'Client-Id': clientId };
}

// ── Channel management ────────────────────────────────────────────────────────

/**
 * Récupérer les infos de la chaîne (titre, jeu, langue, viewers)
 */
async function getChannelInfo() {
    const token = await getAccessToken();
    const broadcasterId = getBroadcasterId();
    if (!broadcasterId) throw new Error('broadcaster_id manquant — reconnectez Twitch');

    const [channelResp, streamResp] = await Promise.all([
        axios.get(`${HELIX}/channels`, {
            headers: helixHeaders(token),
            params: { broadcaster_id: broadcasterId },
        }),
        axios.get(`${HELIX}/streams`, {
            headers: helixHeaders(token),
            params: { user_id: broadcasterId },
        }),
    ]);

    const channel = channelResp.data.data?.[0] || {};
    const stream = streamResp.data.data?.[0] || null;

    return {
        broadcasterId,
        title: channel.title || '',
        gameName: channel.game_name || '',
        gameId: channel.game_id || '',
        language: channel.broadcaster_language || '',
        isLive: !!stream,
        viewerCount: stream?.viewer_count || 0,
        startedAt: stream?.started_at || null,
    };
}

/**
 * Modifier le titre et/ou la catégorie du stream
 */
async function updateChannel({ title, gameId }) {
    const token = await getAccessToken();
    const broadcasterId = getBroadcasterId();
    if (!broadcasterId) throw new Error('broadcaster_id manquant — reconnectez Twitch');

    const body = {};
    if (title !== undefined) body.title = title;
    if (gameId !== undefined) body.game_id = gameId;

    await axios.patch(`${HELIX}/channels`, body, {
        headers: helixHeaders(token),
        params: { broadcaster_id: broadcasterId },
    });
    console.log(`[Twitch] Chaîne mise à jour — titre: "${title || '—'}" | gameId: ${gameId || '—'}`);
    return { success: true };
}

/**
 * Rechercher des catégories/jeux Twitch
 */
async function searchCategories(query) {
    const token = await getAccessToken();
    const resp = await axios.get(`${HELIX}/search/categories`, {
        headers: helixHeaders(token),
        params: { query, first: 10 },
    });
    return resp.data.data || [];
}

/**
 * Créer un clip du stream en cours
 */
async function createClip() {
    const token = await getAccessToken();
    const broadcasterId = getBroadcasterId();
    if (!broadcasterId) throw new Error('broadcaster_id manquant — reconnectez Twitch');

    const resp = await axios.post(`${HELIX}/clips`, null, {
        headers: helixHeaders(token),
        params: { broadcaster_id: broadcasterId },
    });
    const clip = resp.data.data?.[0];
    console.log(`[Twitch] Clip créé: ${clip?.id}`);
    return clip || {};
}

/**
 * Ajouter un marker de repère dans le stream en cours
 */
async function createMarker(description = '') {
    const token = await getAccessToken();
    const broadcasterId = getBroadcasterId();
    if (!broadcasterId) throw new Error('broadcaster_id manquant — reconnectez Twitch');

    const resp = await axios.post(`${HELIX}/streams/markers`, {
        user_id: broadcasterId,
        description: description.substring(0, 140),
    }, { headers: helixHeaders(token) });

    const marker = resp.data.data?.[0];
    console.log(`[Twitch] Marker créé à ${marker?.position_seconds}s`);
    return marker || {};
}

module.exports = {
    isConfigured,
    getAuthUrl,
    exchangeCode,
    getConnectionStatus,
    revokeTokens,
    getChannelInfo,
    updateChannel,
    searchCategories,
    createClip,
    createMarker,
};
