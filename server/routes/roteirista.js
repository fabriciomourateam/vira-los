/**
 * roteirista.js — Rota do Roteirista (transcrição → roteiro adaptado)
 *
 * POST /api/roteirista  → chama roteiristaService.gerarRoteirista
 */

const express = require('express');
const { gerarRoteirista } = require('../services/roteiristaService');

const router = express.Router();

router.post('/', async (req, res) => {
  const { transcricao, nicho, estilo, assinatura, creatorProfile } = req.body || {};
  if (!transcricao || !String(transcricao).trim()) {
    return res.status(400).json({ error: 'Cole a transcrição do vídeo viral.' });
  }
  try {
    const result = await gerarRoteirista({ transcricao, nicho, estilo, assinatura, creatorProfile });
    res.json(result);
  } catch (err) {
    console.error('[Roteirista]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
