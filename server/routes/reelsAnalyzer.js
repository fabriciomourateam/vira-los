/**
 * reelsAnalyzer.js — Rotas do Analisador de Reels
 *
 * POST /api/reels-analyzer/start   → inicia análise do Reel
 * GET  /api/reels-analyzer/stream  → SSE com progresso em tempo real
 * GET  /api/reels-analyzer/status  → status atual (polling fallback)
 */

const express = require('express');
const router = express.Router();
const { analyzeReel, getState, sseClients } = require('../services/reelsAnalyzerService');

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

module.exports = router;
