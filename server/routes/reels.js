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
const { generateReelsFromCarousel } = require('../services/reelsGeneratorService');
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

module.exports = router;
