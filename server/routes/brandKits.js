/**
 * brandKits.js — CRUD de Brand Kits
 *
 * GET    /api/brand-kits          → lista todos
 * POST   /api/brand-kits          → cria novo
 * GET    /api/brand-kits/:id      → busca por id
 * PUT    /api/brand-kits/:id      → atualiza
 * DELETE /api/brand-kits/:id      → exclui
 */

const express = require('express');
const crypto = require('crypto');
const db = require('../db/database');

const router = express.Router();

function newId() {
  return crypto.randomUUID();
}

router.get('/', (req, res) => {
  res.json(db.getAllBrandKits());
});

router.get('/:id', (req, res) => {
  const kit = db.getBrandKit(req.params.id);
  if (!kit) return res.status(404).json({ error: 'Brand kit não encontrado' });
  res.json(kit);
});

router.post('/', (req, res) => {
  const { name, brandName, industry, contentTone, designStyle, fontStyle,
          targetAudience, aboutProduct, differentiator, palette, instagramHandle,
          logoUrl, examples } = req.body;

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'O campo "name" é obrigatório' });
  }

  const kit = {
    id: newId(),
    name: name.trim(),
    brandName: brandName || name.trim(),
    industry: industry || '',
    contentTone: contentTone || 'Profissional',
    designStyle: designStyle || 'Moderno',
    fontStyle: fontStyle || 'Sans-Serif Moderna',
    targetAudience: targetAudience || '',
    aboutProduct: aboutProduct || '',
    differentiator: differentiator || '',
    palette: palette || ['#6366f1', '#8b5cf6', '#ffffff'],
    instagramHandle: instagramHandle || '',
    logoUrl: logoUrl || '',
    examples: examples || '',
  };

  db.createBrandKit(kit);
  res.status(201).json(kit);
});

router.put('/:id', (req, res) => {
  const kit = db.getBrandKit(req.params.id);
  if (!kit) return res.status(404).json({ error: 'Brand kit não encontrado' });

  const allowed = ['name','brandName','industry','contentTone','designStyle','fontStyle',
                   'targetAudience','aboutProduct','differentiator','palette','instagramHandle',
                   'logoUrl','examples'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );

  db.updateBrandKit(req.params.id, updates);
  res.json({ ...kit, ...updates });
});

router.delete('/:id', (req, res) => {
  const kit = db.getBrandKit(req.params.id);
  if (!kit) return res.status(404).json({ error: 'Brand kit não encontrado' });
  db.deleteBrandKit(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
