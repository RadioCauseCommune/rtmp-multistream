# 📡 Nginx-RTMP Multistream — Radio Cause Commune

Solution open-source de **multistreaming dynamique** propulsée par Nginx-RTMP, une API Node.js, du relay managé via FFmpeg, une **WebTV 24/7 auto-générée** avec sous-titres IA temps réel, et un Dashboard de contrôle néo-brutaliste.

**Développée par et pour [Radio Cause Commune — 93.1 FM Paris](https://causecommune.fm)**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

---

## 🚀 Fonctionnalités

| Fonctionnalité | Description |
|---|---|
| **Multistreaming Dynamique** | Réception du flux OBS et redistribution ciblée (YouTube, Twitch, PeerTube, Facebook, X) via FFmpeg |
| **Auto-Healing** | Reconnexion automatique avec backoff exponentiel en cas de coupure |
| **Stream de Secours** | Bascule intelligente sur une mire vidéo (`mire.mp4`) si OBS se déconnecte |
| **WebTV 24/7** | Moteur autonome Xvfb + Chromium + FFmpeg : overlay HTML + audio Icecast + audiogramme dynamique |
| **Sous-titres IA** | Transcription temps réel via [Voxtral](https://mistral.ai/) (vLLM + Socket.IO) affichée en incrustation vidéo |
| **Agenda Automatique** | Programmation de plages horaires pour la WebTV avec détection de priorité OBS en temps réel |
| **Restream Automatique** | Les relays vers les plateformes démarrent/s'arrêtent automatiquement avec l'agenda WebTV |
| **HLS Adaptive Bitrate** | Transcodage multi-qualités (1080p, 720p, 480p, Audio-Only) accessible publiquement |
| **VOD PeerTube** | Archivage auto des directs, re-muxing MP4 et upload asynchrone |
| **Dashboard** | Interface web néo-brutaliste pour contrôler toutes les fonctionnalités en temps réel |

## 🏗️ Architecture

```
OBS (Régie Studio)
        │
        ▼
┌──────────────────────────────────────┐
│  Nginx-RTMP (Docker)                 │
│  ├─ /live   → flux OBS              │
│  ├─ /webtv  → flux WebTV            │
│  ├─ /hls    → HLS ABR               │
│  └─ exec_publish → webhook API      │
└───────────┬──────────────────────────┘
            │
            ▼
┌──────────────────────────────────────┐
│  API Node.js (Docker)                │
│  ├─ Relais FFmpeg (auto-healing)     │
│  ├─ WebTV (Puppeteer + FFmpeg)       │
│  ├─ Scheduler (node-cron)            │
│  ├─ VOD (transcoding + PeerTube)     │
│  └─ Overlay locale + Socket.IO      │
└───────────┬──────────────────────────┘
            │
            ▼
┌──────────────────────────────────────┐
│  STUNNEL (RTMPS)                     │
└───────────┬──────────────────────────┘
            │
    ┌───────┼───────┬───────┬───────┐
    ▼       ▼       ▼       ▼       ▼
 Twitch  YouTube  PeerTube  X    Facebook
```

## ⚙️ Prérequis

- **Docker** & **Docker Compose** (V2)
- **Reverse Proxy** (Nginx / Traefik) avec certificat SSL
- Fichier `.env` configuré avec vos clés de stream

## 🛠️ Installation

### 1. Cloner le dépôt

```bash
git clone https://github.com/RadioCauseCommune/rtmp-multistream.git
cd rtmp-multistream
```

### 2. Configuration

```bash
# Copier les templates
cp .env.example .env
cp platforms.json.example platforms.json
cp schedule.json.example schedule.json

# Remplir vos clés de stream
nano .env

# Sécuriser le fichier
chmod 600 .env

# Générer la configuration Nginx
./generate-nginx.sh
```

### 3. Démarrage

```bash
docker compose up -d --build
```

Les services démarrent dans cet ordre :
1. **stunnel** — Passerelle RTMPS
2. **nginx-rtmp** — Serveur RTMP + HLS
3. **rtmp-api** — API + WebTV + Scheduler
4. **rtmp-stats** — Dashboard d'administration

### 4. Accès

| Service | URL |
|---------|-----|
| Dashboard | `http://[IP]:8081` |
| API | `http://[IP]:3000/api` |
| HLS Player | `http://[IP]:8081/hls/[STREAM_NAME].m3u8` |
| Stats XML | `http://[IP]:8080/stat` |

## 🔌 Configuration OBS

- **Serveur** : `rtmp://[IP_DU_SERVEUR]:1935/live`
- **Clé de stream** : valeur de `STREAM_NAME` dans `.env` (ex: `radiocausecommune`)

## 📚 API Reference

### Plateformes

```bash
# Lister les plateformes
curl http://localhost:3000/api/platforms

# Démarrer le relay vers YouTube
curl -X POST http://localhost:3000/api/stream/platforms/youtube/start

# Arrêter tous les relays
curl -X POST http://localhost:3000/api/stream/stop-all
```

### WebTV

```bash
# Démarrer la WebTV
curl -X POST http://localhost:3000/api/webtv/start

# Arrêter la WebTV
curl -X POST http://localhost:3000/api/webtv/stop

# Statut
curl http://localhost:3000/api/webtv/status
```

### Agenda (Scheduler)

```bash
# Lister les plages + statut
curl http://localhost:3000/api/schedule

# Ajouter une plage (Lundi 14h-16h)
curl -X POST http://localhost:3000/api/schedule \
  -H "Content-Type: application/json" \
  -d '{"label":"Émission du lundi","days":[1],"startTime":"14:00","endTime":"16:00"}'

# Supprimer une plage
curl -X DELETE http://localhost:3000/api/schedule/[ID]

# Changer le mode (auto/manual)
curl -X POST http://localhost:3000/api/schedule/mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"auto"}'
```

## 📂 Structure du projet

```
├── api/                      # API Node.js
│   ├── routes/               # Endpoints REST
│   │   ├── platforms.js      # CRUD plateformes
│   │   ├── stream.js         # Start/stop relays
│   │   ├── schedule.js       # Agenda WebTV
│   │   ├── webtv.js          # Contrôle WebTV
│   │   └── vod.js            # VOD PeerTube
│   ├── services/             # Logique métier
│   │   ├── ffmpeg.js         # Orchestrateur relays + fallback monitor
│   │   ├── webtv.js          # Moteur WebTV (Puppeteer + FFmpeg)
│   │   ├── scheduler.js      # Agenda automatique (node-cron)
│   │   ├── platforms.js      # Gestion platforms.json
│   │   └── nginx-stats.js    # Parser stats XML
│   ├── Dockerfile            # Image Node + Chromium + FFmpeg + Xvfb
│   └── server.js             # Point d'entrée Express
├── stats-dashboard/          # Dashboard néo-brutaliste
│   ├── index.html            # Interface complète (HTML/CSS/JS)
│   └── nginx.conf            # Proxy Nginx du dashboard
├── webtv-overlay/            # Overlay WebTV + sous-titres Voxtral
│   ├── index.html            # Overlay HTML (Socket.IO + API Airtime)
│   └── style.css             # Styles néo-brutalistes
├── logo/                     # Logos Radio Cause Commune
├── docker-compose.yml        # Topologie des services
├── nginx.conf.template       # Template Nginx-RTMP
├── stunnel.conf              # Passerelle RTMPS
├── generate-nginx.sh         # Génération nginx.conf depuis template
├── rotate-keys.sh            # Rotation des clés de stream
├── post-process.sh           # Conversion FLV → MP4
├── reverse-proxy-template.conf  # Template reverse proxy
├── .env.example              # Template des secrets
├── platforms.json.example    # Template config plateformes
├── schedule.json.example     # Template agenda
└── ROADMAP.md                # Historique et prochaines étapes
```

## 🔒 Sécurité

- Les **clés de stream** sont stockées dans `.env` (jamais committé)
- Le réseau Docker isole les services (`10.0.0.0/8`, `172.16.0.0/12`)
- La **publication RTMP** est restreinte aux IP du réseau local
- Le dashboard n'a **pas d'authentification intégrée** — utilisez un reverse proxy avec Basic Auth ou SSO

## 🤝 Contribuer

Les contributions sont les bienvenues ! Ce projet est sous licence **AGPL-3.0** : toute modification déployée sur un serveur public doit être redistribuée.

1. Forkez le dépôt
2. Créez votre branche (`git checkout -b feature/ma-fonctionnalite`)
3. Committez vos changements (`git commit -m 'feat: description'`)
4. Poussez (`git push origin feature/ma-fonctionnalite`)
5. Ouvrez une Pull Request

## 📄 Licence

[AGPL-3.0](LICENSE) — Radio Cause Commune, 2024-2026.

---

*Fait avec ❤️ par l'équipe technique de [Radio Cause Commune — 93.1 FM](https://causecommune.fm)*
