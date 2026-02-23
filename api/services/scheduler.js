// ============================================================================
// Service Scheduler - Programmation automatique de la WebTV par plages horaires
// ============================================================================

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const crypto = require('crypto');
const webtvService = require('./webtv');
const ffmpegService = require('./ffmpeg');

const SCHEDULE_FILE = process.env.SCHEDULE_FILE || '/app/schedule.json';

// ── État interne ────────────────────────────────────────────────────────────
let schedule = { slots: [] };
let cronTask = null;
let obsActive = false;        // Mis à jour par webhook nginx ou polling
let schedulerMode = 'auto';   // 'auto' = piloté par l'agenda, 'manual' = désactivé
let lastAction = null;        // Dernière action du scheduler (info)
let autoStartedWebTV = false; // true si c'est le scheduler qui a démarré la WebTV
let autoStartedRelays = false; // true si c'est le scheduler qui a démarré les relays
let relayStartTimer = null;   // Timer pour démarrage différé des relays

// ── Chargement / Sauvegarde ─────────────────────────────────────────────────

function loadSchedule() {
    try {
        if (fs.existsSync(SCHEDULE_FILE)) {
            const raw = fs.readFileSync(SCHEDULE_FILE, 'utf-8');
            schedule = JSON.parse(raw);
            if (!Array.isArray(schedule.slots)) {
                schedule.slots = [];
            }
            console.log(`[Scheduler] ${schedule.slots.length} plage(s) horaire(s) chargée(s).`);
        } else {
            schedule = { slots: [] };
            saveSchedule();
            console.log('[Scheduler] Fichier schedule.json créé (vide).');
        }
    } catch (err) {
        console.error('[Scheduler] Erreur chargement schedule.json:', err.message);
        schedule = { slots: [] };
    }
}

function saveSchedule() {
    try {
        fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(schedule, null, 2), 'utf-8');
    } catch (err) {
        console.error('[Scheduler] Erreur sauvegarde schedule.json:', err.message);
    }
}

// ── Logique Cron ────────────────────────────────────────────────────────────

/**
 * Vérifie si l'heure/jour actuels tombent dans une plage active.
 * @returns {{ active: boolean, slot: object|null }}
 */
function isInActiveSlot() {
    const now = new Date();
    // Jour ISO : 1=Lundi ... 7=Dimanche
    const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    for (const slot of schedule.slots) {
        if (!slot.enabled) continue;
        if (!slot.days.includes(dayOfWeek)) continue;

        const [startH, startM] = slot.startTime.split(':').map(Number);
        const [endH, endM] = slot.endTime.split(':').map(Number);
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        // Gestion des plages qui traversent minuit
        if (endMinutes <= startMinutes) {
            // Ex: 22:00 → 02:00
            if (currentMinutes >= startMinutes || currentMinutes < endMinutes) {
                return { active: true, slot };
            }
        } else {
            if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
                return { active: true, slot };
            }
        }
    }

    return { active: false, slot: null };
}

/**
 * Évalue la situation et agit en conséquence.
 * Appelée chaque minute par le cron.
 */
async function evaluate() {
    if (schedulerMode !== 'auto') return;

    const { active, slot } = isInActiveSlot();
    const webtvStatus = webtvService.getWebTVStatus();
    const isWebTVRunning = webtvStatus.status === 'running' || webtvStatus.status === 'starting';

    if (active) {
        // On est dans une plage programmée
        if (obsActive) {
            // Un flux OBS est actif → la WebTV doit se taire
            if (isWebTVRunning && autoStartedWebTV) {
                console.log(`[Scheduler] Flux OBS détecté pendant plage "${slot.label}" — Pause WebTV + Relays`);
                cancelRelayStart();
                if (autoStartedRelays) {
                    ffmpegService.stopAllRelays();
                    autoStartedRelays = false;
                }
                await webtvService.stopWebTV();
                lastAction = { type: 'paused_for_obs', slot: slot.label, at: new Date().toISOString() };
            }
        } else {
            // Pas de flux OBS → la WebTV doit tourner
            if (!isWebTVRunning) {
                console.log(`[Scheduler] Plage "${slot.label}" active — Démarrage WebTV automatique`);
                await webtvService.startWebTV();
                autoStartedWebTV = true;
                lastAction = { type: 'auto_start', slot: slot.label, at: new Date().toISOString() };

                // Démarrer les relays après un délai (laisser le RTMP se stabiliser)
                scheduleRelayStart(slot.label);
            } else if (autoStartedWebTV && !autoStartedRelays && !relayStartTimer) {
                // WebTV tourne déjà mais pas de relays → les lancer
                scheduleRelayStart(slot.label);
            }
        }
    } else {
        // Hors plage programmée
        if (autoStartedWebTV || autoStartedRelays) {
            console.log('[Scheduler] Fin de plage programmée — Arrêt WebTV + Relays automatique');
            cancelRelayStart();
            if (autoStartedRelays) {
                ffmpegService.stopAllRelays();
                autoStartedRelays = false;
            }
            if (isWebTVRunning && autoStartedWebTV) {
                await webtvService.stopWebTV();
            }
            autoStartedWebTV = false;
            lastAction = { type: 'auto_stop', at: new Date().toISOString() };
        }
    }
}

/**
 * Planifie le démarrage des relays avec un délai pour laisser
 * le flux RTMP se stabiliser après le démarrage de la WebTV.
 */
function scheduleRelayStart(slotLabel) {
    cancelRelayStart();
    const RELAY_DELAY_MS = 15000; // 15 secondes
    console.log(`[Scheduler] Relays programmés dans ${RELAY_DELAY_MS / 1000}s...`);

    relayStartTimer = setTimeout(async () => {
        relayStartTimer = null;
        try {
            const webtvStatus = webtvService.getWebTVStatus();
            if (webtvStatus.status !== 'running') {
                console.log('[Scheduler] WebTV pas encore prête — relays reportés');
                return;
            }
            console.log(`[Scheduler] Démarrage relays automatiques pour "${slotLabel}"`);
            const results = await ffmpegService.startAllRelays();
            autoStartedRelays = true;
            const started = results.filter(r => r.success).length;
            const failed = results.filter(r => !r.success).length;
            console.log(`[Scheduler] Relays lancés : ${started} OK, ${failed} échec(s)`);
            lastAction = { type: 'auto_relay_start', slot: slotLabel, relays: started, at: new Date().toISOString() };
        } catch (err) {
            console.error('[Scheduler] Erreur démarrage relays:', err.message);
        }
    }, RELAY_DELAY_MS);
}

function cancelRelayStart() {
    if (relayStartTimer) {
        clearTimeout(relayStartTimer);
        relayStartTimer = null;
    }
}

// ── Gestion OBS (webhooks) ──────────────────────────────────────────────────

/**
 * Appelé quand un flux OBS est publié sur /live
 */
async function setObsActive(active) {
    const wasActive = obsActive;
    obsActive = active;
    console.log(`[Scheduler] OBS ${active ? 'ACTIF' : 'INACTIF'}`);

    // Si l'OBS vient de partir et qu'on est dans une plage → relancer la WebTV
    if (wasActive && !active) {
        // Petite temporisation pour éviter un faux positif (OBS qui redémarre)
        setTimeout(() => {
            if (!obsActive) {
                evaluate();
            }
        }, 3000);
    } else if (!wasActive && active) {
        // OBS vient d'arriver → évaluer immédiatement
        await evaluate();
    }
}

// ── CRUD Slots ──────────────────────────────────────────────────────────────

function getSchedule() {
    return {
        slots: schedule.slots,
        status: {
            mode: schedulerMode,
            obsActive,
            autoStartedWebTV,
            autoStartedRelays,
            lastAction,
            currentSlot: isInActiveSlot(),
            nextSlot: getNextSlot()
        }
    };
}

function addSlot({ label, days, startTime, endTime, enabled = true }) {
    const slot = {
        id: crypto.randomUUID(),
        label: label || 'Sans titre',
        days: days || [],
        startTime: startTime || '00:00',
        endTime: endTime || '23:59',
        enabled
    };

    schedule.slots.push(slot);
    saveSchedule();
    console.log(`[Scheduler] Plage ajoutée : "${slot.label}" (${slot.id})`);

    // Réévaluer immédiatement
    evaluate();

    return slot;
}

function updateSlot(id, updates) {
    const idx = schedule.slots.findIndex(s => s.id === id);
    if (idx === -1) return null;

    const allowed = ['label', 'days', 'startTime', 'endTime', 'enabled'];
    for (const key of allowed) {
        if (updates[key] !== undefined) {
            schedule.slots[idx][key] = updates[key];
        }
    }

    saveSchedule();
    console.log(`[Scheduler] Plage modifiée : "${schedule.slots[idx].label}" (${id})`);

    // Réévaluer immédiatement
    evaluate();

    return schedule.slots[idx];
}

function deleteSlot(id) {
    const idx = schedule.slots.findIndex(s => s.id === id);
    if (idx === -1) return false;

    const removed = schedule.slots.splice(idx, 1)[0];
    saveSchedule();
    console.log(`[Scheduler] Plage supprimée : "${removed.label}" (${id})`);

    // Réévaluer immédiatement
    evaluate();

    return true;
}

// ── Utilitaires ─────────────────────────────────────────────────────────────

/**
 * Trouver le prochain créneau programmé
 */
function getNextSlot() {
    const now = new Date();
    const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    let bestSlot = null;
    let bestDelta = Infinity;

    for (const slot of schedule.slots) {
        if (!slot.enabled) continue;

        const [startH, startM] = slot.startTime.split(':').map(Number);
        const startMinutes = startH * 60 + startM;

        for (const day of slot.days) {
            let dayDelta = day - dayOfWeek;
            if (dayDelta < 0) dayDelta += 7;

            let totalMinutesDelta;
            if (dayDelta === 0 && startMinutes > currentMinutes) {
                totalMinutesDelta = startMinutes - currentMinutes;
            } else if (dayDelta === 0) {
                totalMinutesDelta = 7 * 24 * 60 + (startMinutes - currentMinutes);
            } else {
                totalMinutesDelta = dayDelta * 24 * 60 + (startMinutes - currentMinutes);
            }

            if (totalMinutesDelta < bestDelta) {
                bestDelta = totalMinutesDelta;
                bestSlot = {
                    ...slot,
                    nextStart: formatNextStart(totalMinutesDelta)
                };
            }
        }
    }

    return bestSlot;
}

function formatNextStart(minutesDelta) {
    if (minutesDelta < 60) return `dans ${minutesDelta}min`;
    const hours = Math.floor(minutesDelta / 60);
    const mins = minutesDelta % 60;
    if (hours < 24) return `dans ${hours}h${mins > 0 ? String(mins).padStart(2, '0') : ''}`;
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `dans ${days}j ${remHours}h`;
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

function init() {
    loadSchedule();

    // Cron : évaluer toutes les minutes
    cronTask = cron.schedule('* * * * *', () => {
        evaluate().catch(err => {
            console.error('[Scheduler] Erreur évaluation:', err.message);
        });
    }, { timezone: process.env.TZ || 'Europe/Paris' });

    console.log('[Scheduler] Initialisé — Évaluation toutes les minutes.');

    // Première évaluation immédiate
    setTimeout(() => evaluate(), 5000);
}

function stop() {
    if (cronTask) {
        cronTask.stop();
        cronTask = null;
    }
    console.log('[Scheduler] Arrêté.');
}

function setMode(mode) {
    if (mode === 'auto' || mode === 'manual') {
        schedulerMode = mode;
        console.log(`[Scheduler] Mode changé → ${mode}`);
        if (mode === 'auto') {
            evaluate();
        }
        return true;
    }
    return false;
}

// ── Export ───────────────────────────────────────────────────────────────────

module.exports = {
    init,
    stop,
    getSchedule,
    addSlot,
    updateSlot,
    deleteSlot,
    setObsActive,
    setMode,
    isInActiveSlot
};
