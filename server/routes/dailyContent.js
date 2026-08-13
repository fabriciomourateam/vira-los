/**
 * dailyContent.js — rotina diária de conteúdo (2 carrosséis por IA + 2 reels/dia
 * da FILA de roteiros pré-escritos, postados às 14h e 19h30).
 *
 * GET  /api/daily-content            → estado + batches (hidratados)
 * POST /api/daily-content/generate   → dispara geração manual ("Gerar agora")
 * GET  /api/daily-content/themes     → banco de temas
 * GET  /api/daily-content/reel-queue → fila de roteiros de reel (quantos faltam)
 */

const express = require('express');
const path = require('path');
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

// Carrega os roteiros do arquivo de seed e semeia a fila. Tenta vários caminhos
// (produção /app/seeds, dev server/seeds) e DEVOLVE o erro se falhar — pra a gente
// enxergar por que a fila não carregou (o seed do boot falhava em silêncio).
function seedReelQueueFromFile() {
  const candidates = [
    '../seeds/reel-scripts.json',                 // /app/routes → /app/seeds (produção) e dev
    '../../server/seeds/reel-scripts.json',        // fallback dev
    path.join(__dirname, '../seeds/reel-scripts.json'),
  ];
  let lastErr = null;
  for (const c of candidates) {
    try {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const seed = require(c);
      const r = db.seedReelQueue(seed.scripts || [], seed.version);
      return { ok: true, added: r.added, replaced: !!r.replaced, path: c, version: seed.version };
    } catch (e) { lastErr = e; }
  }
  return { ok: false, error: lastErr ? lastErr.message : 'arquivo de seed não encontrado', triedPaths: candidates };
}

// Fila de roteiros de reel: quantos ainda faltam postar + lista. Se a fila estiver
// VAZIA, tenta re-semear na hora (robustez) e devolve o status do seed — assim, só
// de abrir o Diário, a fila carrega; e se falhar, o erro aparece.
router.get('/reel-queue', (req, res) => {
  let seedStatus = db.getDoc('reel_queue_seed_status') || null;
  if (db.getReelQueueStats().remaining === 0) {
    seedStatus = { ...seedReelQueueFromFile(), at: new Date().toISOString(), lazy: true };
    try { db.setDoc('reel_queue_seed_status', seedStatus); } catch { /* ignora */ }
  }
  const stats = db.getReelQueueStats();
  const full = req.query.full === 'true';
  const items = db.getReelQueue().map((it) => full ? it : {
    slug: it.slug, audience: it.audience, title: it.title, order: it.order,
    used: !!it.used, usedAt: it.usedAt || null,
  });
  res.json({ ...stats, seedStatus, items });
});

// Força re-semear a fila (botão manual). Devolve o resultado/erro.
router.post('/reel-queue/reseed', (_req, res) => {
  const r = seedReelQueueFromFile();
  try { db.setDoc('reel_queue_seed_status', { ...r, at: new Date().toISOString(), manual: true }); } catch { /* ignora */ }
  res.json({ ...r, ...db.getReelQueueStats() });
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
