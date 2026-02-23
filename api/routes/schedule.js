const express = require('express');
const router = express.Router();
const scheduler = require('../services/scheduler');

// GET /api/schedule — Liste des plages + état du scheduler
router.get('/', (req, res) => {
    try {
        const data = scheduler.getSchedule();
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/schedule — Ajouter une plage horaire
router.post('/', (req, res) => {
    try {
        const { label, days, startTime, endTime, enabled } = req.body;

        if (!days || !Array.isArray(days) || days.length === 0) {
            return res.status(400).json({ error: 'Le champ "days" est requis (tableau de jours 1-7).' });
        }
        if (!startTime || !endTime) {
            return res.status(400).json({ error: 'Les champs "startTime" et "endTime" sont requis (HH:MM).' });
        }

        const timeRegex = /^\d{2}:\d{2}$/;
        if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
            return res.status(400).json({ error: 'Format horaire invalide. Utilisez HH:MM.' });
        }

        const slot = scheduler.addSlot({ label, days, startTime, endTime, enabled });
        res.status(201).json({ success: true, slot });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/schedule/:id — Modifier une plage
router.put('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        if (updates.startTime || updates.endTime) {
            const timeRegex = /^\d{2}:\d{2}$/;
            if (updates.startTime && !timeRegex.test(updates.startTime)) {
                return res.status(400).json({ error: 'Format startTime invalide. Utilisez HH:MM.' });
            }
            if (updates.endTime && !timeRegex.test(updates.endTime)) {
                return res.status(400).json({ error: 'Format endTime invalide. Utilisez HH:MM.' });
            }
        }

        const slot = scheduler.updateSlot(id, updates);
        if (!slot) {
            return res.status(404).json({ error: 'Plage non trouvée.' });
        }
        res.json({ success: true, slot });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/schedule/:id — Supprimer une plage
router.delete('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const deleted = scheduler.deleteSlot(id);
        if (!deleted) {
            return res.status(404).json({ error: 'Plage non trouvée.' });
        }
        res.json({ success: true, message: 'Plage supprimée.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/schedule/obs-active — Webhook : flux OBS publié
router.post('/obs-active', async (req, res) => {
    try {
        await scheduler.setObsActive(true);
        res.json({ success: true, message: 'OBS marqué comme actif.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/schedule/obs-inactive — Webhook : flux OBS terminé
router.post('/obs-inactive', async (req, res) => {
    try {
        await scheduler.setObsActive(false);
        res.json({ success: true, message: 'OBS marqué comme inactif.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/schedule/mode — Changer le mode (auto/manual)
router.post('/mode', (req, res) => {
    try {
        const { mode } = req.body;
        const ok = scheduler.setMode(mode);
        if (!ok) {
            return res.status(400).json({ error: 'Mode invalide. Utilisez "auto" ou "manual".' });
        }
        res.json({ success: true, mode });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
