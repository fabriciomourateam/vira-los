/**
 * dailyContentService.js — Rotina diária automática do Fabricio Moura.
 *
 * Todo dia (cron 09h America/Sao_Paulo) gera 2 CARROSSÉIS de temas DISTINTOS
 * (template fmteam, com o cérebro editorial: voz + anti-ban + ângulos) e, pra
 * cada um, 1 modelo de REEL (com teleprompter pronto). Salva tudo DENTRO do
 * viralos (carousels.json + reels.json + daily_content.json) — sem Notion.
 *
 * Substitui a rotina do fmteam-gerador. Mira o HOMEM 25-40, evita repetir
 * temas das últimas 2 semanas.
 */

const path = require('path');
const db = require('../db/database');
const {
  generateCarousel, takeScreenshotsPixelPerfect, OUTPUT_DIR,
} = require('./carouselService');
const { generateReelsFromCarousel } = require('./reelsGeneratorService');

const HANDLE = 'fabriciomourateam';
const CREATOR = 'Fabricio Moura';
const NICHE = 'Saúde hormonal e performance masculina';

// ── Banco de temas (ângulos comprovados do PERFORMANCE-LOG, por SINTOMA = ban-safe) ──
// O cérebro editorial (fmteamEditorial.js) cuida da voz/anti-ban; aqui é só O QUE falar.
const THEMES = [
  { id: 'testo-baixa', topic: 'Sinais de testosterona baixa no homem', tone: 'investigativo', emotion: 'preocupação' },
  { id: 'energia',     topic: 'Falta de energia que não passa nem dormindo', tone: 'direto', emotion: 'cansaço' },
  { id: 'rotina',      topic: 'Por que você não consegue encaixar treino e dieta na rotina', tone: 'direto', emotion: 'frustração' },
  { id: 'cortisol',    topic: 'Estresse e cortisol travando o seu shape', tone: 'investigativo', emotion: 'frustração' },
  { id: 'falso-magro', topic: 'Falso magro: magro por fora, gordo por dentro', tone: 'provocativo', emotion: 'surpresa' },
  { id: 'plato',       topic: 'Treina pesado e não cresce: o que está travando', tone: 'direto', emotion: 'frustração' },
  { id: 'alcool',      topic: 'Como o álcool sabota seu shape e sua testosterona', tone: 'provocativo', emotion: 'surpresa' },
  { id: 'glp1',        topic: 'Emagrecimento rápido que rouba o seu músculo', tone: 'investigativo', emotion: 'alerta' },
  { id: 'vitd-zinco',  topic: 'Vitamina D, zinco e magnésio baixos derrubam sua testosterona', tone: 'investigativo', emotion: 'curiosidade' },
  { id: 'depois-30',   topic: 'Depois dos 30 o shape fica mais difícil — e por quê', tone: 'direto', emotion: 'preocupação' },
  { id: 'sono',        topic: 'Sono ruim sabotando sua testosterona e seu shape', tone: 'investigativo', emotion: 'preocupação' },
  { id: 'cardio',      topic: 'Cardio em excesso comendo o seu músculo', tone: 'provocativo', emotion: 'contra-intuição' },
];

// Estado em memória (só 1 geração por vez)
const state = { generating: false, startedAt: null, lastError: null, lastFinishedAt: null };

// Temas usados nos últimos N dias (pra não repetir)
function recentThemeIds(days = 14) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const used = new Set();
  for (const b of db.getAllDailyBatches()) {
    if (new Date(b.created_at).getTime() >= cutoff) {
      (b.themes || []).forEach((t) => used.add(t.id));
    }
  }
  return used;
}

// Escolhe 2 temas distintos, evitando os recentes (com fallback se acabarem)
function pickThemes() {
  const recent = recentThemeIds();
  let pool = THEMES.filter((t) => !recent.has(t.id));
  if (pool.length < 2) pool = THEMES.slice(); // todos recentes → libera geral
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 2);
}

async function buildOne(theme) {
  // 1) Carrossel fmteam
  const carouselResult = await generateCarousel({
    topic: theme.topic,
    instructions: 'Mire o HOMEM 25-40. Gancho na capa que para o scroll. Cada slide de conteúdo entrega 1 ponto técnico traduzido.',
    niche: NICHE,
    instagramHandle: HANDLE,
    creatorName: CREATOR,
    numSlides: 9,
    contentTone: theme.tone,
    dominantEmotion: theme.emotion,
    layoutStyle: 'fmteam',
    ctaStyle: 'dark-fullbleed',
  });

  // 2) Screenshots server-side (Playwright). Se indisponível, segue com HTML só.
  let screenshots = [];
  try {
    const outputDir = path.join(OUTPUT_DIR, carouselResult.folderName);
    screenshots = await takeScreenshotsPixelPerfect(carouselResult.html, outputDir);
  } catch (e) {
    console.warn(`[DailyContent] screenshots indisponíveis (${theme.id}):`, e.message);
  }

  // 3) Persiste o carrossel
  const carouselId = `carousel_${Date.now()}_${theme.id}`;
  const carousel = {
    id: carouselId,
    topic: carouselResult.topic,
    folderName: carouselResult.folderName,
    numSlides: carouselResult.numSlides,
    screenshots,
    legenda: carouselResult.legenda,
    layoutStyle: 'fmteam',
    source: 'daily',
    themeId: theme.id,
    archived: false,
  };
  db.saveCarousel(carousel);

  // 4) Modelo de reel a partir do carrossel (mesmo tema) — traz teleprompter pronto
  let reelId = null;
  try {
    const reel = await generateReelsFromCarousel({
      carousel: { id: carouselId, topic: carousel.topic, html: carouselResult.html, legenda: carousel.legenda, numSlides: carousel.numSlides },
      duration: 15,
      niche: NICHE,
      instagramHandle: `@${HANDLE}`,
    });
    reelId = `reel_${Date.now()}_${theme.id}`;
    db.saveReel({
      ...reel,
      id: reelId,
      carouselId,
      carouselTopic: carousel.topic,
      niche: NICHE,
      instagramHandle: `@${HANDLE}`,
      source: 'daily',
      themeId: theme.id,
      archived: false,
    });
  } catch (e) {
    console.warn(`[DailyContent] reel falhou (${theme.id}):`, e.message);
  }

  return { theme, carouselId, reelId, photosUsed: carouselResult.unsplashImagesUsed || 0 };
}

// Gera o batch do dia (2 temas). Resiliente: falha de 1 tema não derruba o outro.
async function generateDailyBatch({ trigger = 'manual' } = {}) {
  if (state.generating) throw new Error('Já existe uma geração em andamento.');
  state.generating = true;
  state.startedAt = new Date().toISOString();
  state.lastError = null;

  const batchId = `daily_${Date.now()}`;
  const date = new Date().toISOString().slice(0, 10);
  const themes = pickThemes();
  const carouselIds = [];
  const reelIds = [];
  let photosUsed = 0;
  const errors = [];

  try {
    for (const theme of themes) {
      try {
        const r = await buildOne(theme);
        if (r.carouselId) carouselIds.push(r.carouselId);
        if (r.reelId) reelIds.push(r.reelId);
        photosUsed += r.photosUsed;
      } catch (e) {
        console.error(`[DailyContent] tema ${theme.id} falhou:`, e.message);
        errors.push(`${theme.id}: ${e.message}`);
      }
    }

    const batch = {
      id: batchId,
      date,
      trigger,
      themes: themes.map((t) => ({ id: t.id, topic: t.topic })),
      carouselIds,
      reelIds,
      photoSource: photosUsed > 0 ? 'pexels' : 'banco/local',
      status: errors.length === 0 ? 'done' : (carouselIds.length ? 'partial' : 'error'),
      errors,
    };
    db.saveDailyBatch(batch);
    state.lastFinishedAt = new Date().toISOString();
    if (errors.length) state.lastError = errors.join(' | ');
    return batch;
  } finally {
    state.generating = false;
  }
}

// Hidrata um batch com os carrosséis e reels completos (pra UI)
function hydrateBatch(batch) {
  const carousels = db.getAllCarousels();
  const reels = db.getAllReels();
  return {
    ...batch,
    carousels: (batch.carouselIds || []).map((id) => carousels.find((c) => c.id === id)).filter(Boolean),
    reels: (batch.reelIds || []).map((id) => reels.find((r) => r.id === id)).filter(Boolean),
  };
}

function getState() {
  return { ...state };
}

module.exports = { generateDailyBatch, hydrateBatch, getState, THEMES };
