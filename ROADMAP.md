# Roadmap d'Évolution - Radio Cause Commune Multistream

Ce document trace les objectifs accomplis et les développements futurs prévus pour l'infrastructure de streaming "Radio Cause Commune".

---

## ✅ Objectifs Atteints (Février 2026)

### Phase 1 : Résilience & Auto-Healing
- Création d'un manager de relayage dynamique de flux (`api/services/ffmpeg.js`).
- Détection des décrochages (erreur TCP "Broken Pipe") et relance intelligente (*Exponential Backoff*).
- Surveillance du flux global via API plutôt que par la redondance bas-niveau de Nginx.

### Phase 2 : Stream de Secours (La Mire 📽️)
- Intégration d'un flux "Fallback" automatique.
- Si le diffuseur de la Web-Radio (régie, OBS) perd la connexion et coupe son flux sur `/live`, le serveur API injecte instantanément un flux vidéo d'attente codé en dur (image statique avec mention "Retour dans un instant").
- Évite l'extinction complète des flux YouTube et Twitch qui coupent très vite en l'absence d'information réseau.

### Phase 3 : WebTV 24/7 (Overlay & Audiogramme Dynamique 📺)
- Ajout d'une fonctionnalité pour permettre à la Web-radio de diffuser en temps continu, sans mobiliser de ressource client OBS.
- Intégration d'un navigateur headless `Chromium` sous `Puppeteer` couplé à un serveur graphique virtuel (`Xvfb`).
- Capture du bandeau d'information Airtime localement.
- Combinaison vidéo/Icecast via un `filter_complex` FFmpeg dessinant un majestueux oscilloscope fluo en superposition.
- Le tout géré via Dashboard.

### Phase 4.1 : Adaptive Bitrate Streaming (ABR) HLS
- Configuration des workers CPU dans `nginx-rtmp` pour multiplier et transcoder le stream entrant 1080p en flux **720p**, **480p** et un **Audio-Only** via `ffmpeg`.
- Génération d'un index Multi-Qualité via le format **HLS** (`.m3u8`).
- Intégration d'un lecteur Web `hls.js` interactif directement dans le Stream Dashboard permettant de prévisualiser l'Adaptive Bitrate sur toutes les qualités.

### Phase 4.2 : Automatisation VOD et Upload (PeerTube)
- Mise en place d'un service de post-traitement automatique (`api/services/vod.js`) déclenché par webhook Nginx (`record_done`).
- Conversion sans perte des archives `.flv` en conteneurs `.mp4` optimisés pour le web (flag `faststart`).
- Intégration de l'API PeerTube pour l'upload asynchrone des archives avec métadonnées dynamiques.

### Phase 4.3 : Sécurité Interactive (Auth du Dashboard)
- Protection du Dashboard et de l'API par authentification `auth_basic` au niveau du reverse proxy Nginx (`192.168.10.100`).
- Découpage fin des locations : le flux HLS et les assets publics (`/hls/`, `/health`, `/logo`) restent accessibles sans authentification, tandis que le dashboard, l'API, les stats XML et les recordings sont protégés.
- Credentials gérés via `.htpasswd` sur le serveur reverse proxy, sécurisés par le tunnel TLS Let's Encrypt existant.

---

## 🚀 Prochaines Étapes

### Phase 5 : Agenda WebTV (Programmation Automatique)

- Service de planification (`api/services/scheduler.js`) avec évaluation cron toutes les minutes.
- CRUD de plages horaires via API REST (`/api/schedule`), stockées dans `schedule.json`.
- Démarrage/arrêt automatique de la WebTV selon la grille de programmes (jours + plages horaires).
- Gestion de la priorité OBS : si un flux live OBS arrive pendant une plage WebTV, la WebTV se met en pause et reprend automatiquement à la fin du direct.
- Détection OBS en temps réel via les hooks `exec_publish`/`exec_publish_done` natifs de nginx-rtmp.
- Section « Agenda WebTV » intégrée dans la sidebar du Dashboard avec gestion inline des plages.
- Restream automatique : les relays vers les plateformes actives démarrent automatiquement 15s après la WebTV, s'arrêtent proprement à la fin de la plage ou lors d'un basculement OBS.

### 5.1. Sous-titres en direct (Voxtral)

- Overlay WebTV locale (`webtv-overlay/index.html`) avec intégration Socket.IO vers le bridge Voxtral (`192.168.10.105:5004`).
- Transcription temps réel via vLLM, affichée en incrustation néo-brutaliste sur le flux vidéo.
- Les sous-titres sont automatiquement brûlés dans l'encodage vidéo via la capture X11 de FFmpeg.

### 5.2. Alerting via Webhook (Discord / Slack)

- Si le stream tombe ou ne remonte pas après 3 tentatives de backoff FFmpeg, notifier immédiatement l'équipe technique de la radio via un bot chat.
