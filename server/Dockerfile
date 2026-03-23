FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Diretório de dados persistentes (monte o volume do Railway aqui: /app/data)
RUN mkdir -p /app/data

EXPOSE 3001

CMD ["node", "index.js"]
