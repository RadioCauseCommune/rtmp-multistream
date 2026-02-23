#!/bin/bash

# ============================================================================
# Script de post-traitement des enregistrements - Radio Cause Commune
# Convertit les fichiers .flv en .mp4 sans perte de qualité
# ============================================================================

RECORDINGS_DIR="/home/olicatssh/nginx-rtmp/recordings"

echo "Démarrage de la conversion des nouveaux enregistrements..."

cd "$RECORDINGS_DIR" || exit

for file in *.flv; do
    if [ -f "$file" ]; then
        filename="${file%.*}"
        if [ ! -f "$filename.mp4" ]; then
            echo "Conversion de $file vers $filename.mp4..."
            ffmpeg -i "$file" -c copy -copyts "$filename.mp4" -y
            echo "✓ Terminé : $filename.mp4"
        fi
    fi
done

echo "Nettoyage des enregistrements de plus de 30 jours..."
find . -name "*.flv" -mtime +30 -delete
find . -name "*.mp4" -mtime +30 -delete

echo "Fini !"
