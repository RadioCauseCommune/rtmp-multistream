// ============================================================================
// Routes Broadcast — YouTube Live & Twitch Channel Management
// ============================================================================

const express = require('express');
const router = express.Router();
const youtubeService = require('../services/youtube');
const twitchService = require('../services/twitch');
const platformsService = require('../services/platforms');

// ── Wrapper d'erreur pour les routes async ────────────────────────────────────

function asyncRoute(fn) {
    return (req, res, next) => fn(req, res, next).catch(next);
}

function handleServiceError(res, err) {
    const msg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
    const status = err.response?.status || 500;
    console.error('[Broadcast] Erreur:', msg);
    res.status(status).json({ error: msg });
}

// ── Status global ─────────────────────────────────────────────────────────────

/**
 * GET /api/broadcast/status
 * État de connexion YouTube + Twitch
 */
router.get('/status', (req, res) => {
    res.json({
        youtube: {
            configured: youtubeService.isConfigured(),
            ...youtubeService.getConnectionStatus(),
        },
        twitch: {
            configured: twitchService.isConfigured(),
            ...twitchService.getConnectionStatus(),
        },
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// YOUTUBE
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/broadcast/youtube/auth-url
 * Retourne l'URL OAuth Google à ouvrir dans le navigateur
 */
router.get('/youtube/auth-url', (req, res) => {
    if (!youtubeService.isConfigured()) {
        return res.status(400).json({ error: 'YOUTUBE_CLIENT_ID et YOUTUBE_CLIENT_SECRET non configurés' });
    }
    try {
        res.json({ authUrl: youtubeService.getAuthUrl() });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

/**
 * GET /api/broadcast/youtube/callback
 * Callback OAuth Google — échange le code contre des tokens
 */
router.get('/youtube/callback', asyncRoute(async (req, res) => {
    const { code, error } = req.query;
    if (error) return res.status(400).send(`OAuth refusé : ${error}`);
    if (!code) return res.status(400).send('Code OAuth manquant');

    try {
        await youtubeService.exchangeCode(code);
        res.send(`
            <html><body style="font-family:monospace;background:#080b0f;color:#00ff88;padding:40px;text-align:center;">
            <h2>✅ YouTube connecté avec succès</h2>
            <p>Vous pouvez fermer cette fenêtre.</p>
            <script>setTimeout(()=>window.close(),2000)</script>
            </body></html>
        `);
    } catch (err) {
        res.status(500).send(`Erreur OAuth : ${err.message}`);
    }
}));

/**
 * GET /api/broadcast/youtube/connection
 * Statut de connexion YouTube
 */
router.get('/youtube/connection', (req, res) => {
    res.json({
        configured: youtubeService.isConfigured(),
        ...youtubeService.getConnectionStatus(),
    });
});

/**
 * DELETE /api/broadcast/youtube/revoke
 * Déconnecter YouTube (supprime les tokens)
 */
router.delete('/youtube/revoke', (req, res) => {
    youtubeService.revokeTokens();
    res.json({ success: true, message: 'YouTube déconnecté' });
});

/**
 * GET /api/broadcast/youtube/broadcasts
 * Lister les broadcasts (upcoming, live, ou complete)
 */
router.get('/youtube/broadcasts', asyncRoute(async (req, res) => {
    const broadcastStatus = req.query.status || 'upcoming';
    const items = await youtubeService.listBroadcasts(broadcastStatus);
    res.json({ items });
}));

/**
 * POST /api/broadcast/youtube/create
 * Créer un nouveau broadcast YouTube et mettre à jour la clé RTMP
 * Body: { title, description?, scheduledStartTime?, privacyStatus?, updateRelayKey? }
 */
router.post('/youtube/create', asyncRoute(async (req, res) => {
    const { title, description, scheduledStartTime, privacyStatus, updateRelayKey = true } = req.body;
    if (!title) return res.status(400).json({ error: 'Le champ "title" est requis' });

    const result = await youtubeService.createBroadcast({
        title,
        description,
        scheduledStartTime,
        privacyStatus: privacyStatus || 'public',
    });

    // Mettre à jour automatiquement la clé RTMP dans platforms.json
    if (updateRelayKey && result.streamKey) {
        process.env.YOUTUBE_KEY = result.streamKey;
        // Persister la clé dans platforms.json comme référence de la clé active
        const platform = platformsService.findPlatform('youtube');
        if (platform) {
            platformsService.updatePlatform('youtube', {
                active_stream_key: result.streamKey,
                active_broadcast_id: result.broadcastId,
            });
        }
        console.log(`[Broadcast] Clé RTMP YouTube mise à jour pour broadcast ${result.broadcastId}`);
    }

    res.json({
        success: true,
        broadcastId: result.broadcastId,
        streamId: result.streamId,
        streamKey: result.streamKey,
        ingestionAddress: result.ingestionAddress,
        message: `Broadcast "${title}" créé avec succès`,
    });
}));

/**
 * POST /api/broadcast/youtube/start/:id
 * Passer le broadcast en mode "live"
 */
router.post('/youtube/start/:id', asyncRoute(async (req, res) => {
    await youtubeService.transitionBroadcast(req.params.id, 'live');
    res.json({ success: true, message: `Broadcast ${req.params.id} passé en LIVE` });
}));

/**
 * POST /api/broadcast/youtube/testing/:id
 * Passer le broadcast en mode "testing" (moniteur)
 */
router.post('/youtube/testing/:id', asyncRoute(async (req, res) => {
    await youtubeService.transitionBroadcast(req.params.id, 'testing');
    res.json({ success: true, message: `Broadcast ${req.params.id} en mode TEST` });
}));

/**
 * POST /api/broadcast/youtube/stop/:id
 * Terminer le broadcast
 */
router.post('/youtube/stop/:id', asyncRoute(async (req, res) => {
    await youtubeService.transitionBroadcast(req.params.id, 'complete');
    res.json({ success: true, message: `Broadcast ${req.params.id} terminé` });
}));

/**
 * GET /api/broadcast/youtube/stats/:id
 * Statistiques en temps réel (viewers concurrents)
 */
router.get('/youtube/stats/:id', asyncRoute(async (req, res) => {
    const stats = await youtubeService.getBroadcastStats(req.params.id);
    res.json(stats);
}));

/**
 * PATCH /api/broadcast/youtube/:id
 * Modifier le titre/description d'un broadcast
 */
router.patch('/youtube/:id', asyncRoute(async (req, res) => {
    const { title, description } = req.body;
    const updated = await youtubeService.updateBroadcast(req.params.id, { title, description });
    res.json({ success: true, broadcast: updated });
}));

// ══════════════════════════════════════════════════════════════════════════════
// TWITCH
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/broadcast/twitch/auth-url
 */
router.get('/twitch/auth-url', (req, res) => {
    if (!twitchService.isConfigured()) {
        return res.status(400).json({ error: 'TWITCH_CLIENT_ID et TWITCH_CLIENT_SECRET non configurés' });
    }
    try {
        res.json({ authUrl: twitchService.getAuthUrl() });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

/**
 * GET /api/broadcast/twitch/callback
 */
router.get('/twitch/callback', asyncRoute(async (req, res) => {
    const { code, error } = req.query;
    if (error) return res.status(400).send(`OAuth refusé : ${error}`);
    if (!code) return res.status(400).send('Code OAuth manquant');

    try {
        await twitchService.exchangeCode(code);
        res.send(`
            <html><body style="font-family:monospace;background:#080b0f;color:#9147ff;padding:40px;text-align:center;">
            <h2>✅ Twitch connecté avec succès</h2>
            <p>Vous pouvez fermer cette fenêtre.</p>
            <script>setTimeout(()=>window.close(),2000)</script>
            </body></html>
        `);
    } catch (err) {
        res.status(500).send(`Erreur OAuth : ${err.message}`);
    }
}));

/**
 * GET /api/broadcast/twitch/connection
 */
router.get('/twitch/connection', (req, res) => {
    res.json({
        configured: twitchService.isConfigured(),
        ...twitchService.getConnectionStatus(),
    });
});

/**
 * DELETE /api/broadcast/twitch/revoke
 */
router.delete('/twitch/revoke', (req, res) => {
    twitchService.revokeTokens();
    res.json({ success: true, message: 'Twitch déconnecté' });
});

/**
 * GET /api/broadcast/twitch/channel
 * Infos chaîne + statut stream en cours
 */
router.get('/twitch/channel', asyncRoute(async (req, res) => {
    const info = await twitchService.getChannelInfo();
    res.json(info);
}));

/**
 * PATCH /api/broadcast/twitch/channel
 * Modifier titre et/ou catégorie
 * Body: { title?, gameId? }
 */
router.patch('/twitch/channel', asyncRoute(async (req, res) => {
    const { title, gameId } = req.body;
    if (!title && !gameId) {
        return res.status(400).json({ error: 'Fournir au moins "title" ou "gameId"' });
    }
    await twitchService.updateChannel({ title, gameId });
    res.json({ success: true, message: 'Chaîne Twitch mise à jour' });
}));

/**
 * GET /api/broadcast/twitch/categories
 * Rechercher des catégories/jeux
 * Query: ?q=musique
 */
router.get('/twitch/categories', asyncRoute(async (req, res) => {
    const query = req.query.q || '';
    if (!query) return res.status(400).json({ error: 'Paramètre "q" requis' });
    const categories = await twitchService.searchCategories(query);
    res.json({ categories });
}));

/**
 * POST /api/broadcast/twitch/clip
 * Créer un clip du stream en cours
 */
router.post('/twitch/clip', asyncRoute(async (req, res) => {
    const clip = await twitchService.createClip();
    res.json({ success: true, clip });
}));

/**
 * POST /api/broadcast/twitch/marker
 * Ajouter un marker de repère
 * Body: { description? }
 */
router.post('/twitch/marker', asyncRoute(async (req, res) => {
    const marker = await twitchService.createMarker(req.body.description || '');
    res.json({ success: true, marker });
}));

// ── Error handler local ───────────────────────────────────────────────────────

router.use((err, req, res, _next) => {
    handleServiceError(res, err);
});

module.exports = router;
