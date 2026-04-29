/**
 * carousel.js — Rotas do Gerador de Carrosseis para Instagram
 *
 * POST /api/carousel/generate          → gera HTML + screenshots + legenda.txt
 * GET  /api/carousel/config            → retorna config salva
 * PUT  /api/carousel/config            → salva config
 * GET  /api/carousel/saved             → lista carrosseis salvos
 * POST /api/carousel/saved             → salva carrossel no histórico
 * DELETE /api/carousel/saved/:id       → exclui carrossel salvo
 * GET  /api/carousel/output/:name      → lista arquivos de um carrossel gerado
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const multer = require('multer');
const { generateCarousel, OUTPUT_DIR, regenerateSlide, buildFmteamCSSTemplate } = require('../services/carouselService');
const db = require('../db/database');

const router = express.Router();
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const UPLOADS_DIR = path.join(__dirname, '../uploads');

// ─── Job store em memória ─────────────────────────────────────────────────────
// Mantém jobs de geração em andamento. Cada job dura no máx 15 min em memória.
// { [jobId]: { status: 'processing'|'done'|'error', step, result?, error? } }
const jobs = new Map();
const JOB_TTL_MS = 15 * 60 * 1000; // 15 min

function createJob() {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  jobs.set(jobId, { status: 'processing', step: 'Iniciando...', startedAt: Date.now() });
  setTimeout(() => jobs.delete(jobId), JOB_TTL_MS);
  return jobId;
}

// Limpeza periódica de jobs expirados (a cada 5 min)
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.startedAt > JOB_TTL_MS) jobs.delete(id);
  }
}, 5 * 60 * 1000);

// ─── Multer: upload de foto de perfil ────────────────────────────────────────

const profilePhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `profile-${Date.now()}${ext}`);
  },
});
const uploadPhoto = multer({
  storage: profilePhotoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Apenas imagens são permitidas'));
  },
});

// ─── Upload foto de perfil ────────────────────────────────────────────────────

router.post('/upload-photo', uploadPhoto.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada' });
  const SERVER_URL = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3001}`;
  const url = `${SERVER_URL}/uploads/${req.file.filename}`;
  res.json({ url });
});

// ─── Gerar carrossel (assíncrono — responde imediatamente com jobId) ──────────

router.post('/generate', (req, res) => {
  const {
    topic, instructions, niche, primaryColor, accentColor, bgColor,
    fontFamily, instagramHandle, creatorName, profilePhotoUrl,
    numSlides, contentTone, dominantEmotion, roteiro, layoutStyle,
    templateHtml,
    titleFontSize, bodyFontSize, bannerFontSize,
    titleFontWeight, bodyFontWeight, titleTextTransform,
    titleFontFamily, bodyFontFamily,
  } = req.body;

  if (!topic || !String(topic).trim()) {
    return res.status(400).json({ error: 'O campo "topic" (tema) é obrigatório' });
  }

  // Cria job e responde IMEDIATAMENTE — sem esperar Anthropic
  const jobId = createJob();
  res.json({ jobId });

  // Callback para atualizar o step visível ao cliente durante o polling
  const setStep = (step) => {
    const job = jobs.get(jobId);
    if (job) jobs.set(jobId, { ...job, step });
  };

  // Processa em background (sem bloquear o HTTP)
  generateCarousel({
    topic, instructions, niche, primaryColor, accentColor, bgColor,
    fontFamily, instagramHandle, creatorName, profilePhotoUrl,
    numSlides, contentTone, dominantEmotion, roteiro, layoutStyle,
    templateHtml,
    titleFontSize, bodyFontSize, bannerFontSize,
    titleFontWeight, bodyFontWeight, titleTextTransform,
    titleFontFamily, bodyFontFamily,
  }, setStep).then(result => {
    jobs.set(jobId, { ...jobs.get(jobId), status: 'done', result, step: 'Concluído!' });
    console.log(`[Job ${jobId}] Concluído.`);
  }).catch(err => {
    const isOverload =
      err?.status === 529 ||
      err?.error?.type === 'overloaded_error' ||
      (err?.message || '').includes('overloaded');
    const message = isOverload
      ? 'A IA está sobrecarregada. Aguarde alguns instantes e tente novamente.'
      : (err.message || 'Erro desconhecido');
    jobs.set(jobId, { ...jobs.get(jobId), status: 'error', error: message });
    console.error(`[Job ${jobId}] Erro:`, message);
  });
});

// ─── Consultar status de job ──────────────────────────────────────────────────

router.get('/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job não encontrado ou expirado' });
  // Não retorna o HTML completo enquanto ainda processando
  if (job.status !== 'done') return res.json({ status: job.status, step: job.step });
  res.json({ status: 'done', result: job.result });
});

// ─── Config persistente ───────────────────────────────────────────────────────

router.get('/config', (req, res) => {
  res.json(db.getCarouselConfig());
});

router.put('/config', (req, res) => {
  db.setCarouselConfig(req.body);
  res.json({ ok: true });
});

// ─── Salvar HTML editado (sem regerar screenshots) ──────────────────────────

router.put('/save-html', (req, res) => {
  const { html, folderName } = req.body;
  if (!html || !folderName) return res.status(400).json({ error: 'html e folderName obrigatórios' });

  const folderPath = path.join(OUTPUT_DIR, folderName);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  const htmlFilePath = path.join(folderPath, 'carrossel.html');
  fs.writeFileSync(htmlFilePath, html, 'utf8');
  res.json({ ok: true });
});

// ─── Salvar HTML editado (screenshots são gerados no cliente via html-to-image) ─

router.post('/screenshots', async (req, res) => {
  const { html, folderName } = req.body;
  if (!html || !folderName) return res.status(400).json({ error: 'html e folderName obrigatórios' });

  const folderPath = path.join(OUTPUT_DIR, folderName);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  const htmlFilePath = path.join(folderPath, 'carrossel.html');
  fs.writeFileSync(htmlFilePath, html, 'utf8');

  // Retorna vazio — cliente gera screenshots via html-to-image e faz upload
  // separado em /save-screenshots.
  res.json({ ok: true, screenshots: [] });
});

// ─── Salvar carrossel editado como modelo ─────────────────────────────────────

router.post('/save-template', async (req, res) => {
  const { html, name, numSlides, legenda, config } = req.body;
  if (!html || !name) return res.status(400).json({ error: 'html e name obrigatórios' });

  const slug = name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').substring(0, 40).replace(/-$/, '');
  const templateFolder = `template-${slug}-${Date.now()}`;
  const folderPath = path.join(OUTPUT_DIR, templateFolder);
  fs.mkdirSync(folderPath, { recursive: true });

  const htmlFilePath = path.join(folderPath, 'carrossel.html');
  fs.writeFileSync(htmlFilePath, html, 'utf8');
  if (legenda) fs.writeFileSync(path.join(folderPath, 'legenda.txt'), legenda, 'utf8');

  // Screenshots vêm do cliente via html-to-image. Registra template sem PNGs;
  // cliente faz PATCH depois com os arquivos gerados.
  const templateId = `t_${Date.now()}`;
  db.saveCarousel({
    id: templateId,
    topic: name,
    folderName: templateFolder,
    numSlides: numSlides || 0,
    screenshots: [],
    legenda: legenda || '',
    config: config || {},
    isTemplate: true,
  });

  res.json({ ok: true, id: templateId, folderName: templateFolder, screenshots: [] });
});

// ─── Carrosseis salvos (histórico + templates) ────────────────────────────────

router.get('/saved', (req, res) => {
  // Auto-popula screenshots a partir dos arquivos em disco quando o DB tem array vazio.
  // Isso corrige carrosseis salvos antes de a geração de screenshots estar funcionando
  // (ou antes de um PATCH ter sido feito com os filenames gerados no cliente).
  const carousels = db.getAllCarousels().map(c => {
    if (!c.screenshots?.length && c.folderName) {
      const folderPath = path.join(OUTPUT_DIR, c.folderName);
      try {
        if (fs.existsSync(folderPath)) {
          const pngs = fs.readdirSync(folderPath)
            .filter(f => /^slide_\d+\.png$/.test(f))
            .sort();
          if (pngs.length) {
            db.updateCarousel(c.id, { screenshots: pngs });
            return { ...c, screenshots: pngs };
          }
        }
      } catch { /* ignora — pasta inacessível */ }
    }
    return c;
  });
  res.json(carousels);
});

router.post('/saved', (req, res) => {
  const { id, topic, folderName, numSlides, screenshots, legenda, config } = req.body;
  if (!id || !topic) return res.status(400).json({ error: 'id e topic obrigatórios' });
  db.saveCarousel({ id, topic, folderName, numSlides, screenshots, legenda, config });
  res.json({ ok: true });
});

router.delete('/saved/:id', (req, res) => {
  db.deleteCarousel(req.params.id);
  res.json({ ok: true });
});

router.patch('/saved/:id', (req, res) => {
  const { screenshots, archived } = req.body;
  const update = {};
  if (screenshots !== undefined) update.screenshots = screenshots;
  if (archived  !== undefined) update.archived  = archived;
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });
  db.updateCarousel(req.params.id, update);
  res.json({ ok: true });
});

// ─── Diagnóstico de variáveis e conectividade ────────────────────────────────

router.get('/check', async (req, res) => {
  const vars = {
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    UNSPLASH_ACCESS_KEY: !!process.env.UNSPLASH_ACCESS_KEY,
    APIFY_API_KEY: !!process.env.APIFY_API_KEY,
  };

  let unsplashOk = false;
  let unsplashError = null;
  if (process.env.UNSPLASH_ACCESS_KEY) {
    try {
      const r = await axios.get('https://api.unsplash.com/search/photos', {
        params: { query: 'technology', per_page: 1, orientation: 'portrait' },
        headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` },
        timeout: 8000,
      });
      unsplashOk = (r.data?.results?.length ?? 0) > 0;
    } catch (err) {
      unsplashError = `${err.response?.status || ''} ${err.response?.data?.errors?.[0] || err.message}`.trim();
    }
  }

  res.json({ vars, unsplash: { ok: unsplashOk, error: unsplashError } });
});

// ─── Proxy de imagens externas (resolve CORS para html-to-image no browser) ───

router.get('/proxy-image', async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url obrigatória' });
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const contentType = response.headers['content-type'] || 'image/jpeg';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Access-Control-Allow-Origin', '*');
    res.send(Buffer.from(response.data));
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar imagem' });
  }
});

// ─── Salvar screenshots gerados no cliente ────────────────────────────────────

router.post('/save-screenshots', (req, res) => {
  const { folderName, screenshots } = req.body; // screenshots: [{slideNum, dataUrl}]
  if (!folderName || !Array.isArray(screenshots)) return res.status(400).json({ error: 'folderName e screenshots obrigatórios' });

  const folderPath = path.join(OUTPUT_DIR, folderName);
  fs.mkdirSync(folderPath, { recursive: true });

  const saved = [];
  for (const { slideNum, dataUrl } of screenshots) {
    try {
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      const num = String(slideNum + 1).padStart(2, '0');
      const filename = `slide_${num}.png`;
      fs.writeFileSync(path.join(folderPath, filename), buffer);
      saved.push(filename);
    } catch (e) {
      console.warn('[SaveScreenshots] Erro no slide', slideNum, e.message);
    }
  }
  res.json({ ok: true, screenshots: saved });
});

// ─── Busca Unsplash inline ────────────────────────────────────────────────────

router.get('/unsplash-search', async (req, res) => {
  const { q, page = '1' } = req.query;
  if (!q) return res.status(400).json({ error: 'q obrigatório' });
  if (!process.env.UNSPLASH_ACCESS_KEY) return res.status(503).json({ error: 'UNSPLASH_ACCESS_KEY não configurada' });
  try {
    const r = await axios.get('https://api.unsplash.com/search/photos', {
      params: { query: q, per_page: 9, page: parseInt(page) || 1, orientation: 'portrait' },
      headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` },
      timeout: 8000,
    });
    res.json({
      results: r.data.results.map(p => ({
        id: p.id,
        url: p.urls.regular,
        thumb: p.urls.thumb,
        alt: p.alt_description || p.description || String(q),
        author: p.user.name,
      })),
      totalPages: r.data.total_pages,
    });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.errors?.[0] || err.message });
  }
});

// ─── Regenerar slide individual ───────────────────────────────────────────────

router.post('/regenerate-slide', async (req, res) => {
  const { slideIndex, numSlides, slideHtml, topic, instructions, niche,
          contentTone, dominantEmotion, instagramHandle, userHint } = req.body;
  if (!slideHtml || !topic) return res.status(400).json({ error: 'slideHtml e topic obrigatórios' });
  try {
    const html = await regenerateSlide({
      slideIndex, numSlides, slideHtml, topic, instructions, niche,
      contentTone, dominantEmotion, instagramHandle, userHint,
    });
    res.json({ slideHtml: html });
  } catch (err) {
    console.error('[Carousel/RegenSlide]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Slides Salvos (biblioteca) ───────────────────────────────────────────────

// ── Re-aplica o CSS fmteam atual + atualiza avatar/nome em HTML já gerado ─────
router.post('/re-apply-fmteam-css', (req, res) => {
  const { html, profilePhotoUrl, creatorName, instagramHandle } = req.body || {};
  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'html obrigatório' });
  }

  let updated = html;

  // 1. Remove <style> antigo e <link> de fontes (Google Fonts)
  updated = updated.replace(/<style[\s\S]*?<\/style>/gi, '');
  updated = updated.replace(/<link[^>]+fonts\.googleapis\.com[^>]*>/gi, '');

  // 2. Injeta CSS fmteam atual com gold #FFC300 fixo
  const fmteamCss = buildFmteamCSSTemplate({ primaryColor: '#FFC300' });
  if (updated.includes('</head>')) {
    updated = updated.replace('</head>', `${fmteamCss}\n</head>`);
  } else {
    updated = `${fmteamCss}\n${updated}`;
  }

  // 3. Atualiza nome do criador (.badge-name e .cta-badge-name) se fornecido
  const handle = (instagramHandle || 'fabriciomourateam').replace('@', '');
  const isFmteamHandle = /fabriciomoura/i.test(handle);
  const newName = creatorName
    || (isFmteamHandle ? 'Fabricio Moura' : null)
    || handle.replace(/team$/i, '').replace(/[._-]/g, ' ').trim()
         .replace(/\b\w/g, c => c.toUpperCase())
    || handle;

  // Helper: regex permissivo que matches <TAG class="...alvo..."> independente de
  // ordem de atributos, espaços e aspas simples/duplas.
  const buildFlexRegex = (tagName, className) => new RegExp(
    `(<${tagName}[^>]*\\bclass\\s*=\\s*["'][^"']*\\b${className}\\b[^"']*["'][^>]*>)([\\s\\S]*?)(</${tagName}>)`,
    'gi'
  );

  // Conta substituições para diagnóstico
  const stats = { name: 0, ctaName: 0, handle: 0, ctaHandle: 0, avatar: 0, ctaAvatar: 0 };

  updated = updated.replace(buildFlexRegex('span', 'badge-name'), (m, open, inner, close) => {
    stats.name++;
    return `${open}${newName}${close}`;
  });
  updated = updated.replace(buildFlexRegex('div', 'cta-badge-name'), (m, open, inner, close) => {
    stats.ctaName++;
    const svgMatch = inner.match(/<svg[\s\S]*?<\/svg>/);
    const svg = svgMatch ? ` ${svgMatch[0]}` : '';
    return `${open}${newName}${svg}${close}`;
  });

  // 4. Atualiza handle
  const handleAt = `@${handle}`;
  updated = updated.replace(buildFlexRegex('div', 'badge-handle'), (m, open, inner, close) => {
    stats.handle++;
    return `${open}${handleAt}${close}`;
  });
  updated = updated.replace(buildFlexRegex('div', 'cta-badge-handle'), (m, open, inner, close) => {
    stats.ctaHandle++;
    return `${open}${handleAt}${close}`;
  });

  // 5. Substitui o avatar (.badge-avatar e .cta-badge-avatar)
  if (profilePhotoUrl && typeof profilePhotoUrl === 'string' && profilePhotoUrl.trim()) {
    const safeUrl = profilePhotoUrl.trim().replace(/"/g, '&quot;');
    const imgTag = `<img src="${safeUrl}" alt="${newName}" style="width:100%;height:100%;object-fit:cover;display:block;">`;
    updated = updated.replace(buildFlexRegex('div', 'badge-avatar'), (m, open, inner, close) => {
      stats.avatar++;
      return `${open}${imgTag}${close}`;
    });
    updated = updated.replace(buildFlexRegex('div', 'cta-badge-avatar'), (m, open, inner, close) => {
      stats.ctaAvatar++;
      return `${open}${imgTag}${close}`;
    });
  }

  console.log('[re-apply-fmteam-css]', stats, 'photoLen=', (profilePhotoUrl || '').length);
  res.json({ html: updated, stats });
});

router.get('/saved-slides', (req, res) => {
  res.json(db.getSavedSlides());
});

router.post('/saved-slides', (req, res) => {
  const { html, label } = req.body;
  if (!html) return res.status(400).json({ error: 'html obrigatório' });
  const slide = {
    id: `slide-${Date.now()}`,
    label: (label || 'Slide salvo').substring(0, 80),
    html,
  };
  db.saveSlide(slide);
  res.json(slide);
});

router.delete('/saved-slides/:id', (req, res) => {
  db.deleteSavedSlide(req.params.id);
  res.json({ ok: true });
});

// ─── Listar arquivos de um carrossel ──────────────────────────────────────────

router.get('/output/:name', (req, res) => {
  const folderPath = path.join(OUTPUT_DIR, req.params.name);
  if (!fs.existsSync(folderPath)) {
    return res.status(404).json({ error: 'Carrossel não encontrado' });
  }
  const files = fs.readdirSync(folderPath);
  res.json({ files });
});

module.exports = router;
