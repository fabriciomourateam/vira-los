/**
 * storyService.js — Orquestrador dos Stories automáticos (Phase 3).
 *
 * 1x/dia: escolhe o MODO (rotação anti-repeat lendo o histórico) → pega o POST do dia
 * (o carrossel principal do batch diário) → gera a sequência na voz do Fabricio →
 * renderiza os PNGs 9:16 dourados → salva o batch. Idempotente por dia (cron não regera).
 *
 * Entrega: o pack é renderizado, salvo (aba "Stories do dia") E agendado sozinho no
 * mLabs como sequência de story (igual carrossel/reel), quando autoScheduleStory=true.
 * O agendamento aprende o formato de story de um story real na conta (ver mlabsService).
 * Se o agendamento falhar, o pack renderizado NÃO se perde — o erro fica no batch.
 */

const path = require('path');
const db = require('../db/database');
const { OUTPUT_DIR } = require('./carouselService');
const { pickStoryMode, generateStorySequence } = require('./storyRotationService');
const { renderStorySequence } = require('./storyRenderService');
const mlabs = require('./mlabsService');

const HANDLE = 'fabriciomourateam';

// Palavra-chave/benefício do CTA por modo (a IA da DM atende a palavra).
const CTA_BY_MODE = {
  engajamento: { keyword: 'DIAGNÓSTICO', benefit: 'destravar o shape em até 90 dias' },
  oferta:      { keyword: 'PLANO',       benefit: 'destravar o shape em até 90 dias' },
  prova:       { keyword: 'CASO',        benefit: 'destravar o shape em até 90 dias' },
  valor:       { keyword: '',            benefit: '' },
  conexao:     { keyword: '',            benefit: '' },
};

const state = { generating: false, startedAt: null, lastError: null };

// Horário SP (UTC-3 fixo) do story do dia: usa storyDailyTime se ainda for futuro
// (com 10 min de folga), senão agora+15min. Retorna "AAAA-MM-DDTHH:MM" (hora local SP).
function storyScheduleTime() {
  const cfg = (db.getMlabsSettings && db.getMlabsSettings()) || {};
  const p = (n) => String(n).padStart(2, '0');
  const spNow = new Date(Date.now() - 3 * 3600 * 1000); // componentes UTC = relógio de SP
  const [hh, mm] = String(cfg.storyDailyTime || '10:00').split(':').map((n) => parseInt(n, 10));
  const y = spNow.getUTCFullYear(), mo = spNow.getUTCMonth(), da = spNow.getUTCDate();
  const preferMs = Date.UTC(y, mo, da, hh || 10, mm || 0);           // horário preferido, em "UTC-como-SP"
  const nowAsSpMs = Date.UTC(y, mo, da, spNow.getUTCHours(), spNow.getUTCMinutes());
  const chosen = preferMs > nowAsSpMs + 10 * 60000
    ? new Date(preferMs)
    : new Date(nowAsSpMs + 15 * 60000);
  return `${chosen.getUTCFullYear()}-${p(chosen.getUTCMonth() + 1)}-${p(chosen.getUTCDate())}T${p(chosen.getUTCHours())}:${p(chosen.getUTCMinutes())}`;
}

// Fonte do dia: o carrossel PRINCIPAL do batch diário de hoje (o 1º = mira hormonal).
// Fallback: o carrossel não-template mais recente.
function pickSourcePost() {
  const date = new Date().toISOString().slice(0, 10);
  const batches = db.getAllDailyBatches ? db.getAllDailyBatches() : [];
  const carousels = db.getAllCarousels();
  const todayBatch = batches.find((b) => b.date === date && (b.carouselIds || []).length);
  let carousel = null;
  let group = null;
  if (todayBatch) {
    const cid = (todayBatch.carouselIds || [])[0];
    carousel = carousels.find((c) => c.id === cid) || null;
    group = ((todayBatch.themes || [])[0] || {}).group || null;
  }
  // Fallback: prefere o carrossel DIÁRIO (mira no homem), nunca o John Hulk (reescreve
  // reels aleatórios, tema fora da marca). Só cai em "qualquer" como último recurso.
  if (!carousel) {
    const live = carousels.filter((c) => !c.isTemplate && !c.archived);
    carousel = live.find((c) => c.source === 'daily' || c.source === 'daily-theme')
      || live.find((c) => c.source !== 'john-hulk' && c.source !== 'johnhulk' && c.source !== 'john_hulk')
      || live[0] || carousels[0] || null;
  }
  if (!carousel) return null;
  const topic = carousel.topic || '';
  const isHormone = group === 'hormonio' || group === 'caneta'
    || /testosterona|hormon|cortisol|insulin|libido|caneta|glp|trt/i.test(topic);
  return { topic, hook: topic, legenda: carousel.legenda || '', isHormone, sourceId: carousel.id };
}

async function generateDailyStories({ trigger = 'manual' } = {}) {
  if (state.generating) throw new Error('Já existe uma geração de stories em andamento.');
  const date = new Date().toISOString().slice(0, 10);

  // Cron é idempotente: se já há batch de hoje com conteúdo, não regera (botão manual ignora).
  if (trigger !== 'manual') {
    const already = db.getAllStoryBatches().some(
      (b) => b.date === date && b.status !== 'error' && (b.screenshots || []).length,
    );
    if (already) { console.log('[Stories] batch de hoje já existe — cron ignorado.'); return null; }
  }

  state.generating = true;
  state.startedAt = new Date().toISOString();
  state.lastError = null;
  const batchId = `stories_${Date.now()}`;

  try {
    const src = pickSourcePost();
    if (!src) throw new Error('Nenhum post do dia encontrado pra amarrar os stories.');

    const recentModes = db.getRecentStoryModes(7);
    const mode = pickStoryMode(recentModes, recentModes);
    const cta = CTA_BY_MODE[mode] || CTA_BY_MODE.valor;

    const seq = await generateStorySequence({
      mode, topic: src.topic, hook: src.hook, legenda: src.legenda,
      ctaKeyword: cta.keyword || 'DIAGNÓSTICO',
      ctaBenefit: cta.benefit || 'destravar o shape em até 90 dias',
      isHormone: src.isHormone, instagramHandle: HANDLE,
    });

    const folderName = batchId;
    const outDir = path.join(OUTPUT_DIR, folderName);
    const screenshots = await renderStorySequence(seq, outDir, { topic: src.topic, handle: HANDLE, fetchImages: true });

    // Agenda sozinho no mLabs (sequência de story), igual carrossel/reel. Guardado:
    // se falhar, o pack renderizado continua salvo e o erro fica visível no batch.
    const cfg = (db.getMlabsSettings && db.getMlabsSettings()) || {};
    let schedule = null;
    if (cfg.autoScheduleStory !== false && screenshots.length) {
      const when = storyScheduleTime();
      try {
        const mediaPaths = screenshots.map((f) => path.join(outDir, f));
        const r = await mlabs.scheduleStories({ mediaPaths, dates: [when] });
        schedule = { ok: true, when, mlabsStatus: r.mlabsStatus, dates: r.dates };
        console.log(`[Stories] batch ${batchId} agendado no mLabs p/ ${when} (SP).`);
      } catch (e) {
        schedule = { ok: false, when, error: e.message };
        console.error(`[Stories] agendamento no mLabs falhou: ${e.message}`);
      }
    }

    const batch = {
      id: batchId, date, trigger, mode, topic: src.topic, sourceId: src.sourceId,
      folderName, stories: seq.stories, resumo: seq.resumo || '',
      ctaKeyword: cta.keyword || null, screenshots, schedule, status: 'done', errors: [],
    };
    db.saveStoryBatch(batch);
    console.log(`[Stories] batch ${batchId} (${mode}) com ${screenshots.length} stories.`);
    return batch;
  } catch (e) {
    console.error('[Stories] geração falhou:', e.message);
    state.lastError = e.message;
    try { db.saveStoryBatch({ id: batchId, date, trigger, status: 'error', error: e.message, errors: [e.message], screenshots: [] }); } catch (_) {}
    throw e;
  } finally {
    state.generating = false;
  }
}

function getState() { return { ...state }; }

module.exports = { generateDailyStories, getState, pickSourcePost };
