/**
 * viralScore.js — Rota do Avaliador de Potencial Viral
 * POST /api/viral-score  → avalia script e retorna JSON com scores + melhorias
 */

const express = require('express');
const router = express.Router();
const { scoreScript } = require('../services/viralScoreService');

router.post('/', async (req, res) => {
  const { script, type = 'carousel' } = req.body;

  if (!script || !String(script).trim()) {
    return res.status(400).json({ error: 'O campo "script" é obrigatório.' });
  }
  if (!['carousel', 'reels'].includes(type)) {
    return res.status(400).json({ error: '"type" deve ser "carousel" ou "reels".' });
  }

  try {
    const result = await scoreScript(String(script).trim(), type);
    res.json(result);
  } catch (err) {
    console.error('[ViralScore]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
