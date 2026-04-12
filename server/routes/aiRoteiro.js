/**
 * aiRoteiro.js — Rota do Gerador de Roteiros de Reels
 *
 * POST /api/ai-roteiro  → chama aiRoteiroService.gerarRoteiro
 */

const express = require('express');
const { gerarRoteiro } = require('../services/aiRoteiroService');

const router = express.Router();

router.post('/', async (req, res) => {
  const { tema, formato, tom, publicoAlvo, creatorProfile } = req.body;

  if (!tema || !String(tema).trim()) {
    return res.status(400).json({ error: 'O campo "tema" é obrigatório.' });
  }

  try {
    const result = await gerarRoteiro({ tema, formato, tom, publicoAlvo, creatorProfile });
    res.json(result);
  } catch (err) {
    console.error('[AI Roteiro Route]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
