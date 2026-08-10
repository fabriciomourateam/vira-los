/**
 * maintenance.js — Limpeza de espaço do volume.
 *
 *   GET  /api/maintenance/overview → uso do disco + lista de carrosséis e reels
 *                                    com tamanho em disco, status (postado/arquivado).
 *   POST /api/maintenance/delete   → apaga em LOTE (registro + ARQUIVOS do disco).
 *
 * Os deletes normais (/api/carousel/saved/:id, /api/reels/saved/:id) só removem o
 * registro — os PNGs/MP4 ficam no volume. Aqui a gente remove o arquivo de fato,
 * pra liberar espaço. Apagar aqui NÃO desfaz o que já foi postado no mLabs/Instagram
 * (o post já está lá); só limpa a cópia local.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const db = require('../db/database');
const { OUTPUT_DIR } = require('../services/carouselService');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');

// Soma o tamanho de uma pasta (recursivo). Tolerante a arquivo/pasta sumido.
function folderSize(dir) {
  let total = 0;
  let names;
  try { names = fs.readdirSync(dir); } catch { return 0; }
  for (const name of names) {
    const full = path.join(dir, name);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) total += folderSize(full);
    else total += st.size;
  }
  return total;
}

function fileSize(p) {
  try { return p && fs.existsSync(p) ? fs.statSync(p).size : 0; } catch { return 0; }
}

// contentIds que já foram mandados pro mLabs (postados/agendados).
function postedContentIds() {
  const set = new Set();
  try {
    for (const s of db.getAllMlabsSchedules()) {
      if (s.status === 'erro' || s.status === 'cancelado') continue;
      if (s.contentId) set.add(s.contentId);
    }
  } catch { /* sem histórico */ }
  return set;
}

router.get('/overview', (_req, res) => {
  let disk = null;
  try {
    const s = fs.statfsSync(DATA_DIR);
    const totalBytes = s.blocks * s.bsize;
    const freeBytes = s.bfree * s.bsize;
    disk = { totalBytes, usedBytes: totalBytes - freeBytes, freeBytes };
  } catch { disk = null; }

  const posted = postedContentIds();

  const carousels = db.getAllCarousels().map((c) => {
    const folder = c.folderName ? path.join(OUTPUT_DIR, c.folderName) : null;
    return {
      id: c.id,
      title: c.topic || 'Carrossel',
      date: c.created_at || null,
      sizeBytes: folder ? folderSize(folder) : 0,
      posted: posted.has(c.id),
      archived: !!c.archived,
      source: c.source || null,
    };
  }).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const reels = db.getAllReels().map((r) => ({
    id: r.id,
    title: r.title || (r.fraseTela || '').replace(/\*\*/g, '') || 'Reel',
    date: r.created_at || null,
    sizeBytes: fileSize(r.videoPath),
    posted: posted.has(r.id),
    archived: !!r.archived,
    source: r.source || null,
  })).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  res.json({ disk, carousels, reels });
});

router.post('/delete', (req, res) => {
  const carouselIds = Array.isArray(req.body && req.body.carouselIds) ? req.body.carouselIds : [];
  const reelIds = Array.isArray(req.body && req.body.reelIds) ? req.body.reelIds : [];
  let freedBytes = 0;
  let deleted = 0;

  for (const id of carouselIds) {
    const c = db.getAllCarousels().find((x) => x.id === id);
    if (!c) continue;
    if (c.folderName) {
      const folder = path.join(OUTPUT_DIR, c.folderName);
      freedBytes += folderSize(folder);
      try { fs.rmSync(folder, { recursive: true, force: true }); } catch { /* ignora */ }
    }
    db.deleteCarousel(id);
    deleted++;
  }

  for (const id of reelIds) {
    const r = db.getReel ? db.getReel(id) : db.getAllReels().find((x) => x.id === id);
    if (!r) continue;
    if (r.videoPath) {
      freedBytes += fileSize(r.videoPath);
      try { if (fs.existsSync(r.videoPath)) fs.unlinkSync(r.videoPath); } catch { /* ignora */ }
    }
    db.deleteReel(id);
    deleted++;
  }

  res.json({ ok: true, deleted, freedBytes });
});

module.exports = router;
