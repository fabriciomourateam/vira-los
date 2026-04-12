/**
 * carousel.js — Rotas do Gerador de Carrosseis para Instagram
 *
 * POST /api/carousel/generate          → gera HTML + screenshots + legenda.txt
 * GET  /api/carousel/output/:name      → lista arquivos de um carrossel gerado
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { generateCarousel } = require('../services/carouselService');

const router = express.Router();
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const OUTPUT_DIR = path.join(DATA_DIR, 'output');

// ─── Gerar carrossel ──────────────────────────────────────────────────────────

router.post('/generate', async (req, res) => {
  const {
    topic, niche, primaryColor, accentColor, bgColor,
    fontFamily, instagramHandle, numSlides, contentTone,
    customScript,
  } = req.body;

  if (!topic || !String(topic).trim()) {
    return res.status(400).json({ error: 'O campo "topic" (tema) é obrigatório' });
  }

  try {
    const result = await generateCarousel({
      topic, niche, primaryColor, accentColor, bgColor,
      fontFamily, instagramHandle, numSlides, contentTone,
      customScript,
    });
    res.json(result);
  } catch (err) {
    console.error('[Carousel Route]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Diagnóstico de variáveis e conectividade ────────────────────────────────

router.get('/check', async (req, res) => {
  const vars = {
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    UNSPLASH_ACCESS_KEY: !!process.env.UNSPLASH_ACCESS_KEY,
    APIFY_API_KEY: !!process.env.APIFY_API_KEY,
  };

  let unsplashOk = false;
  let unsplashError = null;
  if (process.env.UNSPLASH_ACCESS_KEY) {
    try {
      const r = await axios.get('https://api.unsplash.com/search/photos', {
        params: { query: 'technology', per_page: 1, orientation: 'portrait' },
        headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` },
        timeout: 8000,
      });
      unsplashOk = (r.data?.results?.length ?? 0) > 0;
    } catch (err) {
      unsplashError = `${err.response?.status || ''} ${err.response?.data?.errors?.[0] || err.message}`.trim();
    }
  }

  res.json({ vars, unsplash: { ok: unsplashOk, error: unsplashError } });
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
