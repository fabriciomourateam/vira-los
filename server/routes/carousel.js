/**
 * carousel.js — Rotas do Gerador de Carrosseis para Instagram
 *
 * POST /api/carousel/generate  → gera HTML do carrossel com campos personalizados
 */

const express = require('express');
const { generateCarousel } = require('../services/carouselService');

const router = express.Router();

router.post('/generate', async (req, res) => {
  const {
    topic,
    niche,
    primaryColor,
    accentColor,
    bgColor,
    fontFamily,
    instagramHandle,
    numSlides,
    contentTone,
  } = req.body;

  if (!topic || !String(topic).trim()) {
    return res.status(400).json({ error: 'O campo "topic" (tema) é obrigatório' });
  }

  try {
    const result = await generateCarousel({
      topic,
      niche,
      primaryColor,
      accentColor,
      bgColor,
      fontFamily,
      instagramHandle,
      numSlides,
      contentTone,
    });
    res.json(result);
  } catch (err) {
    console.error('[Carousel Route]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
