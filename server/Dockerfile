FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Garante que o diretório db existe
RUN mkdir -p /app/db

EXPOSE 3001

CMD ["node", "index.js"]
