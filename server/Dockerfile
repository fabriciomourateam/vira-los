# ── Imagem base do Playwright com Chromium já instalado ───────────────────────
FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

# Copia e instala dependências Node
COPY package*.json ./
RUN npm ci --omit=dev

# Instala o Chromium do Playwright (dentro do container)
RUN npx playwright install chromium

# Copia o restante do código
COPY . .

# Expõe a porta do servidor
EXPOSE 3001

# Inicia o servidor
CMD ["node", "index.js"]
