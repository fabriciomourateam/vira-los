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
    const allowed = ['profileId', 'channelSourceIds', 'channelSourceIdsReel', 'youtubeShortsChannelId', 'ownerId', 'autoScheduleCarousel', 'autoScheduleReel', 'autoRenderReel', 'defaultTime', 'dateOffsetsMonths', 'reelPostsPerDay', 'reelScheduleDays', 'reelScheduleTimes', 'reelDailyTimes', 'reelFontSize', 'reelFontFile', 'reelCtaColor', 'reelCtaAtMiddle', 'reelTextY', 'reelCtaGap', 'reelMusicOn', 'reelMusicVolume', 'reelTextStyle', 'reelBoxColor', 'reelBoxTextColor', 'reelBackground', 'reelMinGapMinutes'];
    const patch = {};
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
    res.json(db.setMlabsSettings(patch));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/default-dates', (_req, res) => res.json({ dates: computeDefaultDates() }));
// Próximos slots livres de REEL (esquema N/dia por X dias). Cada reel = 1 slot.
router.get('/reel-slots', (req, res) => {
  const count = Math.max(1, Math.min(50, parseInt(req.query.count, 10) || 1));
  res.json({ dates: mlabs().computeNextReelSlots(count) });
});

// ── Agendados (registro local do que mandamos) ──────────────────────────────────
router.get('/agendados', (_req, res) => res.json(db.getAllMlabsSchedules()));

// ── Calendário (uma entrada por data agendada, pra planejar o conteúdo) ─────────
// Junta carrosséis + reels do banco. Cada agendamento pode ter várias datas
// (repost evergreen) → vira uma entrada por data. Classifica o reel em
// "pronto" (subido já editado) x "editado" (texto queimado com ffmpeg).
router.get('/calendar', (_req, res) => {
  const out = [];
  for (const s of db.getAllMlabsSchedules()) {
    if (s.status === 'erro' || s.status === 'cancelado') continue; // não entrou de fato no mLabs
    let kind = 'carrossel';
    let typeLabel = 'Carrossel';
    let origin = null; // origem do reel: 'queue' (meu roteiro) | 'ia' | 'ready' (pronto subido)
    if (s.contentType === 'reel') {
      const r = db.getReel(s.contentId);
      const isReady = !!(r && (r.source === 'ready' || r.readyVideoId));
      kind = isReady ? 'reel-pronto' : 'reel-ffmpeg';
      typeLabel = isReady ? 'Reel pronto' : 'Reel editado';
      origin = isReady ? 'ready' : (r && r.source === 'queue' ? 'queue' : 'ia');
    }
    for (const d of (s.dates || [])) {
      const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
      if (!m) continue;
      out.push({
        scheduleId: s.id,
        date: `${m[1]}-${m[2]}-${m[3]}`,   // já em horário de Brasília
        time: `${m[4]}:${m[5]}`,
        kind, typeLabel, origin,
        contentType: s.contentType,
        caption: String(s.caption || '').slice(0, 200),
        status: s.status || 'agendado',
        platformsCount: Array.isArray(s.platforms) ? s.platforms.length : 0,
      });
    }
  }
  out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  res.json(out);
});
router.delete('/agendados/:id', (req, res) => {
  db.deleteMlabsSchedule(req.params.id);
  res.json({ ok: true });
});

// ── Agendamentos DO mLabs (busca na API deles, cacheia localmente) ──────────
// Retorna o cache por padrão (rápido); com ?refresh=true abre o browser e busca
// de verdade (lento, ~30s). O cache é usado pelo computeNextReelSlots pra garantir
// o gap de 1h entre posts.
router.get('/mlabs-schedules', async (req, res) => {
  const refresh = req.query.refresh === 'true';
  const pad = (n) => String(n).padStart(2, '0');

  // Sem refresh: retorna cache (rápido) ou vazio. NÃO abre browser automaticamente.
  if (!refresh) {
    try {
      const cached = db.getDoc('mlabs_external_schedules');
      if (cached && cached.items) {
        return res.json({ items: cached.items, cached: true, fetchedAt: cached.fetchedAt });
      }
    } catch {}
    return res.json({ items: [], cached: false, fetchedAt: null, needsSync: true });
  }

  // Com refresh=true: abre browser e busca de verdade (~30s).
  try {
    const now = new Date();
    const startStr = req.query.start || `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const end = new Date(now);
    end.setDate(end.getDate() + 150);
    const endStr = req.query.end || `${pad(end.getDate())}/${pad(end.getMonth() + 1)}/${end.getFullYear()}`;

    const items = await mlabs().fetchMlabsSchedules(startStr, endStr);
    res.json({ items, cached: false, fetchedAt: new Date().toISOString() });
  } catch (e) {
    try {
      const cached = db.getDoc('mlabs_external_schedules');
      if (cached && cached.items) {
        return res.json({ items: cached.items, cached: true, fetchedAt: cached.fetchedAt, error: e.message });
      }
    } catch {}
    res.status(500).json({ error: e.message });
  }
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
    // Reel usa o esquema flexível "N/dia por X dias" (1 slot livre por reel);
    // carrossel mantém as datas evergreen (amanhã + a cada 3 meses).
    if (!dates || !dates.length) {
      dates = contentType === 'reel' ? mlabs().computeNextReelSlots(1) : computeDefaultDates();
    }
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
