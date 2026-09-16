/**
 * johnHulk.js — job separado: reel de referência (@john.hulk_ por padrão) →
 * transcrição → carrossel FMTeam (imagens de bodybuilder) → RASCUNHO pra revisão.
 *
 * GET  /api/john-hulk            → estado + settings + batches (hidratados)
 * POST /api/john-hulk/generate   → dispara geração (cron/manual), mesmo guard
 *                                   x-cron-key/DAILY_CRON_SECRET do daily-content
 * POST /api/john-hulk/settings   → liga/desliga kill-switch e auto-agendamento
 * POST /api/john-hulk/:id/approve → agenda o rascunho aprovado no mLabs
 */

const express = require('express');
const path = require('path');
const router = express.Router();
const db = require('../db/database');
const johnHulk = require('../services/johnHulkService');

router.get('/', (req, res) => {
  const batches = db.getAllJohnHulkBatches().map((b) => johnHulk.hydrateBatch(b));
  res.json({ state: johnHulk.getState(), settings: db.getJohnHulkSettings(), batches });
});

router.post('/generate', (req, res) => {
  const trigger = req.body && req.body.trigger === 'cron' ? 'cron' : 'manual';

  // Mesma proteção do /api/daily-content/generate: se DAILY_CRON_SECRET estiver
  // setada, o trigger 'cron' exige o header x-cron-key correto.
  const secret = process.env.DAILY_CRON_SECRET;
  if (trigger === 'cron' && secret && req.get('x-cron-key') !== secret) {
    return res.status(401).json({ error: 'cron key inválida' });
  }

  if (!db.getJohnHulkSettings().johnHulkEnabled) {
    return res.json({ skipped: 'disabled' });
  }

  if (johnHulk.getState().generating) {
    return res.status(409).json({ error: 'Já existe uma geração John Hulk em andamento.' });
  }

  // Responde imediatamente — geração roda em background (pode levar minutos).
  res.json({ started: true });
  johnHulk.generateDailyCarousel({ trigger })
    .then((b) => console.log(`[JohnHulk] batch ${trigger}: ${b ? `${b.id} (${b.status})` : 'ignorado (kill-switch ou já existe hoje)'}`))
    .catch((e) => console.error('[JohnHulk] geração falhou:', e.message));
});

router.post('/settings', (req, res) => {
  const patch = {};
  if (typeof req.body?.johnHulkEnabled === 'boolean') patch.johnHulkEnabled = req.body.johnHulkEnabled;
  if (typeof req.body?.autoScheduleJohnHulk === 'boolean') patch.autoScheduleJohnHulk = req.body.autoScheduleJohnHulk;
  const settings = db.setJohnHulkSettings(patch);
  res.json(settings);
});

// Aprovação 1-clique do rascunho — agenda o carrossel no mLabs (item 10 do plano).
router.post('/:id/approve', async (req, res) => {
  try {
    const batch = db.getAllJohnHulkBatches().find((b) => b.id === req.params.id);
    if (!batch || !batch.carouselId) {
      return res.status(404).json({ error: 'Batch/carrossel não encontrado para este id.' });
    }
    const carousel = db.getAllCarousels().find((c) => c.id === batch.carouselId);
    if (!carousel) return res.status(404).json({ error: 'Carrossel não encontrado.' });
    if (!carousel.screenshots || !carousel.screenshots.length) {
      return res.status(400).json({ error: 'Carrossel sem screenshots — não é possível agendar.' });
    }

    const mlabs = require('../services/mlabsService');
    const { OUTPUT_DIR } = require('../services/carouselService');
    const { v4: uuidv4 } = require('uuid');

    const dates = req.body?.dates && Array.isArray(req.body.dates) && req.body.dates.length
      ? req.body.dates
      : mlabs.computeDefaultDates();

    const recId = uuidv4();
    db.createMlabsSchedule({
      id: recId, contentType: 'carousel', contentId: carousel.id,
      caption: carousel.legenda || '', dates, platforms: null, status: 'enviando',
    });

    try {
      const r = await mlabs.scheduleContent({
        type: 'IMAGE',
        mediaPaths: carousel.screenshots.map((name) => path.join(OUTPUT_DIR, carousel.folderName, name)),
        caption: carousel.legenda || '',
        dates,
      });
      db.updateMlabsSchedule(recId, { status: 'agendado', mlabsResponse: r.scheduleResponse || null });
      return res.json({ ok: true, scheduleId: recId, dates, mlabs: r });
    } catch (e) {
      db.updateMlabsSchedule(recId, { status: 'erro', error: e.message });
      return res.status(502).json({ error: `Falha ao agendar no mLabs: ${e.message}`, scheduleId: recId });
    }
  } catch (e) {
    console.error('[JohnHulk] approve falhou:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
