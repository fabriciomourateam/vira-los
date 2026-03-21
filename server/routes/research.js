const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const db = require('../db/database');

// ── Busca Viral (YouTube Data API) ────────────────────────────────────────────

router.get('/viral', async (req, res) => {
  const { q = '', count = 20, publishedAfter } = req.query;
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
  try {
    const yt = require('../services/youtube');
    const auth = await yt.getAuthenticatedClient();
    const { google } = require('googleapis');
    const youtube = google.youtube({ version: 'v3', auth });

    const trendRes = await youtube.videos.list({
      part: ['snippet', 'statistics'],
      chart: 'mostPopular',
      regionCode: 'BR',
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
    const videos = list.map((v) => ({
      id: v.video_id || v.aweme_id,
      title: v.title || v.desc || '',
      author: v.author || '',
      author_handle: v.author || '',
      views: v.play_count || 0,
      likes: v.digg_count || 0,
      comments: v.comment_count || 0,
      shares: v.share_count || 0,
      cover: v.cover || v.origin_cover || '',
      url: `https://www.tiktok.com/@${v.author}/video/${v.video_id || v.aweme_id}`,
      platform: 'tiktok',
    }));

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
      .map((u) => ({
        uid: u.user_info?.uid || u.uid,
        username: u.user_info?.unique_id || u.unique_id,
        nickname: u.user_info?.nickname || u.nickname,
        followers: u.user_info?.follower_count || u.follower_count || 0,
        avatar: u.user_info?.avatar_thumb?.url_list?.[0] || '',
      }))
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
    const item = { id: uuidv4(), ...req.body };
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

module.exports = router;
