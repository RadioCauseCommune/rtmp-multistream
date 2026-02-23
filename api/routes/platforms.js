// ============================================================================
// Routes Plateformes - CRUD et toggle enable/disable
// ============================================================================

const express = require('express');
const router = express.Router();
const platformsService = require('../services/platforms');
const ffmpegService = require('../services/ffmpeg');

/**
 * GET /api/platforms
 * Liste toutes les plateformes avec leur statut relay
 */
router.get('/', (req, res) => {
    const status = ffmpegService.getAllRelayStatus();
    res.json({ platforms: status });
});

/**
 * GET /api/platforms/:id
 * Détail d'une plateforme
 */
router.get('/:id', (req, res) => {
    const platform = platformsService.findPlatform(req.params.id);
    if (!platform) {
        return res.status(404).json({ error: `Plateforme '${req.params.id}' non trouvée` });
    }
    const relay = ffmpegService.getRelayInfo(req.params.id);
    res.json({ ...platform, relay });
});

/**
 * PATCH /api/platforms/:id
 * Modifier une plateforme (enabled, name, rtmp_url, max_bitrate_kbps)
 */
router.patch('/:id', (req, res) => {
    const updated = platformsService.updatePlatform(req.params.id, req.body);
    if (!updated) {
        return res.status(404).json({ error: `Plateforme '${req.params.id}' non trouvée` });
    }

    // Si on désactive une plateforme, arrêter son relay
    if (req.body.enabled === false) {
        ffmpegService.stopRelay(req.params.id);
    }

    const relay = ffmpegService.getRelayInfo(req.params.id);
    res.json({ platform: { ...updated, relay }, message: 'Plateforme mise à jour' });
});

module.exports = router;
