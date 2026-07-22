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
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const axios = require('axios');
const archiver = require('archiver');
const { generateReelsFromCarousel, generateShortReelFromCarousel } = require('../services/reelsGeneratorService');
const { fetchOneImage } = require('../services/carouselService');
const { renderReelVideo, scheduleReelNow } = require('../services/reelPipelineService');
const db = require('../db/database');

const router = express.Router();

// ─── Banco de vídeos crus (clipes de treino sem texto) ────────────────────────
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../uploads');
const RAW_DIR = path.join(UPLOADS_DIR, 'reels', 'raw');

const rawStorage = multer.diskStorage({
  destination: (_req, _file, cb) => { fs.mkdirSync(RAW_DIR, { recursive: true }); cb(null, RAW_DIR); },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '.mp4') || '.mp4';
    cb(null, `raw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const uploadRaw = multer({
  storage: rawStorage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (_req, file, cb) => cb(null, /video\//.test(file.mimetype) || /\.(mp4|mov|m4v|webm)$/i.test(file.originalname)),
});

// Sobe 1..N clipes crus pro banco (campo "videos"). A rotina diária pesca
// automaticamente o mais antigo livre; a UI também lista/exclui por aqui.
router.post('/raw-videos', uploadRaw.array('videos', 20), (req, res) => {
  try {
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'Envie ao menos um arquivo no campo "videos".' });
    const saved = req.files.map((f) => {
      const id = `raw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const rec = { id, path: f.path, file: path.basename(f.path), originalName: f.originalname, size: f.size };
      db.saveRawVideo(rec);
      return { id, file: rec.file, originalName: rec.originalName, size: rec.size };
    });
    res.json({ ok: true, count: saved.length, videos: saved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/raw-videos', (_req, res) => {
  // Não devolve o path absoluto do disco; só o que a UI precisa.
  res.json(db.getAllRawVideos().map((v) => ({
    id: v.id, file: v.file, originalName: v.originalName, size: v.size,
    used: !!v.used, usedByReelId: v.usedByReelId || null, created_at: v.created_at,
  })));
});

router.delete('/raw-videos/:id', (req, res) => {
  const v = db.getRawVideo(req.params.id);
  if (!v) return res.status(404).json({ error: 'Clipe não encontrado.' });
  try { if (v.path && fs.existsSync(v.path)) fs.unlinkSync(v.path); } catch { /* ignora */ }
  db.deleteRawVideo(req.params.id);
  res.json({ ok: true });
});

// Renderiza o reel: queima a fraseTela no clipe cru (auto-pick ou rawVideoId) e
// grava em videoPath. Se autoScheduleReel estiver ligado, já agenda no mLabs.
router.post('/saved/:id/render', async (req, res) => {
  try {
    const { rawVideoId, autoSchedule } = req.body || {};
    const out = await renderReelVideo(req.params.id, { rawVideoId: rawVideoId || null });

    const cfg = db.getMlabsSettings();
    let scheduled = null;
    const wantsSchedule = autoSchedule !== undefined ? !!autoSchedule : !!cfg.autoScheduleReel;
    if (wantsSchedule) {
      try {
        scheduled = await scheduleReelNow(req.params.id);
      } catch (e) {
        return res.json({ ok: true, videoFile: path.basename(out.outPath), rawVideoId: out.rawVideoId, scheduleError: e.message });
      }
    }
    res.json({ ok: true, videoFile: path.basename(out.outPath), rawVideoId: out.rawVideoId, scheduled });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Lote: cria + renderiza + agenda vários reels de uma vez ───────────────────
// Body: { rows: [{ texto, legenda, data?, rawVideoId? }], schedule?: bool }
// Cada linha vira um reel com o SEU texto na tela (não o da IA). Clipe é
// opcional: vazio → auto-pick do banco. Data opcional: vazia → próximo slot livre.
// Responde {jobId} na hora; o progresso vem por GET /api/reels/jobs/:id.
router.post('/bulk', (req, res) => {
  const { rows, schedule = true } = req.body || {};
  if (!Array.isArray(rows) || !rows.length) {
    return res.status(400).json({ error: 'Envie rows[] (linhas da planilha).' });
  }
  const clean = rows
    .map((r, i) => ({
      texto: String(r.texto || '').trim(),
      legenda: String(r.legenda || '').trim(),
      data: r.data || null,
      rawVideoId: r.rawVideoId || null,
      row: i + 1,
    }))
    .filter((r) => r.texto);
  if (!clean.length) return res.status(400).json({ error: 'Nenhuma linha com "texto na tela" preenchido.' });

  const jobId = createJob();
  res.json({ jobId, total: clean.length });

  (async () => {
    const results = [];
    for (let k = 0; k < clean.length; k++) {
      const item = clean[k];
      setJobStep(jobId, `Renderizando ${k + 1}/${clean.length}${schedule ? ' e agendando' : ''}...`);
      const reelId = `reel_bulk_${Date.now()}_${k}`;
      try {
        db.saveReel({
          id: reelId,
          fraseTela: item.texto,
          fraseTelaTiming: '0-4s',
          ctaTela: '👇 LEIA A LEGENDA',
          ctaTelaTiming: '4-5s',
          legendaPost: item.legenda,
          title: item.texto.slice(0, 60),
          source: 'bulk',
          archived: false,
        });
        await renderReelVideo(reelId, { rawVideoId: item.rawVideoId });
        let scheduled = null;
        if (schedule) {
          scheduled = await scheduleReelNow(reelId, {
            dates: item.data ? [item.data] : null,
            caption: item.legenda || null,
          });
        }
        results.push({ row: item.row, ok: true, reelId, dates: scheduled ? scheduled.dates : null });
      } catch (e) {
        results.push({ row: item.row, ok: false, error: e.message });
        console.warn(`[ReelsBulk] linha ${item.row} falhou:`, e.message);
      }
    }
    finishJob(jobId, { results, ok: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length });
  })();
});

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

function setJobStep(jobId, step) {
  const j = jobs.get(jobId);
  if (j) jobs.set(jobId, { ...j, step });
}
function finishJob(jobId, result) {
  const j = jobs.get(jobId);
  if (j) jobs.set(jobId, { ...j, status: 'done', step: 'Concluído!', result });
}

// ─── Gerar reels (assíncrono) ────────────────────────────────────────────────

router.post('/generate', (req, res) => {
  const { carouselId, duration = 30, niche, instagramHandle, format } = req.body || {};
  const isShort = format === 'short';

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

  // Reel curto (7s, vídeo + legenda) tem piso próprio; o roteiro falado mantém o mínimo de 15s.
  const dur = isShort
    ? Math.min(15, Math.max(5, Number(duration) || 7))
    : Math.min(120, Math.max(15, Number(duration) || 30));
  const config = db.getCarouselConfig() || {};
  const finalNiche = niche || carousel.config?.niche || config.niche || 'fitness';
  const finalHandle = instagramHandle || carousel.config?.instagramHandle || config.instagramHandle || '';

  const jobId = createJob();
  res.json({ jobId });

  const setStep = (step) => {
    const job = jobs.get(jobId);
    if (job) jobs.set(jobId, { ...job, step });
  };

  setStep(isShort ? `Gerando reel curto de ${dur}s (vídeo + legenda)...` : `Gerando roteiro de ${dur}s com IA...`);

  const generation = isShort
    ? generateShortReelFromCarousel({ carousel, duration: dur, niche: finalNiche, instagramHandle: finalHandle })
    : generateReelsFromCarousel({ carousel, duration: dur, niche: finalNiche, instagramHandle: finalHandle });

  generation
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
  const allowed = ['title', 'archived', 'done', 'teleprompter', 'hook', 'body', 'cta', 'legendaPost', 'fraseTela', 'fraseTelaTiming', 'ctaTela', 'ctaTelaTiming'];
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

// ─── Sessões de gravação (fila de reels pra gravar em batch) ──────────────────
//
// Cada sessão = { id, name, reelIds: [], recordedReelIds: [], created_at }
// recordedReelIds rastreia quais reels da sessão já foram marcados como gravados.

router.get('/sessions', (req, res) => {
  res.json(db.getAllReelsSessions());
});

router.post('/sessions', (req, res) => {
  const { name, reelIds } = req.body || {};
  if (!Array.isArray(reelIds) || reelIds.length === 0) {
    return res.status(400).json({ error: 'reelIds deve ser um array não vazio' });
  }
  const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const session = {
    id,
    name: (typeof name === 'string' && name.trim()) ? name.trim() : `Sessão ${new Date().toLocaleDateString('pt-BR')}`,
    reelIds,
    recordedReelIds: [],
  };
  db.saveReelsSession(session);
  res.json(session);
});

router.get('/sessions/:id', (req, res) => {
  const session = db.getReelsSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Sessão não encontrada' });
  // Hidrata reels — front recebe a lista pronta sem precisar de N requests
  const allReels = db.getAllReels();
  const reelsById = new Map(allReels.map(r => [r.id, r]));
  const reels = session.reelIds
    .map(id => reelsById.get(id))
    .filter(Boolean); // descarta reels que foram deletados
  res.json({ ...session, reels });
});

router.patch('/sessions/:id', (req, res) => {
  const allowed = ['name', 'reelIds', 'recordedReelIds', 'archived'];
  const update = {};
  for (const k of allowed) if (req.body?.[k] !== undefined) update[k] = req.body[k];
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Nenhum campo válido' });
  db.updateReelsSession(req.params.id, update);
  res.json({ ok: true });
});

router.delete('/sessions/:id', (req, res) => {
  db.deleteReelsSession(req.params.id);
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
