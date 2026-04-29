/**
 * discoveryService.js
 * Coleta dados reais de engajamento.
 *
 * Fontes que funcionam de qualquer servidor (IP de cloud):
 *   • Reddit       → OAuth2 (REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET) — grátis
 *   • YouTube      → Data API v3 (YOUTUBE_API_KEY) — 10k unidades/dia grátis
 *   • TikTok CC    → Creative Center (sem auth, pode bloquear por IP)
 *   • Google Trends → público, pode bloquear por IP
 *
 * Apify (opcional — só ativa se APIFY_API_KEY estiver configurado):
 *   • Instagram Hashtag Scraper
 *   • Google Trends Scraper
 *
 * SETUP das APIs autenticadas:
 *   Reddit OAuth:
 *     1. Acesse https://www.reddit.com/prefs/apps
 *     2. Crie um app tipo "script"
 *     3. Anote Client ID (abaixo do nome) e Client Secret
 *     4. Adicione ao .env: REDDIT_CLIENT_ID=... REDDIT_CLIENT_SECRET=...
 *
 *   YouTube Data API:
 *     1. Acesse https://console.cloud.google.com
 *     2. Crie projeto → Ative "YouTube Data API v3" → Crie API Key
 *     3. Adicione ao .env: YOUTUBE_API_KEY=...
 */

const axios = require('axios');

const APIFY_BASE = 'https://api.apify.com/v2';
const hasApify   = () => !!process.env.APIFY_API_KEY;
const hasRedditOAuth = () => !!process.env.REDDIT_CLIENT_ID && !!process.env.REDDIT_CLIENT_SECRET;
const hasYoutube     = () => !!process.env.YOUTUBE_API_KEY;

// ─── Helper Apify ─────────────────────────────────────────────────────────────

async function runApifySync(actorSlug, input, timeoutSecs = 90) {
  if (!hasApify()) return [];
  const actorId = actorSlug.replace('/', '~');
  try {
    const res = await axios.post(
      `${APIFY_BASE}/acts/${actorId}/run-sync-get-dataset-items`,
      input,
      {
        params: { token: process.env.APIFY_API_KEY, timeout: timeoutSecs, memory: 256 },
        timeout: (timeoutSecs + 30) * 1000,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    console.warn(`[Discovery] Apify ${actorSlug} (${err.response?.status}): ${err.message}`);
    return [];
  }
}

// ─── 1. Instagram via Apify (opcional) ────────────────────────────────────────

async function scrapeInstagram(hashtags = []) {
  if (!hasApify()) return [];
  const items = await runApifySync('apify/instagram-hashtag-scraper', {
    hashtags: hashtags.slice(0, 5),
    resultsLimit: 40,
    resultsType: 'posts',
  });
  return items
    .map(item => ({
      platform: 'instagram',
      title: (item.caption || '').replace(/\n/g, ' ').substring(0, 200),
      engagement: (item.likesCount || 0) + (item.commentsCount || 0) * 3,
      likes: item.likesCount || 0,
      comments: item.commentsCount || 0,
      hashtags: (item.hashtags || []).slice(0, 8),
    }))
    .filter(i => i.engagement > 10 && i.title.length > 10)
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 20);
}

// ─── 2. TikTok Creative Center + Apify fallback ───────────────────────────────

async function scrapeTikTok(hashtags = []) {
  const results = [];

  try {
    const res = await axios.get(
      'https://ads.tiktok.com/business/creativecenter/api/v1/trending/hashtags/list',
      {
        params: { period: 7, region: 'BR', count: 30, cursor: 0, lang: 'pt' },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://ads.tiktok.com/business/creativecenter/inspiration/trending/hashtag/pc/pt',
        },
        timeout: 12000,
      }
    );
    const list = res.data?.data?.list || [];
    for (const tag of list.slice(0, 20)) {
      results.push({
        platform: 'tiktok_cc',
        title: `#${tag.hashtag_name} — ${(tag.video_views || 0).toLocaleString()} views (${tag.rank_diff > 0 ? '↑' : tag.rank_diff < 0 ? '↓' : '='} ${Math.abs(tag.rank_diff || 0)} posições)`,
        engagement: tag.video_views || tag.publish_cnt || 0,
        hashtag: tag.hashtag_name,
        videoCount: tag.publish_cnt || 0,
        views: tag.video_views || 0,
      });
    }
  } catch (err) {
    console.warn('[Discovery] TikTok Creative Center:', err.message);
  }

  if (results.length < 5 && hasApify()) {
    const items = await runApifySync('clockworks/tiktok-scraper', {
      hashtags: hashtags.slice(0, 4),
      resultsPerPage: 12,
      maxProfilesPerQuery: 1,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
    });
    items.forEach(item => {
      results.push({
        platform: 'tiktok',
        title: (item.text || item.desc || '').replace(/\n/g, ' ').substring(0, 200),
        engagement: (item.diggCount || 0) + (item.commentCount || 0) * 3 + (item.shareCount || 0) * 5,
        likes: item.diggCount || 0,
        comments: item.commentCount || 0,
        shares: item.shareCount || 0,
      });
    });
  }

  return results.sort((a, b) => b.engagement - a.engagement).slice(0, 50);
}

// ─── 3. Google Trends (público — pode bloquear IP de servidor) ────────────────

async function scrapeGoogleTrends(keywords = []) {
  const rising = new Set();

  try {
    const res = await axios.get('https://trends.google.com/trends/api/dailytrends', {
      params: { hl: 'pt-BR', tz: 180, geo: 'BR', ns: 15 },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
      },
      timeout: 15000,
    });
    const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const jsonText = raw.replace(/^\)\]\}'\n?/, '');
    const data = JSON.parse(jsonText);
    const days = data?.default?.trendingSearchesDays || [];
    for (const day of days.slice(0, 2)) {
      for (const search of (day.trendingSearches || []).slice(0, 15)) {
        if (search.title?.query) rising.add(search.title.query);
        for (const article of (search.articles || []).slice(0, 2)) {
          if (article.title) rising.add(article.title);
        }
      }
    }
  } catch (err) {
    console.warn('[Discovery] Google Trends:', err.message);
  }

  if (rising.size < 5 && hasApify() && keywords.length > 0) {
    try {
      const items = await runApifySync('apify/google-trends-scraper', {
        searchTerms: keywords.slice(0, 3),
        geo: 'BR',
        timeRange: 'now 7-d',
      }, 60);
      for (const item of items) {
        for (const q of item.relatedQueries?.rising || []) rising.add(q.query);
        for (const q of (item.relatedQueries?.top || []).slice(0, 5)) rising.add(q.query);
      }
    } catch {}
  }

  return [...rising].slice(0, 50);
}

// ─── 4. Reddit OAuth (funciona de qualquer IP) ────────────────────────────────
// Fallback: JSON público (bloqueia em IPs de cloud)

let redditTokenCache = null; // { token, expiresAt }

async function getRedditToken() {
  if (redditTokenCache && redditTokenCache.expiresAt > Date.now() + 60_000) {
    return redditTokenCache.token;
  }
  const res = await axios.post(
    'https://www.reddit.com/api/v1/access_token',
    'grant_type=client_credentials',
    {
      auth: {
        username: process.env.REDDIT_CLIENT_ID,
        password: process.env.REDDIT_CLIENT_SECRET,
      },
      headers: {
        'User-Agent': 'linux:vira-los:1.0 (by /u/fabriciomourateam)',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 10000,
    }
  );
  const token = res.data.access_token;
  const expiresIn = res.data.expires_in || 3600;
  redditTokenCache = { token, expiresAt: Date.now() + expiresIn * 1000 };
  return token;
}

async function scrapeReddit(subreddits = []) {
  const results = [];
  let useOAuth = false;
  let token = null;

  if (hasRedditOAuth()) {
    try {
      token = await getRedditToken();
      useOAuth = true;
      console.log('[Discovery] Reddit: usando OAuth');
    } catch (err) {
      console.warn('[Discovery] Reddit OAuth token falhou:', err.message);
    }
  }

  const SUBS = subreddits.length ? subreddits.slice(0, 6) : [
    'Fitness', 'bodybuilding', 'Testosterone', 'TRT', 'nutrition', 'GettingBigger',
  ];

  for (const sub of SUBS) {
    try {
      let res;
      if (useOAuth && token) {
        // OAuth endpoint — funciona de qualquer IP
        res = await axios.get(`https://oauth.reddit.com/r/${sub}/top`, {
          params: { t: 'week', limit: 50 },
          headers: {
            Authorization: `Bearer ${token}`,
            'User-Agent': 'linux:vira-los:1.0 (by /u/fabriciomourateam)',
          },
          timeout: 15000,
        });
      } else {
        // Fallback público (pode bloquear em cloud)
        res = await axios.get(`https://www.reddit.com/r/${sub}/top/.json`, {
          params: { t: 'week', limit: 50 },
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
          },
          timeout: 15000,
        });
      }
      for (const { data: p } of (res.data?.data?.children || [])) {
        if (p.score > 30 && !p.over_18) {
          results.push({
            platform: 'reddit',
            subreddit: p.subreddit,
            title: p.title,
            engagement: p.score + p.num_comments * 4,
            score: p.score,
            comments: p.num_comments,
            url: `https://reddit.com${p.permalink}`,
          });
        }
      }
    } catch (err) {
      console.warn(`[Discovery] Reddit r/${sub}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 800));
  }

  return results.sort((a, b) => b.engagement - a.engagement).slice(0, 50);
}

// ─── 5. YouTube Data API v3 (funciona de qualquer IP) ────────────────────────

async function scrapeYoutube(keywords = [], niche = '') {
  if (!hasYoutube()) return [];

  const key = process.env.YOUTUBE_API_KEY;
  const searchTerms = keywords.length
    ? keywords.slice(0, 3)
    : [niche || 'fitness nutrição', 'testosterona shape', 'dieta treino'];

  const allVideoIds = [];
  const results = [];

  // Busca vídeos por keyword (custa ~100 unidades por search)
  for (const q of searchTerms) {
    try {
      const searchRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
        params: {
          key,
          part: 'snippet',
          q,
          type: 'video',
          regionCode: 'BR',
          relevanceLanguage: 'pt',
          videoDuration: 'short',      // short = < 4min (Reels/Shorts friendly)
          order: 'viewCount',
          maxResults: 10,
          publishedAfter: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
        timeout: 15000,
      });
      const items = searchRes.data?.items || [];
      allVideoIds.push(...items.map(i => i.id.videoId).filter(Boolean));
      // Aproveita snippets como contexto
      for (const item of items) {
        const title = item.snippet?.title;
        const channel = item.snippet?.channelTitle;
        if (title) {
          results.push({
            platform: 'youtube',
            title: title.substring(0, 200),
            channel: channel || '',
            engagement: 0,
            likes: 0,
            views: 0,
            keyword: q,
          });
        }
      }
    } catch (err) {
      console.warn(`[Discovery] YouTube search "${q}": ${err.message}`);
    }
  }

  // Busca estatísticas dos vídeos em batch (custa ~1 unidade por vídeo)
  if (allVideoIds.length > 0) {
    try {
      const statsRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: {
          key,
          part: 'statistics',
          id: allVideoIds.slice(0, 30).join(','),
        },
        timeout: 15000,
      });
      const statsMap = {};
      for (const item of statsRes.data?.items || []) {
        statsMap[item.id] = {
          views: parseInt(item.statistics?.viewCount || '0', 10),
          likes: parseInt(item.statistics?.likeCount || '0', 10),
          comments: parseInt(item.statistics?.commentCount || '0', 10),
        };
      }
      // Enriquece resultados com estatísticas reais
      let idx = 0;
      for (const item of results) {
        const videoId = allVideoIds[idx++];
        if (videoId && statsMap[videoId]) {
          const s = statsMap[videoId];
          item.views = s.views;
          item.likes = s.likes;
          item.comments = s.comments;
          item.engagement = s.likes + s.comments * 3;
        }
      }
    } catch (err) {
      console.warn('[Discovery] YouTube stats:', err.message);
    }
  }

  return results
    .filter(r => r.views > 1000 || r.likes > 50)
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 30);
}

module.exports = {
  scrapeInstagram,
  scrapeTikTok,
  scrapeGoogleTrends,
  scrapeReddit,
  scrapeYoutube,
  hasApify,
  hasRedditOAuth,
  hasYoutube,
};
