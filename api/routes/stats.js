// ============================================================================
// Routes Stats - Proxy vers les stats nginx-rtmp avec parsing enrichi
// ============================================================================

const express = require('express');
const router = express.Router();
const statsService = require('../services/nginx-stats');

/**
 * GET /api/stats
 * Stats enrichies (JSON parsé depuis le XML nginx-rtmp)
 */
router.get('/', async (req, res) => {
    try {
        const stats = await statsService.getStats();
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/stats/raw
 * Stats brutes XML (proxy direct)
 */
router.get('/raw', async (req, res) => {
    try {
        const xml = await statsService.fetchRawStats();
        res.set('Content-Type', 'application/xml');
        res.send(xml);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
