/**
 * pexels.js
 * Proxy server-side da Pexels API.
 * Resolve CORS no mobile (browser nunca chama Pexels diretamente).
 *
 * Endpoints:
 *   GET  /api/pexels?query=...&orientation=portrait&per_page=5
 *   POST /api/pexels/batch  body: { queries: [{id, query, orientation}] }
 */

const express = require('express');
const axios = require('axios');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const {
      query = 'fitness',
      orientation = 'portrait',
      per_page = 5,
      page = 1,
    } = req.query;

    if (!process.env.PEXELS_API_KEY) {
      return res.status(500).json({ error: 'PEXELS_API_KEY não configurada no .env' });
    }

    const response = await axios.get('https://api.pexels.com/v1/search', {
      headers: { Authorization: process.env.PEXELS_API_KEY },
      params: {
        query,
        orientation,
        per_page: Math.min(parseInt(per_page, 10) || 5, 15),
        page: parseInt(page, 10) || 1,
      },
      timeout: 8000,
    });

    const photos = response.data.photos || [];
    if (photos.length === 0) {
      return res.json({ url: null, photos: [] });
    }

    const first = photos[0];
    res.json({
      url: first.src.large2x || first.src.large,
      photos: photos.map(p => ({
        id: p.id,
        url: p.src.large2x || p.src.large,
        thumb: p.src.medium,
        alt: p.alt,
        photographer: p.photographer,
      })),
      total_results: response.data.total_results,
    });
  } catch (err) {
    console.error('[Pexels Route Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/batch', async (req, res) => {
  try {
    const { queries = [] } = req.body;

    if (!process.env.PEXELS_API_KEY) {
      return res.status(500).json({ error: 'PEXELS_API_KEY não configurada no .env' });
    }

    const results = {};

    await Promise.all(
      queries.map(async ({ id, query, orientation = 'portrait' }) => {
        try {
          const response = await axios.get('https://api.pexels.com/v1/search', {
            headers: { Authorization: process.env.PEXELS_API_KEY },
            params: { query, orientation, per_page: 5, page: 1 },
            timeout: 8000,
          });
          const photos = response.data.photos || [];
          if (photos.length > 0) {
            const photo = photos[Math.floor(Math.random() * photos.length)];
            results[id] = {
              url: photo.src.large2x || photo.src.large,
              thumb: photo.src.medium,
              photographer: photo.photographer,
            };
          } else {
            results[id] = null;
          }
        } catch (e) {
          results[id] = null;
        }
      })
    );

    res.json({ results });
  } catch (err) {
    console.error('[Pexels Batch Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
