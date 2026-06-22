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
  const trigger = req.body && req.body.trigger === 'cron' ? 'cron' : 'manual';

  // Proteção opcional do disparo automático: se DAILY_CRON_SECRET estiver setada,
  // o trigger 'cron' exige o header x-cron-key correto (evita disparos de custo).
  // O botão "Gerar agora" do app (trigger manual) não precisa de chave.
  const secret = process.env.DAILY_CRON_SECRET;
  if (trigger === 'cron' && secret && req.get('x-cron-key') !== secret) {
    return res.status(401).json({ error: 'cron key inválida' });
  }

  if (daily.getState().generating) {
    return res.status(409).json({ error: 'Já existe uma geração em andamento.' });
  }
  // Responde imediatamente — geração roda em background (leva minutos)
  res.json({ started: true });
  daily.generateDailyBatch({ trigger })
    .then((b) => console.log(`[DailyContent] batch ${trigger}: ${b ? `${b.id} (${b.status})` : 'ignorado (já existe hoje)'}`))
    .catch((e) => console.error('[DailyContent] geração falhou:', e.message));
});

module.exports = router;
