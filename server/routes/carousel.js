/**
 * carousel.js — Rotas do Gerador de Carrosseis para Instagram
 *
 * POST /api/carousel/generate          → gera HTML + screenshots + legenda.txt
 * GET  /api/carousel/config            → retorna config salva
 * PUT  /api/carousel/config            → salva config
 * GET  /api/carousel/saved             → lista carrosseis salvos
 * POST /api/carousel/saved             → salva carrossel no histórico
 * DELETE /api/carousel/saved/:id       → exclui carrossel salvo
 * GET  /api/carousel/output/:name      → lista arquivos de um carrossel gerado
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const multer = require('multer');
const { generateCarousel, takeScreenshots, OUTPUT_DIR } = require('../services/carouselService');
const db = require('../db/database');

const router = express.Router();
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const UPLOADS_DIR = path.join(__dirname, '../uploads');

// ─── Multer: upload de foto de perfil ────────────────────────────────────────

const profilePhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `profile-${Date.now()}${ext}`);
  },
});
const uploadPhoto = multer({
  storage: profilePhotoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Apenas imagens são permitidas'));
  },
});

// ─── Upload foto de perfil ────────────────────────────────────────────────────

router.post('/upload-photo', uploadPhoto.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada' });
  const SERVER_URL = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3001}`;
  const url = `${SERVER_URL}/uploads/${req.file.filename}`;
  res.json({ url });
});

// ─── Gerar carrossel ──────────────────────────────────────────────────────────

router.post('/generate', async (req, res) => {
  const {
    topic, niche, primaryColor, accentColor, bgColor,
    fontFamily, instagramHandle, creatorName, profilePhotoUrl,
    numSlides, contentTone, dominantEmotion, roteiro, layoutStyle,
    templateHtml,
  } = req.body;

  if (!topic || !String(topic).trim()) {
    return res.status(400).json({ error: 'O campo "topic" (tema) é obrigatório' });
  }

  try {
    const result = await generateCarousel({
      topic, niche, primaryColor, accentColor, bgColor,
      fontFamily, instagramHandle, creatorName, profilePhotoUrl,
      numSlides, contentTone, dominantEmotion, roteiro, layoutStyle,
      templateHtml,
    });
    res.json(result);
  } catch (err) {
    console.error('[Carousel Route]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Config persistente ───────────────────────────────────────────────────────

router.get('/config', (req, res) => {
  res.json(db.getCarouselConfig());
});

router.put('/config', (req, res) => {
  db.setCarouselConfig(req.body);
  res.json({ ok: true });
});

// ─── Salvar HTML editado (sem regerar screenshots) ──────────────────────────

router.put('/save-html', (req, res) => {
  const { html, folderName } = req.body;
  if (!html || !folderName) return res.status(400).json({ error: 'html e folderName obrigatórios' });

  const folderPath = path.join(OUTPUT_DIR, folderName);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  const htmlFilePath = path.join(folderPath, 'carrossel.html');
  fs.writeFileSync(htmlFilePath, html, 'utf8');
  res.json({ ok: true });
});

// ─── Regenerar screenshots a partir de HTML editado ──────────────────────────

router.post('/screenshots', async (req, res) => {
  const { html, folderName, bgColor = '#1a1a1a', primaryColor = '#B078FF' } = req.body;
  if (!html || !folderName) return res.status(400).json({ error: 'html e folderName obrigatórios' });

  const folderPath = path.join(OUTPUT_DIR, folderName);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  // Salva HTML editado no disco
  const htmlFilePath = path.join(folderPath, 'carrossel.html');
  fs.writeFileSync(htmlFilePath, html, 'utf8');

  try {
    const screenshots = await takeScreenshots(htmlFilePath, folderPath, bgColor, primaryColor, folderName);
    res.json({ screenshots });
  } catch (err) {
    console.error('[Carousel/Screenshots]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Salvar carrossel editado como modelo ─────────────────────────────────────

router.post('/save-template', async (req, res) => {
  const { html, folderName, name, numSlides, legenda, config,
          bgColor = '#1a1a1a', primaryColor = '#B078FF' } = req.body;
  if (!html || !name) return res.status(400).json({ error: 'html e name obrigatórios' });

  // Cria pasta própria para o template
  const slug = name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').substring(0, 40).replace(/-$/, '');
  const templateFolder = `template-${slug}-${Date.now()}`;
  const folderPath = path.join(OUTPUT_DIR, templateFolder);
  fs.mkdirSync(folderPath, { recursive: true });

  const htmlFilePath = path.join(folderPath, 'carrossel.html');
  fs.writeFileSync(htmlFilePath, html, 'utf8');
  if (legenda) fs.writeFileSync(path.join(folderPath, 'legenda.txt'), legenda, 'utf8');

  let screenshots = [];
  try {
    screenshots = await takeScreenshots(htmlFilePath, folderPath, bgColor, primaryColor, templateFolder);
  } catch (err) {
    console.warn('[Carousel/SaveTemplate] Screenshots falhou:', err.message);
  }

  const templateId = `t_${Date.now()}`;
  db.saveCarousel({
    id: templateId,
    topic: name,
    folderName: templateFolder,
    numSlides: numSlides || 0,
    screenshots,
    legenda: legenda || '',
    config: config || {},
    isTemplate: true,
  });

  res.json({ ok: true, id: templateId, folderName: templateFolder, screenshots });
});

// ─── Carrosseis salvos (histórico + templates) ────────────────────────────────

router.get('/saved', (req, res) => {
  res.json(db.getAllCarousels());
});

router.post('/saved', (req, res) => {
  const { id, topic, folderName, numSlides, screenshots, legenda, config } = req.body;
  if (!id || !topic) return res.status(400).json({ error: 'id e topic obrigatórios' });
  db.saveCarousel({ id, topic, folderName, numSlides, screenshots, legenda, config });
  res.json({ ok: true });
});

router.delete('/saved/:id', (req, res) => {
  db.deleteCarousel(req.params.id);
  res.json({ ok: true });
});

router.patch('/saved/:id', (req, res) => {
  const { screenshots } = req.body;
  if (!screenshots) return res.status(400).json({ error: 'screenshots obrigatório' });
  db.updateCarousel(req.params.id, { screenshots });
  res.json({ ok: true });
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
