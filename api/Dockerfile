FROM node:20-alpine

# Installer FFmpeg pour le relay des streams, les polices pour la mire, Chromium et xvfb pour la WebTV
RUN apk add --no-cache ffmpeg curl ttf-dejavu chromium nss freetype harfbuzz ttf-freefont xvfb

WORKDIR /app

# Générer la vidéo de mire (5 secondes, écran textuel statique avec encodage x264/aac)
RUN ffmpeg -f lavfi -i "color=c=black:s=1280x720:r=30" \
    -f lavfi -i "anullsrc=r=44100:cl=stereo" \
    -vf "drawtext=fontfile=/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf:text='Radio Cause Commune':fontcolor=white:fontsize=64:x=(w-text_w)/2:y=(h-text_h)/2-50,drawtext=fontfile=/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf:text='Stream de secours - Retour dans un instant...':fontcolor=gray:fontsize=32:x=(w-text_w)/2:y=(h-text_h)/2+50" \
    -c:v libx264 -preset veryfast -c:a aac -t 5 -y mire.mp4

# Variables d'environnement pour Puppeteer (contourner le bac à sable Alpine)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copier les dépendances et installer
COPY package.json ./
RUN npm install --production

# Copier le code source
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
