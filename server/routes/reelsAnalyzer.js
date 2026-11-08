/**
 * reelsAnalyzer.js — Rotas do Analisador de Reels
 *
 * POST /api/reels-analyzer/start   → inicia análise do Reel
 * GET  /api/reels-analyzer/stream  → SSE com progresso em tempo real
 * GET  /api/reels-analyzer/status  → status atual (polling fallback)
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { analyzeReel, analyzeLocalVideo, getState, sseClients } = require('../services/reelsAnalyzerService');
const db = require('../db/database');

// ─── Upload de vídeo local (mesmo volume persistente dos outros uploads) ──────
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../uploads');
const ANALYZER_UPLOAD_DIR = path.join(UPLOADS_DIR, 'reels', 'analyzer');

const analyzerStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(ANALYZER_UPLOAD_DIR, { recursive: true });
    cb(null, ANALYZER_UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '.mp4').toLowerCase();
    cb(null, `upload_${Date.now()}${ext}`);
  },
});
const uploadVideo = multer({
  storage: analyzerStorage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (_req, file, cb) =>
    cb(null, /video\//.test(file.mimetype) || /\.(mp4|mov|m4v|webm)$/i.test(file.originalname)),
});

// ─── SSE: stream de eventos em tempo real ─────────────────────────────────────

router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Envia estado atual imediatamente
  const state = getState();
  res.write(`data: ${JSON.stringify({ type: 'state', state })}\n\n`);

  sseClients.add(res);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// ─── Status atual (polling fallback) ──────────────────────────────────────────

router.get('/status', (req, res) => {
  res.json(getState());
});

// ─── Inicia análise ───────────────────────────────────────────────────────────

router.post('/start', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'URL do Reel é obrigatória.' });
  }

  const cleanUrl = url.trim();

  // Valida que é uma URL do Instagram ou TikTok
  const isInstagram = /instagram\.com\/(reel|p|tv)\//i.test(cleanUrl);
  const isTikTok    = /tiktok\.com/i.test(cleanUrl);
  if (!isInstagram && !isTikTok) {
    return res.status(400).json({
      error: 'URL inválida. Use um link de Reel do Instagram ou vídeo do TikTok.',
    });
  }

  const state = getState();
  if (state.running) {
    return res.status(409).json({ error: 'Análise já em andamento. Aguarde terminar.' });
  }

  // Inicia análise em background (não aguarda — o cliente monitora via SSE)
  analyzeReel(cleanUrl).catch(err => {
    console.error('[ReelsAnalyzer Route] Erro não capturado:', err.message);
  });

  res.json({ ok: true, message: 'Análise iniciada. Monitore via /stream.' });
});

// ─── Inicia análise a partir de vídeo ENVIADO (upload) ────────────────────────
// Para vídeos que NÃO estão no Instagram/TikTok (ex.: criativos de anúncio).
// Reutiliza o mesmo pipeline/SSE do fluxo por URL, pulando Apify/yt-dlp.
router.post('/upload', (req, res) => {
  uploadVideo.single('video')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Falha no upload do vídeo.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Envie um arquivo de vídeo (campo "video").' });
    }

    const state = getState();
    if (state.running) {
      try { fs.rmSync(req.file.path, { force: true }); } catch {}
      return res.status(409).json({ error: 'Análise já em andamento. Aguarde terminar.' });
    }

    const caption = typeof req.body?.caption === 'string' ? req.body.caption.trim() : '';

    // Roda em background — o cliente monitora via /stream (SSE).
    analyzeLocalVideo(req.file.path, caption).catch(e => {
      console.error('[ReelsAnalyzer Route] Erro upload não capturado:', e.message);
    });

    res.json({ ok: true, message: 'Análise iniciada. Monitore via /stream.' });
  });
});

// ─── Banco de Roteiros Salvos ────────────────────────────────────────────────

router.get('/scripts', (req, res) => {
  res.json(db.getAllReelsScripts());
});

router.post('/scripts', (req, res) => {
  const { title, script } = req.body;
  if (!title || !script) return res.status(400).json({ error: 'title e script obrigatórios' });
  const id = `rs_${Date.now()}`;
  const saved = db.createReelsScript({ id, title, script });
  res.json({ ok: true, id: saved.id });
});

router.patch('/scripts/:id', (req, res) => {
  const { title, script } = req.body;
  const update = {};
  if (title !== undefined) update.title = title;
  if (script !== undefined) update.script = script;
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
  db.updateReelsScript(req.params.id, update);
  res.json({ ok: true });
});

router.delete('/scripts/:id', (req, res) => {
  db.deleteReelsScript(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
