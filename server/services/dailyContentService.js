/**
 * dailyContentService.js — Rotina diária automática do Fabricio Moura.
 *
 * Todo dia (cron 09h America/Sao_Paulo) gera 2 CARROSSÉIS de temas DISTINTOS
 * (template fmteam, com o cérebro editorial: voz + anti-ban + ângulos) e, pra
 * cada um, 1 REEL CURTO de ~7s (formato vídeo + frase de tela + "leia a legenda",
 * com o conteúdo completo na legenda). Salva tudo DENTRO do
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
const { generateShortReelFromCarousel } = require('./reelsGeneratorService');

const HANDLE = 'fabriciomourateam';
const CREATOR = 'Fabricio Moura';
const NICHE = 'Saúde hormonal e performance masculina';

// ── Banco de temas (ângulos comprovados do PERFORMANCE-LOG, por SINTOMA = ban-safe) ──
// O cérebro editorial (fmteamEditorial.js) cuida da voz/anti-ban; aqui é só O QUE falar.
// `keywords` = termos pra casar com legendas dos posts reais (ponderação por performance).
const THEMES = [
  { id: 'testo-baixa', topic: 'Sinais de testosterona baixa no homem', tone: 'investigativo', emotion: 'preocupação', keywords: ['testosterona', 'testo', 'libido', 'hormonal', 'hormônio'] },
  { id: 'energia',     topic: 'Falta de energia que não passa nem dormindo', tone: 'direto', emotion: 'cansaço', keywords: ['energia', 'disposição', 'cansaço', 'cansado', 'fadiga'] },
  { id: 'rotina',      topic: 'Por que você não consegue encaixar treino e dieta na rotina', tone: 'direto', emotion: 'frustração', keywords: ['rotina', 'tempo', 'consistência', 'hábito', 'agenda'] },
  { id: 'cortisol',    topic: 'Estresse e cortisol travando o seu shape', tone: 'investigativo', emotion: 'frustração', keywords: ['cortisol', 'estresse', 'estressado', 'ansiedade'] },
  { id: 'falso-magro', topic: 'Falso magro: magro por fora, gordo por dentro', tone: 'provocativo', emotion: 'surpresa', keywords: ['falso magro', 'gordura visceral', 'magro'] },
  { id: 'plato',       topic: 'Treina pesado e não cresce: o que está travando', tone: 'direto', emotion: 'frustração', keywords: ['não cresce', 'platô', 'estagnado', 'hipertrofia', 'massa muscular'] },
  { id: 'alcool',      topic: 'Como o álcool sabota seu shape e sua testosterona', tone: 'provocativo', emotion: 'surpresa', keywords: ['álcool', 'bebida', 'cerveja', 'beber'] },
  { id: 'glp1',        topic: 'Emagrecimento rápido que rouba o seu músculo', tone: 'investigativo', emotion: 'alerta', keywords: ['mounjaro', 'ozempic', 'glp', 'semaglutida', 'tirzepatida', 'emagrecimento rápido'] },
  { id: 'vitd-zinco',  topic: 'Vitamina D, zinco e magnésio baixos derrubam sua testosterona', tone: 'investigativo', emotion: 'curiosidade', keywords: ['vitamina d', 'zinco', 'magnésio', 'suplemento'] },
  { id: 'depois-30',   topic: 'Depois dos 30 o shape fica mais difícil — e por quê', tone: 'direto', emotion: 'preocupação', keywords: ['depois dos 30', 'idade', 'metabolismo', 'envelhec'] },
  { id: 'sono',        topic: 'Sono ruim sabotando sua testosterona e seu shape', tone: 'investigativo', emotion: 'preocupação', keywords: ['sono', 'dormir', 'dorme', 'insônia'] },
  { id: 'cardio',      topic: 'Cardio em excesso comendo o seu músculo', tone: 'provocativo', emotion: 'contra-intuição', keywords: ['cardio', 'corrida', 'aeróbico', 'esteira'] },
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

  // Ponderação por performance real (Analytics): temas cujos posts performaram
  // melhor (saves/shares/follows) têm mais chance. Sem dados = pesos iguais (sorteio puro).
  const scores = scoreThemes();
  const maxScore = Math.max(0, ...pool.map((t) => scores[t.id] || 0));
  const weights = pool.map((t) => 1 + (maxScore > 0 ? (scores[t.id] || 0) / maxScore : 0) * 4);
  return weightedSample(pool, weights, 2);
}

// Score de cada tema a partir dos posts reais do Instagram (Analytics).
// Casa keywords do tema nas legendas; pontua saves/shares/follows acima de likes.
function scoreThemes() {
  const posts = (db.getInstagramPosts && db.getInstagramPosts()) || [];
  const scores = {};
  for (const t of THEMES) {
    const matched = posts.filter((p) => {
      const cap = (p.caption || '').toLowerCase();
      return (t.keywords || []).some((k) => cap.includes(k));
    });
    if (!matched.length) { scores[t.id] = 0; continue; }
    const sum = matched.reduce((s, p) =>
      s + (p.saves || 0) * 4 + (p.shares || 0) * 3 + (p.follows || 0) * 5 + (p.comments || 0) * 2 + (p.likes || 0), 0);
    scores[t.id] = sum / matched.length;
  }
  return scores;
}

// Amostragem ponderada sem reposição (k itens).
function weightedSample(items, weights, k) {
  const pool = items.map((it, i) => ({ it, w: Math.max(weights[i], 0.0001) }));
  const chosen = [];
  while (chosen.length < k && pool.length) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) { r -= pool[idx].w; if (r <= 0) break; }
    idx = Math.min(idx, pool.length - 1);
    chosen.push(pool[idx].it);
    pool.splice(idx, 1);
  }
  return chosen;
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

  // 3b) Auto-agendamento no mLabs (se ligado nas settings e há PNGs). Best-effort:
  //     uma falha aqui NÃO derruba a geração do dia.
  try {
    const cfg = db.getMlabsSettings && db.getMlabsSettings();
    if (cfg && cfg.autoScheduleCarousel && screenshots.length) {
      const mlabs = require('./mlabsService');
      const { v4: uuidv4 } = require('uuid');
      const dates = mlabs.computeDefaultDates();
      const recId = uuidv4();
      db.createMlabsSchedule({
        id: recId, contentType: 'carousel', contentId: carouselId,
        caption: carousel.legenda || '', dates, platforms: cfg.channelSourceIds, status: 'enviando',
      });
      try {
        const r = await mlabs.scheduleContent({
          type: 'IMAGE',
          mediaPaths: screenshots.map((name) => path.join(OUTPUT_DIR, carouselResult.folderName, name)),
          caption: carousel.legenda || '',
          dates,
        });
        db.updateMlabsSchedule(recId, { status: 'agendado', mlabsResponse: r.scheduleResponse || null });
        console.log(`[DailyContent] carrossel ${theme.id} agendado no mLabs (${dates.length} datas).`);
      } catch (e) {
        db.updateMlabsSchedule(recId, { status: 'erro', error: e.message });
        console.warn(`[DailyContent] auto-agendar mLabs falhou (${theme.id}):`, e.message);
      }
    }
  } catch (e) {
    console.warn('[DailyContent] auto-agendamento mLabs indisponível:', e.message);
  }

  // 4) Reel curto de ~7s a partir do carrossel (mesmo tema): vídeo + frase de tela
  //    + "leia a legenda", com o conteúdo completo na legenda.
  let reelId = null;
  try {
    const reel = await generateShortReelFromCarousel({
      carousel: { id: carouselId, topic: carousel.topic, html: carouselResult.html, legenda: carousel.legenda, numSlides: carousel.numSlides },
      duration: 7,
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

  const date = new Date().toISOString().slice(0, 10);
  // Cron é idempotente por dia: se já existe batch de hoje (não-erro), não regera.
  // O botão "Gerar agora" (manual) ignora essa trava e sempre gera.
  if (trigger !== 'manual') {
    // só pula se o batch de hoje REALMENTE tem conteúdo — um batch vazio não bloqueia o dia.
    const already = db.getAllDailyBatches().some(
      (b) => b.date === date && b.status !== 'error' && ((b.carouselIds || []).length || (b.reelIds || []).length)
    );
    if (already) { console.log('[DailyContent] batch de hoje já existe com conteúdo — cron ignorado.'); return null; }
  }

  state.generating = true;
  state.startedAt = new Date().toISOString();
  state.lastError = null;

  const batchId = `daily_${Date.now()}`;
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
