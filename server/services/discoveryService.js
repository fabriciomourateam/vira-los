/**
 * discoveryService.js
 * Raspa dados reais de engajamento de Instagram, TikTok, Google Trends e Reddit.
 * Cada plataforma corre em paralelo — falhas individuais são toleradas.
 */

const axios = require('axios');

const APIFY_BASE = 'https://api.apify.com/v2';
const hasApify = () => !!process.env.APIFY_API_KEY;

// ─── Helper: chama um ator Apify no modo sync (espera até ~90s) ───────────────

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
    const status = err.response?.status;
    const msg = err.response?.data?.error?.message || err.message;
    console.warn(`[Discovery] ${actorSlug} failed (${status}): ${msg}`);
    return [];
  }
}

// ─── Instagram: top posts por hashtag ────────────────────────────────────────

async function scrapeInstagram(hashtags = [], limit = 15) {
  if (!hasApify()) return [];
  const items = await runApifySync('apify/instagram-hashtag-scraper', {
    hashtags: hashtags.slice(0, 5),
    resultsLimit: limit,
    resultsType: 'posts',
  });
  return items
    .map(item => ({
      platform: 'instagram',
      title: (item.caption || '').replace(/\n/g, ' ').substring(0, 200),
      engagement: (item.likesCount || 0) + (item.commentsCount || 0) * 3,
      likes: item.likesCount || 0,
      comments: item.commentsCount || 0,
      isVideo: item.type === 'Video' || !!item.videoUrl,
      hashtags: (item.hashtags || []).slice(0, 8),
      url: item.url || '',
    }))
    .filter(i => i.engagement > 10 && i.title.length > 10)
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 20);
}

// ─── TikTok: vídeos por hashtag ───────────────────────────────────────────────

async function scrapeTikTok(hashtags = [], limit = 15) {
  if (!hasApify()) return [];
  const items = await runApifySync('clockworks/tiktok-scraper', {
    hashtags: hashtags.slice(0, 5),
    resultsPerPage: limit,
    maxProfilesPerQuery: 1,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadSubtitles: false,
    shouldDownloadSlideshowImages: false,
  });
  return items
    .map(item => ({
      platform: 'tiktok',
      title: (item.text || item.desc || '').replace(/\n/g, ' ').substring(0, 200),
      engagement:
        (item.diggCount || item.stats?.diggCount || 0) +
        (item.commentCount || item.stats?.commentCount || 0) * 3 +
        (item.shareCount || item.stats?.shareCount || 0) * 5,
      likes: item.diggCount || item.stats?.diggCount || 0,
      comments: item.commentCount || item.stats?.commentCount || 0,
      shares: item.shareCount || item.stats?.shareCount || 0,
      hashtags: (item.hashtags || []).map(h => (typeof h === 'string' ? h : h.name)).slice(0, 8),
      url: item.webVideoUrl || item.url || '',
    }))
    .filter(i => i.engagement > 10 && i.title.length > 5)
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 20);
}

// ─── Google Trends: queries relacionadas em alta (Brasil) ─────────────────────

async function scrapeGoogleTrends(keywords = []) {
  if (!hasApify()) return [];
  const items = await runApifySync('apify/google-trends-scraper', {
    searchTerms: keywords.slice(0, 4),
    geo: 'BR',
    timeRange: 'now 7-d',
    outputAsJson: true,
  });
  const rising = new Set();
  for (const item of items) {
    for (const q of item.relatedQueries?.rising || [])  rising.add(q.query);
    for (const q of (item.relatedQueries?.top || []).slice(0, 5)) rising.add(q.query);
  }
  return [...rising].slice(0, 20);
}

// ─── Reddit: posts top da semana (API pública gratuita) ───────────────────────

async function scrapeReddit(subreddits = []) {
  const results = [];
  for (const sub of subreddits.slice(0, 5)) {
    try {
      const res = await axios.get(`https://www.reddit.com/r/${sub}/top/.json`, {
        params: { t: 'week', limit: 20 },
        headers: { 'User-Agent': 'ViralOS/1.0 content-research' },
        timeout: 12000,
      });
      const posts = res.data?.data?.children || [];
      for (const { data: p } of posts) {
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
  }
  return results.sort((a, b) => b.engagement - a.engagement).slice(0, 25);
}

module.exports = { scrapeInstagram, scrapeTikTok, scrapeGoogleTrends, scrapeReddit, hasApify };
