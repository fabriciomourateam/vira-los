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
  getIGUserInfo,
  syncPosts,
  getAudienceDemographics,
} = require('../services/instagramService');
const { analyzeWithAI } = require('../services/instagramAnalyticsService');
const db = require('../db/database');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// ─── Helper: monta um snapshot agregado das métricas da conta ────────────────
// Roda a cada sync. Captura nº de seguidores + médias/totais dos posts, datado,
// pra alimentar o gráfico de evolução (1 ponto por sync).
function buildSnapshot(posts, accountInfo) {
  const sum = (f) => posts.reduce((s, p) => s + (Number(p[f]) || 0), 0);
  const avg = (f) => (posts.length ? sum(f) / posts.length : 0);
  const r2  = (x) => Math.round(x * 100) / 100;

  const reels     = posts.filter((p) => p.mediaType === 'REELS' || p.mediaType === 'VIDEO');
  const carousels = posts.filter((p) => p.mediaType === 'CAROUSEL_ALBUM');
  const images    = posts.filter((p) => p.mediaType === 'IMAGE');

  return {
    date:              new Date().toISOString(),
    followers:         accountInfo?.followers_count ?? null,
    mediaCount:        accountInfo?.media_count ?? null,
    postsAnalyzed:     posts.length,
    avgEngagementRate: r2(avg('engagementRate')),
    avgSaveRate:       r2(avg('saveRate')),
    avgShareRate:      r2(avg('shareRate')),
    avgCommentRate:    r2(avg('commentRate')),
    totalReach:        sum('reach'),
    totalLikes:        sum('likes'),
    totalComments:     sum('comments'),
    totalSaves:        sum('saves'),
    totalShares:       sum('shares'),
    totalViews:        sum('views'),
    totalFollows:      sum('follows'),
    reelsCount:        reels.length,
    carouselsCount:    carousels.length,
    imagesCount:       images.length,
  };
}

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
  const { code, error, error_description } = req.query;

  if (error || !code) {
    const msg = error_description || error || 'Acesso negado';
    return res.redirect(`${FRONTEND_URL}?ig_error=${encodeURIComponent(msg)}`);
  }

  try {
    // Instagram Login: a troca já devolve o token do próprio usuário IG — sem Página
    const { accessToken, userId } = await exchangeCodeForToken(code);
    const info = await getIGUserInfo(accessToken);

    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

    db.setInstagramToken({
      accessToken,
      igUserId:       info.user_id || userId,
      username:       info.username,
      name:           info.name || info.username,
      profilePicture: info.profile_picture_url || null,
      followersCount: info.followers_count ?? null,
      accountType:    info.account_type || null,
      expiresAt,
      createdAt:      new Date().toISOString(),
    });

    res.redirect(`${FRONTEND_URL}?ig_connected=1`);
  } catch (err) {
    const apiMsg = err.response?.data?.error_message
      || err.response?.data?.error?.message
      || err.message;
    console.error('[Instagram/Callback]', apiMsg, err.response?.data || '');
    res.redirect(`${FRONTEND_URL}?ig_error=${encodeURIComponent(apiMsg)}`);
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
    const posts = await syncPosts(token.accessToken);
    db.saveInstagramPosts(posts);

    // Refresca os dados da conta (seguidores atualizados) — best-effort
    let accountInfo = null;
    try {
      accountInfo = await getIGUserInfo(token.accessToken);
    } catch (e) {
      console.warn('[Instagram/Sync] info da conta indisponível:', e.message);
    }

    if (!token.fromScheduler) {
      db.setInstagramToken({
        ...token,
        followersCount: accountInfo?.followers_count ?? token.followersCount ?? null,
        lastSync: new Date().toISOString(),
      });
    }

    // Snapshot de evolução — 1 ponto no gráfico por sync (atualiza se mesmo dia)
    const snapshot = buildSnapshot(posts, accountInfo);
    db.appendInstagramHistory(snapshot);

    // Demografia do público — best-effort, não derruba o sync se falhar
    try {
      const audience = await getAudienceDemographics(token.accessToken, token.igUserId);
      if (audience) db.setInstagramAudience(audience);
    } catch (e) {
      console.warn('[Instagram/Sync] demografia indisponível:', e.message);
    }

    res.json({ ok: true, count: posts.length, snapshot });
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

// ─── Demografia do público ──────────────────────────────────────────────────

router.get('/audience', (req, res) => {
  res.json(db.getInstagramAudience() || null);
});

// ─── Histórico de métricas (gráfico de evolução) ─────────────────────────────

router.get('/history', (req, res) => {
  res.json(db.getInstagramHistory());
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
