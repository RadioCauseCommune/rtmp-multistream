const express = require('express');
const router = express.Router();
const webtvService = require('../services/webtv');

// GET /api/webtv/status
router.get('/status', (req, res) => {
    try {
        const status = webtvService.getWebTVStatus();
        res.json(status);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/webtv/start
router.post('/start', async (req, res) => {
    try {
        const result = await webtvService.startWebTV();
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/webtv/stop
router.post('/stop', async (req, res) => {
    try {
        const result = await webtvService.stopWebTV();
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
