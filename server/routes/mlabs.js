/**
 * routes/mlabs.js — endpoints de agendamento no mLabs (via Browserless).
 *
 *   GET  /api/mlabs/settings            → config (perfil, canais, auto-postar, datas padrão)
 *   PUT  /api/mlabs/settings            → atualiza config
 *   GET  /api/mlabs/default-dates       → datas/horas padrão pré-preenchidas (editáveis na UI)
 *   GET  /api/mlabs/agendados           → o que JÁ foi mandado pro mLabs (pra você saber)
 *   DELETE /api/mlabs/agendados/:id     → remove um registro local
 *   POST /api/mlabs/schedule            → agenda 1 carrossel/reel em N datas
 *   POST /api/mlabs/upload-reel/:reelId → sobe o .mp4 editado e amarra ao reel
 *   POST /api/mlabs/session             → semeia a sessão (cookies de um login manual)
 *   POST /api/mlabs/calibrate           → 1ª run: aprende perfil/canais/auth do app real
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { OUTPUT_DIR, takeScreenshotsPixelPerfect } = require('../services/carouselService');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../uploads');
const REELS_DIR = path.join(UPLOADS_DIR, 'reels');

// mlabsService usa Playwright/Browserless — carregado preguiçosamente pra não quebrar
// o boot do servidor se o Browserless ainda não estiver configurado.
function mlabs() {
  return require('../services/mlabsService');
}

// Datas padrão (amanhã + offsets) vêm do serviço, compartilhadas com a rotina diária.
const computeDefaultDates = () => mlabs().computeDefaultDates();

// ── Resolve os arquivos de mídia de um conteúdo ─────────────────────────────────
// Carrossel: re-renderiza PIXEL-PERFECT a partir do carrossel.html salvo (a MESMA
// rota do download "PNGs HD"). Assim o mLabs sempre recebe a última versão editada,
// em qualidade pixel-perfect — não um screenshot velho. Cai pro screenshot salvo se
// não houver html.
async function resolveMedia(contentType, contentId) {
  if (contentType === 'carousel') {
    const c = db.getAllCarousels().find((x) => x.id === contentId);
    if (!c) throw new Error('Carrossel não encontrado.');
    const folderPath = path.join(OUTPUT_DIR, c.folderName);
    const htmlPath = path.join(folderPath, 'carrossel.html');

    let shots = c.screenshots || [];
    if (fs.existsSync(htmlPath)) {
      try {
        const html = fs.readFileSync(htmlPath, 'utf8');
        const fresh = await takeScreenshotsPixelPerfect(html, folderPath); // sobrescreve slide_NN.png
        if (fresh && fresh.length) shots = fresh;
      } catch (e) {
        console.warn('[mLabs] render pixel-perfect falhou, usando screenshots salvos:', e.message);
      }
    }
    if (!shots.length) throw new Error('Esse carrossel não tem PNGs nem HTML pra renderizar.');
    const paths = shots.map((name) => path.join(folderPath, name));
    for (const p of paths) if (!fs.existsSync(p)) throw new Error(`Arquivo do slide não existe: ${path.basename(p)}`);
    return { type: 'IMAGE', mediaPaths: paths, caption: c.legenda || '', content: c };
  }
  if (contentType === 'reel') {
    const r = db.getReel ? db.getReel(contentId) : db.getAllReels().find((x) => x.id === contentId);
    if (!r) throw new Error('Reel não encontrado.');
    if (!r.videoPath || !fs.existsSync(r.videoPath)) {
      throw new Error('Esse reel não tem vídeo editado. Suba o .mp4 (POST /api/mlabs/upload-reel/:reelId) antes de agendar.');
    }
    const caption = r.legendaPost || r.legenda || r.caption || '';
    // Título do YouTube Shorts: usa o title do reel, ou a 1ª frase da legenda.
    const youtubeTitle = (r.title || caption.split('\n')[0] || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    return { type: 'VIDEO', mediaPaths: [r.videoPath], caption, youtubeTitle, content: r };
  }
  throw new Error('contentType inválido (use "carousel" ou "reel").');
}

// ── Settings ────────────────────────────────────────────────────────────────────
router.get('/settings', (_req, res) => res.json(db.getMlabsSettings()));

router.put('/settings', (req, res) => {
  try {
    const allowed = ['profileId', 'channelSourceIds', 'channelSourceIdsReel', 'youtubeShortsChannelId', 'ownerId', 'autoScheduleCarousel', 'defaultTime', 'dateOffsetsMonths'];
    const patch = {};
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
    res.json(db.setMlabsSettings(patch));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/default-dates', (_req, res) => res.json({ dates: computeDefaultDates() }));

// ── Agendados (registro local do que mandamos) ──────────────────────────────────
router.get('/agendados', (_req, res) => res.json(db.getAllMlabsSchedules()));
router.delete('/agendados/:id', (req, res) => {
  db.deleteMlabsSchedule(req.params.id);
  res.json({ ok: true });
});

// ── Upload do .mp4 editado do reel ──────────────────────────────────────────────
const reelStorage = multer.diskStorage({
  destination: (_req, _file, cb) => { fs.mkdirSync(REELS_DIR, { recursive: true }); cb(null, REELS_DIR); },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '.mp4') || '.mp4';
    cb(null, `${req.params.reelId}_${Date.now()}${ext}`);
  },
});
const uploadReel = multer({
  storage: reelStorage,
  limits: { fileSize: 300 * 1024 * 1024 }, // 300MB
  fileFilter: (_req, file, cb) => cb(null, /video\//.test(file.mimetype) || /\.(mp4|mov|m4v)$/i.test(file.originalname)),
});

router.post('/upload-reel/:reelId', uploadReel.single('video'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie o arquivo de vídeo no campo "video".' });
    const reelId = req.params.reelId;
    const r = db.getReel ? db.getReel(reelId) : db.getAllReels().find((x) => x.id === reelId);
    if (!r) { fs.unlinkSync(req.file.path); return res.status(404).json({ error: 'Reel não encontrado.' }); }
    db.updateReel(reelId, { videoPath: req.file.path, videoFile: path.basename(req.file.path) });
    res.json({ ok: true, videoFile: path.basename(req.file.path) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Agendar (carrossel ou reel) em N datas ──────────────────────────────────────
router.post('/schedule', async (req, res) => {
  const { contentType, contentId } = req.body;
  let { dates, caption, platforms } = req.body;
  const recordId = uuidv4();
  try {
    if (!contentType || !contentId) return res.status(400).json({ error: 'contentType e contentId obrigatórios.' });
    const media = await resolveMedia(contentType, contentId);
    if (!dates || !dates.length) dates = computeDefaultDates();
    if (!caption) caption = media.caption;

    // Registra como "enviando" antes de chamar o mLabs (assim você vê mesmo se travar).
    db.createMlabsSchedule({
      id: recordId, contentType, contentId, caption, dates,
      platforms: platforms || db.getMlabsSettings().channelSourceIds, status: 'enviando',
    });

    const result = await mlabs().scheduleContent({
      type: media.type,
      mediaPaths: media.mediaPaths,
      caption,
      dates,
      channelSourceIds: platforms || undefined,
      youtubeTitle: media.youtubeTitle,
    });

    db.updateMlabsSchedule(recordId, { status: 'agendado', mlabsResponse: result.scheduleResponse || null });
    res.json({ ok: true, id: recordId, dates: result.dates, mlabsStatus: result.mlabsStatus });
  } catch (e) {
    db.updateMlabsSchedule(recordId, { status: 'erro', error: e.message });
    res.status(500).json({ error: e.message, id: recordId });
  }
});

// ── Semear sessão (cookies de login manual) ─────────────────────────────────────
// Aceita 3 formatos:
//   • storageState do Playwright  { cookies:[...], origins:[...] }
//   • { storageState: {...} }
//   • array cru da extensão Cookie-Editor  [ {name,value,domain,expirationDate,...}, ... ]
// Normaliza pro formato do Playwright (sameSite/expires) automaticamente.
function normalizeSameSite(v) {
  const s = String(v || '').toLowerCase();
  if (s === 'no_restriction' || s === 'none') return 'None';
  if (s === 'strict') return 'Strict';
  return 'Lax'; // lax / unspecified / vazio
}
function normalizeCookies(arr) {
  return arr
    .filter((c) => c && c.name && c.domain)
    .map((c) => ({
      name: c.name,
      value: c.value || '',
      domain: c.domain,
      path: c.path || '/',
      expires: typeof c.expires === 'number' ? c.expires
        : typeof c.expirationDate === 'number' ? Math.round(c.expirationDate)
        : -1,
      httpOnly: !!c.httpOnly,
      secure: !!c.secure,
      sameSite: normalizeSameSite(c.sameSite),
    }));
}
router.post('/session', (req, res) => {
  try {
    const b = req.body;
    let cookies, origins = [];
    if (Array.isArray(b)) {
      cookies = normalizeCookies(b);                       // Cookie-Editor
    } else if (b && Array.isArray(b.cookies)) {
      cookies = normalizeCookies(b.cookies); origins = b.origins || []; // Playwright
    } else if (b && b.storageState && Array.isArray(b.storageState.cookies)) {
      cookies = normalizeCookies(b.storageState.cookies); origins = b.storageState.origins || [];
    }
    if (!cookies || !cookies.length) {
      return res.status(400).json({ error: 'Envie os cookies (array do Cookie-Editor ou storageState do Playwright).' });
    }
    const mlabsCookies = cookies.filter((c) => /mlabs/i.test(c.domain));
    db.setMlabsSession({ cookies, origins });
    res.json({ ok: true, cookies: cookies.length, mlabsCookies: mlabsCookies.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Calibração (1ª run: aprende perfil/canais/auth) ─────────────────────────────
router.post('/calibrate', async (_req, res) => {
  try {
    const result = await mlabs().calibrate();
    res.json({ ok: true, ...result, settings: db.getMlabsSettings() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
