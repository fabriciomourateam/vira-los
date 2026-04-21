/**
 * discoveryService.js
 * Coleta dados reais de engajamento — 100% gratuito por padrão.
 *
 * Fontes gratuitas:
 *   • Reddit        → API pública JSON (sem auth)
 *   • Google Trends → endpoint público direto (sem key)
 *   • TikTok CC     → Creative Center trending hashtags (sem auth)
 *
 * Apify (opcional — só ativa se APIFY_API_KEY estiver configurado):
 *   • Instagram Hashtag Scraper
 *   • TikTok Scraper (mais dados que o CC)
 */

const axios = require('axios');

const APIFY_BASE = 'https://api.apify.com/v2';
const hasApify   = () => !!process.env.APIFY_API_KEY;

// ─── Helper Apify (só usado se key disponível) ────────────────────────────────

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

// ─── 2. TikTok Creative Center (gratuito, sem auth) ───────────────────────────
//    Fallback: Apify se key disponível e CC falhar

async function scrapeTikTok(hashtags = []) {
  const results = [];

  // 2a. TikTok Creative Center — trending hashtags (gratuito)
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

  // 2b. Fallback para Apify se key disponível e CC retornou pouco
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

// ─── 3. Google Trends — endpoint público gratuito ─────────────────────────────

async function scrapeGoogleTrends(keywords = []) {
  const rising = new Set();

  // 3a. Daily trending searches no Brasil (gratuito, sem key)
  try {
    const res = await axios.get('https://trends.google.com/trends/api/dailytrends', {
      params: { hl: 'pt-BR', tz: 180, geo: 'BR', ns: 15 },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
      },
      timeout: 15000,
    });
    // O response começa com ")]}'\n" — precisa remover antes de parsear
    const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const jsonText = raw.replace(/^\)\]\}'\n?/, '');
    const data = JSON.parse(jsonText);
    const days = data?.default?.trendingSearchesDays || [];
    for (const day of days.slice(0, 2)) {
      for (const search of (day.trendingSearches || []).slice(0, 15)) {
        if (search.title?.query) rising.add(search.title.query);
        // Também pega as notícias relacionadas como contexto
        for (const article of (search.articles || []).slice(0, 2)) {
          if (article.title) rising.add(article.title);
        }
      }
    }
  } catch (err) {
    console.warn('[Discovery] Google Trends daily:', err.message);
  }

  // 3b. Apify para related queries (se key disponível)
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

// ─── 4. Reddit — API pública gratuita (sem auth) ──────────────────────────────

async function scrapeReddit(subreddits = []) {
  const results = [];
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
  };
  for (const sub of subreddits.slice(0, 5)) {
    try {
      const res = await axios.get(`https://www.reddit.com/r/${sub}/top/.json`, {
        params: { t: 'week', limit: 50 },
        headers,
        timeout: 15000,
      });
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
    // Pequeno delay para não rate-limitar
    await new Promise(r => setTimeout(r, 1500));
  }
  return results.sort((a, b) => b.engagement - a.engagement).slice(0, 50);
}

module.exports = { scrapeInstagram, scrapeTikTok, scrapeGoogleTrends, scrapeReddit, hasApify };
