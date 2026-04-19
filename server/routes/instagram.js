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
    const { shortToken, longToken } = await exchangeCodeForToken(code);

    // Tenta com long-lived primeiro, fallback para short-lived
    let discovery;
    try {
      discovery = await getIGBusinessAccount(longToken);
    } catch (err) {
      console.warn('[Instagram/Callback] Long token falhou, tentando short token:', err.message);
      discovery = await getIGBusinessAccount(shortToken);
    }
    const { igUserId, pageToken } = discovery;

    const effectiveToken = pageToken || longToken;
    let igInfo;
    try {
      igInfo = await getIGUserInfo(igUserId, effectiveToken);
    } catch {
      igInfo = await getIGUserInfo(igUserId, longToken);
    }

    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

    db.setInstagramToken({
      accessToken:    effectiveToken,
      pageToken,
      igUserId,
      username:       igInfo.username || igInfo.name,
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

// ─── Helper: busca token do Analytics OU do Agendador (fallback) ─────────────

function getEffectiveToken() {
  // 1. Token próprio do Analytics (OAuth completo)
  const igToken = db.getInstagramToken();
  if (igToken?.accessToken) return igToken;

  // 2. Fallback: token manual do Agendador (platforms/instagram)
  const platformToken = db.getPlatformToken('instagram');
  if (platformToken?.access_token) {
    return {
      accessToken: platformToken.access_token,
      igUserId: platformToken.user_id,
      username: platformToken.username || 'instagram',
      profilePicture: null,
      followersCount: null,
      expiresAt: null,
      lastSync: platformToken.updated_at || null,
      fromScheduler: true,
    };
  }

  return null;
}

// ─── Status ───────────────────────────────────────────────────────────────────

router.get('/status', (req, res) => {
  const token = getEffectiveToken();
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
    fromScheduler:  token.fromScheduler || false,
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
  const token = getEffectiveToken();
  if (!token?.accessToken) {
    return res.status(401).json({ error: 'Conta não conectada. Conecte pelo Analytics ou pelo Agendador.' });
  }

  try {
    const posts = await syncPosts(token.accessToken, token.igUserId);
    db.saveInstagramPosts(posts);
    if (!token.fromScheduler) {
      db.setInstagramToken({ ...token, lastSync: new Date().toISOString() });
    }
    res.json({ ok: true, count: posts.length });
  } catch (err) {
    // Extrai a mensagem real do Meta API (axios encapsula em err.response.data.error)
    const metaError = err.response?.data?.error;
    const msg = metaError
      ? `[Meta API ${metaError.code}] ${metaError.message}`
      : err.message;
    console.error('[Instagram/Sync]', msg, err.response?.data || '');
    res.status(500).json({ error: msg });
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
  const token = getEffectiveToken();
  if (!token?.accessToken) {
    return res.status(401).json({ error: 'Conta não conectada. Conecte pelo Analytics ou pelo Agendador.' });
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
    const metaError = err.response?.data?.error;
    const msg = metaError ? `[Meta API ${metaError.code}] ${metaError.message}` : err.message;
    console.error('[Instagram/Analyze]', msg);
    // redefine err.message para o bloco abaixo
    err.message = msg;
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
