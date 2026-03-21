const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const db = require('../db/database');

// ── Busca Viral (Scraptik / RapidAPI) ─────────────────────────────────────────

router.get('/viral', async (req, res) => {
  const { q = '', count = 20 } = req.query;
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return res.status(503).json({ error: 'RAPIDAPI_KEY não configurada no servidor' });
  if (!q.trim()) return res.json([]);

  try {
    const response = await axios.get('https://scraptik.p.rapidapi.com/search_posts', {
      params: { keyword: q.trim(), count, offset: 0 },
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'scraptik.p.rapidapi.com',
      },
      timeout: 15000,
    });

    const list = response.data?.aweme_list || response.data?.data || [];
    const videos = list.map((v) => ({
      id: v.aweme_id || v.id || String(Math.random()),
      title: v.desc || '',
      author: v.author?.nickname || v.author?.unique_id || '',
      author_handle: v.author?.unique_id || '',
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
    console.error('[Viral search] Error:', e.response?.data || e.message);
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

router.get('/trending', async (req, res) => {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return res.status(503).json({ error: 'RAPIDAPI_KEY não configurada no servidor' });

  try {
    const response = await axios.get('https://scraptik.p.rapidapi.com/challenge_posts', {
      params: { challenge_name: 'fyp', count: 20, offset: 0 },
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'scraptik.p.rapidapi.com',
      },
      timeout: 15000,
    });

    const list = response.data?.aweme_list || response.data?.data || [];
    const videos = list.map((v) => ({
      id: v.aweme_id || v.id || String(Math.random()),
      title: v.desc || '',
      author: v.author?.nickname || v.author?.unique_id || '',
      author_handle: v.author?.unique_id || '',
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
    console.error('[Trending] Error:', e.response?.data || e.message);
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
