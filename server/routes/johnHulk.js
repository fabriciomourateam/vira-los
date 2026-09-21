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
 * GET  /api/john-hulk/reels               → lista a biblioteca (filtros/sort; sourceType:'reel'|'ad', sort:'running' p/ ads)
 * POST /api/john-hulk/reels/refresh       → atualiza a biblioteca de REELS (Apify, background; body {mode:'full'|'incremental'})
 * POST /api/john-hulk/ads/refresh         → atualiza a biblioteca de ANÚNCIOS/Meta Ad Library (Apify, background; body {pageId?,count?})
 * POST /api/john-hulk/reels/:sc/model     → modela 1 reel da biblioteca (background; body
 *                                            {regenerate,variants,angle,mode,ctaDestination,offer,numSlides})
 * POST /api/john-hulk/reels/model-url     → modela 1 reel por URL avulsa (background; mesmo body
 *                                            + {url}, inclui as mesmas opções de modo anúncio)
 * POST /api/john-hulk/reels/model-batch   → modela vários reels em sequência (background; sempre
 *                                            orgânico — body {shortCodes,numSlides?})
 * POST /api/john-hulk/reels/:sc/status    → seta status manual do reel (inclui 'erro')
 * POST /api/john-hulk/reels/:sc/favorite  → toggle favorito
 * GET  /api/john-hulk/reels/:sc/dupe-check → aviso de reel com tema parecido já modelado (não bloqueia)
 * GET  /api/john-hulk/insights            → aprendizado leve (tema modelado × posts que performaram)
 * GET  /api/john-hulk/cost                → custo Anthropic (melhor esforço, via usageTracker)
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

// ── SONDA TEMPORÁRIA: valida actor/input do Apify pra Biblioteca de Anúncios ────
// Aditivo e inofensivo (só lê). Serve pra descobrir qual actor da Ad Library
// devolve os anúncios e qual o shape dos dados, sem redeploy (itero o actor/input
// via CI). Será removida quando a fonte "Anúncios" estiver pronta.
router.post('/ads/probe', async (req, res) => {
  const { actor, input } = req.body || {};
  if (!actor || !input || typeof input !== 'object') {
    return res.status(400).json({ error: 'Informe { actor, input } (input = objeto).' });
  }
  try {
    const { runApifyActor } = require('../services/reelsAnalyzerService');
    const items = await runApifyActor(actor, input, 120);
    const first = Array.isArray(items) && items.length ? items[0] : null;
    // Corta o sample pra não estourar o log/response.
    const sample = first ? JSON.parse(JSON.stringify(first)) : null;
    const sampleStr = sample ? JSON.stringify(sample).slice(0, 4000) : null;
    res.json({
      ok: true,
      count: Array.isArray(items) ? items.length : 0,
      firstKeys: first ? Object.keys(first) : [],
      sample: sampleStr,
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ── Biblioteca de Reels (Reel Library) ─────────────────────────────────────────
// 'erro' (item A do plano de melhorias) — reel cuja modelagem falhou (1ª tentativa
// + retry) 2x seguidas. Se comporta como 'novo' pro guard de "já modelado".
const REEL_STATUS_VALUES = ['novo', 'modelado', 'editado', 'agendado', 'postado', 'erro'];

// ── Modo anúncio (tráfego pago) — validação compartilhada entre /reels/:sc/model
// e /reels/model-url (os dois pontos de entrada que modelam um reel de verdade). ──
const AD_CTA_DESTINATIONS = ['whatsapp', 'link', 'dm'];

// Lê e valida as opções COMUNS de modelagem do body: {regenerate,variants,angle,
// mode,ctaDestination,offer,numSlides}. Em caso de erro já responde 400 e devolve
// null — o chamador só precisa checar `if (!opts) return;`. `mode` default
// 'organico' (comportamento igual ao de sempre); 'anuncio' exige ctaDestination.
function parseModelOpts(req, res) {
  const body = req.body || {};
  const regenerate = !!body.regenerate;
  const angle = body.angle ? String(body.angle).slice(0, 300) : undefined;

  let variants = 1;
  if (body.variants != null) {
    variants = Number(body.variants);
    if (!Number.isInteger(variants) || variants < 1 || variants > 3) {
      res.status(400).json({ error: 'variants deve ser um inteiro entre 1 e 3.' });
      return null;
    }
  }

  let numSlides;
  if (body.numSlides != null) {
    numSlides = Number(body.numSlides);
    if (!Number.isInteger(numSlides) || numSlides < 4 || numSlides > 10) {
      res.status(400).json({ error: 'numSlides deve ser um inteiro entre 4 e 10.' });
      return null;
    }
  }

  const mode = body.mode === 'anuncio' ? 'anuncio' : 'organico';
  let ctaDestination;
  let offer;
  if (mode === 'anuncio') {
    ctaDestination = body.ctaDestination;
    if (!AD_CTA_DESTINATIONS.includes(ctaDestination)) {
      res.status(400).json({ error: `mode:'anuncio' exige ctaDestination — use um de: ${AD_CTA_DESTINATIONS.join(', ')}` });
      return null;
    }
    offer = body.offer ? String(body.offer).slice(0, 200) : undefined;
  }

  return {
    regenerate, angle, variants, numSlides, mode, ctaDestination, offer,
  };
}

// Extração simples de palavras-chave (PT-BR) — compartilhada entre /insights e
// /reels/:shortCode/dupe-check (item D do plano de melhorias).
const KEYWORD_STOPWORDS = new Set(['para', 'como', 'sobre', 'esse', 'essa', 'isso', 'você', 'mais', 'nunca', 'sempre', 'tudo', 'pelo', 'pela']);
const keywordsOf = (text) => String(text || '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .split(/[^a-z0-9]+/)
  .filter((w) => w.length >= 4 && !KEYWORD_STOPWORDS.has(w));

// Lista a biblioteca com filtros/ordenação server-side.
// `sourceType` (novo, ADITIVO): 'reel' = itens sem sourceType OU sourceType:'reel'
// (comportamento de sempre); 'ad' = sourceType:'ad' (Biblioteca de Anúncios);
// omitido = todos (reels + ads juntos, comportamento de antes preservado quando
// o filtro não é usado).
// `sort=running` (novo): ordena por `runningDays` desc — só faz sentido pra ads,
// mas não quebra reels (runningDays fica undefined/0 neles).
router.get('/reels', (req, res) => {
  const {
    handle, status, favorite, q, sort = 'date', order = 'desc', sourceType,
  } = req.query;
  let reels = db.getJohnHulkReels();

  if (handle) reels = reels.filter((r) => r.handle === handle);
  if (status) reels = reels.filter((r) => r.status === status);
  if (favorite === 'true') reels = reels.filter((r) => r.favorite === true);
  if (favorite === 'false') reels = reels.filter((r) => r.favorite !== true);
  if (sourceType === 'ad') reels = reels.filter((r) => r.sourceType === 'ad');
  else if (sourceType === 'reel') reels = reels.filter((r) => !r.sourceType || r.sourceType === 'reel');
  if (q) {
    const needle = String(q).toLowerCase();
    reels = reels.filter((r) => (r.caption || '').toLowerCase().includes(needle) || (r.topic || '').toLowerCase().includes(needle));
  }

  const sortKeyMap = {
    views: 'views', likes: 'likes', comments: 'comments', date: 'timestampMs', running: 'runningDays',
  };
  const sortKey = sortKeyMap[sort] || 'timestampMs';
  const dir = order === 'asc' ? 1 : -1;
  reels = reels.slice().sort((a, b) => dir * ((a[sortKey] || 0) - (b[sortKey] || 0)));

  res.json({ libraryState: johnHulk.getLibraryState(), adLibraryState: johnHulk.getAdLibraryState(), reels });
});

// Atualiza a biblioteca de ANÚNCIOS (Meta Ad Library) via Apify — mesmo padrão
// background de /reels/refresh. Body opcional: { pageId?, count? } — sem pageId,
// usa settings.adLibraryPageId.
router.post('/ads/refresh', (req, res) => {
  if (!db.getJohnHulkSettings().johnHulkEnabled) {
    return res.json({ skipped: 'disabled' });
  }
  if (johnHulk.getAdLibraryState().refreshing) {
    return res.status(409).json({ error: 'Já existe um refresh da biblioteca de anúncios em andamento.' });
  }

  const pageId = req.body && req.body.pageId ? String(req.body.pageId) : undefined;
  const count = req.body && req.body.count ? Number(req.body.count) : undefined;

  res.json({ started: true });
  johnHulk.refreshAdLibrary({ pageId, count })
    .then((r) => console.log(`[JohnHulk] refreshAdLibrary: +${r.added} novos, ${r.updated} atualizados (total ${r.total}).`))
    .catch((e) => console.error('[JohnHulk] refreshAdLibrary falhou:', e.message));
});

// Atualiza a biblioteca via Apify (pode levar minutos — roda em background).
// Body opcional: { handle?, limit?, mode?:'full'|'incremental' } — item F do plano
// (incremental = limit 30, mais rápido/barato pra refresh frequente).
router.post('/reels/refresh', (req, res) => {
  if (!db.getJohnHulkSettings().johnHulkEnabled) {
    return res.json({ skipped: 'disabled' });
  }
  if (johnHulk.getLibraryState().refreshing) {
    return res.status(409).json({ error: 'Já existe um refresh da biblioteca em andamento.' });
  }

  const handle = req.body && req.body.handle ? String(req.body.handle) : undefined;
  const limit = req.body && req.body.limit ? Number(req.body.limit) : undefined;
  const mode = req.body && req.body.mode === 'incremental' ? 'incremental' : undefined;

  res.json({ started: true });
  johnHulk.refreshLibrary({ handle, limit, mode })
    .then((r) => console.log(`[JohnHulk] refreshLibrary(${mode || 'full'}): +${r.added} novos, ${r.updated} atualizados (total ${r.total}).`))
    .catch((e) => console.error('[JohnHulk] refreshLibrary falhou:', e.message));
});

// Modela 1 reel específico da biblioteca (Modeling Studio).
// Body opcional: { regenerate?:boolean, variants?:1-3, angle?:string, numSlides?:4-10,
// mode?:'organico'|'anuncio' (default 'organico'), ctaDestination?:'whatsapp'|'link'|'dm'
// (obrigatório se mode:'anuncio'), offer?:string }.
router.post('/reels/:shortCode/model', (req, res) => {
  const { shortCode } = req.params;
  const opts = parseModelOpts(req, res);
  if (!opts) return; // parseModelOpts já respondeu 400

  const reel = db.getJohnHulkReel(shortCode);
  if (!reel) return res.status(404).json({ error: `Reel ${shortCode} não encontrado na biblioteca.` });
  if (johnHulk.isReelModeling(shortCode)) {
    return res.status(409).json({ error: `Reel ${shortCode} já está sendo modelado.` });
  }

  res.json({ started: true });
  johnHulk.modelReel({ shortCode, ...opts })
    .then((r) => console.log(`[JohnHulk] modelReel ${shortCode}: carrossel(s) ${(r.carouselIds || [r.carouselId]).join(', ')}`))
    .catch((e) => console.error(`[JohnHulk] modelReel ${shortCode} falhou:`, e.message));
});

// Modela um reel a partir de uma URL avulsa do Instagram (fora da biblioteca).
// Body: { url } + as mesmas opções opcionais de /reels/:shortCode/model (variants,
// angle, numSlides, mode, ctaDestination, offer) — dá pra criar um anúncio a partir
// de uma URL avulsa também.
router.post('/reels/model-url', (req, res) => {
  const url = req.body && req.body.url;
  if (!url || !/instagram\.com/i.test(String(url))) {
    return res.status(400).json({ error: 'Informe uma URL válida do Instagram (reel/post).' });
  }
  const opts = parseModelOpts(req, res);
  if (!opts) return; // parseModelOpts já respondeu 400

  res.json({ started: true });
  johnHulk.modelReel({ url: String(url), ...opts })
    .then((r) => console.log(`[JohnHulk] modelReel (URL avulsa) ${r.reelShortCode}: carrossel ${r.carouselId}`))
    .catch((e) => console.error('[JohnHulk] modelReel (URL avulsa) falhou:', e.message));
});

// Modela vários reels em sequência (lote) — resiliente, 1 falha não para os outros.
// Sempre orgânico (sem opções de anúncio, pra manter o batch simples) — só aceita
// numSlides opcional (4-10), passado igual pra cada reel do lote.
router.post('/reels/model-batch', (req, res) => {
  const shortCodes = Array.isArray(req.body && req.body.shortCodes) ? req.body.shortCodes : [];
  if (!shortCodes.length) return res.status(400).json({ error: 'Informe shortCodes (array não vazio).' });

  let numSlides;
  if (req.body && req.body.numSlides != null) {
    numSlides = Number(req.body.numSlides);
    if (!Number.isInteger(numSlides) || numSlides < 4 || numSlides > 10) {
      return res.status(400).json({ error: 'numSlides deve ser um inteiro entre 4 e 10.' });
    }
  }

  res.json({ started: true });
  johnHulk.modelBatch({ shortCodes, numSlides })
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

// Dedupe por tema (item D do plano de melhorias) — AVISO, não bloqueia: compara
// caption/topic deste reel com reels JÁ MODELADOS nos últimos `days` (default 21)
// por overlap simples de palavras-chave. Best-effort/defensivo.
router.get('/reels/:shortCode/dupe-check', (req, res) => {
  try {
    const { shortCode } = req.params;
    const reel = db.getJohnHulkReel(shortCode);
    if (!reel) return res.status(404).json({ error: `Reel ${shortCode} não encontrado.` });

    const days = Number(req.query.days) > 0 ? Number(req.query.days) : 21;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    const myKws = new Set(keywordsOf(reel.topic || reel.caption));
    if (!myKws.size) return res.json({ similar: [], count: 0 });

    const others = db.getJohnHulkReels().filter((r) => (
      r.shortCode !== shortCode
      && r.carouselId
      && r.usedAt
      && new Date(r.usedAt).getTime() >= cutoff
    ));

    const similar = others
      .map((r) => {
        const otherKws = keywordsOf(r.topic || r.caption);
        const overlap = otherKws.filter((w) => myKws.has(w)).length;
        return {
          shortCode: r.shortCode, topic: r.topic, carouselId: r.carouselId, overlap,
        };
      })
      .filter((r) => r.overlap >= 2)
      .sort((a, b) => b.overlap - a.overlap);

    res.json({ similar, count: similar.length });
  } catch (e) {
    console.error('[JohnHulk] dupe-check falhou:', e.message);
    res.json({ similar: [], count: 0, error: e.message });
  }
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

// Custo Anthropic (item G do plano de melhorias) — melhor esforço: reaproveita o
// que /api/usage já calcula (usageTracker), resumido pro feature 'john-hulk'.
// A atribuição por feature depende do middleware de FEATURE_PATTERNS (server/index.js)
// marcar a requisição como 'john-hulk' — hoje isso cobre TODO o prefixo /api/john-hulk,
// então deriveTopic/deriveViralInsight/generateCarousel chamados a partir daqui contam
// aqui. Chamadas Claude fora desse prefixo (ex.: reels-analyzer usado por outras
// telas) não entram nesse recorte.
router.get('/cost', (req, res) => {
  try {
    const usageTracker = require('../services/usageTracker');
    const summary = usageTracker.getSummary();
    const jh = summary.byFeature && summary.byFeature['john-hulk'];
    if (!jh) {
      return res.json({ available: true, today: 0, total: 0, byFeature: { 'john-hulk': { brl: 0, count: 0 } } });
    }
    res.json({
      available: true,
      today: summary.today.brl, // total do dia inteiro (todas as features) — referência
      total: summary.total.brl, // total geral (todas as features) — referência
      johnHulk: { brl: jh.brl, count: jh.count, savedBrl: jh.savedBrl },
      byFeature: summary.byFeature,
    });
  } catch (e) {
    console.error('[JohnHulk] /cost falhou:', e.message);
    res.json({ available: false, error: e.message });
  }
});

module.exports = router;
