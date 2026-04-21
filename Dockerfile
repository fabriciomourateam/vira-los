FROM node:20-slim

# Dependências do Chromium (usado pelo Playwright)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libgtk-3-0 \
    libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/package*.json ./
RUN npm install

# Usa o Chromium do sistema (evita baixar outro binário)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

COPY server/ .

# Pastas persistentes (montadas no volume)
RUN mkdir -p /app/data /app/output /app/uploads

EXPOSE 8080
ENV PORT=8080

CMD ["node", "index.js"]
