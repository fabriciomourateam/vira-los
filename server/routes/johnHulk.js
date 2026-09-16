/**
 * johnHulk.js — job separado: reel de referência (@john.hulk_ por padrão) →
 * transcrição → carrossel FMTeam (imagens de bodybuilder) → RASCUNHO pra revisão.
 * Também expõe a BIBLIOTECA de reels + o Modeling Studio (modelagem sob demanda,
 * fora da rotina diária automática).
 *
 * GET  /api/john-hulk                     → estado + settings + batches (hidratados)
 * POST /api/john-hulk/generate            → dispara geração (cron/manual), mesmo guard
 *                                            x-cron-key/DAILY_CRON_SECRET do daily-content
 * POST /api/john-hulk/settings            → liga/desliga kill-switch e auto-agendamento
 * GET  /api/john-hulk/reels               → lista a biblioteca (filtros/sort)
 * POST /api/john-hulk/reels/refresh       → atualiza a biblioteca (Apify, background)
 * POST /api/john-hulk/reels/:sc/model     → modela 1 reel da biblioteca (background)
 * POST /api/john-hulk/reels/model-url     → modela 1 reel por URL avulsa (background)
 * POST /api/john-hulk/reels/model-batch   → modela vários reels em sequência (background)
 * POST /api/john-hulk/reels/:sc/status    → seta status manual do reel
 * POST /api/john-hulk/reels/:sc/favorite  → toggle favorito
 * GET  /api/john-hulk/insights            → aprendizado leve (tema modelado × posts que performaram)
 * POST /api/john-hulk/:id/approve         → agenda o rascunho aprovado no mLabs
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

// ── Biblioteca de Reels (Reel Library) ─────────────────────────────────────────
const REEL_STATUS_VALUES = ['novo', 'modelado', 'editado', 'agendado', 'postado'];

// Lista a biblioteca com filtros/ordenação server-side.
router.get('/reels', (req, res) => {
  const { handle, status, favorite, q, sort = 'date', order = 'desc' } = req.query;
  let reels = db.getJohnHulkReels();

  if (handle) reels = reels.filter((r) => r.handle === handle);
  if (status) reels = reels.filter((r) => r.status === status);
  if (favorite === 'true') reels = reels.filter((r) => r.favorite === true);
  if (favorite === 'false') reels = reels.filter((r) => r.favorite !== true);
  if (q) {
    const needle = String(q).toLowerCase();
    reels = reels.filter((r) => (r.caption || '').toLowerCase().includes(needle) || (r.topic || '').toLowerCase().includes(needle));
  }

  const sortKeyMap = { views: 'views', likes: 'likes', comments: 'comments', date: 'timestampMs' };
  const sortKey = sortKeyMap[sort] || 'timestampMs';
  const dir = order === 'asc' ? 1 : -1;
  reels = reels.slice().sort((a, b) => dir * ((a[sortKey] || 0) - (b[sortKey] || 0)));

  res.json({ libraryState: johnHulk.getLibraryState(), reels });
});

// Atualiza a biblioteca via Apify (pode levar minutos — roda em background).
router.post('/reels/refresh', (req, res) => {
  if (!db.getJohnHulkSettings().johnHulkEnabled) {
    return res.json({ skipped: 'disabled' });
  }
  if (johnHulk.getLibraryState().refreshing) {
    return res.status(409).json({ error: 'Já existe um refresh da biblioteca em andamento.' });
  }

  const handle = req.body && req.body.handle ? String(req.body.handle) : undefined;
  const limit = req.body && req.body.limit ? Number(req.body.limit) : undefined;

  res.json({ started: true });
  johnHulk.refreshLibrary({ handle, limit })
    .then((r) => console.log(`[JohnHulk] refreshLibrary: +${r.added} novos, ${r.updated} atualizados (total ${r.total}).`))
    .catch((e) => console.error('[JohnHulk] refreshLibrary falhou:', e.message));
});

// Modela 1 reel específico da biblioteca (Modeling Studio).
router.post('/reels/:shortCode/model', (req, res) => {
  const { shortCode } = req.params;
  const regenerate = !!(req.body && req.body.regenerate);

  const reel = db.getJohnHulkReel(shortCode);
  if (!reel) return res.status(404).json({ error: `Reel ${shortCode} não encontrado na biblioteca.` });
  if (johnHulk.isReelModeling(shortCode)) {
    return res.status(409).json({ error: `Reel ${shortCode} já está sendo modelado.` });
  }

  res.json({ started: true });
  johnHulk.modelReel({ shortCode, regenerate })
    .then((r) => console.log(`[JohnHulk] modelReel ${shortCode}: carrossel ${r.carouselId}`))
    .catch((e) => console.error(`[JohnHulk] modelReel ${shortCode} falhou:`, e.message));
});

// Modela um reel a partir de uma URL avulsa do Instagram (fora da biblioteca).
router.post('/reels/model-url', (req, res) => {
  const url = req.body && req.body.url;
  if (!url || !/instagram\.com/i.test(String(url))) {
    return res.status(400).json({ error: 'Informe uma URL válida do Instagram (reel/post).' });
  }

  res.json({ started: true });
  johnHulk.modelReel({ url: String(url) })
    .then((r) => console.log(`[JohnHulk] modelReel (URL avulsa) ${r.reelShortCode}: carrossel ${r.carouselId}`))
    .catch((e) => console.error('[JohnHulk] modelReel (URL avulsa) falhou:', e.message));
});

// Modela vários reels em sequência (lote) — resiliente, 1 falha não para os outros.
router.post('/reels/model-batch', (req, res) => {
  const shortCodes = Array.isArray(req.body && req.body.shortCodes) ? req.body.shortCodes : [];
  if (!shortCodes.length) return res.status(400).json({ error: 'Informe shortCodes (array não vazio).' });

  res.json({ started: true });
  johnHulk.modelBatch({ shortCodes })
    .then((results) => console.log(`[JohnHulk] modelBatch: ${results.filter((r) => r.ok).length}/${results.length} ok.`))
    .catch((e) => console.error('[JohnHulk] modelBatch falhou:', e.message));
});

// Seta o status manual de um reel (kanban do dono: novo → modelado → editado → agendado → postado).
router.post('/reels/:shortCode/status', (req, res) => {
  const { shortCode } = req.params;
  const status = req.body && req.body.status;
  if (!REEL_STATUS_VALUES.includes(status)) {
    return res.status(400).json({ error: `status inválido — use um de: ${REEL_STATUS_VALUES.join(', ')}` });
  }
  const reel = db.getJohnHulkReel(shortCode);
  if (!reel) return res.status(404).json({ error: `Reel ${shortCode} não encontrado.` });
  const updated = db.updateJohnHulkReel(shortCode, { status });
  res.json(updated);
});

// Toggle de favorito.
router.post('/reels/:shortCode/favorite', (req, res) => {
  const { shortCode } = req.params;
  const reel = db.getJohnHulkReel(shortCode);
  if (!reel) return res.status(404).json({ error: `Reel ${shortCode} não encontrado.` });
  const updated = db.updateJohnHulkReel(shortCode, { favorite: !reel.favorite });
  res.json(updated);
});

// Aprendizado leve (item de loop): tema/legenda dos reels JÁ MODELADOS × posts
// próprios que performaram bem — best-effort, defensivo (sem posts do IG, não
// tem base de comparação e devolve available:false).
router.get('/insights', (req, res) => {
  try {
    const posts = db.getInstagramPosts();
    if (!Array.isArray(posts) || !posts.length) {
      return res.json({ available: false });
    }
    const modeled = db.getJohnHulkReels().filter((r) => r.carouselId);
    if (!modeled.length) {
      return res.json({ available: false });
    }

    const stopwords = new Set(['para', 'como', 'sobre', 'esse', 'essa', 'isso', 'você', 'mais', 'nunca', 'sempre', 'tudo', 'pelo', 'pela']);
    const keywordsOf = (text) => String(text || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !stopwords.has(w));

    const summary = modeled.map((reel) => {
      const kws = new Set(keywordsOf(reel.topic || reel.caption));
      const matched = kws.size ? posts.filter((p) => {
        const postKws = keywordsOf(p.caption);
        return postKws.some((w) => kws.has(w));
      }) : [];
      const avgEngagement = matched.length
        ? matched.reduce((sum, p) => sum + (Number(p.like_count || p.likes || 0) + Number(p.comments_count || p.comments || 0)), 0) / matched.length
        : null;
      return {
        shortCode: reel.shortCode,
        topic: reel.topic,
        themeTag: reel.themeTag,
        carouselId: reel.carouselId,
        matchedPosts: matched.length,
        avgEngagement,
      };
    }).sort((a, b) => (b.avgEngagement || 0) - (a.avgEngagement || 0));

    res.json({ available: true, summary });
  } catch (e) {
    console.error('[JohnHulk] insights falhou:', e.message);
    res.json({ available: false, error: e.message });
  }
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
      // Mapeia carouselId → reel da biblioteca e marca como agendado (best-effort).
      try {
        const reel = db.getJohnHulkReels().find((rl) => rl.carouselId === carousel.id);
        if (reel) db.updateJohnHulkReel(reel.shortCode, { status: 'agendado' });
      } catch (_) { /* best-effort */ }
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
