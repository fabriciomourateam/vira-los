/**
 * maquina.js — Rotas da Máquina de Carrosséis (modo BrandsDecoded).
 *
 * Pipeline editorial:
 *   POST   /api/maquina/headlines           → 10 headlines (5 IC + 5 NM)
 *   POST   /api/maquina/structure           → espinha dorsal
 *   POST   /api/maquina/generate            → HTML completo (Pexels resolvido + fontes embutidas)
 *   POST   /api/maquina/full                → automação total (headlines→structure→HTML em uma chamada)
 *
 * Histórico (CRUD):
 *   GET    /api/maquina/carrosseis          → lista
 *   GET    /api/maquina/carrosseis/:id      → busca um
 *   POST   /api/maquina/carrosseis          → cria
 *   PATCH  /api/maquina/carrosseis/:id      → renomeia / status / arquivar
 *   DELETE /api/maquina/carrosseis/:id      → exclui
 *
 * Diagnóstico:
 *   GET    /api/maquina/check               → verifica chaves API necessárias
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');

const {
  generateHeadlines,
  generateStructure,
  generateCarouselHTML,
} = require('../services/maquinaService');
const db = require('../db/database');

const router = express.Router();

// ─── Diagnóstico de chaves ───────────────────────────────────────────────────
router.get('/check', (_req, res) => {
  res.json({
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    pexels:    Boolean(process.env.PEXELS_API_KEY),
    model:     'claude-sonnet-4-6',
  });
});

// ─── 1. Headlines ────────────────────────────────────────────────────────────
router.post('/headlines', async (req, res) => {
  try {
    const { tema, nicho, brandKitId } = req.body;
    if (!tema) return res.status(400).json({ error: 'Campo "tema" é obrigatório.' });

    const brandKit = brandKitId ? db.getBrandKit(brandKitId) : null;
    const headlines = await generateHeadlines(tema, nicho, brandKit);
    res.json({ headlines });
  } catch (err) {
    console.error('[Maquina/Headlines]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 2. Espinha dorsal ───────────────────────────────────────────────────────
router.post('/structure', async (req, res) => {
  try {
    const { headline, tema, conversationHistory = [] } = req.body;
    if (!headline || !tema) {
      return res.status(400).json({ error: 'Campos "headline" e "tema" são obrigatórios.' });
    }
    const structure = await generateStructure(headline, tema, conversationHistory);
    res.json({ structure });
  } catch (err) {
    console.error('[Maquina/Structure]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 3. HTML do carrossel ────────────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  try {
    const {
      tema, headline, cta, slides = 9, nicho,
      brandKitId, conversationHistory = [],
    } = req.body;

    if (!tema || !headline) {
      return res.status(400).json({ error: 'Campos "tema" e "headline" são obrigatórios.' });
    }

    const brandKit = brandKitId ? db.getBrandKit(brandKitId) : null;
    const html = await generateCarouselHTML({
      tema, headline, cta, slides, nicho, brandKit, conversationHistory,
    });
    res.json({ html });
  } catch (err) {
    console.error('[Maquina/Generate]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 4. Automação total ──────────────────────────────────────────────────────
router.post('/full', async (req, res) => {
  try {
    const {
      tema,
      headlineIndex = 0,
      cta = 'Comenta SHAPE e me segue para mais conteúdos como esse',
      slides = 9,
      nicho = 'Consultoria Esportiva',
      brandKitId,
    } = req.body;

    if (!tema) return res.status(400).json({ error: 'Campo "tema" é obrigatório.' });

    const brandKit = brandKitId ? db.getBrandKit(brandKitId) : null;

    // Passo 1: 10 headlines
    const headlinesText = await generateHeadlines(tema, nicho, brandKit);

    // Passo 2: extrai a headline escolhida da tabela markdown
    const tableLines = headlinesText
      .split('\n')
      .filter(l => l.startsWith('|') && !l.includes('---') && !l.toLowerCase().includes('headline'));

    let chosenHeadline = tema;
    if (tableLines.length > headlineIndex) {
      const cols = tableLines[headlineIndex].split('|').map(c => c.trim()).filter(Boolean);
      if (cols.length >= 2) chosenHeadline = cols[1];
    }

    // Passo 3: espinha dorsal
    const structure = await generateStructure(chosenHeadline, tema);

    // Passo 4: HTML
    const conversationHistory = [
      { role: 'user',      content: `Tema: ${tema}` },
      { role: 'assistant', content: headlinesText },
      { role: 'user',      content: `Escolhi a headline: ${chosenHeadline}` },
      { role: 'assistant', content: structure },
      { role: 'user',      content: 'Aprovado. Agora gere o HTML do carrossel.' },
    ];

    const html = await generateCarouselHTML({
      tema, headline: chosenHeadline, cta, slides, nicho, brandKit, conversationHistory,
    });

    res.json({ headline: chosenHeadline, structure, html, headlines: headlinesText });
  } catch (err) {
    console.error('[Maquina/Full]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── CRUD do histórico ───────────────────────────────────────────────────────
router.get('/carrosseis', (_req, res) => {
  res.json({ carrosseis: db.getAllMaquinaCarrosseis() });
});

router.get('/carrosseis/:id', (req, res) => {
  const item = db.getMaquinaCarrossel(req.params.id);
  if (!item) return res.status(404).json({ error: 'Carrossel não encontrado.' });
  res.json(item);
});

router.post('/carrosseis', (req, res) => {
  const id = req.body.id || uuidv4();
  const item = db.createMaquinaCarrossel({
    id,
    briefing: req.body.briefing || {},
    headlines: req.body.headlines || [],
    headlineEscolhida: req.body.headlineEscolhida || null,
    estrutura: req.body.estrutura || null,
    html: req.body.html || null,
    legenda: req.body.legenda || null,
    status: req.body.status || 'draft',
    title: req.body.title || (req.body.briefing?.tema || 'Sem título'),
    archived: false,
  });
  res.json(item);
});

router.patch('/carrosseis/:id', (req, res) => {
  db.updateMaquinaCarrossel(req.params.id, req.body);
  res.json(db.getMaquinaCarrossel(req.params.id));
});

router.delete('/carrosseis/:id', (req, res) => {
  db.deleteMaquinaCarrossel(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
