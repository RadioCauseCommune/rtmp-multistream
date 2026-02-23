const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class VodService {
    constructor() {
        this.recordingsDir = process.env.RECORDINGS_DIR || '/var/recordings';
        this.peertubeUrl = process.env.PEERTUBE_URL;
        this.peertubeClientId = process.env.PEERTUBE_CLIENT_ID;
        this.peertubeClientSecret = process.env.PEERTUBE_CLIENT_SECRET;
        this.peertubeUsername = process.env.PEERTUBE_USERNAME;
        this.peertubePassword = process.env.PEERTUBE_PASSWORD;
    }

    /**
     * Traite l'archive FLV générée par Nginx-RTMP après la fin d'un stream
     * @param {string} flvPath Chemin absolu du fichier .flv
     * @param {string} streamName Nom de la clé de stream
     */
    async processRecording(flvPath, streamName) {
        try {
            console.log(`[VOD] Début du traitement de l'archive: ${flvPath}`);

            if (!fs.existsSync(flvPath)) {
                throw new Error(`Le fichier source n'existe pas: ${flvPath}`);
            }

            // 1. Définir le chemin de sortie MP4
            const mp4Filename = path.basename(flvPath, '.flv') + '.mp4';
            const mp4Path = path.join(path.dirname(flvPath), mp4Filename);

            // 2. Transcoder FLV vers MP4 Web-Optimisé (Faststart)
            await this.transcodeToMp4(flvPath, mp4Path);
            console.log(`[VOD] Transcodage MP4 réussi: ${mp4Path}`);

            // 3. (Optionnel) Uploader vers PeerTube
            if (this.peertubeUrl || process.env.PEERTUBE_KEY) {
                const peertubeHost = this.peertubeUrl || 'https://live.libratoi.org';
                console.log(`[VOD] Upload vers PeerTube (${peertubeHost}) planifié pour: ${mp4Path}`);
                await this.uploadToPeerTube(mp4Path, streamName, peertubeHost);
            } else {
                console.log(`[VOD] Configuration PeerTube non trouvée (PEERTUBE_KEY manquante). Upload ignoré.`);
            }

        } catch (error) {
            console.error(`[VOD] Erreur lors du traitement de l'archive:`, error.message);
        }
    }

    /**
     * Convertit un fichier FLV en MP4 compatible Web
     */
    transcodeToMp4(inputPath, outputPath) {
        return new Promise((resolve, reject) => {
            console.log(`[VOD] FFmpeg: Conversion de ${inputPath} vers ${outputPath}...`);

            // Copie des flux sans ré-encodage si possible, place le moov atom au début pour le streaming web
            const ffmpegArgs = [
                '-y',
                '-i', inputPath,
                '-c:v', 'copy',
                '-c:a', 'copy',
                '-movflags', '+faststart',
                outputPath
            ];

            const ffmpeg = spawn('ffmpeg', ffmpegArgs);

            ffmpeg.stderr.on('data', (data) => {
                // FFmpeg logge dans stderr même pour les infos
                // console.log(`[FFmpeg VOD] ${data.toString().trim()}`);
            });

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    resolve(outputPath);
                } else {
                    reject(new Error(`FFmpeg a quitté avec le code ${code}`));
                }
            });

            ffmpeg.on('error', (err) => {
                reject(err);
            });
        });
    }

    /**
     * Uploade un fichier MP4 vers l'API PeerTube
     */
    async uploadToPeerTube(mp4Path, streamName, host) {
        try {
            const token = process.env.PEERTUBE_KEY;
            if (!token) throw new Error("PEERTUBE_KEY est requis pour l'upload");

            const filename = path.basename(mp4Path);
            const stats = fs.statSync(mp4Path);

            console.log(`[PeerTube] Préparation de l'upload: ${filename} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

            // Dans une version réelle, on devrait d'abord récupérer un channelId
            // Ici on suppose que l'API accepte l'upload sur le compte par défaut ou on utilise un channel par défaut
            const channelId = process.env.PEERTUBE_CHANNEL_ID || '1';

            // Utilisation de native fetch (Node 20)
            const formData = new FormData();

            // Création d'un Blob/File pour fetch
            const { openAsBlob } = require('node:fs');
            const fileBlob = await openAsBlob(mp4Path);

            formData.append('videofile', fileBlob, filename);
            formData.append('name', `Archive Direct - ${streamName} - ${new Date().toLocaleDateString()}`);
            formData.append('channelId', channelId);
            formData.append('privacy', '1'); // 1 = Public
            formData.append('waitTranscoding', 'true');

            const response = await fetch(`${host}/api/v1/videos/upload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Erreur PeerTube (${response.status}): ${errorText}`);
            }

            const result = await response.json();
            console.log(`[PeerTube] Upload réussi ! Vidéo ID: ${result.video.id || result.video.uuid}`);
            return result;

        } catch (error) {
            console.error(`[PeerTube] Échec de l'upload:`, error.message);
            throw error;
        }
    }
}

module.exports = new VodService();
