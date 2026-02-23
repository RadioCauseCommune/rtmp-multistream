// ============================================================================
// Routes Stream - Démarrer/arrêter les push vers les plateformes
// ============================================================================

const express = require('express');
const router = express.Router();
const ffmpegService = require('../services/ffmpeg');
const statsService = require('../services/nginx-stats');

/**
 * GET /api/stream/status
 * Statut global : stream live + état des relays
 */
router.get('/status', async (req, res) => {
    try {
        const stats = await statsService.getStats();
        const relays = ffmpegService.getAllRelayStatus();

        res.json({
            stream: stats,
            platforms: relays,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/stream/platforms/:id/start
 * Démarrer le relay vers une plateforme spécifique
 */
router.post('/platforms/:id/start', async (req, res) => {
    const result = await ffmpegService.startRelay(req.params.id);
    const status = result.success ? 200 : 400;
    res.status(status).json(result);
});

/**
 * POST /api/stream/platforms/:id/stop
 * Arrêter le relay vers une plateforme spécifique
 */
router.post('/platforms/:id/stop', (req, res) => {
    const result = ffmpegService.stopRelay(req.params.id);
    const status = result.success ? 200 : 400;
    res.status(status).json(result);
});

/**
 * POST /api/stream/start-all
 * Démarrer les relays vers toutes les plateformes activées
 */
router.post('/start-all', async (req, res) => {
    const results = await ffmpegService.startAllRelays();
    res.json({ results });
});

/**
 * POST /api/stream/stop-all
 * Arrêter tous les relays actifs
 */
router.post('/stop-all', (req, res) => {
    const results = ffmpegService.stopAllRelays();
    res.json({ results });
});

module.exports = router;
