# Guide d'installation nginx-rtmp - Radio Cause Commune

## 🎯 Objectif

Remplacer Restream.io (500$/an) par une solution maison de multistreaming professionnelle avec :
- Diffusion simultanée vers Twitch, YouTube, X, Facebook, etc.
- Enregistrement automatique local
- Dashboard de monitoring en temps réel
- Contrôle total et coût : **0€**

## 📊 Performance avec FTTO 100Mbps

**Scénario multistream** :
```
Twitch (1080p 30fps) :     6 Mbps
YouTube (1080p 30fps) :    6 Mbps
X (720p) :                 4 Mbps
Facebook (optionnel) :     4 Mbps
Enregistrement local :     0 Mbps (pas d'upload)
─────────────────────────────────
TOTAL Upload :            20 Mbps
Marge disponible :        80 Mbps
```

**Verdict** : ✅ 100Mbps est **largement suffisant**

## 🏗️ Architecture

```
┌─────────────────┐
│   HP OBS        │  Stream 1x vers serveur local
│  192.168.20.12  │  (8 Mbps, charge CPU minimale)
└────────┬────────┘
         │ RTMP
         ↓
┌────────────────────────────────┐
│  Serveur nginx-rtmp (VM)       │
│  192.168.10.XX                 │
│  - Réplication des flux        │
│  - Enregistrement local        │
│  - Monitoring stats            │
└───┬────┬────┬────┬─────────────┘
    │    │    │    │
    ↓    ↓    ↓    ↓
 Twitch YouTube X  Facebook
 (6Mb)  (6Mb)  (4Mb) (4Mb)
```

**Avantages** :
- HP OBS envoie **1 seul flux** → charge minimale
- Serveur fait la distribution → pas de perte si une plateforme lag
- Enregistrement centralisé → archivage automatique
- Monitoring unifié → stats en temps réel

## 📦 Fichiers fournis

1. **docker-compose.yml** - Configuration Docker
2. **nginx.conf** - Configuration nginx-rtmp
3. **stats-dashboard/index.html** - Dashboard de monitoring
4. **rtmp-manager.sh** - Script de gestion
5. **README-nginx-rtmp.md** - Ce guide

## 🚀 Installation

### Prérequis

**Serveur** :
- Une VM Ubuntu 22.04/24.04 sur votre réseau 192.168.10.X
- 2 CPU / 4GB RAM minimum
- 100GB disque (pour les enregistrements)
- Docker & Docker Compose installés

**Réseau** :
- Accessible depuis 192.168.20.0/24 (réseau régie)
- Accès Internet pour push vers les plateformes

### Étape 1 : Préparation de la VM

```bash
# Connexion à la VM
ssh user@192.168.10.XX

# Mise à jour du système
sudo apt update && sudo apt upgrade -y

# Installation Docker (si pas déjà fait)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

# Vérification
docker --version
docker compose version
```

### Étape 2 : Déploiement des fichiers

```bash
# Créer le répertoire de travail
mkdir -p ~/nginx-rtmp
cd ~/nginx-rtmp

# Copier les fichiers fournis dans ce répertoire
# - docker-compose.yml
# - nginx.conf
# - rtmp-manager.sh
# - stats-dashboard/index.html

# Rendre le script exécutable
chmod +x rtmp-manager.sh
```

### Étape 3 : Configuration des clés de streaming

**Important** : Ne mettez JAMAIS vos clés dans un repo Git !

```bash
# Créer le fichier de clés (ignoré par git)
cat > .stream_keys << 'EOF'
# Clés de streaming - NE PAS COMMITER
TWITCH_KEY=live_123456789_abcdefghijklmnop
YOUTUBE_KEY=xxxx-yyyy-zzzz-wwww-vvvv
X_KEY=your_x_stream_key
FACEBOOK_KEY=your_facebook_stream_key
EOF

# Protéger le fichier
chmod 600 .stream_keys
```

**Où trouver vos clés ?**

**Twitch** :
1. https://dashboard.twitch.tv/settings/stream
2. Copier la "Clé de stream primaire"

**YouTube** :
1. https://studio.youtube.com/
2. Diffusion en direct → Gérer → Clé de diffusion

**X (Twitter)** :
1. https://studio.twitter.com/
2. Accéder aux paramètres de diffusion

**Facebook** :
1. https://www.facebook.com/live/producer
2. Récupérer la clé de flux

### Étape 4 : Mise à jour de la configuration

```bash
# Éditer nginx.conf et remplacer les placeholders
nano nginx.conf

# Chercher et remplacer :
# VOTRE_TWITCH_STREAM_KEY → votre vraie clé
# VOTRE_YOUTUBE_STREAM_KEY → votre vraie clé
# etc.

# OU utiliser le script automatique :
./rtmp-manager.sh update-keys
```

**Important** : Décommentez seulement les plateformes que vous utilisez dans `nginx.conf`

### Étape 5 : Initialisation et démarrage

```bash
# Configuration initiale
./rtmp-manager.sh setup

# Démarrer le serveur
./rtmp-manager.sh start

# Vérifier le statut
./rtmp-manager.sh status

# Tester la connectivité
./rtmp-manager.sh test
```

Vous devriez voir :
```
✓ Port RTMP 1935 accessible
✓ Port HTTP 8080 accessible
✓ Serveur en bonne santé
```

## 🎬 Configuration OBS

### Sur HP OBS (192.168.20.12)

**Paramètres → Diffusion** :

```
Service : Personnalisé
Serveur : rtmp://192.168.10.XX:1935/live
Clé de diffusion : radiocausecommune
```

(Remplacez `192.168.10.XX` par l'IP de votre VM)

**Paramètres → Sortie** :

```
Mode de sortie : Avancé

Onglet "Diffusion" :
- Encodeur : NVENC H.264 (GPU Nvidia) ou x264 (CPU)
- Contrôle de débit : CBR
- Débit : 8000 Kbps
- Intervalle d'image clé : 2
- Préréglage : Quality (NVENC) ou veryfast (x264)
- Profil : high
- Accordage : hq (NVENC)
```

**Paramètres → Vidéo** :

```
Résolution de base : 1920x1080
Résolution de sortie : 1920x1080 (ou 1280x720 si besoin)
FPS : 30 (ou 60 si puissance suffisante)
```

**Paramètres → Audio** :

```
Fréquence d'échantillonnage : 48 kHz
Canaux : Stéréo
```

## 📊 Accès au monitoring

### Dashboard en temps réel

Ouvrir dans un navigateur : **http://192.168.10.XX:8081**

Vous verrez :
- État du stream (LIVE / OFFLINE)
- Bitrate en temps réel
- Nombre de viewers
- Durée du stream
- Status de chaque plateforme
- Statistiques détaillées

### Stats XML brutes

**http://192.168.10.XX:8080/stat**

Format XML avec toutes les métriques détaillées.

### Via le script manager

```bash
# Stats en console
./rtmp-manager.sh stats

# Monitoring continu (rafraîchit toutes les 5s)
./rtmp-manager.sh monitor

# Logs en temps réel
./rtmp-manager.sh logs
```

## 🎥 Utilisation quotidienne

### Démarrer un stream

1. Démarrer le serveur nginx-rtmp (si pas déjà fait) :
```bash
./rtmp-manager.sh start
```

2. Sur HP OBS : cliquer sur "Démarrer le streaming"

3. Vérifier le dashboard : http://192.168.10.XX:8081
   - Le status doit passer à "🔴 LIVE"
   - Les plateformes doivent être en vert
   - Le bitrate doit monter à ~8000 kbps

4. Vérifier sur les plateformes :
   - Twitch : https://dashboard.twitch.tv/
   - YouTube : https://studio.youtube.com/
   - etc.

### Arrêter un stream

1. Sur HP OBS : cliquer sur "Arrêter le streaming"

2. Le dashboard doit passer à "OFFLINE"

3. L'enregistrement est sauvegardé automatiquement dans `/var/recordings`

## 💾 Gestion des enregistrements

### Accéder aux enregistrements

**Via navigateur** : http://192.168.10.XX:8080/recordings/

**Via SSH** :
```bash
./rtmp-manager.sh recordings
```

### Format des fichiers

Les enregistrements sont au format `.flv` avec timestamp :
```
radiocausecommune_20260127_153045.flv
```

### Conversion en MP4 (optionnel)

```bash
# Installer ffmpeg si pas déjà fait
sudo apt install ffmpeg

# Convertir un enregistrement
cd ~/nginx-rtmp/recordings
ffmpeg -i votre_stream_20260127.flv -c copy output.mp4
```

### Nettoyage automatique

```bash
# Supprimer les enregistrements de plus de 30 jours
./rtmp-manager.sh clean-recordings
```

Ou automatiser avec cron :
```bash
# Éditer le crontab
crontab -e

# Ajouter (nettoyage tous les lundis à 3h)
0 3 * * 1 cd /home/user/nginx-rtmp && ./rtmp-manager.sh clean-recordings -y
```

## 🔧 Administration

### Commandes utiles

```bash
# Démarrer le serveur
./rtmp-manager.sh start

# Arrêter le serveur
./rtmp-manager.sh stop

# Redémarrer (après modif config)
./rtmp-manager.sh restart

# Voir les logs
./rtmp-manager.sh logs

# Monitoring temps réel
./rtmp-manager.sh monitor

# Test de connectivité
./rtmp-manager.sh test

# Backup de la config
./rtmp-manager.sh backup

# Status détaillé
./rtmp-manager.sh status
```

### Modifier la configuration

```bash
# Éditer nginx.conf
nano nginx.conf

# Redémarrer pour appliquer
./rtmp-manager.sh restart
```

### Ajouter/retirer des plateformes

Dans `nginx.conf`, section `application live` :

```nginx
# Pour ACTIVER une plateforme : décommenter la ligne push
push rtmp://live.twitch.tv/app/VOTRE_CLE;

# Pour DÉSACTIVER : commenter la ligne
# push rtmp://live.twitch.tv/app/VOTRE_CLE;
```

Puis redémarrer : `./rtmp-manager.sh restart`

## 🔐 Sécurité

### Protéger l'accès

**Limiter les IPs autorisées** :

Dans `nginx.conf` :
```nginx
application live {
    # Autoriser uniquement depuis régie et serveur
    allow publish 192.168.20.0/24;  # Réseau régie
    allow publish 192.168.10.0/24;  # Réseau serveur
    deny publish all;
}
```

**Protéger le dashboard avec mot de passe** :

```bash
# Installer apache2-utils
sudo apt install apache2-utils

# Créer un fichier htpasswd
htpasswd -c ~/nginx-rtmp/.htpasswd admin

# Éditer docker-compose.yml pour ajouter l'auth sur le service rtmp-stats
```

### Fichiers sensibles

**Ne JAMAIS commiter** :
- `.stream_keys` (contient vos clés)
- `nginx.conf` avec vos vraies clés
- `/recordings` (enregistrements)

**Créer un `.gitignore`** :
```bash
cat > .gitignore << 'EOF'
.stream_keys
nginx.conf
recordings/
logs/
*.flv
*.mp4
backups/
EOF
```

## 🚨 Troubleshooting

### Problème : OBS ne se connecte pas

**Symptôme** : OBS affiche "Connexion au serveur..."

**Solutions** :
1. Vérifier que le serveur tourne :
```bash
./rtmp-manager.sh status
```

2. Tester la connectivité :
```bash
./rtmp-manager.sh test
```

3. Vérifier les logs :
```bash
./rtmp-manager.sh logs
```

4. Vérifier l'IP dans OBS : doit être `192.168.10.XX`, pas `localhost`

5. Vérifier le firewall sur la VM :
```bash
sudo ufw allow 1935/tcp
sudo ufw allow 8080/tcp
```

### Problème : Une plateforme ne reçoit pas le flux

**Symptôme** : Le dashboard montre LIVE mais une plateforme reste inactive

**Solutions** :
1. Vérifier la clé de stream dans `nginx.conf`

2. Vérifier que la ligne push n'est pas commentée :
```bash
grep "push rtmp://live.twitch.tv" nginx.conf
```

3. Tester manuellement avec ffmpeg :
```bash
ffmpeg -re -i test.mp4 -c copy -f flv rtmp://live.twitch.tv/app/VOTRE_CLE
```

4. Vérifier les logs nginx :
```bash
./rtmp-manager.sh logs | grep "error"
```

### Problème : Enregistrements ne se créent pas

**Symptôme** : Le dossier `/recordings` est vide

**Solutions** :
1. Vérifier les permissions :
```bash
ls -la ~/nginx-rtmp/recordings
# Doit être accessible en écriture
```

2. Vérifier l'espace disque :
```bash
df -h
```

3. Vérifier la config d'enregistrement dans `nginx.conf` :
```nginx
application archive {
    record all;
    record_path /var/recordings;
}
```

4. Vérifier les logs :
```bash
docker-compose logs nginx-rtmp | grep record
```

### Problème : Performances dégradées / lag

**Symptôme** : Stream saccadé, buffering

**Solutions** :
1. Vérifier la charge CPU de la VM :
```bash
top
```

2. Vérifier la bande passante utilisée :
```bash
# Sur le MikroTik
/interface monitor-traffic ether5
```

3. Réduire le bitrate dans OBS (passer de 8000 à 6000 kbps)

4. Désactiver des plateformes pour réduire la charge

5. Augmenter les ressources de la VM (CPU/RAM)

### Problème : Dashboard ne s'affiche pas

**Symptôme** : Page blanche ou erreur 502

**Solutions** :
1. Vérifier que le container rtmp-stats tourne :
```bash
docker-compose ps
```

2. Vérifier les logs :
```bash
docker-compose logs rtmp-stats
```

3. Redémarrer le service :
```bash
docker-compose restart rtmp-stats
```

## 📈 Optimisations avancées

### Transcoding à la volée (plusieurs qualités)

Modifier `nginx.conf` pour ajouter des variantes :

```nginx
application live {
    live on;
    
    # Flux original
    push rtmp://127.0.0.1:1935/hls;
    
    # Transcode vers 720p
    exec ffmpeg -i rtmp://localhost:1935/live/$name
        -c:v libx264 -b:v 3000k -s 1280x720 -c:a aac -b:a 128k
        -f flv rtmp://localhost:1935/hls/${name}_720p;
    
    # Transcode vers 480p
    exec ffmpeg -i rtmp://localhost:1935/live/$name
        -c:v libx264 -b:v 1500k -s 854x480 -c:a aac -b:a 96k
        -f flv rtmp://localhost:1935/hls/${name}_480p;
}
```

⚠️ **Attention** : Demande beaucoup de CPU !

### Intégration avec APIs externes

**Webhook au démarrage/arrêt du stream** :

Dans `nginx.conf` :
```nginx
application live {
    # Callback au démarrage
    on_publish http://192.168.10.XX:5000/webhook/stream_start;
    
    # Callback à l'arrêt
    on_publish_done http://192.168.10.XX:5000/webhook/stream_stop;
}
```

Créer un serveur Flask pour recevoir les webhooks :
```python
from flask import Flask, request
app = Flask(__name__)

@app.route('/webhook/stream_start', methods=['POST'])
def stream_start():
    # Envoyer notification Discord/Slack
    # Mettre à jour le site web
    # Logger l'événement
    return "OK"

@app.route('/webhook/stream_stop', methods=['POST'])
def stream_stop():
    # Notification fin de stream
    return "OK"
```

### Monitoring avec Prometheus + Grafana

Décommenter dans `docker-compose.yml` :
```yaml
prometheus:
  # ...
grafana:
  # ...
```

Accès Grafana : http://192.168.10.XX:3000

### Archivage automatique vers S3/Wasabi

Script de synchronisation :
```bash
#!/bin/bash
# sync-recordings.sh

# Synchroniser vers S3-compatible storage
rclone sync /home/user/nginx-rtmp/recordings \
    s3:radiocausecommune-archives/streams \
    --transfers 4 \
    --checkers 8 \
    --log-file=/var/log/rclone-sync.log
```

Automatiser avec cron :
```bash
# Tous les jours à 4h
0 4 * * * /home/user/nginx-rtmp/sync-recordings.sh
```

## 💰 Comparaison Restream.io vs Solution maison

| Critère | Restream.io | nginx-rtmp |
|---------|-------------|------------|
| **Coût annuel** | 500$ | 0€ |
| **Contrôle** | Limité | Total |
| **Enregistrement local** | Non | Oui |
| **Personnalisation** | Limitée | Complète |
| **Dépendance** | Oui | Non |
| **Stats** | Basiques | Détaillées |
| **Latence** | +2-5s | Minimale |
| **Uptime** | 99.9% | Vous gérez |

**ROI** : Configuration initiale = 4-8h → Économies = 500$/an 🎉

## 📚 Ressources

**Documentation nginx-rtmp** :
- https://github.com/arut/nginx-rtmp-module

**Optimisation OBS** :
- https://obsproject.com/wiki/Stream-Settings

**Clés de streaming** :
- Twitch: https://dashboard.twitch.tv/settings/stream
- YouTube: https://studio.youtube.com/
- Facebook: https://www.facebook.com/live/producer

**Support** :
- Radio Cause Commune : technique@radiocausecommune.org

---

**Prêt à économiser 500$/an tout en gardant le contrôle total ?** 🚀

Prochaine étape : `./rtmp-manager.sh setup`
