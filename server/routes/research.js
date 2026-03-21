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
