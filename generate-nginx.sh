#!/bin/sh

# ============================================================================
# Génération sécurisée de nginx.conf à partir du template
# Les clés de stream ne sont jamais écrites sur le volume hôte
# La config est générée IN-CONTAINER uniquement
# ============================================================================
# Compatible POSIX sh (Alpine ash)
# ============================================================================

set -eu

TEMPLATE_FILE="./nginx.conf.template"
OUTPUT_FILE="./nginx.conf"
ENV_FILE="./.env"

# Detect if running inside the container (where paths are fixed)
if [ -f "/etc/nginx/nginx.conf.template" ]; then
    TEMPLATE_FILE="/etc/nginx/nginx.conf.template"
    OUTPUT_FILE="/etc/nginx/nginx.conf"
    ENV_FILE="/etc/nginx/.env"
fi

# --- Validation du template ---
if [ ! -f "$TEMPLATE_FILE" ]; then
    echo "ERREUR: Template non trouvé: $TEMPLATE_FILE"
    exit 1
fi

# --- Chargement des variables d'environnement ---
if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE"
    set +a
else
    echo "ERREUR: Fichier .env non trouvé: $ENV_FILE"
    exit 1
fi

# --- Validation des variables obligatoires ---
# Note: les clés de stream (TWITCH_KEY, YOUTUBE_KEY, etc.) ne sont plus
# nécessaires dans nginx.conf. Elles sont lues par l'API backend.
# generate-nginx.sh ne gère plus que la config de base nginx.

# --- Génération de la config ---
echo "Génération de nginx.conf..."

# Copier le template tel quel (plus besoin de substitution de clés)
cp "$TEMPLATE_FILE" "$OUTPUT_FILE"

# --- Restriction des permissions (lisible uniquement par root/nginx) ---
chmod 600 "$OUTPUT_FILE"

echo "✓ nginx.conf généré dans le conteneur"
echo "  Les push vers les plateformes sont gérés par l'API backend"

