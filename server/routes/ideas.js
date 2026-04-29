/**
 * ideas.js — Rotas do Gerador de Ideias de Conteúdo
 *
 * POST /api/ideas/discover          → inicia job de descoberta (retorna jobId)
 * GET  /api/ideas/status/:jobId     → status do job em andamento
 * GET  /api/ideas/config            → config salva (nicho, hashtags, etc.)
 * PUT  /api/ideas/config            → salva config
 * GET  /api/ideas/discovered        → ideias geradas na última rodada
 * DELETE /api/ideas/discovered/:id  → remove ideia da lista
 * DELETE /api/ideas/discovered      → limpa todas as ideias descobertas
 * GET  /api/ideas/calendar          → calendário de conteúdo
 * PUT  /api/ideas/calendar          → salva calendário
 * GET  /api/ideas/tracked           → posts rastreados (performance)
 * POST /api/ideas/tracked           → adiciona post rastreado
 * PUT  /api/ideas/tracked/:id       → atualiza métricas do post
 * DELETE /api/ideas/tracked/:id     → remove post rastreado
 * POST /api/ideas/to-reels          → gera roteiro de Reels a partir de uma ideia
 */

const express = require('express');
const router = express.Router();
const { scrapeInstagram, scrapeTikTok, scrapeGoogleTrends, scrapeReddit } = require('../services/discoveryService');
const { generateIdeas, generateReelsScript } = require('../services/ideasGeneratorService');
const db = require('../db/database');

// ─── Job store em memória (auto-limpa após 30 min) ───────────────────────────
const jobs = new Map();
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (new Date(job.startedAt).getTime() < cutoff) jobs.delete(id);
  }
}, 5 * 60 * 1000);

// ─── Config ───────────────────────────────────────────────────────────────────
router.get('/config', (req, res) => res.json(db.getIdeasConfig()));
router.put('/config', (req, res) => { db.setIdeasConfig(req.body); res.json({ ok: true }); });

// ─── Iniciar descoberta ───────────────────────────────────────────────────────
router.post('/discover', (req, res) => {
  const config = { ...db.getIdeasConfig(), ...req.body };
  const jobId = `job-${Date.now()}`;
  jobs.set(jobId, {
    status: 'running',
    progress: 0,
    steps: [],
    results: null,
    error: null,
    startedAt: new Date().toISOString(),
  });
  res.json({ jobId });
  runDiscovery(jobId, config); // async, não aguarda
});

async function runDiscovery(jobId, config) {
  function update(step, pct, label) {
    const job = jobs.get(jobId);
    if (!job) return;
    jobs.set(jobId, {
      ...job,
      progress: pct,
      steps: [...(job.steps || []), { step, label, time: new Date().toISOString() }],
    });
  }

  try {
    const {
      hashtags = [],
      keywords = [],
      platforms = ['instagram', 'tiktok', 'trends', 'reddit'],
    } = config;

    const SUBREDDITS = ['Fitness', 'bodybuilding', 'Testosterone', 'TRT', 'nutrition', 'GettingBigger'];

    update('start', 5, 'Iniciando coleta de dados...');

    // Corre todas as plataformas em paralelo — falhas individuais são toleradas
    const [igResult, ttResult, trendsResult, redditResult] = await Promise.allSettled([
      platforms.includes('instagram') ? scrapeInstagram(hashtags) : Promise.resolve([]),
      platforms.includes('tiktok')    ? scrapeTikTok(hashtags)    : Promise.resolve([]),
      platforms.includes('trends')    ? scrapeGoogleTrends(keywords.length ? keywords : hashtags) : Promise.resolve([]),
      platforms.includes('reddit')    ? scrapeReddit(SUBREDDITS)  : Promise.resolve([]),
    ]);

    const scrapedData = {
      instagram: igResult.status     === 'fulfilled' ? igResult.value     : [],
      tiktok:    ttResult.status     === 'fulfilled' ? ttResult.value     : [],
      trends:    trendsResult.status === 'fulfilled' ? trendsResult.value : [],
      reddit:    redditResult.status === 'fulfilled' ? redditResult.value : [],
    };

    // ── Diagnóstico por plataforma: o que veio vs vazio ─────────────────────────
    const platformStatus = {
      instagram: { active: platforms.includes('instagram'), count: scrapedData.instagram.length, error: igResult.status === 'rejected' ? (igResult.reason?.message || 'erro') : (platforms.includes('instagram') && scrapedData.instagram.length === 0 ? 'sem resultados (Apify pode estar inativo)' : null) },
      tiktok:    { active: platforms.includes('tiktok'),    count: scrapedData.tiktok.length,    error: ttResult.status === 'rejected' ? (ttResult.reason?.message || 'erro') : (platforms.includes('tiktok') && scrapedData.tiktok.length === 0 ? 'TikTok bloqueou IP do servidor (403)' : null) },
      trends:    { active: platforms.includes('trends'),    count: scrapedData.trends.length,    error: trendsResult.status === 'rejected' ? (trendsResult.reason?.message || 'erro') : (platforms.includes('trends') && scrapedData.trends.length === 0 ? 'Google Trends bloqueou IP do servidor (403)' : null) },
      reddit:    { active: platforms.includes('reddit'),    count: scrapedData.reddit.length,    error: redditResult.status === 'rejected' ? (redditResult.reason?.message || 'erro') : (platforms.includes('reddit') && scrapedData.reddit.length === 0 ? 'Reddit bloqueou IP do servidor (403)' : null) },
    };
    scrapedData.platformStatus = platformStatus;

    const total = scrapedData.instagram.length + scrapedData.tiktok.length +
                  scrapedData.reddit.length + scrapedData.trends.length;

    // ── Se TODOS os scrapers falharam: vai direto pro Claude (fallback) ─────────
    if (total === 0) {
      update('fallback', 70, 'Scrapers bloquearam o servidor — gerando ideias direto via IA…');
      try {
        const ideas = await generateIdeas(scrapedData, config);
        db.saveDiscoveredIdeas(ideas);
        update('done', 100, `${ideas.length} ideias geradas (modo fallback IA)`);
        const job = jobs.get(jobId);
        jobs.set(jobId, { ...job, status: 'done', results: ideas, scrapedData, progress: 100 });
      } catch (err) {
        console.error('[Ideas/Discovery] fallback IA falhou:', err.message);
        const job = jobs.get(jobId);
        if (job) jobs.set(jobId, { ...job, status: 'error', error: `Scrapers bloqueados e fallback IA falhou: ${err.message}` });
      }
      return;
    }

    // ── Pausa para revisão: o usuário verá os dados antes de gerar ideias ──────
    update('scraped', 65, `${total} resultados coletados. Revise os dados abaixo.`);
    const job = jobs.get(jobId);
    jobs.set(jobId, { ...job, status: 'scraped', scrapedData, progress: 65 });
    // Geração de ideias é disparada separadamente por POST /generate-ideas

  } catch (err) {
    console.error('[Ideas/Discovery]', err.message);
    const job = jobs.get(jobId);
    if (job) jobs.set(jobId, { ...job, status: 'error', error: err.message });
  }
}

// ─── Gerar ideias a partir de dados já coletados (disparado pelo usuário) ─────
router.post('/generate-ideas', async (req, res) => {
  const { scrapedData } = req.body;
  if (!scrapedData) return res.status(400).json({ error: 'scrapedData obrigatório' });
  try {
    const config = db.getIdeasConfig();
    const ideas = await generateIdeas(scrapedData, config);
    db.saveDiscoveredIdeas(ideas);
    res.json({ ideas });
  } catch (err) {
    console.error('[Ideas/GenerateIdeas]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Status do job ────────────────────────────────────────────────────────────
router.get('/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job não encontrado' });
  res.json(job);
});

// ─── Ideias descobertas ───────────────────────────────────────────────────────
router.get('/discovered', (req, res) => res.json(db.getDiscoveredIdeas()));

router.delete('/discovered', (req, res) => {
  db.saveDiscoveredIdeas([]);
  res.json({ ok: true });
});

router.delete('/discovered/:id', (req, res) => {
  db.deleteDiscoveredIdea(req.params.id);
  res.json({ ok: true });
});

// ─── Calendário ───────────────────────────────────────────────────────────────
router.get('/calendar', (req, res) => res.json(db.getContentCalendar()));
router.put('/calendar', (req, res) => { db.setContentCalendar(req.body); res.json({ ok: true }); });

// ─── Posts rastreados (performance) ──────────────────────────────────────────
router.get('/tracked', (req, res) => res.json(db.getTrackedPosts()));

router.post('/tracked', (req, res) => {
  db.addTrackedPost(req.body);
  res.json({ ok: true });
});

router.put('/tracked/:id', (req, res) => {
  db.updateTrackedPost(req.params.id, req.body);
  res.json({ ok: true });
});

router.delete('/tracked/:id', (req, res) => {
  db.deleteTrackedPost(req.params.id);
  res.json({ ok: true });
});

// ─── Converter ideia → roteiro de Reels ──────────────────────────────────────
router.post('/to-reels', async (req, res) => {
  const { idea } = req.body;
  if (!idea) return res.status(400).json({ error: '"idea" é obrigatório' });
  try {
    const config = db.getIdeasConfig();
    const script = await generateReelsScript(idea, config);
    res.json({ script });
  } catch (err) {
    console.error('[Ideas/ToReels]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
