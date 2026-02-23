const express = require('express');
const router = express.Router();
const vodService = require('../services/vod');

/**
 * Endpoint appelé par Nginx-RTMP 'record_done'
 * Nginx envoie les donnees via POST en x-www-form-urlencoded
 */
router.post('/callback', (req, res) => {
    // Les paramètres Nginx standard: app, name, path
    // path contient le chemin absolu du fichier enregistré
    const { app, name, path: filePath } = req.body;

    console.log(`[Webhook VOD] 'record_done' reçu pour l'application '${app}', flux '${name}'`);
    console.log(`[Webhook VOD] Fichier sauvegardé sous: ${filePath}`);

    // Si on a bien un fichier d'archive de la live room
    if (app === 'archive' && filePath) {
        // Lancer le traitement de manière asynchrone pour ne pas bloquer Nginx
        vodService.processRecording(filePath, name).catch(err => {
            console.error('[Webhook VOD] Erreur asynchrone:', err);
        });
    }

    // Nginx requiert un simple HTTP 200 pour confirmer la réception
    res.status(200).send('OK');
});

module.exports = router;
