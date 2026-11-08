/**
 * storySequence.js — Rota do Gerador de Sequência de Stories
 * POST /api/story-sequence  → gera 5 stories a partir de um script de carrossel
 */

const express = require('express');
const router = express.Router();
const { generateStorySequence } = require('../services/storySequenceService');

router.post('/', async (req, res) => {
  const { carouselScript, instagramHandle = '' } = req.body;

  if (!carouselScript || !String(carouselScript).trim()) {
    return res.status(400).json({ error: 'O campo "carouselScript" é obrigatório.' });
  }

  try {
    const result = await generateStorySequence(
      String(carouselScript).trim(),
      String(instagramHandle).trim()
    );
    res.json(result);
  } catch (err) {
    console.error('[StorySequence]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
