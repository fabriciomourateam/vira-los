/**
 * trendRadar.js — Rota do Radar de Tendências (SSE)
 * GET /api/trend-radar?niche=fitness          → stream SSE com progresso + resultado
 * GET /api/trend-radar?niche=fitness&refresh  → força atualização do cache
 * GET /api/trend-radar/niches                 → lista niches disponíveis
 */

const express = require('express');
const router = express.Router();
const {
  NICHE_MAP,
  resolveSubreddits,
  fetchRedditTrends,
  analyzeOpportunities,
} = require('../services/trendRadarService');

// ─── Cache em memória (30 min por nicho) ──────────────────────────────────────
const cache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

// ─── Lista de niches ──────────────────────────────────────────────────────────
router.get('/niches', (_req, res) => {
  res.json({ niches: Object.keys(NICHE_MAP) });
});

// ─── Radar principal via SSE ──────────────────────────────────────────────────
router.get('/', (req, res) => {
  const niche   = (req.query.niche   || '').toString().trim();
  const refresh = req.query.refresh !== undefined;

  if (!niche) {
    return res.status(400).json({ error: 'Parâmetro "niche" é obrigatório.' });
  }

  // ── SSE headers ──────────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Heartbeat a cada 15s — mantém a conexão viva no Railway
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': heartbeat\n\n');
  }, 15000);

  function send(obj) {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  }

  function done() {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }

  req.on('close', () => clearInterval(heartbeat));

  // ── Verifica cache ────────────────────────────────────────────────────────────
  const cacheKey = niche.toLowerCase();
  const cached   = cache.get(cacheKey);

  if (cached && !refresh && Date.now() - cached.ts < CACHE_TTL_MS) {
    send({
      type: 'result',
      data: { ...cached.data, fromCache: true, cachedAt: new Date(cached.ts).toISOString() },
    });
    done();
    return;
  }

  // ── Processamento assíncrono ──────────────────────────────────────────────────
  (async () => {
    try {
      send({ type: 'progress', message: 'Buscando posts no Reddit...' });

      const subreddits = resolveSubreddits(niche);
      const trends     = await fetchRedditTrends(subreddits);

      send({
        type: 'progress',
        message: trends.length > 0
          ? `${trends.length} posts encontrados. Analisando com IA...`
          : 'Reddit indisponível — gerando com base no conhecimento da IA...',
      });

      const result = await analyzeOpportunities(trends, niche);

      const data = {
        ...result,
        subredditsConsultados: subreddits.slice(0, 6),
        totalPostsAnalisados:  trends.length,
        redditDisponivel:      trends.length > 0,
        updatedAt:             new Date().toISOString(),
      };

      cache.set(cacheKey, { data, ts: Date.now() });
      send({ type: 'result', data: { ...data, fromCache: false } });
    } catch (err) {
      console.error('[TrendRadar]', err.message);
      send({ type: 'error', message: err.message });
    } finally {
      done();
    }
  })();
});

module.exports = router;
