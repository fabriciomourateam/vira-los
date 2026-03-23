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

# Garante que o diretório db existe (será sobreposto pelo volume do Railway)
RUN mkdir -p /app/db

# Volume para persistir banco de dados, sessões e agendamentos entre deploys
VOLUME ["/app/db"]

# Expõe a porta do servidor
EXPOSE 3001

# Inicia o servidor
CMD ["node", "index.js"]
