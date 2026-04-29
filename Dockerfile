FROM node:20-slim

# Dependências do sistema para Playwright/Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    python3 \
    python3-pip \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libgbm1 \
    libasound2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libpangocairo-1.0-0 \
    libgtk-3-0 \
    --no-install-recommends \
    && pip3 install --break-system-packages yt-dlp \
    && rm -rf /var/lib/apt/lists/*

# Playwright usa o Chromium do sistema (sem baixar ~200MB extras)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY server/package*.json ./
RUN npm install --omit=dev

COPY server/ .

RUN mkdir -p /app/data /app/output /app/uploads

EXPOSE 8080
ENV PORT=8080

CMD ["node", "index.js"]
