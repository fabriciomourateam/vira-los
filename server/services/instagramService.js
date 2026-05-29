/**
 * instagramService.js
 * Instagram API com Instagram Login (graph.instagram.com) — OAuth + data sync.
 *
 * Conecta DIRETO com a conta Profissional/Criador do Instagram, SEM precisar de
 * Página do Facebook. É o fluxo recomendado pelo Meta pra criador solo.
 *
 * Env vars (do produto "Instagram" no app do Meta → "API setup with Instagram login"):
 *   INSTAGRAM_APP_ID        ("Instagram app ID" — diferente do Facebook App ID)
 *   INSTAGRAM_APP_SECRET    ("Instagram app secret")
 *   INSTAGRAM_REDIRECT_URI  (default: SERVER_URL/api/instagram/callback)
 */

const axios = require('axios');

const IG_GRAPH = 'https://graph.instagram.com';
const IG_OAUTH = 'https://www.instagram.com/oauth/authorize';
const IG_TOKEN = 'https://api.instagram.com/oauth/access_token';

function getAppCredentials() {
  const appId       = process.env.INSTAGRAM_APP_ID;
  const appSecret   = process.env.INSTAGRAM_APP_SECRET;
  const serverUrl   = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3001}`;
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI || `${serverUrl}/api/instagram/callback`;
  return { appId, appSecret, redirectUri };
}

// ─── OAuth URL ────────────────────────────────────────────────────────────────

function getConnectUrl() {
  const { appId, redirectUri } = getAppCredentials();
  if (!appId) {
    throw new Error('INSTAGRAM_APP_ID não configurado no servidor (produto "Instagram" do app no Meta).');
  }
  const scope = ['instagram_business_basic', 'instagram_business_manage_insights'].join(',');
  return (
    `${IG_OAUTH}` +
    `?client_id=${appId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}`
  );
}

// ─── Token Exchange ───────────────────────────────────────────────────────────

async function exchangeCodeForToken(code) {
  const { appId, appSecret, redirectUri } = getAppCredentials();
  if (!appId || !appSecret) {
    throw new Error('INSTAGRAM_APP_ID ou INSTAGRAM_APP_SECRET não configurados no servidor.');
  }

  // Step 1 — short-lived token (POST form-encoded para api.instagram.com)
  const form = new URLSearchParams();
  form.append('client_id', appId);
  form.append('client_secret', appSecret);
  form.append('grant_type', 'authorization_code');
  form.append('redirect_uri', redirectUri);
  form.append('code', code);

  const r1 = await axios.post(IG_TOKEN, form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000,
  });
  const shortToken = r1.data.access_token;
  const userId     = r1.data.user_id;
  if (!shortToken) throw new Error('Instagram não retornou access_token.');

  // Step 2 — troca por long-lived (60 dias)
  let longToken = shortToken;
  try {
    const r2 = await axios.get(`${IG_GRAPH}/access_token`, {
      params: { grant_type: 'ig_exchange_token', client_secret: appSecret, access_token: shortToken },
      timeout: 10000,
    });
    if (r2.data.access_token) longToken = r2.data.access_token;
  } catch (err) {
    console.warn('[Instagram] troca long-lived falhou, usando short-lived:', err.message);
  }

  return { accessToken: longToken, userId };
}

// ─── User Info ────────────────────────────────────────────────────────────────

async function getIGUserInfo(token) {
  const r = await axios.get(`${IG_GRAPH}/me`, {
    params: {
      fields: 'user_id,username,name,account_type,media_count,followers_count,profile_picture_url',
      access_token: token,
    },
    timeout: 10000,
  });
  return r.data; // { user_id, username, name, account_type, media_count, followers_count, profile_picture_url }
}

// ─── Post Insights ────────────────────────────────────────────────────────────

async function getPostInsights(mediaId, mediaType, token) {
  // Instagram Login (2024+): views substitui impressions; métricas iguais p/ todos os tipos
  const metric = 'reach,saved,shares,views,total_interactions';
  const result = {};
  try {
    const r = await axios.get(`${IG_GRAPH}/${mediaId}/insights`, {
      params: { metric, access_token: token },
      timeout: 8000,
    });
    (r.data.data || []).forEach((item) => {
      result[item.name] = item.values?.[0]?.value ?? item.total_value?.value ?? 0;
    });
  } catch {
    // insights indisponíveis para este post (normal em posts muito antigos)
  }
  if (result.views != null && result.plays == null) result.plays = result.views; // compat
  return result;
}

// ─── Sync de posts (paginado — pega reels E carrosséis) ──────────────────────

async function syncPosts(token) {
  const MAX_POSTS = 90;   // teto — equilíbrio entre cobertura de carrosséis e tempo
  const MAX_PAGES = 4;
  const CONCURRENCY = 8;  // insights em paralelo (sequencial estourava o timeout do Fly)

  // Fase 1 — coleta a lista de mídias (rápido, só metadados)
  const rawPosts = [];
  let url = `${IG_GRAPH}/me/media`;
  let params = {
    fields: 'id,media_type,media_url,thumbnail_url,permalink,timestamp,caption,like_count,comments_count',
    limit: 50,
    access_token: token,
  };
  for (let page = 0; page < MAX_PAGES && rawPosts.length < MAX_POSTS; page++) {
    const r = await axios.get(url, params ? { params, timeout: 15000 } : { timeout: 15000 });
    rawPosts.push(...(r.data.data || []));
    const next = r.data.paging?.next;
    if (!next) break;
    url = next;       // "next" já carrega cursor + access_token + fields
    params = null;
  }
  const slice = rawPosts.slice(0, MAX_POSTS);

  // Fase 2 — busca insights em PARALELO (lotes de CONCURRENCY)
  const insightsById = {};
  for (let i = 0; i < slice.length; i += CONCURRENCY) {
    const batch = slice.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((p) => getPostInsights(p.id, p.media_type, token).catch(() => ({})))
    );
    batch.forEach((p, j) => { insightsById[p.id] = results[j] || {}; });
  }

  // Fase 3 — monta o shape final
  return slice.map((post) => {
    const insights = insightsById[post.id] || {};
    const rawReach = insights.reach || 0;
    const likes    = post.like_count    || 0;
    const comments = post.comments_count || 0;
    const saves    = insights.saved     || 0;
    const shares   = insights.shares    || 0;
    const views    = insights.views     || insights.plays || 0;
    const follows  = insights.follows   || 0;

    const reach = rawReach > 0 ? rawReach : Math.max(views, likes * 10, 1);

    // Weighted engagement: saves×4 + shares×3 + comments×2 + likes×1
    const rawEng         = likes + comments * 2 + saves * 4 + shares * 3;
    const engagementRate = (rawEng / reach) * 100;
    const saveRate       = (saves / reach) * 100;
    const shareRate      = (shares / reach) * 100;
    const commentRate    = (comments / reach) * 100;
    const reelCandidateScore = saveRate * 0.4 + shareRate * 0.3 + commentRate * 0.3;

    let mediaType = post.media_type;
    if (mediaType === 'VIDEO') mediaType = 'REELS';

    return {
      id: post.id,
      mediaType,
      thumbnailUrl: post.thumbnail_url || post.media_url || '',
      permalink:    post.permalink,
      timestamp:    post.timestamp,
      caption:      post.caption || '',
      likes, comments, saves, shares, views, reach, follows,
      engagementRate:    Math.round(engagementRate    * 100) / 100,
      saveRate:          Math.round(saveRate           * 100) / 100,
      reelCandidateScore:Math.round(reelCandidateScore * 100) / 100,
    };
  });
}

// ─── Demografia do público (Instagram Login) ─────────────────────────────────
// follower_demographics: idade / gênero / país dos seguidores. Requer ~100+
// seguidores. Best-effort — se a métrica não estiver liberada, retorna null.

async function getAudienceDemographics(token, igUserId) {
  const breakdowns = ['age', 'gender', 'country'];
  const out = {};

  for (const bd of breakdowns) {
    try {
      const r = await axios.get(`${IG_GRAPH}/${igUserId}/insights`, {
        params: {
          metric: 'follower_demographics',
          period: 'lifetime',
          metric_type: 'total_value',
          breakdown: bd,
          access_token: token,
        },
        timeout: 10000,
      });
      const results = r.data.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
      const map = {};
      for (const item of results) {
        const key = (item.dimension_values || [])[0];
        if (key != null) map[key] = item.value;
      }
      if (Object.keys(map).length) out[bd] = map;
    } catch (err) {
      console.warn(`[Instagram/Audience] ${bd} indisponível:`, err.response?.data?.error?.message || err.message);
    }
  }

  return Object.keys(out).length ? out : null;
}

module.exports = {
  getConnectUrl,
  exchangeCodeForToken,
  getIGUserInfo,
  syncPosts,
  getAudienceDemographics,
};
