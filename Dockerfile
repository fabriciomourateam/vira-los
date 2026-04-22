FROM node:20-slim

WORKDIR /app

COPY server/package*.json ./
RUN npm install --omit=dev

COPY server/ .

RUN mkdir -p /app/data /app/output /app/uploads

EXPOSE 8080
ENV PORT=8080

CMD ["node", "index.js"]
