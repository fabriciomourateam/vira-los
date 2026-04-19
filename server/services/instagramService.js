/**
 * instagramService.js
 * Instagram Graph API — OAuth + data sync
 *
 * Env vars needed:
 *   FACEBOOK_APP_ID
 *   FACEBOOK_APP_SECRET
 *   INSTAGRAM_REDIRECT_URI  (default: SERVER_URL/api/instagram/callback)
 */

const axios = require('axios');

const FB_API = 'https://graph.facebook.com/v22.0';

function getAppCredentials() {
  const appId       = process.env.FACEBOOK_APP_ID;
  const appSecret   = process.env.FACEBOOK_APP_SECRET;
  const serverUrl   = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3001}`;
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI || `${serverUrl}/api/instagram/callback`;
  return { appId, appSecret, redirectUri };
}

// ─── OAuth URL ────────────────────────────────────────────────────────────────

function getConnectUrl() {
  const { appId, redirectUri } = getAppCredentials();
  if (!appId) throw new Error('FACEBOOK_APP_ID não configurado no servidor');
  const scope = [
    'instagram_basic',
    'instagram_manage_insights',
    'pages_show_list',
    'pages_read_engagement',
  ].join(',');
  return (
    `https://www.facebook.com/v19.0/dialog/oauth` +
    `?client_id=${appId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scope}` +
    `&response_type=code`
  );
}

// ─── Token Exchange ───────────────────────────────────────────────────────────

async function exchangeCodeForToken(code) {
  const { appId, appSecret, redirectUri } = getAppCredentials();
  if (!appId || !appSecret) throw new Error('FACEBOOK_APP_ID ou FACEBOOK_APP_SECRET não configurados');

  // Step 1 — short-lived token
  const r1 = await axios.get(`${FB_API}/oauth/access_token`, {
    params: { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code },
    timeout: 10000,
  });
  const shortToken = r1.data.access_token;

  // Step 2 — exchange for 60-day long-lived token
  let longToken = shortToken;
  try {
    const r2 = await axios.get(`${FB_API}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortToken,
      },
      timeout: 10000,
    });
    longToken = r2.data.access_token;
  } catch (err) {
    console.warn('[Instagram/Token] Long-lived exchange falhou, usando short-lived:', err.message);
  }

  return { shortToken, longToken };
}

// ─── Account Discovery ────────────────────────────────────────────────────────

/**
 * Returns { igUserId, pageToken } for the first page with an IG business account.
 */
async function getIGBusinessAccount(longLivedToken) {
  // Método 1: /me/accounts (padrão)
  try {
    const r = await axios.get(`${FB_API}/me/accounts`, {
      params: {
        access_token: longLivedToken,
        fields: 'id,name,access_token,instagram_business_account',
      },
      timeout: 10000,
    });

    const pages = r.data.data || [];
    console.log(`[Instagram/Discovery] /me/accounts: ${pages.length} páginas`);

    for (const page of pages) {
      if (page.instagram_business_account?.id) {
        return {
          igUserId: page.instagram_business_account.id,
          pageToken: page.access_token,
        };
      }
    }
  } catch (err) {
    console.warn('[Instagram/Discovery] /me/accounts falhou:', err.message);
  }

  // Método 2: consulta direta pela Page ID conhecida (workaround para Login for Business)
  // Tenta buscar todas as páginas que o usuário pode gerenciar
  const knownPageIds = (process.env.FACEBOOK_PAGE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

  // Também tenta descobrir páginas via /me?fields=accounts
  try {
    const meRes = await axios.get(`${FB_API}/me`, {
      params: { fields: 'accounts{id}', access_token: longLivedToken },
      timeout: 8000,
    });
    const mePages = meRes.data.accounts?.data || [];
    for (const p of mePages) {
      if (p.id && !knownPageIds.includes(p.id)) knownPageIds.push(p.id);
    }
  } catch {}

  for (const pageId of knownPageIds) {
    try {
      const pr = await axios.get(`${FB_API}/${pageId}`, {
        params: { fields: 'id,name,instagram_business_account', access_token: longLivedToken },
        timeout: 8000,
      });
      if (pr.data.instagram_business_account?.id) {
        console.log(`[Instagram/Discovery] IG Business encontrado via página direta ${pageId}: ${pr.data.instagram_business_account.id}`);
        return {
          igUserId: pr.data.instagram_business_account.id,
          pageToken: longLivedToken,
        };
      }
    } catch (err) {
      console.warn(`[Instagram/Discovery] Página ${pageId} falhou:`, err.message);
    }
  }

  throw new Error(
    'Nenhuma conta Instagram Business vinculada encontrada. Configure FACEBOOK_PAGE_IDS no servidor com o ID da sua página.'
  );
}

// ─── User Info ────────────────────────────────────────────────────────────────

async function getIGUserInfo(igUserId, token) {
  const r = await axios.get(`${FB_API}/${igUserId}`, {
    params: {
      fields: 'name,username,profile_picture_url,followers_count',
      access_token: token,
    },
    timeout: 10000,
  });
  return r.data;
}

// ─── Post Insights ────────────────────────────────────────────────────────────

async function getPostInsights(mediaId, mediaType, token) {
  const isReel = mediaType === 'REELS' || mediaType === 'VIDEO';
  // Reels use "plays"; static/carousel use "impressions"
  const metric = isReel
    ? 'plays,reach,saved,shares'
    : 'impressions,reach,saved,shares';
  try {
    const r = await axios.get(`${FB_API}/${mediaId}/insights`, {
      params: { metric, access_token: token },
      timeout: 8000,
    });
    const result = {};
    (r.data.data || []).forEach((item) => {
      result[item.name] = item.values?.[0]?.value ?? item.value ?? 0;
    });
    return result;
  } catch {
    // Some post types don't support all metrics — return empty object gracefully
    return {};
  }
}

// ─── Resolve IG Business Account ID from token ──────────────────────────────
// Quando o user_id salvo é inválido (ex: ID do Facebook, não do IG Business),
// tenta descobrir o ID correto via /me/accounts → instagram_business_account

async function resolveIGUserId(token, providedId) {
  // Primeiro tenta usar o ID fornecido
  if (providedId) {
    try {
      await axios.get(`${FB_API}/${providedId}`, {
        params: { fields: 'id,username', access_token: token },
        timeout: 8000,
      });
      return providedId; // ID válido
    } catch {
      // ID inválido — tenta resolver via Pages
    }
  }

  // Busca Pages e encontra o IG Business Account
  try {
    const r = await axios.get(`${FB_API}/me/accounts`, {
      params: { fields: 'id,name,instagram_business_account', access_token: token },
      timeout: 10000,
    });
    const pages = r.data.data || [];
    for (const page of pages) {
      if (page.instagram_business_account?.id) {
        return page.instagram_business_account.id;
      }
    }
  } catch {
    // Token sem permissão de pages — tenta via /me
  }

  // Última tentativa: /me com o token pode retornar o IG user
  try {
    const r = await axios.get(`${FB_API}/me`, {
      params: { fields: 'id', access_token: token },
      timeout: 8000,
    });
    return r.data.id;
  } catch {
    // Nada funcionou
  }

  return providedId; // retorna o que tem
}

// ─── Sync Posts ───────────────────────────────────────────────────────────────

async function syncPosts(token, igUserId) {
  // Resolve o ID correto (pode ser diferente do salvo no Agendador)
  const resolvedId = await resolveIGUserId(token, igUserId);

  // Fetch up to 50 most recent posts
  const r = await axios.get(`${FB_API}/${resolvedId}/media`, {
    params: {
      fields: 'id,media_type,thumbnail_url,media_url,permalink,timestamp,caption,like_count,comments_count',
      limit: 50,
      access_token: token,
    },
    timeout: 15000,
  });
  const rawPosts = r.data.data || [];

  const posts = [];
  for (const post of rawPosts) {
    const insights = await getPostInsights(post.id, post.media_type, token);

    const reach    = Math.max(insights.reach || 0, 1);
    const likes    = post.like_count    || 0;
    const comments = post.comments_count || 0;
    const saves    = insights.saved     || 0;
    const shares   = insights.shares    || 0;
    const views    = insights.plays     || insights.impressions || 0;

    // Weighted engagement: likes + comments×2 + saves×3 + shares×2
    const rawEng         = likes + comments * 2 + saves * 3 + shares * 2;
    const engagementRate = (rawEng / reach) * 100;
    const saveRate       = (saves / reach) * 100;
    // High save rate + comments = strong reel candidate
    const reelCandidateScore = saveRate * 0.5 + ((comments / reach) * 100 * 0.5);

    // Normalise media type — the API returns "VIDEO" for both regular videos and Reels
    let mediaType = post.media_type;
    if (mediaType === 'VIDEO') mediaType = 'REELS';

    posts.push({
      id: post.id,
      mediaType,
      thumbnailUrl: post.thumbnail_url || post.media_url || '',
      permalink:    post.permalink,
      timestamp:    post.timestamp,
      caption:      post.caption || '',
      likes,
      comments,
      saves,
      shares,
      views,
      reach,
      engagementRate:    Math.round(engagementRate    * 100) / 100,
      saveRate:          Math.round(saveRate           * 100) / 100,
      reelCandidateScore:Math.round(reelCandidateScore * 100) / 100,
    });
  }

  return posts;
}

module.exports = {
  getConnectUrl,
  exchangeCodeForToken,
  getIGBusinessAccount,
  getIGUserInfo,
  syncPosts,
};
