// ============================================================================
// Serveur API - Radio Cause Commune - Multistreaming Manager
// ============================================================================

require('dotenv').config({ path: process.env.ENV_FILE || '/app/.env' });

const express = require('express');
const cors = require('cors');
const path = require('path');

const platformsRoutes = require('./routes/platforms');
const streamRoutes = require('./routes/stream');
const statsRoutes = require('./routes/stats');
const webtvRoutes = require('./routes/webtv');
const vodRoutes = require('./routes/vod');
const scheduleRoutes = require('./routes/schedule');

const app = express();
const PORT = process.env.API_PORT || 3000;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging simple des requêtes
app.use((req, res, next) => {
    if (req.path !== '/api/health') {
        console.log(`[API] ${req.method} ${req.path}`);
    }
    next();
});

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/overlay', express.static(path.join(__dirname, 'webtv-overlay')));
app.use('/api/platforms', platformsRoutes);
app.use('/api/stream', streamRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/webtv', webtvRoutes);
app.use('/api/vod', vodRoutes);
app.use('/api/schedule', scheduleRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404
app.use((req, res) => {
    res.status(404).json({ error: 'Route non trouvée' });
});

// Gestion des erreurs
app.use((err, req, res, _next) => {
    console.error('[API] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur interne du serveur' });
});

// ── Démarrage ──────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[API] Serveur démarré sur le port ${PORT}`);
    console.log(`[API] Stream source: ${process.env.NGINX_RTMP_URL || 'rtmp://nginx-rtmp:1935/live'}`);
    console.log(`[API] Stats source: ${process.env.NGINX_STAT_URL || 'http://nginx-rtmp:8080/stat'}`);

    // Initialiser le scheduler de la WebTV
    const scheduler = require('./services/scheduler');
    scheduler.init();
});

// Arrêt propre
process.on('SIGTERM', async () => {
    console.log('[API] SIGTERM reçu, arrêt des relays...');
    const ffmpegService = require('./services/ffmpeg');
    ffmpegService.stopAllRelays();
    const scheduler = require('./services/scheduler');
    scheduler.stop();
    const webtvService = require('./services/webtv');
    await webtvService.stopWebTV();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('[API] SIGINT reçu, arrêt des relays...');
    const ffmpegService = require('./services/ffmpeg');
    ffmpegService.stopAllRelays();
    const scheduler2 = require('./services/scheduler');
    scheduler2.stop();
    const webtvService = require('./services/webtv');
    await webtvService.stopWebTV();
    process.exit(0);
});
