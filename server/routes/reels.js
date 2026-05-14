/**
 * reels.js — Rotas do Gerador de Reels (a partir de carrosseis salvos)
 *
 * POST   /api/reels/generate          → inicia job, responde {jobId} imediato
 * GET    /api/reels/jobs/:id          → polling: { status, step, result? }
 * GET    /api/reels/saved             → lista reels salvos
 * POST   /api/reels/saved             → salva reel manualmente
 * PATCH  /api/reels/saved/:id         → renomeia / atualiza
 * DELETE /api/reels/saved/:id         → remove
 */

const express = require('express');
const axios = require('axios');
const archiver = require('archiver');
const { generateReelsFromCarousel } = require('../services/reelsGeneratorService');
const { fetchOneImage } = require('../services/carouselService');
const db = require('../db/database');

const router = express.Router();

// ─── Job store em memória ─────────────────────────────────────────────────────
const jobs = new Map();
const JOB_TTL_MS = 15 * 60 * 1000;

function createJob() {
  const jobId = `reel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  jobs.set(jobId, { status: 'processing', step: 'Lendo carrossel...', startedAt: Date.now() });
  setTimeout(() => jobs.delete(jobId), JOB_TTL_MS);
  return jobId;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) if (now - job.startedAt > JOB_TTL_MS) jobs.delete(id);
}, 5 * 60 * 1000);

// ─── Gerar reels (assíncrono) ────────────────────────────────────────────────

router.post('/generate', (req, res) => {
  const { carouselId, duration = 30, niche, instagramHandle } = req.body || {};

  if (!carouselId) {
    return res.status(400).json({ error: 'carouselId é obrigatório' });
  }

  const carousels = db.getAllCarousels();
  const carousel = carousels.find(c => c.id === carouselId);
  if (!carousel) {
    return res.status(404).json({ error: `Carrossel "${carouselId}" não encontrado.` });
  }
  if (!carousel.html) {
    // Tenta ler do disco se não tiver html inline
    const fs = require('fs');
    const path = require('path');
    const OUTPUT_DIR = path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), 'output');
    if (carousel.folderName) {
      const htmlFile = path.join(OUTPUT_DIR, carousel.folderName, 'carrossel.html');
      if (fs.existsSync(htmlFile)) {
        carousel.html = fs.readFileSync(htmlFile, 'utf8');
      }
    }
  }
  if (!carousel.html) {
    return res.status(400).json({ error: 'Carrossel sem HTML — não dá pra gerar reels.' });
  }

  const dur = Math.min(120, Math.max(15, Number(duration) || 30));
  const config = db.getCarouselConfig() || {};
  const finalNiche = niche || carousel.config?.niche || config.niche || 'fitness';
  const finalHandle = instagramHandle || carousel.config?.instagramHandle || config.instagramHandle || '';

  const jobId = createJob();
  res.json({ jobId });

  const setStep = (step) => {
    const job = jobs.get(jobId);
    if (job) jobs.set(jobId, { ...job, step });
  };

  setStep(`Gerando roteiro de ${dur}s com IA...`);

  generateReelsFromCarousel({ carousel, duration: dur, niche: finalNiche, instagramHandle: finalHandle })
    .then(reelsData => {
      const reel = {
        id: `reel_${Date.now()}`,
        carouselId,
        carouselTopic: carousel.topic,
        ...reelsData,
        niche: finalNiche,
        instagramHandle: finalHandle,
      };
      db.saveReel(reel);
      jobs.set(jobId, { ...jobs.get(jobId), status: 'done', result: reel, step: 'Concluído!' });
      console.log(`[Reels Job ${jobId}] Concluído — id=${reel.id}`);
    })
    .catch(err => {
      const anthropicMsg = err?.error?.error?.message || err?.error?.message;
      const errorType = err?.error?.error?.type || err?.error?.type;
      const httpStatus = err?.status ? `[HTTP ${err.status}] ` : '';
      const isOverload = err?.status === 529 || errorType === 'overloaded_error' || (err?.message || '').includes('overloaded');
      const message = isOverload
        ? 'A IA está sobrecarregada. Aguarde alguns instantes e tente novamente.'
        : `${httpStatus}${errorType ? `(${errorType}) ` : ''}${anthropicMsg || err?.message || 'Erro desconhecido'}`;
      jobs.set(jobId, { ...jobs.get(jobId), status: 'error', error: message });
      console.error(`[Reels Job ${jobId}] Erro:`, message);
      if (err?.stack) console.error(err.stack);
    });
});

// ─── Polling ────────────────────────────────────────────────────────────────

router.get('/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job não encontrado ou expirado' });
  if (job.status === 'done')  return res.json({ status: 'done', result: job.result });
  if (job.status === 'error') return res.json({ status: 'error', error: job.error });
  return res.json({ status: job.status, step: job.step });
});

// ─── Reels salvos ───────────────────────────────────────────────────────────

router.get('/saved', (req, res) => {
  res.json(db.getAllReels());
});

router.post('/saved', (req, res) => {
  const { id, ...rest } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id obrigatório' });
  db.saveReel({ id, ...rest });
  res.json({ ok: true });
});

router.patch('/saved/:id', (req, res) => {
  const allowed = ['title', 'archived', 'teleprompter', 'hook', 'body', 'cta', 'legendaPost'];
  const update = {};
  for (const k of allowed) if (req.body?.[k] !== undefined) update[k] = req.body[k];
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Nenhum campo válido para atualizar' });
  db.updateReel(req.params.id, update);
  res.json({ ok: true });
});

router.delete('/saved/:id', (req, res) => {
  db.deleteReel(req.params.id);
  res.json({ ok: true });
});

// ─── Pacote ZIP (imagens + roteiro + timings) ─────────────────────────────────
// GET /api/reels/saved/:id/zip
//
// Monta um .zip pronto pra importar no CapCut com:
//   • roteiro.txt        — hook + body + CTA legível, com timestamps
//   • timings.json       — array de { kind, filename, start, duration, fala, legenda }
//   • imagens/01_*.jpg…  — uma imagem por segmento (Unsplash/Pexels via fetchOneImage)
//
// Timings calculados de forma simples: hook = 3s, cta = 3s, body splita o resto.

function safeSlug(s, max = 40) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max) || 'reels';
}

async function downloadImageBuffer(url, timeoutMs = 15000) {
  const r = await axios.get(url, { responseType: 'arraybuffer', timeout: timeoutMs });
  return Buffer.from(r.data);
}

function buildSegmentList(reel) {
  // Retorna lista ordenada: hook → body[] → cta, com timestamps calculados
  const total = Number(reel.duration) || 30;
  const HOOK_DUR = Math.min(3, Math.max(2, Math.round(total * 0.10)));
  const CTA_DUR  = Math.min(3, Math.max(2, Math.round(total * 0.10)));
  const bodySegments = Array.isArray(reel.body) ? reel.body : [];
  const bodyTotal = Math.max(1, total - HOOK_DUR - CTA_DUR);
  const bodyEach  = bodySegments.length > 0 ? bodyTotal / bodySegments.length : 0;

  const out = [];
  let cursor = 0;
  if (reel.hook) {
    out.push({
      kind: 'hook',
      start: cursor,
      duration: HOOK_DUR,
      fala: reel.hook.fala || '',
      legenda: reel.hook.legenda || '',
      imagem: reel.hook.imagem || reel.carouselTopic || reel.title || '',
      tipo: reel.hook.tipo || '',
    });
    cursor += HOOK_DUR;
  }
  bodySegments.forEach((seg, i) => {
    const dur = Math.max(1, Math.round(bodyEach));
    out.push({
      kind: 'body',
      index: i + 1,
      start: cursor,
      duration: dur,
      fala: seg.fala || '',
      legenda: seg.legenda || '',
      imagem: seg.imagem || reel.carouselTopic || '',
      curiosity_gap: seg.curiosity_gap || '',
    });
    cursor += dur;
  });
  if (reel.cta) {
    out.push({
      kind: 'cta',
      start: Math.max(cursor, total - CTA_DUR),
      duration: CTA_DUR,
      fala: reel.cta.fala || '',
      legenda: reel.cta.legenda || '',
      imagem: reel.cta.imagem || reel.carouselTopic || '',
      palavra_chave: reel.cta.palavra_chave || '',
    });
  }
  return out;
}

function buildRoteiroTxt(reel, segments) {
  const lines = [];
  lines.push('=== ROTEIRO REELS ===');
  if (reel.title) lines.push(`Título: ${reel.title}`);
  if (reel.carouselTopic) lines.push(`Tópico: ${reel.carouselTopic}`);
  lines.push(`Duração total: ${reel.duration || 30}s`);
  lines.push('');

  for (const s of segments) {
    const tag = s.kind === 'hook' ? 'HOOK' : s.kind === 'cta' ? 'CTA' : `BODY ${s.index}`;
    const range = `${s.start}-${s.start + s.duration}s`;
    lines.push(`[${tag} — ${range}]`);
    if (s.tipo) lines.push(`Tipo: ${s.tipo}`);
    if (s.fala) lines.push(`Fala: ${s.fala}`);
    if (s.legenda) lines.push(`Tela: "${s.legenda}"`);
    if (s.curiosity_gap) lines.push(`Gancho: ${s.curiosity_gap}`);
    if (s.palavra_chave) lines.push(`Palavra: ${s.palavra_chave}`);
    lines.push('');
  }

  if (reel.teleprompter) {
    lines.push('=== TELEPROMPTER (texto corrido) ===');
    lines.push(reel.teleprompter);
    lines.push('');
  }

  if (reel.legendaPost) {
    lines.push('=== LEGENDA DO POST ===');
    lines.push(reel.legendaPost);
  }

  return lines.join('\n');
}

router.get('/saved/:id/zip', async (req, res) => {
  const reel = db.getAllReels().find(r => r.id === req.params.id);
  if (!reel) return res.status(404).json({ error: 'Reels não encontrado' });

  const segments = buildSegmentList(reel);
  if (!segments.length) return res.status(400).json({ error: 'Reels sem segmentos' });

  // Resolve imagens em paralelo (uma por segmento). Falhas individuais não derrubam o ZIP.
  const fallback = reel.carouselTopic || reel.title || 'fitness';
  const imageResults = await Promise.all(segments.map(async (s) => {
    if (!s.imagem) return { ok: false, reason: 'sem-query' };
    try {
      const img = await fetchOneImage(s.imagem, fallback);
      if (!img?.url) return { ok: false, reason: 'sem-resultado', query: s.imagem };
      const buf = await downloadImageBuffer(img.url);
      return { ok: true, buffer: buf, url: img.url, alt: img.alt };
    } catch (err) {
      return { ok: false, reason: err.message, query: s.imagem };
    }
  }));

  const slug = safeSlug(reel.title || reel.carouselTopic, 40);
  const filename = `reel-${slug}-${reel.duration || 30}s.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('warning', (err) => { if (err.code !== 'ENOENT') console.warn('[ReelsZip] warn:', err.message); });
  archive.on('error', (err) => { console.error('[ReelsZip] error:', err.message); try { res.end(); } catch {} });
  archive.pipe(res);

  // Monta timings.json
  const timings = {
    title: reel.title || '',
    topic: reel.carouselTopic || '',
    totalDuration: Number(reel.duration) || 30,
    fps: 30,
    segments: segments.map((s, i) => {
      const num = String(i + 1).padStart(2, '0');
      const kindLabel = s.kind === 'hook' ? 'hook' : s.kind === 'cta' ? 'cta' : `body_${s.index}`;
      const imgRes = imageResults[i];
      return {
        order: i + 1,
        kind: s.kind,
        filename: imgRes?.ok ? `imagens/${num}_${kindLabel}.jpg` : null,
        start: s.start,
        duration: s.duration,
        fala: s.fala,
        legenda: s.legenda,
        query: s.imagem,
        ...(s.curiosity_gap ? { curiosity_gap: s.curiosity_gap } : {}),
        ...(s.palavra_chave ? { palavra_chave: s.palavra_chave } : {}),
        ...(imgRes?.ok ? {} : { imageError: imgRes?.reason || 'unknown' }),
      };
    }),
  };

  archive.append(buildRoteiroTxt(reel, segments), { name: 'roteiro.txt' });
  archive.append(JSON.stringify(timings, null, 2), { name: 'timings.json' });

  for (let i = 0; i < segments.length; i++) {
    const r = imageResults[i];
    if (!r.ok) continue;
    const num = String(i + 1).padStart(2, '0');
    const kindLabel = segments[i].kind === 'hook' ? 'hook' : segments[i].kind === 'cta' ? 'cta' : `body_${segments[i].index}`;
    archive.append(r.buffer, { name: `imagens/${num}_${kindLabel}.jpg` });
  }

  await archive.finalize();
});

module.exports = router;
