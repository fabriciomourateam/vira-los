/**
 * qaStickers.js — Rotas das Caixinhas de Perguntas
 *
 * POST   /api/qa-stickers/generate   → gera N pares a partir do IG do usuário
 * GET    /api/qa-stickers            → histórico salvo
 * POST   /api/qa-stickers            → salva uma leva gerada
 * PATCH  /api/qa-stickers/:id        → marca pares como usados / renomeia
 * DELETE /api/qa-stickers/:id        → remove
 */

const express = require('express');
const { generateQaStickers } = require('../services/qaStickersService');
const db = require('../db/database');

const router = express.Router();

router.post('/generate', async (req, res) => {
  const { note, count } = req.body || {};
  const n = Math.min(10, Math.max(3, Number(count) || 6));
  try {
    const result = await generateQaStickers({ note, count: n });
    res.json(result);
  } catch (err) {
    const status = /sincroniz|Analytics/i.test(err.message) ? 409 : 500;
    console.error('[QaStickers/Generate]', err.message);
    res.status(status).json({ error: err.message });
  }
});

router.get('/', (req, res) => {
  res.json(db.getAllQaStickers());
});

router.post('/', (req, res) => {
  const { pairs, note, niche } = req.body || {};
  if (!Array.isArray(pairs) || pairs.length === 0) {
    return res.status(400).json({ error: 'pairs obrigatório' });
  }
  const id = `qa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const set = { id, pairs, note: note || '', niche: niche || '', usedPairs: [] };
  db.saveQaStickers(set);
  res.json(set);
});

router.patch('/:id', (req, res) => {
  const allowed = ['pairs', 'usedPairs', 'note'];
  const update = {};
  for (const k of allowed) if (req.body?.[k] !== undefined) update[k] = req.body[k];
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Nenhum campo válido' });
  db.updateQaStickers(req.params.id, update);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.deleteQaStickers(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
