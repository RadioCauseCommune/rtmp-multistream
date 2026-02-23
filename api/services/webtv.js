// ============================================================================
// Service WebTV - Génération de flux vidéo continu à partir de HTML + Audio
// ============================================================================

const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

const OVERLAY_URL = process.env.WEBTV_OVERLAY_URL || 'http://localhost:3000/overlay/index.html';
const AUDIO_URL = process.env.WEBTV_AUDIO_URL || 'https://connect.libre-a-toi.org/voixdulat_mp3';
const OUTPUT_URL = process.env.WEBTV_OUTPUT_URL || 'rtmp://nginx-rtmp:1935/webtv/live';
const VOXTRAL_URL = process.env.VOXTRAL_URL || '';

let webtvState = {
    status: 'stopped', // stopped, starting, running, error
    browser: null,
    xvfbProcess: null,
    ffmpegProcess: null,
    startedAt: null,
    lastError: null
};

/**
 * Démarrer le flux WebTV continu
 */
async function startWebTV() {
    if (webtvState.status === 'running' || webtvState.status === 'starting') {
        return { success: false, message: 'WebTV est déjà en cours de démarrage ou tourne déjà.' };
    }

    webtvState.status = 'starting';
    webtvState.lastError = null;
    console.log('[WebTV] Démarrage du flux 24/7...');

    try {
        // 1. Démarrer Xvfb (frambeuffer virtuel) sur le display :98
        console.log('[WebTV] Lancement de Xvfb sur :98');
        webtvState.xvfbProcess = spawn('Xvfb', [':98', '-screen', '0', '1920x1080x24']);

        webtvState.xvfbProcess.on('error', (err) => {
            console.error('[WebTV] Erreur Xvfb:', err);
            stopWebTV();
        });

        // Laisser 1 seconde à Xvfb pour s'initialiser
        await new Promise(r => setTimeout(r, 1000));

        // 2. Lancer Puppeteer dans le framebuffer Xvfb
        // Construire l'URL complète de l'overlay (avec paramètre Voxtral si configuré)
        let fullOverlayUrl = OVERLAY_URL;
        if (VOXTRAL_URL) {
            const sep = OVERLAY_URL.includes('?') ? '&' : '?';
            fullOverlayUrl = `${OVERLAY_URL}${sep}voxtral=${encodeURIComponent(VOXTRAL_URL)}`;
        }

        console.log(`[WebTV] Lancement de Chrome headless sur ${fullOverlayUrl}`);
        webtvState.browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
            headless: false, // Doit être 'false' pour le rendu dans Xvfb
            defaultViewport: { width: 1920, height: 1080 },
            ignoreDefaultArgs: ['--enable-automation'],
            args: [
                `--app=${fullOverlayUrl}`,
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--window-size=1920,1080',
                '--window-position=0,0',
                '--display=:98',
                '--autoplay-policy=no-user-gesture-required',
                '--kiosk',
                '--start-fullscreen',
                '--hide-scrollbars',
                '--disable-features=Translate',
                '--disable-infobars'
            ]
        });

        const pages = await webtvState.browser.pages();
        const page = pages.length > 0 ? pages[0] : await webtvState.browser.newPage();

        // Debugging logs from the overlay page
        page.on('console', msg => console.log('[WebTV Page]', msg.text()));
        page.on('pageerror', error => console.error('[WebTV Error]', error.message));

        // Cacher la barre de défilement pour faire propre
        await page.addStyleTag({ content: 'body { overflow: hidden; margin: 0; padding: 0; }' }).catch(() => { });

        try {
            if (page.url() !== fullOverlayUrl && page.url() !== `${fullOverlayUrl}/`) {
                await page.goto(fullOverlayUrl, { waitUntil: 'networkidle2', timeout: 15000 });
            }
        } catch (e) {
            console.log('[WebTV] Erreur mineure goto:', e.message);
        }
        console.log('[WebTV] Page chargée avec succès.');

        // 3. Lancer FFmpeg pour capturer X11 et le mix avec l'audio Icecast
        console.log(`[WebTV] Lancement de FFmpeg (X11grab + Audio -> ${OUTPUT_URL})`);

        const ffmpegArgs = [
            '-hide_banner', '-loglevel', 'warning',
            // Input 1 : Capture Vidéo X11
            '-f', 'x11grab',
            '-video_size', '1920x1080',
            '-framerate', '30',
            '-i', ':98.0',
            // Input 2 : Flux Audio Icecast
            '-re', // Lire à vitesse réelle
            '-i', AUDIO_URL,
            // Filtre de composition complexe : Audiogramme
            '-filter_complex', '[1:a]showwaves=s=1920x250:colors=0xB6F529:mode=cline,colorkey=black:0.3:0.2[wave];[0:v][wave]overlay=0:H-h-160[outv]',
            '-map', '[outv]',
            '-map', '1:a',
            // Encodage
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-b:v', '2500k',
            '-pix_fmt', 'yuv420p',
            '-g', '60',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-ar', '44100',
            // Output RTMP
            '-f', 'flv',
            '-flvflags', 'no_duration_filesize',
            OUTPUT_URL
        ];

        webtvState.ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, DISPLAY: ':98' }
        });

        let stderrBuffer = '';
        webtvState.ffmpegProcess.stderr.on('data', (data) => {
            stderrBuffer += data.toString();
            const lines = stderrBuffer.split('\n');
            if (lines.length > 10) {
                stderrBuffer = lines.slice(-10).join('\n');
            }
        });

        webtvState.ffmpegProcess.on('close', (code) => {
            console.log(`[WebTV] FFmpeg terminé (code: ${code})`);
            if (code !== 0 && stderrBuffer.trim()) {
                console.error(`[WebTV] Erreur FFmpeg: ${stderrBuffer.trim().split('\n').pop()}`);
            }
            if (webtvState.status === 'running') {
                webtvState.lastError = 'FFmpeg s\'est arrêté inopinément.';
                stopWebTV();
            }
        });

        webtvState.status = 'running';
        webtvState.startedAt = new Date().toISOString();
        console.log('[WebTV] Stream WebTV 24/7 EN LIGNE.');

        return { success: true, message: 'WebTV démarrée avec succès.' };
    } catch (err) {
        console.error('[WebTV] Erreur fatale au démarrage:', err.message);
        webtvState.lastError = err.message;
        await stopWebTV();
        return { success: false, message: `Erreur: ${err.message}` };
    }
}

/**
 * Arrêter le flux WebTV et nettoyer les process
 */
async function stopWebTV() {
    if (webtvState.status === 'stopped') {
        return { success: false, message: 'WebTV est déjà arrêtée.' };
    }

    console.log('[WebTV] Arrêt du flux WebTV...');
    webtvState.status = 'stopped';

    // 1. Stopper FFmpeg
    if (webtvState.ffmpegProcess && !webtvState.ffmpegProcess.killed) {
        try {
            webtvState.ffmpegProcess.kill('SIGTERM');
        } catch (e) { }
    }

    // 2. Fermer Chromium
    try {
        if (webtvState.browser) {
            await webtvState.browser.close();
            webtvState.browser = null;
        }
    } catch (e) {
        console.error('[WebTV] Erreur fermeture browser:', e.message);
    }

    // 3. Stopper Xvfb
    if (webtvState.xvfbProcess && !webtvState.xvfbProcess.killed) {
        try {
            webtvState.xvfbProcess.kill('SIGKILL');
        } catch (e) { }
    }

    webtvState.xvfbProcess = null;
    webtvState.ffmpegProcess = null;
    webtvState.startedAt = null;

    console.log('[WebTV] Processus nettoyés.');
    return { success: true, message: 'WebTV arrêtée.' };
}

/**
 * Obtenir l'état de la WebTV
 */
function getWebTVStatus() {
    return {
        status: webtvState.status,
        startedAt: webtvState.startedAt,
        lastError: webtvState.lastError,
        overlayUrl: OVERLAY_URL,
        audioUrl: AUDIO_URL
    };
}

module.exports = {
    startWebTV,
    stopWebTV,
    getWebTVStatus
};
