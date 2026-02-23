# 🚀 Guide d'Installation : RTMP Multistream sur Ubuntu 22.04 (LXC Proxmox)

Ce guide détaille l'installation complète de la stack de multistreaming pour Radio Cause Commune.

## 1. Préparation du Système

Connectez-vous à votre container Ubuntu et installez les dépendances nécessaires.

```bash
# Mise à jour des dépôts
apt update && apt upgrade -y

# Installation de Docker et Docker Compose
apt install -y docker.io docker-compose git curl

# Activation de Docker au démarrage
systemctl enable --now docker
```

> [!IMPORTANT]
> Assurez-vous que l'option **Nesting** est activée dans les options du container sur Proxmox.

---

## 2. Déploiement du Code

Clonez le dépôt ou copiez les fichiers dans le répertoire souhaité.

```bash
mkdir -p /opt/rtmp-multistream
cd /opt/rtmp-multistream
# [Copiez ici les fichiers du projet]
```

Donnez les permissions d'exécution aux scripts :
```bash
chmod +x *.sh
```

---

## 3. Configuration de l'Application

### Création du .env
Copiez le template et remplissez vos clés de diffusion pour Twitch, YouTube, etc.

```bash
cp .env.example .env
nano .env
```

> [!NOTE]
> Vous n'avez pas besoin d'installer Nginx sur l'hôte Ubuntu. La stack utilise des containers Docker qui embarquent leur propre serveur Nginx pré-configuré.

---

## 4. Démarrage des Services

Lancez la stack avec Docker Compose. La configuration Nginx sera générée automatiquement à partir de votre fichier `.env` au démarrage du container.

```bash
docker-compose up -d
```

Vérifiez que les containers sont bien lancés :
```bash
docker ps
```
Vous devriez voir `rtmp-server-cc`, `rtmp-stats-cc` and `rtmp-tunnel-cc`.

---

## 5. Intégration Reverse Proxy (192.168.10.100)

Sur votre machine reverse proxy (Nginx), utilisez la configuration suivante pour exposer le dashboard.

```nginx
# Exemple de configuration sur le proxy
server {
    listen 80;
    server_name stream.causecommune.fm;

    location / {
        proxy_pass http://10.10.10.49:8081; # Port du Dashboard Stats
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /stat {
        proxy_pass http://10.10.10.49:8080/stat; # Port de Nginx-RTMP
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 6. Utilisation et Monitoring

Le script `rtmp-manager.sh` est votre outil principal de gestion.

- **Voir les logs :** `./rtmp-manager.sh logs`
- **Monitorer en temps réel :** `./rtmp-manager.sh monitor`
- **Tester la connectivité :** `./rtmp-manager.sh test`
- **Mettre à jour une clé :** Utilisez `./rotate-keys.sh` ou modifiez le `.env` puis relancez `./generate-nginx.sh && docker compose restart nginx-rtmp`.

---

## 7. Configuration OBS

Pour diffuser vers ce serveur :
- **Service :** Personnalisé
- **Serveur :** `rtmp://10.10.10.49/live`
- **Clé de stream :** `radiocausecommune` (ou la valeur de `STREAM_NAME` dans votre `.env`)
