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
  const r2 = await axios.get(`${FB_API}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortToken,
    },
    timeout: 10000,
  });
  return r2.data.access_token;
}

// ─── Account Discovery ────────────────────────────────────────────────────────

/**
 * Returns { igUserId, pageToken } for the first page with an IG business account.
 */
async function getIGBusinessAccount(longLivedToken) {
  const r = await axios.get(`${FB_API}/me/accounts`, {
    params: {
      access_token: longLivedToken,
      fields: 'id,name,access_token,instagram_business_account',
    },
    timeout: 10000,
  });

  const pages = r.data.data || [];
  for (const page of pages) {
    if (page.instagram_business_account?.id) {
      return {
        igUserId: page.instagram_business_account.id,
        pageToken: page.access_token,
      };
    }
  }
  throw new Error(
    'Nenhuma conta Instagram Business/Creator encontrada. Certifique-se de que sua conta está conectada a uma Página do Facebook.'
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

// ─── Sync Posts ───────────────────────────────────────────────────────────────

async function syncPosts(token, igUserId) {
  // Fetch up to 50 most recent posts
  const r = await axios.get(`${FB_API}/${igUserId}/media`, {
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
