/**
 * instagram.js — Instagram Graph API routes
 *
 * GET  /api/instagram/connect-url   → OAuth URL para o frontend abrir
 * GET  /api/instagram/callback      → Troca code → token, salva conta, redireciona
 * GET  /api/instagram/status        → Status da conexão + info da conta
 * DELETE /api/instagram/disconnect  → Remove token e posts
 * POST /api/instagram/sync          → Busca posts + insights do IG
 * GET  /api/instagram/posts         → Lista posts sincronizados
 * GET  /api/instagram/analysis      → Última análise IA salva
 * POST /api/instagram/analyze       → Roda análise IA com Claude
 */

const express = require('express');
const router  = express.Router();

const {
  getConnectUrl,
  exchangeCodeForToken,
  getIGBusinessAccount,
  getIGUserInfo,
  syncPosts,
} = require('../services/instagramService');
const { analyzeWithAI } = require('../services/instagramAnalyticsService');
const db = require('../db/database');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// ─── OAuth Connect URL ────────────────────────────────────────────────────────

router.get('/connect-url', (req, res) => {
  try {
    const url = getConnectUrl();
    res.json({ url });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// ─── OAuth Callback ───────────────────────────────────────────────────────────

router.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    const msg = error || 'Acesso negado';
    return res.redirect(`${FRONTEND_URL}?ig_error=${encodeURIComponent(msg)}`);
  }

  try {
    const longLivedToken         = await exchangeCodeForToken(code);
    const { igUserId, pageToken } = await getIGBusinessAccount(longLivedToken);
    const igInfo                  = await getIGUserInfo(igUserId, longLivedToken);

    // Long-lived tokens last 60 days
    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

    db.setInstagramToken({
      accessToken:    longLivedToken,
      pageToken,
      igUserId,
      username:       igInfo.username,
      name:           igInfo.name,
      profilePicture: igInfo.profile_picture_url,
      followersCount: igInfo.followers_count,
      expiresAt,
      createdAt:      new Date().toISOString(),
    });

    res.redirect(`${FRONTEND_URL}?ig_connected=1`);
  } catch (err) {
    console.error('[Instagram/Callback]', err.message);
    res.redirect(`${FRONTEND_URL}?ig_error=${encodeURIComponent(err.message)}`);
  }
});

// ─── Status ───────────────────────────────────────────────────────────────────

router.get('/status', (req, res) => {
  const token = db.getInstagramToken();
  if (!token?.accessToken) {
    return res.json({ connected: false });
  }

  const daysLeft = token.expiresAt
    ? Math.max(0, Math.floor((new Date(token.expiresAt) - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  res.json({
    connected:      true,
    username:       token.username,
    profilePicture: token.profilePicture,
    followersCount: token.followersCount,
    daysLeft,
    lastSync:       token.lastSync || null,
  });
});

// ─── Disconnect ───────────────────────────────────────────────────────────────

router.delete('/disconnect', (req, res) => {
  db.clearInstagramToken();
  db.saveInstagramPosts([]);
  res.json({ ok: true });
});

// ─── Sync Posts ───────────────────────────────────────────────────────────────

router.post('/sync', async (req, res) => {
  const token = db.getInstagramToken();
  if (!token?.accessToken) {
    return res.status(401).json({ error: 'Conta não conectada' });
  }

  try {
    const posts = await syncPosts(token.accessToken, token.igUserId);
    db.saveInstagramPosts(posts);
    // Store lastSync inside the token object
    db.setInstagramToken({ ...token, lastSync: new Date().toISOString() });
    res.json({ ok: true, count: posts.length });
  } catch (err) {
    console.error('[Instagram/Sync]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Posts ────────────────────────────────────────────────────────────────────

router.get('/posts', (req, res) => {
  res.json(db.getInstagramPosts());
});

// ─── Saved Analysis ───────────────────────────────────────────────────────────

router.get('/analysis', (req, res) => {
  const analysis = db.getInstagramAnalysis();
  if (!analysis?.generatedAt) {
    return res.status(404).json({ error: 'Nenhuma análise encontrada. Execute "Analisar com IA" primeiro.' });
  }
  res.json(analysis);
});

// ─── Run AI Analysis ──────────────────────────────────────────────────────────

router.post('/analyze', async (req, res) => {
  const token = db.getInstagramToken();
  if (!token?.accessToken) {
    return res.status(401).json({ error: 'Conta não conectada' });
  }

  const posts = db.getInstagramPosts();
  if (posts.length === 0) {
    return res.status(400).json({ error: 'Nenhum post sincronizado. Clique em Sincronizar primeiro.' });
  }

  try {
    const analysis = await analyzeWithAI(posts, {
      username:       token.username,
      followersCount: token.followersCount,
    });
    db.saveInstagramAnalysis(analysis);
    res.json(analysis);
  } catch (err) {
    console.error('[Instagram/Analyze]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
