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
const { generateQaStickers, DEFAULT_PROMPT_TEMPLATE, PLACEHOLDERS } = require('../services/qaStickersService');
const db = require('../db/database');

const router = express.Router();

// ─── Prompt editável ──────────────────────────────────────────────────────────

router.get('/prompt', (req, res) => {
  const saved = db.getCaixinhasPrompt() || null;
  res.json({
    template:    saved?.template || DEFAULT_PROMPT_TEMPLATE,
    isCustom:    !!(saved?.template && saved.template.trim()),
    default:     DEFAULT_PROMPT_TEMPLATE,
    placeholders: PLACEHOLDERS,
    updatedAt:   saved?.updated_at || null,
  });
});

router.put('/prompt', (req, res) => {
  const { template } = req.body || {};
  if (typeof template !== 'string' || !template.trim()) {
    return res.status(400).json({ error: 'template precisa ser uma string não-vazia' });
  }
  if (template.length > 20000) {
    return res.status(400).json({ error: 'template grande demais (máx 20k chars)' });
  }
  db.setCaixinhasPrompt({ template });
  res.json({ ok: true });
});

router.delete('/prompt', (req, res) => {
  db.resetCaixinhasPrompt();
  res.json({ ok: true, template: DEFAULT_PROMPT_TEMPLATE });
});

router.post('/generate', async (req, res) => {
  const { note, count } = req.body || {};
  const n = Math.min(10, Math.max(3, Number(count) || 6));
  try {
    const result = await generateQaStickers({ note, count: n });
    res.json(result);
  } catch (err) {
    const status = /sincroniz|Analytics/i.test(err.message) ? 409 : 500;
    console.error('[QaStickers/Generate]', err.message);
    const body = { error: err.message };
    if (err.rawSnippet) body.rawSnippet = err.rawSnippet;
    res.status(status).json(body);
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
