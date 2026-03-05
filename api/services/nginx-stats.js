// ============================================================================
// Service de parsing des stats nginx-rtmp (XML)
// ============================================================================

const http = require('http');
const { parseStringPromise } = require('xml2js');

const NGINX_STAT_URL = process.env.NGINX_STAT_URL || 'http://127.0.0.1:8080/stat';

/**
 * Récupérer le XML brut depuis nginx-rtmp /stat
 */
function fetchRawStats() {
    return new Promise((resolve, reject) => {
        http.get(NGINX_STAT_URL, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
            res.on('error', reject);
        }).on('error', reject);
    });
}

/**
 * Parser les stats et retourner un objet structuré
 */
async function getStats() {
    try {
        const xml = await fetchRawStats();
        const parsed = await parseStringPromise(xml, {
            explicitArray: false,
            ignoreAttrs: true,
        });

        const rtmp = parsed.rtmp;
        if (!rtmp || !rtmp.server) {
            return { live: false, stream: null };
        }

        // Trouver l'application 'live'
        const server = rtmp.server;
        let applications = server.application;
        if (!Array.isArray(applications)) {
            applications = applications ? [applications] : [];
        }

        const liveApp = applications.find(app => app.name === 'live');
        if (!liveApp || !liveApp.live || !liveApp.live.stream) {
            return { live: false, stream: null };
        }

        const stream = liveApp.live.stream;
        const s = Array.isArray(stream) ? stream[0] : stream;

        return {
            live: true,
            stream: {
                name: s.name || '',
                time_ms: parseInt(s.time || 0),
                bw_in: parseInt(s.bw_in || 0),
                bw_out: parseInt(s.bw_out || 0),
                bw_video: parseInt(s.bw_video || 0),
                bw_audio: parseInt(s.bw_audio || 0),
                bytes_in: parseInt(s.bytes_in || 0),
                bytes_out: parseInt(s.bytes_out || 0),
                nclients: parseInt(s.nclients || 0),
                video: s.meta?.video ? {
                    codec: s.meta.video.codec || '',
                    width: parseInt(s.meta.video.width || 0),
                    height: parseInt(s.meta.video.height || 0),
                    frame_rate: parseFloat(s.meta.video.frame_rate || 0),
                } : null,
                audio: s.meta?.audio ? {
                    codec: s.meta.audio.codec || '',
                    sample_rate: parseInt(s.meta.audio.sample_rate || 0),
                    channels: parseInt(s.meta.audio.channels || 0),
                } : null,
            },
        };
    } catch (err) {
        console.error('[Stats] Erreur parsing:', err.message);
        return { live: false, stream: null, error: err.message };
    }
}

module.exports = {
    fetchRawStats,
    getStats,
};
