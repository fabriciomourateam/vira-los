/**
 * dailyContent.js — rotina diária de conteúdo (2 carrosséis por IA + 1 reel/dia
 * da FILA de roteiros pré-escritos, postado às 19h30).
 *
 * GET  /api/daily-content            → estado + batches (hidratados)
 * POST /api/daily-content/generate   → dispara geração manual ("Gerar agora")
 * GET  /api/daily-content/themes     → banco de temas
 * GET  /api/daily-content/reel-queue → fila de roteiros de reel (quantos faltam)
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

// Fila de roteiros de reel: quantos ainda faltam postar + lista (pra você ver
// quantos dias de conteúdo tem na frente). ?full=true traz o texto completo.
router.get('/reel-queue', (req, res) => {
  const stats = db.getReelQueueStats();
  const full = req.query.full === 'true';
  const items = db.getReelQueue().map((it) => full ? it : {
    slug: it.slug, audience: it.audience, title: it.title, order: it.order,
    used: !!it.used, usedAt: it.usedAt || null,
  });
  res.json({ ...stats, items });
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
