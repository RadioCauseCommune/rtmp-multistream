// ============================================================================
// Service FFmpeg - Gestion des processus de relay vers les plateformes
// ============================================================================

const { spawn } = require('child_process');
const platformsService = require('./platforms');
const statsService = require('./nginx-stats');
const webtvService = require('./webtv');

// Map des processus FFmpeg actifs : platformId -> { process, startedAt, status }
const activeRelays = new Map();

// Nom du stream entrant (fallback si détection auto échoue)
const STREAM_NAME = process.env.STREAM_NAME || 'radiocausecommune';
const NGINX_RTMP_URL = process.env.NGINX_RTMP_URL || 'rtmp://nginx-rtmp:1935/live';

/**
 * Charger les clés de stream depuis les variables d'environnement
 */
function getStreamKey(keyEnvName) {
    return process.env[keyEnvName] || '';
}

/**
 * Détecter le nom du stream actif en interrogeant les stats nginx-rtmp
 * @returns {Promise<string|null>} Le nom du stream actif ou null
 */
async function detectActiveStreamName() {
    try {
        const stats = await statsService.getStats();
        if (stats.live && stats.stream && stats.stream.name) {
            return stats.stream.name;
        }
    } catch (err) {
        console.warn('[FFmpeg] Erreur détection stream actif:', err.message);
    }
    return null;
}

/**
 * Démarrer le relay FFmpeg vers une plateforme
 * @param {string} platformId - ID de la plateforme
 * @returns {Promise<object>} Résultat { success, message, relay? }
 */
async function startRelay(platformId) {
    // Vérifier si un relay est déjà actif
    if (activeRelays.has(platformId)) {
        const existing = activeRelays.get(platformId);
        if (existing.status === 'running') {
            return { success: false, message: `Le relay vers ${platformId} est déjà actif` };
        }
    }

    // Charger la config de la plateforme
    const platform = platformsService.findPlatform(platformId);
    if (!platform) {
        return { success: false, message: `Plateforme '${platformId}' non trouvée` };
    }
    if (!platform.enabled) {
        return { success: false, message: `Plateforme '${platformId}' est désactivée` };
    }

    // Récupérer la clé de stream
    const streamKey = getStreamKey(platform.key_env);
    if (!streamKey) {
        return {
            success: false,
            message: `Clé de stream '${platform.key_env}' non définie dans .env`,
        };
    }

    // Construire l'URL de destination
    const outputUrl = `${platform.rtmp_url}${streamKey}`;

    console.log(`[FFmpeg] Démarrage relay vers ${platform.name}: ${platform.rtmp_url}***`);

    const relay = {
        process: null,
        pid: null,
        platformId,
        startedAt: new Date().toISOString(),
        status: 'starting',
        lastError: null,
        restarts: 0,
        restartTimeout: null,
        mode: 'live',
    };
    activeRelays.set(platformId, relay);

    function spawnFfmpeg() {
        if (relay.status === 'stopping') return;

        console.log(`[FFmpeg] Lancement relay ${platform.name} (Tentative: ${relay.restarts + 1})`);

        detectActiveStreamName().then(activeStreamName => {
            if (relay.status === 'stopping') return;

            const webtvStatus = webtvService.getWebTVStatus();
            let actualArgs = [];

            if (activeStreamName) {
                console.log(`[FFmpeg] OBS stream détecté: '${activeStreamName}' - Relay direct`);
                const currentInputUrl = `${NGINX_RTMP_URL}/${activeStreamName}`;
                actualArgs = [
                    '-hide_banner', '-loglevel', 'warning',
                    '-rw_timeout', '10000000',
                    '-i', currentInputUrl,
                    '-c', 'copy',
                    '-f', 'flv', '-flvflags', 'no_duration_filesize',
                    outputUrl,
                ];
                relay.mode = 'live';
            } else if (webtvStatus.status === 'running') {
                console.log(`[FFmpeg] WebTV active - Relay de la WebTV`);
                const currentInputUrl = webtvStatus.outputUrl || 'rtmp://nginx-rtmp:1935/webtv/live';
                actualArgs = [
                    '-hide_banner', '-loglevel', 'warning',
                    '-rw_timeout', '10000000',
                    '-i', currentInputUrl,
                    '-c', 'copy',
                    '-f', 'flv', '-flvflags', 'no_duration_filesize',
                    outputUrl,
                ];
                relay.mode = 'webtv';
            } else {
                console.log(`[FFmpeg] OBS stream HORS LIGNE et WebTV arrêtée - Envoi de la Mire de secours`);
                actualArgs = [
                    '-hide_banner', '-loglevel', 'warning',
                    '-re',
                    '-stream_loop', '-1',
                    '-i', '/app/mire.mp4',
                    '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '2000k', '-g', '60',
                    '-c:a', 'aac', '-b:a', '128k',
                    '-f', 'flv', '-flvflags', 'no_duration_filesize',
                    outputUrl,
                ];
                relay.mode = 'mire';
            }

            const proc = spawn('ffmpeg', actualArgs, {
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            relay.process = proc;
            relay.pid = proc.pid;
            relay.status = 'running';

            let stderrBuffer = '';
            proc.stderr.on('data', (data) => {
                stderrBuffer += data.toString();
                // Garder seulement les dernières lignes
                const lines = stderrBuffer.split('\n');
                if (lines.length > 20) {
                    stderrBuffer = lines.slice(-20).join('\n');
                }
            });

            proc.on('close', (code) => {
                console.log(`[FFmpeg] Relay ${platform.name} terminé (code: ${code})`);
                if (code !== 0 && stderrBuffer.trim()) {
                    console.error(`[FFmpeg] Dernière erreur ${platform.name}: ${stderrBuffer.trim().split('\n').pop()}`);
                }

                if (relay.status === 'stopping') {
                    relay.status = 'stopped';
                    relay.stoppedAt = new Date().toISOString();
                    return;
                }

                // Auto-restart
                relay.status = 'error';
                relay.lastError = code !== 0 ? stderrBuffer.trim().split('\n').pop() : 'Fermeture inattendue (code 0)';
                scheduleRestart();
            });

            proc.on('error', (err) => {
                console.error(`[FFmpeg] Erreur relay ${platform.name}:`, err.message);
                if (relay.status === 'stopping') return;

                relay.status = 'error';
                relay.lastError = err.message;
                scheduleRestart();
            });
        }).catch(err => {
            console.error(`[FFmpeg] Erreur pre-spawn ${platform.name}:`, err.message);
            scheduleRestart();
        });
    }

    function scheduleRestart() {
        relay.restarts++;
        // Backoff exponentiel: 2s, 3s, 4.5s, 6.7s, etc. Max 30s.
        const delay = Math.min(30000, 2000 * Math.pow(1.5, relay.restarts - 1));
        console.log(`[FFmpeg] Reconnexion prévue vers ${platform.name} dans ${Math.round(delay / 1000)}s...`);
        relay.status = 'waiting_restart';
        relay.restartTimeout = setTimeout(() => {
            spawnFfmpeg();
        }, delay);
    }

    spawnFfmpeg();

    return {
        success: true,
        message: `Relay vers ${platform.name} démarré avec auto-healing`,
        relay: getRelayInfo(platformId),
    };
}

/**
 * Arrêter le relay FFmpeg vers une plateforme
 */
function stopRelay(platformId) {
    if (!activeRelays.has(platformId)) {
        return { success: false, message: `Aucun relay actif vers ${platformId}` };
    }

    const relay = activeRelays.get(platformId);
    if (relay.status === 'stopped' || relay.status === 'stopping') {
        activeRelays.delete(platformId);
        return { success: false, message: `Le relay vers ${platformId} est déjà arrêté ou en cours d'arrêt` };
    }

    console.log(`[FFmpeg] Arrêt relay vers ${platformId}${relay.pid ? ' (PID: ' + relay.pid + ')' : ''}`);

    relay.status = 'stopping';

    if (relay.restartTimeout) {
        clearTimeout(relay.restartTimeout);
    }

    if (relay.process && !relay.process.killed) {
        // Envoyer SIGTERM pour un arrêt propre
        relay.process.kill('SIGTERM');

        // Forcer l'arrêt après 5s si toujours actif
        setTimeout(() => {
            try {
                if (relay.process && !relay.process.killed) {
                    relay.process.kill('SIGKILL');
                }
            } catch (_) { /* ignore */ }
        }, 5000);
    } else {
        relay.status = 'stopped';
        relay.stoppedAt = new Date().toISOString();
    }

    return {
        success: true,
        message: `Relay vers ${platformId} en cours d'arrêt`,
    };
}

/**
 * Démarrer les relays vers toutes les plateformes activées
 */
async function startAllRelays() {
    const platforms = platformsService.loadPlatforms();
    const results = [];

    for (const platform of platforms) {
        if (platform.enabled) {
            results.push(await startRelay(platform.id));
        }
    }

    return results;
}

/**
 * Arrêter tous les relays actifs
 */
function stopAllRelays() {
    const results = [];
    for (const [platformId] of activeRelays) {
        results.push(stopRelay(platformId));
    }
    return results;
}

/**
 * Obtenir les infos d'un relay (sans le processus interne)
 */
function getRelayInfo(platformId) {
    if (!activeRelays.has(platformId)) return null;
    const r = activeRelays.get(platformId);
    return {
        platformId: r.platformId,
        pid: r.pid,
        status: r.status,
        startedAt: r.startedAt,
        stoppedAt: r.stoppedAt || null,
        lastError: r.lastError,
        restarts: r.restarts || 0,
    };
}

/**
 * Obtenir le statut de tous les relays
 */
function getAllRelayStatus() {
    const platforms = platformsService.loadPlatforms();
    return platforms.map(p => ({
        ...p,
        relay: getRelayInfo(p.id),
    }));
}

/**
 * Démarrer le moniteur de fallback qui contrôle OBS
 */
let monitorInterval = null;
function startFallbackMonitor() {
    if (monitorInterval) return;
    let wasLive = false;

    // Lancer immédiatement une première vérification sans action
    detectActiveStreamName().then(name => { wasLive = !!name; });

    monitorInterval = setInterval(async () => {
        try {
            const activeStreamName = await detectActiveStreamName();
            const isLiveNow = !!activeStreamName;
            const webtvStatus = webtvService.getWebTVStatus();
            const isWebTVNow = webtvStatus.status === 'running';

            for (const [platformId, relay] of activeRelays.entries()) {
                if (relay.status === 'running') {
                    if (isLiveNow && relay.mode !== 'live') {
                        console.log(`[Fallback] Switch vers Live pour ${platformId}`);
                        if (relay.process && !relay.process.killed) relay.process.kill('SIGTERM');
                    } else if (!isLiveNow && isWebTVNow && relay.mode !== 'webtv') {
                        console.log(`[Fallback] Switch vers WebTV pour ${platformId}`);
                        if (relay.process && !relay.process.killed) relay.process.kill('SIGTERM');
                    } else if (!isLiveNow && !isWebTVNow && relay.mode !== 'mire') {
                        console.log(`[Fallback] Switch vers Mire pour ${platformId}`);
                        if (relay.process && !relay.process.killed) relay.process.kill('SIGTERM');
                    }
                }
            }
        } catch (err) {
            console.error('[Fallback] Erreur monitoring:', err.message);
        }
    }, 5000);
}

startFallbackMonitor();

module.exports = {
    startRelay,
    stopRelay,
    startAllRelays,
    stopAllRelays,
    getRelayInfo,
    getAllRelayStatus,
};
