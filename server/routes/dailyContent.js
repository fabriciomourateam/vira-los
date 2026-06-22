/**
 * dailyContent.js — rotina diária de conteúdo (2 carrosséis + 2 reels/dia).
 *
 * GET  /api/daily-content        → estado + batches (hidratados com carrosséis/reels)
 * POST /api/daily-content/generate → dispara geração manual ("Gerar agora")
 * GET  /api/daily-content/themes → banco de temas
 */

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const daily = require('../services/dailyContentService');

router.get('/', (req, res) => {
  const batches = db.getAllDailyBatches().map((b) => daily.hydrateBatch(b));
  res.json({ state: daily.getState(), batches });
});

router.get('/themes', (req, res) => {
  res.json(daily.THEMES);
});

router.post('/generate', (req, res) => {
  if (daily.getState().generating) {
    return res.status(409).json({ error: 'Já existe uma geração em andamento.' });
  }
  // Responde imediatamente — geração roda em background (leva minutos)
  res.json({ started: true });
  daily.generateDailyBatch({ trigger: 'manual' })
    .then((b) => console.log(`[DailyContent] batch manual concluído: ${b.id} (${b.status})`))
    .catch((e) => console.error('[DailyContent] geração manual falhou:', e.message));
});

module.exports = router;
