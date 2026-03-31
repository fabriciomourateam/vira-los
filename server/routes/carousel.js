/**
 * carousel.js — Rotas do Gerador de Carrosseis para Instagram
 *
 * POST /api/carousel/generate          → gera HTML + screenshots + legenda.txt
 * GET  /api/carousel/output/:name      → lista arquivos de um carrossel gerado
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { generateCarousel } = require('../services/carouselService');

const router = express.Router();
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const OUTPUT_DIR = path.join(DATA_DIR, 'output');

// ─── Gerar carrossel ──────────────────────────────────────────────────────────

router.post('/generate', async (req, res) => {
  const {
    topic, niche, primaryColor, accentColor, bgColor,
    fontFamily, instagramHandle, numSlides, contentTone,
  } = req.body;

  if (!topic || !String(topic).trim()) {
    return res.status(400).json({ error: 'O campo "topic" (tema) é obrigatório' });
  }

  try {
    const result = await generateCarousel({
      topic, niche, primaryColor, accentColor, bgColor,
      fontFamily, instagramHandle, numSlides, contentTone,
    });
    res.json(result);
  } catch (err) {
    console.error('[Carousel Route]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Listar arquivos de um carrossel ──────────────────────────────────────────

router.get('/output/:name', (req, res) => {
  const folderPath = path.join(OUTPUT_DIR, req.params.name);
  if (!fs.existsSync(folderPath)) {
    return res.status(404).json({ error: 'Carrossel não encontrado' });
  }
  const files = fs.readdirSync(folderPath);
  res.json({ files });
});

module.exports = router;
