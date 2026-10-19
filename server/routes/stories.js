/**
 * stories.js — Rotas dos Stories automáticos (Phase 3).
 *  POST /api/stories/generate  → dispara a geração do pack do dia (cron ou manual)
 *  GET  /api/stories           → lista os batches recentes + estado (UI e poll do cron)
 */
const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { generateDailyStories, getState } = require('../services/storyService');

// Kick-off assíncrono: responde rápido e gera em background (geração+render demora).
router.post('/generate', (req, res) => {
  const trigger = (req.body && req.body.trigger) || 'manual';
  if (getState().generating) return res.json({ started: false, reason: 'already-generating' });
  generateDailyStories({ trigger }).catch((e) => console.error('[Stories] background:', e.message));
  res.json({ started: true });
});

router.get('/', (_req, res) => {
  res.json({ batches: db.getAllStoryBatches().slice(0, 30), state: getState() });
});

module.exports = router;
