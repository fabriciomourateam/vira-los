const express = require('express');
const router = express.Router();
const db = require('../db/database');

// GET /api/platforms/status
router.get('/status', (_req, res) => {
  const names = ['instagram', 'tiktok', 'youtube'];
  const status = {};
  for (const p of names) {
    const t = db.getPlatformToken(p);
    status[p] = {
      connected: !!t,
      username: t?.username || null,
      expires_at: t?.token_expires_at || null,
    };
  }
  res.json(status);
});

// ── Instagram ─────────────────────────────────────────────────────────────────

router.get('/instagram/auth-url', (_req, res) => {
  try {
    const ig = require('../services/instagram');
    res.json({ url: ig.getAuthUrl() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/instagram/callback', async (req, res) => {
  try {
    const ig = require('../services/instagram');
    const result = await ig.exchangeCode(req.body.code);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Conexão manual: o usuário cola o token diretamente (mais simples para desenvolvedores)
router.post('/instagram/manual', (req, res) => {
  try {
    const { access_token, user_id, username } = req.body;
    if (!access_token || !user_id) {
      return res.status(400).json({ error: 'access_token e user_id são obrigatórios' });
    }
    db.setPlatformToken('instagram', { access_token, user_id, username: username || 'instagram' });
    res.json({ ok: true, username: username || 'instagram' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/instagram', (_req, res) => {
  db.deletePlatformToken('instagram');
  res.json({ ok: true });
});

// ── TikTok ────────────────────────────────────────────────────────────────────

router.get('/tiktok/auth-url', (_req, res) => {
  try {
    const tt = require('../services/tiktok');
    res.json({ url: tt.getAuthUrl() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/tiktok/callback', async (req, res) => {
  try {
    const tt = require('../services/tiktok');
    const result = await tt.exchangeCode(req.body.code);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/tiktok', (_req, res) => {
  db.deletePlatformToken('tiktok');
  res.json({ ok: true });
});

// ── YouTube ───────────────────────────────────────────────────────────────────

router.get('/youtube/auth-url', (_req, res) => {
  try {
    const yt = require('../services/youtube');
    res.json({ url: yt.getAuthUrl() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/youtube/callback', async (req, res) => {
  try {
    const yt = require('../services/youtube');
    const result = await yt.exchangeCode(req.body.code);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/youtube', (_req, res) => {
  db.deletePlatformToken('youtube');
  res.json({ ok: true });
});

module.exports = router;
