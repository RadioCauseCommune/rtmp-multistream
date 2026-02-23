#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

echo "=== Rotation des clés de streaming ==="
echo ""

if [ ! -f "$ENV_FILE" ]; then
    echo "ERREUR: Fichier .env non trouvé"
    exit 1
fi

echo "Liste des plateformes:"
echo "  1. Twitch"
echo "  2. YouTube"
echo "  3. X (Twitter)"
echo "  4. Facebook"
echo "  5. Toutes"
echo ""

read -p "Sélectionner les clés à modifier (1-5): " choice

backup_file() {
    local file="$1"
    local backup="${file}.backup.$(date +%Y%m%d-%H%M%S)"
    cp "$file" "$backup"
    echo "  ✓ Sauvegarde: $backup"
}

update_key() {
    local platform="$1"
    local var_name="$2"
    local current_val="${!var_name}"

    echo ""
    echo "--- $platform ---"
    echo "Clé actuelle: ${current_val:0:15}..."
    read -p "Nouvelle clé (laisser vide pour garder l'ancienne): " new_val

    if [ -n "$new_val" ]; then
        backup_file "$ENV_FILE"
        sed -i "s|^${var_name}=.*|${var_name}=${new_val}|" "$ENV_FILE"
        echo "  ✓ Clé $platform mise à jour"
    else
        echo "  ✓ Clé inchangée"
    fi
}

case "$choice" in
    1) update_key "Twitch" "TWITCH_KEY" ;;
    2) update_key "YouTube" "YOUTUBE_KEY" ;;
    3) update_key "X (Twitter)" "X_KEY" ;;
    4) update_key "Facebook" "FACEBOOK_KEY" ;;
    5)
        update_key "Twitch" "TWITCH_KEY"
        update_key "YouTube" "YOUTUBE_KEY"
        update_key "X (Twitter)" "X_KEY"
        update_key "Facebook" "FACEBOOK_KEY"
        ;;
    *)
        echo "ERREUR: Choix invalide"
        exit 1
        ;;
esac

echo ""
echo "=== Reconfiguration du serveur ==="

if command -v docker-compose &> /dev/null; then
    cd "$SCRIPT_DIR"
    echo "Redémarrage des containers..."
    docker-compose restart nginx-rtmp
    echo "✓ Serveur redémarré"
else
    echo "⚠️ docker-compose non trouvé. Redémarrez manuellement:"
    echo "   cd $SCRIPT_DIR && docker-compose restart nginx-rtmp"
fi

echo ""
echo "=== Vérification ==="
echo "Le container Nginx régénérera sa configuration automatiquement au démarrage."
echo "Pour vérifier les clés actives (tronquées) : ./rtmp-manager.sh logs nginx-rtmp"

echo ""
echo "=== Terminé ==="
echo "Vérifiez le statut: ./rtmp-manager.sh status"
