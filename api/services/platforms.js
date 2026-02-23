// ============================================================================
// Service de gestion des plateformes - Lecture/écriture de platforms.json
// ============================================================================

const fs = require('fs');
const path = require('path');

const PLATFORMS_FILE = process.env.PLATFORMS_FILE || '/app/platforms.json';

/**
 * Charger les plateformes depuis le fichier JSON
 */
function loadPlatforms() {
    try {
        const raw = fs.readFileSync(PLATFORMS_FILE, 'utf-8');
        const data = JSON.parse(raw);
        return data.platforms || [];
    } catch (err) {
        console.error(`Erreur lecture ${PLATFORMS_FILE}:`, err.message);
        return [];
    }
}

/**
 * Sauvegarder les plateformes dans le fichier JSON
 */
function savePlatforms(platforms) {
    const data = { platforms };
    fs.writeFileSync(PLATFORMS_FILE, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Trouver une plateforme par ID
 */
function findPlatform(id) {
    const platforms = loadPlatforms();
    return platforms.find(p => p.id === id) || null;
}

/**
 * Mettre à jour une plateforme par ID
 * @param {string} id - Identifiant de la plateforme
 * @param {object} updates - Champs à mettre à jour
 * @returns {object|null} La plateforme mise à jour ou null
 */
function updatePlatform(id, updates) {
    const platforms = loadPlatforms();
    const index = platforms.findIndex(p => p.id === id);
    if (index === -1) return null;

    // Champs modifiables (whitelist)
    const allowedFields = ['enabled', 'name', 'rtmp_url', 'max_bitrate_kbps'];
    for (const field of allowedFields) {
        if (updates[field] !== undefined) {
            platforms[index][field] = updates[field];
        }
    }

    savePlatforms(platforms);
    return platforms[index];
}

module.exports = {
    loadPlatforms,
    savePlatforms,
    findPlatform,
    updatePlatform,
};
