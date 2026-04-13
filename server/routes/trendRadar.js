/**
 * trendRadar.js — Rota do Radar de Tendências
 * GET /api/trend-radar?niche=fitness          → busca tendências para o nicho
 * GET /api/trend-radar?niche=fitness&refresh  → força atualização do cache
 * GET /api/trend-radar/niches                 → lista niches disponíveis
 */

const express = require('express');
const router = express.Router();
const { getTrendRadar, NICHE_MAP } = require('../services/trendRadarService');

// ─── Cache em memória (30 min por nicho) ──────────────────────────────────────
const cache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

// ─── Lista de niches ──────────────────────────────────────────────────────────
router.get('/niches', (_req, res) => {
  res.json({ niches: Object.keys(NICHE_MAP) });
});

// ─── Radar principal ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const niche   = (req.query.niche   || '').toString().trim();
  const refresh = req.query.refresh !== undefined;

  if (!niche) {
    return res.status(400).json({ error: 'Parâmetro "niche" é obrigatório.' });
  }

  const cacheKey = niche.toLowerCase();
  const cached   = cache.get(cacheKey);

  if (cached && !refresh && Date.now() - cached.ts < CACHE_TTL_MS) {
    return res.json({ ...cached.data, fromCache: true, cachedAt: new Date(cached.ts).toISOString() });
  }

  // Timeout de segurança — responde com erro se demorar mais de 50s
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({ error: 'Tempo limite excedido. Tente novamente.' });
    }
  }, 50000);

  try {
    const data = await getTrendRadar(niche);
    clearTimeout(timer);
    if (res.headersSent) return;
    cache.set(cacheKey, { data, ts: Date.now() });
    res.json({ ...data, fromCache: false });
  } catch (err) {
    clearTimeout(timer);
    console.error('[TrendRadar]', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

module.exports = router;
