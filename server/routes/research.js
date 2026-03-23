const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const db = require('../db/database');

// ── Busca Viral (YouTube Data API) ────────────────────────────────────────────

router.get('/viral', async (req, res) => {
  const { q = '', count = 20, publishedAfter, regionCode = 'BR' } = req.query;
  if (!q.trim()) return res.json([]);

  try {
    const yt = require('../services/youtube');
    const auth = await yt.getAuthenticatedClient();
    const { google } = require('googleapis');
    const youtube = google.youtube({ version: 'v3', auth });

    const searchParams = {
      part: ['snippet'],
      q: q.trim(),
      type: ['video'],
      videoDuration: 'short',
      order: 'viewCount',
      maxResults: Number(count),
      regionCode,
    };
    if (publishedAfter) searchParams.publishedAfter = publishedAfter;

    const searchRes = await youtube.search.list(searchParams);

    const ids = searchRes.data.items.map((i) => i.id.videoId).filter(Boolean);
    if (!ids.length) return res.json([]);

    const statsRes = await youtube.videos.list({
      part: ['statistics'],
      id: ids,
    });

    const statsMap = {};
    statsRes.data.items.forEach((v) => { statsMap[v.id] = v.statistics; });

    const videos = searchRes.data.items.map((item) => {
      const stats = statsMap[item.id.videoId] || {};
      return {
        id: item.id.videoId,
        title: item.snippet.title,
        author: item.snippet.channelTitle,
        author_handle: item.snippet.channelTitle,
        views: parseInt(stats.viewCount || '0'),
        likes: parseInt(stats.likeCount || '0'),
        comments: parseInt(stats.commentCount || '0'),
        shares: 0,
        cover: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
        url: `https://www.youtube.com/shorts/${item.id.videoId}`,
        platform: 'youtube',
      };
    });

    res.set('Cache-Control', 'no-store');
    res.json(videos);
  } catch (e) {
    console.error('[Viral search] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/trending', async (req, res) => {
  const { regionCode = 'BR' } = req.query;
  try {
    const yt = require('../services/youtube');
    const auth = await yt.getAuthenticatedClient();
    const { google } = require('googleapis');
    const youtube = google.youtube({ version: 'v3', auth });

    const trendRes = await youtube.videos.list({
      part: ['snippet', 'statistics'],
      chart: 'mostPopular',
      regionCode,
      videoCategoryId: '22',
      maxResults: 20,
    });

    const videos = trendRes.data.items.map((v) => ({
      id: v.id,
      title: v.snippet.title,
      author: v.snippet.channelTitle,
      author_handle: v.snippet.channelTitle,
      views: parseInt(v.statistics?.viewCount || '0'),
      likes: parseInt(v.statistics?.likeCount || '0'),
      comments: parseInt(v.statistics?.commentCount || '0'),
      shares: 0,
      cover: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || '',
      url: `https://www.youtube.com/watch?v=${v.id}`,
      platform: 'youtube',
    }));

    res.set('Cache-Control', 'no-store');
    res.json(videos);
  } catch (e) {
    console.error('[Trending] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Busca Instagram por hashtag (Meta Graph API) ─────────────────────────────

router.get('/instagram-hashtag', async (req, res) => {
  const { q = '' } = req.query;
  const hashtag = q.trim().replace(/^#/, '').toLowerCase();
  if (!hashtag) return res.json([]);

  const igToken = db.getPlatformToken('instagram');
  if (!igToken) return res.status(503).json({ error: 'Instagram não conectado. Configure nas Plataformas.' });

  const { access_token, user_id } = igToken;

  try {
    // 1. Busca ID da hashtag
    const hashRes = await axios.get('https://graph.facebook.com/v21.0/ig_hashtag_search', {
      params: { user_id, q: hashtag, access_token },
      timeout: 15000,
    });
    const hashId = hashRes.data?.data?.[0]?.id;
    if (!hashId) return res.json([]);

    // 2. Busca top media da hashtag
    const mediaRes = await axios.get(`https://graph.facebook.com/v21.0/${hashId}/top_media`, {
      params: {
        user_id,
        fields: 'id,media_type,like_count,comments_count,thumbnail_url,media_url,permalink,caption',
        access_token,
      },
      timeout: 15000,
    });

    const items = mediaRes.data?.data || [];
    const videos = items.map((i) => ({
      id: i.id,
      title: i.caption ? i.caption.substring(0, 120) : '',
      author: '',
      author_handle: hashtag,
      views: 0,
      likes: i.like_count || 0,
      comments: i.comments_count || 0,
      shares: 0,
      cover: i.thumbnail_url || i.media_url || '',
      url: i.permalink,
      platform: 'instagram',
    }));

    res.set('Cache-Control', 'no-store');
    res.json(videos);
  } catch (e) {
    console.error('[Instagram hashtag] Error:', e.response?.data || e.message);
    const apiMsg = e.response?.data?.error?.message || e.message || '';
    const friendly = apiMsg.includes('instagram_basic')
      ? 'Token sem permissão instagram_basic. Vá em developers.facebook.com → Graph API Explorer, adicione a permissão instagram_basic e gere um novo token.'
      : apiMsg;
    res.status(500).json({ error: friendly });
  }
});

// ── Helper: parse "2.9M followers" → número ──────────────────────────────────
function parseSocialCtx(str) {
  if (!str) return 0;
  const m = String(str).match(/([\d.]+)\s*([KMB]?)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()] || 1;
  return Math.round(n * mult);
}

// ── Busca Reels por palavra-chave (instagram-scraper-stable-api) ─────────────

router.get('/instagram-search', async (req, res) => {
  const { q = '' } = req.query;
  const keyword = q.trim();
  if (!keyword) return res.json([]);

  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return res.status(503).json({ error: 'RAPIDAPI_KEY não configurada' });

  const IG_HOST = 'instagram-scraper-stable-api.p.rapidapi.com';

  try {
    // Passo 1: busca hashtags relacionadas à keyword
    const searchRes = await axios.post(
      `https://${IG_HOST}/search_ig.php`,
      new URLSearchParams({ search_query: keyword }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-rapidapi-key': apiKey, 'x-rapidapi-host': IG_HOST }, timeout: 15000 }
    );

    const hashtags = searchRes.data?.hashtags || [];
    if (!hashtags.length) return res.json([]);

    // Passo 2: busca mídia da hashtag com mais posts
    const topTag = hashtags[0]?.hashtag?.name || hashtags[0]?.name;
    if (!topTag) return res.json([]);

    const mediaRes = await axios.get(`https://${IG_HOST}/get_hashtag_media.php`, {
      params: { hashtag: topTag },
      headers: { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': IG_HOST },
      timeout: 15000,
    });

    const raw = mediaRes.data;
    const list = raw?.data?.edges?.map((e) => e.node) || raw?.edges?.map((e) => e.node) || (Array.isArray(raw?.data) ? raw.data : []);

    const videos = list
      .map((v) => ({
        id: String(v.shortcode || v.id || v.pk || ''),
        title: v.edge_media_to_caption?.edges?.[0]?.node?.text?.substring(0, 150) || v.caption || '',
        author: String(v.owner?.username || ''),
        author_handle: String(v.owner?.username || ''),
        views: Number(v.video_view_count || v.play_count || 0),
        likes: Number(v.edge_media_preview_like?.count || v.like_count || 0),
        comments: Number(v.edge_media_to_comment?.count || v.comment_count || 0),
        shares: 0,
        cover: String(v.display_url || v.thumbnail_src || ''),
        url: `https://www.instagram.com/reel/${v.shortcode || v.id}/`,
        platform: 'instagram',
      }))
      .filter((v) => v.id && v.author_handle);

    res.set('Cache-Control', 'no-store');
    res.json(videos);
  } catch (e) {
    console.error('[Instagram search] Error:', e.response?.data || e.message);
    res.json([]); // retorna vazio em vez de 500
  }
});

// ── Busca Criadores Instagram por palavra-chave (instagram-scraper-stable-api) ─

router.get('/instagram-creators', async (req, res) => {
  const { q = '' } = req.query;
  const keyword = q.trim();
  if (!keyword) return res.json([]);

  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return res.status(503).json({ error: 'RAPIDAPI_KEY não configurada' });

  const IG_HOST = 'instagram-scraper-stable-api.p.rapidapi.com';

  try {
    const response = await axios.post(
      `https://${IG_HOST}/search_ig.php`,
      new URLSearchParams({ search_query: keyword }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-rapidapi-key': apiKey, 'x-rapidapi-host': IG_HOST }, timeout: 15000 }
    );

    const list = response.data?.users || [];
    const creators = list
      .map((item) => {
        const u = item.user || item;
        return {
          username: String(u.username || ''),
          nickname: String(u.full_name || u.username || ''),
          followers: parseSocialCtx(u.search_social_context) || Number(u.follower_count || 0),
          avatar: String(u.profile_pic_url || ''),
          is_verified: Boolean(u.is_verified || false),
        };
      })
      .filter((u) => u.username)
      .sort((a, b) => b.followers - a.followers);

    res.set('Cache-Control', 'no-store');
    res.json(creators);
  } catch (e) {
    console.error('[Instagram creators] Error:', e.response?.data || e.message);
    res.json([]); // retorna vazio em vez de 500
  }
});

// ── Busca Viral Instagram (por @username via RapidAPI) ────────────────────────

router.get('/viral-instagram', async (req, res) => {
  const { q = '' } = req.query;
  const username = q.trim().replace(/^@/, '');
  if (!username) return res.json([]);

  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return res.status(503).json({ error: 'RAPIDAPI_KEY não configurada' });

  try {
    // 1. Busca o user_id pelo username
    const userRes = await axios.get('https://instagram-api-fast-reliable-data-scraper.p.rapidapi.com/user_id_by_username', {
      params: { username },
      headers: { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'instagram-api-fast-reliable-data-scraper.p.rapidapi.com' },
      timeout: 15000,
    });

    const userId = userRes.data?.UserID;
    if (!userId) return res.status(404).json({ error: 'Usuário não encontrado' });

    // 2. Busca os reels do usuário
    const reelsRes = await axios.get('https://instagram-api-fast-reliable-data-scraper.p.rapidapi.com/reels', {
      params: { user_id: userId, include_feed_video: true },
      headers: { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'instagram-api-fast-reliable-data-scraper.p.rapidapi.com' },
      timeout: 15000,
    });

    const items = reelsRes.data?.data?.items || [];
    const videos = items
      .filter((i) => i.media?.media_type === 2)
      .map((i) => {
        const m = i.media;
        const cover = m.image_versions2?.candidates?.[0]?.url || '';
        return {
          id: m.id,
          title: m.caption?.text ? m.caption.text.substring(0, 120) : '',
          author: username,
          author_handle: username,
          views: m.play_count || m.view_count || 0,
          likes: m.like_count || 0,
          comments: m.comment_count || 0,
          shares: 0,
          cover,
          url: `https://www.instagram.com/reel/${m.code}/`,
          platform: 'instagram',
        };
      });

    res.set('Cache-Control', 'no-store');
    res.json(videos);
  } catch (e) {
    console.error('[Instagram viral] Error:', e.response?.data || e.message);
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

// ── Busca TikTok por palavra-chave (TikTok Scraper 7) ────────────────────────

router.get('/tiktok-search', async (req, res) => {
  const { q = '', region = 'br', sort_type = '0', publish_time = '0' } = req.query;
  if (!q.trim()) return res.json([]);

  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return res.status(503).json({ error: 'RAPIDAPI_KEY não configurada' });

  try {
    const response = await axios.get('https://tiktok-scraper7.p.rapidapi.com/feed/search', {
      params: { keywords: q.trim(), region, count: 20, cursor: 0, publish_time, sort_type },
      headers: { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com' },
      timeout: 15000,
    });

    const list = response.data?.data?.videos || [];
    const videos = list.map((v) => {
      // author pode ser string ou objeto { id, unique_id, nickname, avatar }
      const authorObj = typeof v.author === 'object' && v.author !== null ? v.author : null;
      const authorHandle = authorObj ? (authorObj.unique_id || authorObj.id || '') : String(v.author || '');
      const authorName = authorObj ? (authorObj.nickname || authorHandle) : authorHandle;
      const videoId = v.video_id || v.aweme_id || '';
      return {
        id: String(videoId),
        title: String(v.title || v.desc || ''),
        author: authorName,
        author_handle: authorHandle,
        views: Number(v.play_count || 0),
        likes: Number(v.digg_count || 0),
        comments: Number(v.comment_count || 0),
        shares: Number(v.share_count || 0),
        cover: String(v.cover || v.origin_cover || ''),
        url: `https://www.tiktok.com/@${authorHandle}/video/${videoId}`,
        platform: 'tiktok',
      };
    });

    res.set('Cache-Control', 'no-store');
    res.json(videos);
  } catch (e) {
    console.error('[TikTok search] Error:', e.response?.data || e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Busca Criadores TikTok por palavra-chave (Scraptik) ───────────────────────

router.get('/tiktok-creators', async (req, res) => {
  const { q = '' } = req.query;
  if (!q.trim()) return res.json([]);

  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return res.status(503).json({ error: 'RAPIDAPI_KEY não configurada' });

  try {
    const response = await axios.get('https://scraptik.p.rapidapi.com/search-users', {
      params: { keyword: q.trim(), count: 15 },
      headers: { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'scraptik.p.rapidapi.com' },
      timeout: 15000,
    });

    const list = response.data?.user_list || [];
    const creators = list
      .map((u) => {
        // Scraptik retorna { user_info: {...} } ou diretamente { id, unique_id, nickname, avatar }
        const info = u.user_info || u;
        const avatarRaw = info.avatar_thumb?.url_list?.[0] || info.avatar_medium?.url_list?.[0];
        const avatar = typeof avatarRaw === 'string' ? avatarRaw
          : (typeof info.avatar === 'string' ? info.avatar : '');
        return {
          uid: String(info.uid || info.id || ''),
          username: String(info.unique_id || ''),
          nickname: String(info.nickname || ''),
          followers: Number(info.follower_count || 0),
          avatar,
        };
      })
      .sort((a, b) => b.followers - a.followers);

    res.set('Cache-Control', 'no-store');
    res.json(creators);
  } catch (e) {
    console.error('[TikTok creators] Error:', e.response?.data || e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Busca Viral TikTok (por @username via Scraptik) ───────────────────────────

router.get('/viral-tiktok', async (req, res) => {
  const { q = '' } = req.query;
  const username = q.trim().replace(/^@/, '');
  if (!username) return res.json([]);

  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return res.status(503).json({ error: 'RAPIDAPI_KEY não configurada' });

  try {
    // 1. Busca user_id pelo username
    const userRes = await axios.get('https://scraptik.p.rapidapi.com/get-user', {
      params: { username },
      headers: { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'scraptik.p.rapidapi.com' },
      timeout: 15000,
    });

    const uid = userRes.data?.user?.uid;
    if (!uid) return res.status(404).json({ error: 'Usuário não encontrado' });

    // 2. Busca posts do usuário
    const postsRes = await axios.get('https://scraptik.p.rapidapi.com/user-posts', {
      params: { user_id: uid, count: 20 },
      headers: { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'scraptik.p.rapidapi.com' },
      timeout: 15000,
    });

    const list = postsRes.data?.aweme_list || [];
    const videos = list.map((v) => ({
      id: v.aweme_id,
      title: v.desc || '',
      author: v.author?.nickname || username,
      author_handle: v.author?.unique_id || username,
      views: v.statistics?.play_count || 0,
      likes: v.statistics?.digg_count || 0,
      comments: v.statistics?.comment_count || 0,
      shares: v.statistics?.share_count || 0,
      cover: v.video?.cover?.url_list?.[0] || v.video?.origin_cover?.url_list?.[0] || '',
      url: `https://www.tiktok.com/@${v.author?.unique_id}/video/${v.aweme_id}`,
      platform: 'tiktok',
    }));

    res.set('Cache-Control', 'no-store');
    res.json(videos);
  } catch (e) {
    console.error('[TikTok viral] Error:', e.response?.data || e.message);
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

// ── IA: Descoberta Automática de Conteúdo Viral — Alinhada ao Roteiro ────────

router.post('/ai-discover', async (req, res) => {
  const { niche = 'testosterona hormônios shape ganho muscular perda de gordura' } = req.body;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(503).json({ error: 'ANTHROPIC_API_KEY não configurada' });

  const rapidApiKey = process.env.RAPIDAPI_KEY;
  if (!rapidApiKey) return res.status(503).json({ error: 'RAPIDAPI_KEY não configurada' });

  const Anthropic = require('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  function fmtK(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  }

  const platformErrors = [];

  try {
    // ── Passo 1: Claude gera palavras-chave multilíngues alinhadas ao Roteiro ──
    const ROTEIRO_SYSTEM = `Você é especialista em conteúdo viral de saúde/fitness/hormônios.
ROTEIRO DE VIRALIZAÇÃO do projeto:
- FORMATOS VIRAIS: lista ("3 sinais que sua testosterona está baixa"), revelação ("O que ninguém conta sobre TRT"), antes/depois, medo/urgência, curiosidade com gancho forte
- ANATOMIA: GANCHO (2-4s visual+auditivo+texto+verbal) + DESENVOLVIMENTO (40-60s) + CTA
- NICHO: testosterona, TRT, GLP-1, hormônios, shape definido, ganhar massa, perder gordura, cortisol, resistência à insulina, dieta, treino, estética, definição corporal, perda de barriga
- FILTRO: ordenar por MAIS CURTIDAS + publicado esse mês
- BUSCA INTERNACIONAL: termos em inglês/espanhol para capturar formatos virais gringos`;

    const kwMsg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: ROTEIRO_SYSTEM,
      messages: [{
        role: 'user',
        content: `Nicho do criador: "${niche}"

Gere palavras-chave para encontrar vídeos VIRAIS com muitas curtidas E views sobre este nicho.
Preciso em 3 idiomas para buscar em vários países:
- "pt": 3 termos em PORTUGUÊS (Brasil/Portugal) — ex: "testosterona baixa sinais", "como perder gordura"
- "en": 2 termos em INGLÊS (EUA/UK) — ex: "testosterone warning signs", "fat loss mistakes"
- "es": 2 termos em ESPANHOL (México/Argentina) — ex: "señales testosterona baja", "perder grasa rápido"

Priorize termos que geram: listas, revelações, medo, curiosidade, antes/depois.
Responda APENAS com JSON: { "pt": [...], "en": [...], "es": [...] }`,
      }],
    });

    let keywords = { pt: [], en: [], es: [] };
    try {
      const raw = kwMsg.content[0].text.trim();
      const match = raw.match(/\{[\s\S]*\}/);
      keywords = match ? JSON.parse(match[0]) : keywords;
    } catch { /* use defaults */ }
    if (!keywords.pt?.length) keywords.pt = ['testosterona sinais', 'perder gordura', 'ganhar massa'];
    if (!keywords.en?.length) keywords.en = ['testosterone warning signs', 'fat loss mistakes'];
    if (!keywords.es?.length) keywords.es = ['testosterona baja señales', 'perder grasa rápido'];

    // ── Passo 2: Buscas paralelas — TikTok multi-região + Instagram ───────────
    const ttSearchPlan = [
      ...keywords.pt.flatMap((kw) => [
        { kw, region: 'br', lang: 'pt' },
        { kw, region: 'pt', lang: 'pt' },
      ]),
      ...keywords.en.map((kw) => ({ kw, region: 'us', lang: 'en' })),
      ...keywords.es.map((kw) => ({ kw, region: 'mx', lang: 'es' })),
    ];

    const [ttResults, igResults] = await Promise.all([
      Promise.allSettled(
        ttSearchPlan.map(({ kw, region }) =>
          axios.get('https://tiktok-scraper7.p.rapidapi.com/feed/search', {
            params: { keywords: kw, region, count: 15, cursor: 0, publish_time: '30', sort_type: '1' },
            headers: { 'x-rapidapi-key': rapidApiKey, 'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com' },
            timeout: 20000,
          })
        )
      ),
      Promise.allSettled(
        keywords.pt.slice(0, 3).map((kw) =>
          axios.post(
            'https://instagram-scraper-stable-api.p.rapidapi.com/search_ig.php',
            new URLSearchParams({ search_query: kw }),
            {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'x-rapidapi-key': rapidApiKey,
                'x-rapidapi-host': 'instagram-scraper-stable-api.p.rapidapi.com',
              },
              timeout: 15000,
            }
          )
        )
      ),
    ]);

    // ── Status das plataformas ────────────────────────────────────────────────
    const ttOk = ttResults.some((r) => r.status === 'fulfilled');
    const igOk = igResults.some((r) => r.status === 'fulfilled');
    if (!ttOk) platformErrors.push({ platform: 'TikTok', error: ttResults[0]?.reason?.message || 'Erro desconhecido' });
    if (!igOk) platformErrors.push({ platform: 'Instagram', error: igResults[0]?.reason?.message || 'Erro desconhecido' });

    // ── Consolidar vídeos TikTok ───────────────────────────────────────────────
    const allVideos = [];
    const seenIds = new Set();
    ttResults.forEach((result, idx) => {
      if (result.status !== 'fulfilled') return;
      const { kw, region, lang } = ttSearchPlan[idx];
      const list = result.value.data?.data?.videos || [];
      list.forEach((v) => {
        const authorObj = typeof v.author === 'object' && v.author !== null ? v.author : null;
        const authorHandle = authorObj ? (authorObj.unique_id || authorObj.id || '') : String(v.author || '');
        const authorName = authorObj ? (authorObj.nickname || authorHandle) : authorHandle;
        const videoId = String(v.video_id || v.aweme_id || '');
        if (!videoId || seenIds.has(videoId)) return;
        seenIds.add(videoId);
        const views = Number(v.play_count || 0);
        const likes = Number(v.digg_count || 0);
        if (views < 5000 && likes < 200) return;
        allVideos.push({
          id: videoId,
          title: String(v.title || v.desc || ''),
          author: authorName,
          author_handle: authorHandle,
          views,
          likes,
          comments: Number(v.comment_count || 0),
          shares: Number(v.share_count || 0),
          cover: String(v.cover || v.origin_cover || ''),
          url: `https://www.tiktok.com/@${authorHandle}/video/${videoId}`,
          platform: 'tiktok',
          keyword: kw,
          region,
          lang,
        });
      });
    });

    // ── Consolidar criadores Instagram ────────────────────────────────────────
    const igCreators = [];
    igResults.forEach((result, idx) => {
      if (result.status !== 'fulfilled') return;
      const kw = keywords.pt[idx];
      const raw = result.value.data;
      // novo formato: { users: [{ user: { username, full_name, search_social_context, ... } }] }
      const rawList = raw?.users || raw?.data?.users || raw?.data || (Array.isArray(raw) ? raw : []);
      rawList.slice(0, 4).forEach((item) => {
        const u = item.user || item;
        if (!u.username) return;
        igCreators.push({
          username: String(u.username || ''),
          nickname: String(u.full_name || u.name || u.username || ''),
          followers: parseSocialCtx(u.search_social_context) || Number(u.follower_count || u.edge_followed_by?.count || 0),
          avatar: String(u.profile_pic_url || ''),
          is_verified: Boolean(u.is_verified || false),
          keyword: kw,
        });
      });
    });

    const platformStatus = {
      tiktok: {
        ok: ttOk,
        searched: ttResults.filter((r) => r.status === 'fulfilled').length,
        total: ttSearchPlan.length,
        videos_found: allVideos.length,
        countries: [...new Set(ttSearchPlan.map((p) => p.region))],
      },
      instagram: {
        ok: igOk,
        searched: igResults.filter((r) => r.status === 'fulfilled').length,
        total: keywords.pt.slice(0, 3).length,
        creators_found: igCreators.length,
      },
    };

    if (allVideos.length === 0) {
      return res.json({ keywords, videos: [], creators: igCreators, insights: '', platformStatus, errors: platformErrors.length ? platformErrors : undefined });
    }

    // ── Passo 3: Pré-rankear por curtidas + views ─────────────────────────────
    allVideos.sort((a, b) => {
      const sA = Math.log10(a.likes + 1) * 0.6 + Math.log10(a.views + 1) * 0.4;
      const sB = Math.log10(b.likes + 1) * 0.6 + Math.log10(b.views + 1) * 0.4;
      return sB - sA;
    });
    const top50 = allVideos.slice(0, 50);

    // ── Passo 4: Claude pontua alinhamento ao Roteiro ─────────────────────────
    const videosForAi = top50.map((v, i) => ({
      idx: i, title: v.title, views: v.views, likes: v.likes,
      comments: v.comments, shares: v.shares, keyword: v.keyword,
    }));

    const scoreMsg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      system: ROTEIRO_SYSTEM,
      messages: [{
        role: 'user',
        content: `Nicho do criador: "${niche}".
Analise cada vídeo e avalie:
1. roteiro_format: "lista" | "revelacao" | "antes_depois" | "medo" | "curiosidade" | "prova_social" | "tutorial" | "outro"
2. niche_fit: 1-10 (alinhamento com testosterona, TRT, GLP-1, hormônios, shape, perda de gordura, ganho muscular, dieta, treino, estética, barriga)
3. gancho_score: 1-10 (força do gancho nos primeiros 2-4s baseado no título)
4. viral_score: 1-10 (potencial viral: engagement + alinhamento ao roteiro + força do nicho)
5. why: 1 frase curta em português

Dê notas altas apenas para vídeos claramente alinhados ao Roteiro e ao nicho.

Vídeos:
${JSON.stringify(videosForAi, null, 2)}

Responda APENAS com JSON array: [{ idx, roteiro_format, niche_fit, gancho_score, viral_score, why }]`,
      }],
    });

    let scores = [];
    try {
      const raw = scoreMsg.content[0].text.trim();
      const match = raw.match(/\[[\s\S]*\]/);
      scores = match ? JSON.parse(match[0]) : [];
    } catch { scores = []; }

    const scoreMap = {};
    scores.forEach((s) => { if (s?.idx != null) scoreMap[s.idx] = s; });

    const scoredVideos = top50.map((v, i) => ({
      ...v,
      viral_score: scoreMap[i]?.viral_score ?? 5,
      niche_fit: scoreMap[i]?.niche_fit ?? 5,
      gancho_score: scoreMap[i]?.gancho_score ?? 5,
      roteiro_format: scoreMap[i]?.roteiro_format || 'outro',
      ai_why: scoreMap[i]?.why || '',
    })).sort((a, b) => {
      const sA = a.viral_score * 4 + Math.log10(a.likes + 1) * 4 + Math.log10(a.views + 1) * 2;
      const sB = b.viral_score * 4 + Math.log10(b.likes + 1) * 4 + Math.log10(b.views + 1) * 2;
      return sB - sA;
    });

    // ── Passo 5: Insight alinhado ao Roteiro ──────────────────────────────────
    const topVideos = scoredVideos.slice(0, 6)
      .map((v) => v.title ? `"${v.title}" (${fmtK(v.likes)} curtidas, ${fmtK(v.views)} views, formato: ${v.roteiro_format})` : null)
      .filter(Boolean);

    let insights = '';
    if (topVideos.length > 0) {
      const insightMsg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 450,
        system: ROTEIRO_SYSTEM,
        messages: [{
          role: 'user',
          content: `Vídeos mais virais encontrados no nicho "${niche}":
${topVideos.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Escreva 3 frases curtas em português:
1. Qual FORMATO do Roteiro está viralizando mais agora
2. Qual EMOÇÃO/GANCHO está funcionando (curiosidade, medo, revelação?)
3. Como o criador pode ADAPTAR esse formato para seu conteúdo de ${niche}`,
        }],
      });
      insights = insightMsg.content[0].text.trim();
    }

    res.set('Cache-Control', 'no-store');
    res.json({ keywords, videos: scoredVideos, creators: igCreators, insights, platformStatus, errors: platformErrors.length ? platformErrors : undefined });
  } catch (e) {
    console.error('[AI Discover] Error:', e.message);
    res.status(500).json({ error: e.message, errors: platformErrors });
  }
});

// ── Referências Virais ────────────────────────────────────────────────────────

router.get('/references', (_req, res) => res.json(db.getAllReferences()));

router.post('/references', (req, res) => {
  try {
    const item = { id: uuidv4(), ...req.body };
    db.createReference(item);
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/references/:id', (req, res) => {
  db.deleteReference(req.params.id);
  res.json({ ok: true });
});

// ── Hook Templates ────────────────────────────────────────────────────────────

router.get('/hooks', (_req, res) => res.json(db.getAllHooks()));

router.post('/hooks', (req, res) => {
  try {
    const item = { id: uuidv4(), ...req.body };
    db.createHook(item);
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/hooks/:id/use', (req, res) => {
  db.incrementHookUse(req.params.id);
  res.json({ ok: true });
});

router.delete('/hooks/:id', (req, res) => {
  db.deleteHook(req.params.id);
  res.json({ ok: true });
});

// ── Ideias de Conteúdo ────────────────────────────────────────────────────────

router.get('/ideas', (_req, res) => res.json(db.getAllIdeas()));

router.post('/ideas', (req, res) => {
  try {
    const item = { id: uuidv4(), status: 'idea', ...req.body };
    db.createIdea(item);
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/ideas/:id', (req, res) => {
  try {
    db.updateIdea(req.params.id, req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/ideas/:id', (req, res) => {
  db.deleteIdea(req.params.id);
  res.json({ ok: true });
});

// ── Gerar Roteiro a partir dos vídeos virais encontrados ─────────────────────
router.post('/roteiro-from-videos', async (req, res) => {
  const { videos = [], niche = '' } = req.body;
  if (!videos.length) return res.status(400).json({ error: 'Nenhum vídeo enviado' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(503).json({ error: 'ANTHROPIC_API_KEY não configurada' });

  const Anthropic = require('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  const top = videos.slice(0, 8);
  const videoList = top.map((v, i) =>
    `${i + 1}. "${v.title || '(sem título)'}" — formato: ${v.roteiro_format || '?'}, viral: ${v.viral_score || '?'}/10, nicho: ${v.niche_fit || '?'}/10, ❤️ ${v.likes?.toLocaleString?.() || v.likes}, 👁 ${v.views?.toLocaleString?.() || v.views}`
  ).join('\n');

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      system: `Você é especialista em roteiros virais de saúde/fitness/hormônios para TikTok e Instagram Reels.
REGRAS DO ROTEIRO VIRA-LOS:
- GANCHO (2-4s): Visual + auditivo + textual + verbal — deve parar o scroll imediatamente
- DESENVOLVIMENTO (40-60s): Dinamismo, quebras de padrão, técnica + entretenimento
- CTA: Comentar, seguir ou compartilhar — no começo, meio e final
- EMOÇÃO CENTRAL: Curiosidade, surpresa, medo, urgência
- DURAÇÃO IDEAL: 50s a 1min20`,
      messages: [{
        role: 'user',
        content: `Nicho do criador: "${niche || 'saúde hormonal, testosterona, shape'}".

Esses são os TOP vídeos virais encontrados pela IA (ordenados por score):
${videoList}

Com base nesses vídeos virais, gere 2 roteiros completos que eu possa REPLICAR adaptando para o meu nicho.
Para cada roteiro:

## Roteiro [N] — [Formato: Lista/Revelação/Medo/etc]
**Gancho (0-3s):** [texto exato que aparece na tela + o que falar]
**Desenvolvimento (10-60s):**
- [ponto 1]
- [ponto 2]
- [ponto 3]
**CTA:** [o que falar no final]
**Por que vai viralizar:** [1 frase]

Adapte os títulos e exemplos para o nicho informado, mas mantenha a ESTRUTURA dos vídeos que mais viralizaram.`,
      }],
    });

    res.json({ roteiro: msg.content[0].text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
