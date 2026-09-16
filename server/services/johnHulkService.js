/**
 * johnHulkService.js — Job DIÁRIO SEPARADO: pega 1 Reel de referência de perfis
 * de bodybuilding (default @john.hulk_), transcreve, deriva o tema/gancho,
 * REESCREVE na voz FMTeam (nunca copia literalmente, nunca cita o autor
 * original) e gera um carrossel FMTeam com imagens de bodybuilder por página.
 * Salva SEMPRE como RASCUNHO (archived:false, source:'john-hulk') — sem
 * auto-agendar no mLabs, a menos que `autoScheduleJohnHulk` esteja ligado
 * explicitamente nas settings.
 *
 * Espelha os padrões de `dailyContentService.js` (withTimeout, estado em
 * memória, placeholder 'generating' salvo já no início, batch sempre salvo
 * mesmo em falha) mas é um job TOTALMENTE separado — não toca na rotina do
 * `daily-content`.
 *
 * IMPORTANTE (decisão do dono): este fluxo NÃO injeta o bloco anti-ban extra
 * (INSTRUCTION_HORMONIO/SUBSTANCE_INTEL) do dailyContentService — o template
 * `fmteam` compartilhado (FMTEAM_EDITORIAL embutido) continua igual.
 *
 * Garantia de propriedade: os frames/thumbnail do reel de referência são
 * usados SÓ para análise (texto) — NUNCA como imagem de saída. Toda imagem do
 * carrossel publicado é bodybuilder de stock/IA (via `imageSubject` no
 * carouselService), nunca um frame do reel original.
 */

const path = require('path');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db/database');
const {
  generateCarousel, takeScreenshotsPixelPerfect, OUTPUT_DIR,
} = require('./carouselService');
const { extractReelContent, runApifyActor } = require('./reelsAnalyzerService');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Config ───────────────────────────────────────────────────────────────────
const HANDLES = (process.env.JOHN_HULK_HANDLES || process.env.JOHN_HULK_HANDLE || 'john.hulk_')
  .split(',').map((s) => s.trim()).filter(Boolean);
const OFFSET_DAYS = Number(process.env.JOHN_HULK_OFFSET_DAYS) || 7;

const HANDLE = 'fabriciomourateam';
const CREATOR = 'Fabricio Moura';
const NICHE = 'Bodybuilding, composição corporal e performance para quem treina sério';
// Viés das imagens (queries + reserva IA) — NUNCA usa frames do reel original.
const IMAGE_SUBJECT = 'muscular bodybuilder physique';

// Estado em memória (só 1 geração por vez, mesmo padrão do dailyContentService)
const state = { generating: false, startedAt: null, lastError: null, lastFinishedAt: null };

// Teto por etapa pesada — se travar (Apify/Whisper/Anthropic/Playwright presos),
// não deixa a geração inteira pendurar sem salvar nada.
const JOHN_HULK_STEP_TIMEOUT_MS = 6 * 60 * 1000;
function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label}: timeout ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Registra status/tempo de cada etapa no batch (observabilidade — item 11 do plano).
async function runStep(steps, id, label, fn) {
  const started = Date.now();
  const step = { id, label, status: 'running', ms: 0 };
  steps.push(step);
  try {
    const result = await fn();
    step.status = 'done';
    step.ms = Date.now() - started;
    return result;
  } catch (e) {
    step.status = 'error';
    step.ms = Date.now() - started;
    step.error = e.message;
    throw e;
  }
}

// Rotaciona o handle-fonte por dia-do-ano (multi-perfil — item 4 do plano).
function pickHandleForToday() {
  if (!HANDLES.length) return 'john.hulk_';
  const start = new Date(new Date().getFullYear(), 0, 0).getTime();
  const dayOfYear = Math.floor((Date.now() - start) / (24 * 60 * 60 * 1000));
  return HANDLES[dayOfYear % HANDLES.length];
}

// ── Passo 1: lista os reels (vídeos) do perfil via Apify, com retry/backoff ────
// (o instagram-scraper é flaky — item 12 do plano: 2s/4s/8s, até 3 tentativas)
async function listProfileReels(handle) {
  const input = {
    directUrls: [`https://www.instagram.com/${handle}/`],
    resultsType: 'posts',
    resultsLimit: 30,
    addParentData: false,
  };
  const delays = [2000, 4000, 8000];
  let lastErr = null;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const items = await runApifyActor('apify/instagram-scraper', input, 120);
      const videos = (items || []).filter((it) => it && (it.type === 'Video' || it.videoUrl));
      const normalized = videos
        .map((it) => ({
          shortCode: it.shortCode || it.id || '',
          url: it.url || (it.shortCode ? `https://www.instagram.com/reel/${it.shortCode}/` : ''),
          timestampMs: it.timestamp ? new Date(it.timestamp).getTime() : 0,
          caption: it.caption || it.text || '',
          videoUrl: it.videoUrl || it.videoVersions?.[0]?.url || null,
          views: it.videoViewCount || it.videoPlayCount || 0,
          likes: it.likesCount || 0,
        }))
        .filter((r) => r.shortCode && r.url);
      normalized.sort((a, b) => b.timestampMs - a.timestampMs);
      return normalized;
    } catch (e) {
      lastErr = e;
      if (attempt < delays.length) {
        console.warn(`[JohnHulk] listProfileReels(@${handle}) falhou (tentativa ${attempt + 1}/${delays.length + 1}): ${e.message} — retry em ${delays[attempt] / 1000}s`);
        await sleep(delays[attempt]);
      }
    }
  }
  throw lastErr || new Error(`listProfileReels(@${handle}) falhou sem detalhe.`);
}

// ── Passo 2: rankeia candidatos (seleção híbrida: corte de dias + performance) ─
// Entre os NÃO usados e com data ≥ OFFSET_DAYS atrás, ordena por views (maior
// primeiro). Se nenhum passa no corte de dias, cai pro mais novo não-usado
// (fallback progressivo). Devolve uma LISTA (não só o campeão) pra o guard de
// qualidade poder tentar o próximo candidato se o 1º não tiver texto usável.
function rankReelCandidates(reels, seen) {
  const seenSet = new Set(seen || []);
  const unused = (reels || []).filter((r) => r.shortCode && !seenSet.has(r.shortCode));
  if (!unused.length) return [];
  const cutoff = Date.now() - OFFSET_DAYS * 24 * 60 * 60 * 1000;
  const aged = unused.filter((r) => r.timestampMs && r.timestampMs <= cutoff);
  if (aged.length) return aged.slice().sort((a, b) => (b.views || 0) - (a.views || 0));
  // Nenhum passou no corte de dias → mais novo não-usado (unused já vem ordenado
  // desc por timestamp de listProfileReels, mas reordena aqui por segurança).
  return unused.slice().sort((a, b) => b.timestampMs - a.timestampMs);
}

// Mantido pelo nome pedido no plano — devolve só o campeão do ranking.
function pickReel(reels, seen) {
  const ranked = rankReelCandidates(reels, seen);
  return ranked[0] || null;
}

// ── Passo 3: deriva tema/tom/emoção via Claude Haiku ───────────────────────────
async function deriveTopic({ transcription, caption, visualAnalysis } = {}) {
  const context = [
    transcription ? `TRANSCRIÇÃO DO ÁUDIO:\n${transcription.slice(0, 2000)}` : '',
    visualAnalysis ? `ANÁLISE VISUAL:\n${String(visualAnalysis).slice(0, 1000)}` : '',
    caption ? `LEGENDA ORIGINAL:\n${caption.slice(0, 500)}` : '',
  ].filter(Boolean).join('\n\n');

  const fallbackTopic = (caption || transcription || 'Treino sério e composição corporal')
    .toString().slice(0, 80).trim() || 'Treino sério e composição corporal';

  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 220,
      messages: [{
        role: 'user',
        content: `Você vai extrair o GANCHO/TEMA de um Reel de referência (bodybuilding/fitness) — o material abaixo é só INSPIRAÇÃO pra um carrossel NOVO, que será totalmente reescrito (sem copiar frase nem citar o autor original).

MATERIAL DE ORIGEM:
${context || '(sem transcrição/análise disponível — use o bom senso do nicho bodybuilding)'}

Responda APENAS com um JSON (sem markdown, sem comentário):
{"topic":"gancho/tema em PT-BR, 4-12 palavras, sem citar nenhum perfil","tone":"um de: direto|investigativo|provocativo|acolhedor|motivacional","emotion":"um de: surpresa|curiosidade|urgência|indignação|motivação|orgulho"}`,
      }],
    });
    const text = (res.content[0]?.text || '').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed && parsed.topic) {
        return {
          topic: String(parsed.topic).slice(0, 140).trim(),
          tone: parsed.tone || 'direto',
          emotion: parsed.emotion || 'motivação',
        };
      }
    }
  } catch (e) {
    console.warn('[JohnHulk] deriveTopic falhou — usando fallback:', e.message);
  }
  return { topic: fallbackTopic, tone: 'direto', emotion: 'motivação' };
}

// ── Passo 4: monta as instruções do carrossel (reescrita, sem anti-ban extra) ──
function buildInstructions({ transcription, caption, visualAnalysis } = {}) {
  const material = [
    transcription ? `Transcrição do áudio:\n${transcription.slice(0, 3000)}` : '',
    visualAnalysis ? `Análise visual:\n${String(visualAnalysis).slice(0, 1200)}` : '',
    caption ? `Legenda original:\n${caption.slice(0, 600)}` : '',
  ].filter(Boolean).join('\n\n');

  return [
    'MATERIAL DE ORIGEM (transcrição/análise de um reel de referência):',
    material || '(sem material detalhado disponível — use o bom senso do nicho bodybuilding/fitness)',
    '',
    'REESCREVA na voz FMTeam, NÃO copie literalmente o texto acima, NÃO cite o autor/perfil original — use só a IDEIA/TEMA do material como inspiração, com as palavras e a estrutura do FMTeam.',
    'Fala com quem treina sério e quer shape/composição corporal de verdade — direto, prático, sem jargão gringo, sem clichê ("não é X é Y", "jornada").',
  ].join('\n');
}

// ── Notificação de rascunho pronto (item 2 do plano) — best-effort, nunca falha o batch ──
async function notifyDraftReady({ topic, reelUrl, carouselId } = {}) {
  const webhook = process.env.JOHN_HULK_NOTIFY_WEBHOOK;
  const payload = { event: 'john_hulk_draft_ready', topic, reelUrl, carouselId, at: new Date().toISOString() };
  if (!webhook) {
    console.log(`\n📋 [JohnHulk] RASCUNHO PRONTO PARA REVISÃO — tema: "${topic}" · reel origem: ${reelUrl} · carrosselId: ${carouselId}\n`);
    return;
  }
  try {
    await axios.post(webhook, payload, { timeout: 10000 });
  } catch (e) {
    console.warn('[JohnHulk] notifyDraftReady (webhook) falhou (ignorado):', e.message);
  }
}

// ── Fluxo principal ─────────────────────────────────────────────────────────────
async function generateDailyCarousel({ trigger = 'manual' } = {}) {
  if (state.generating) throw new Error('Já existe uma geração John Hulk em andamento.');

  // Kill-switch (item 8 do plano) — desligável sem mexer no workflow.
  const settingsAtStart = db.getJohnHulkSettings();
  if (!settingsAtStart.johnHulkEnabled) {
    console.log('[JohnHulk] johnHulkEnabled=false (kill-switch) — geração pulada.');
    return null;
  }

  const date = new Date().toISOString().slice(0, 10);
  // Cron idempotente por dia: só pula se o batch de hoje JÁ tem um carrossel
  // (um batch vazio/"sem reel novo" não bloqueia novas tentativas no mesmo dia).
  if (trigger !== 'manual') {
    const already = db.getAllJohnHulkBatches().some(
      (b) => b.date === date && b.status !== 'error' && b.carouselId
    );
    if (already) { console.log('[JohnHulk] batch de hoje já tem carrossel — cron ignorado.'); return null; }
  }

  state.generating = true;
  state.startedAt = new Date().toISOString();
  state.lastError = null;

  const batchId = `johnhulk_${Date.now()}`;
  const steps = [];
  const errors = [];
  let handle = null;
  let reelShortCode = null;
  let reelUrl = null;
  let topic = null;
  let carouselId = null;
  let note = null;

  // Placeholder 'generating' já no início — mesmo padrão do dailyContentService,
  // pro polling do workflow ver o estado corrente em vez de um batch de erro antigo.
  try {
    db.saveJohnHulkBatch({
      id: batchId, date, trigger, handle: null, reelShortCode: null, reelUrl: null,
      topic: null, carouselId: null, steps: [], status: 'generating', errors: [],
    });
  } catch (_) { /* ignora */ }

  try {
    try {
      handle = pickHandleForToday();

      const reels = await withTimeout(
        runStep(steps, 'list-reels', `Listando reels de @${handle}`, () => listProfileReels(handle)),
        JOHN_HULK_STEP_TIMEOUT_MS, 'listProfileReels'
      );

      const seen = db.getJohnHulkSeen();
      // Tenta até 3 candidatos (do ranking híbrido) até achar um com texto usável —
      // guard de qualidade (item 1 do plano): pula reel sem fala/legenda suficiente.
      const candidates = rankReelCandidates(reels, seen).slice(0, 3);

      let picked = null;
      let extracted = null;

      for (const candidate of candidates) {
        let content = db.getJohnHulkTranscript(candidate.shortCode);
        if (content) {
          console.log(`[JohnHulk] transcript em cache pra ${candidate.shortCode} — sem re-scrape/re-transcrever.`);
        } else {
          try {
            content = await withTimeout(
              runStep(steps, `extract-${candidate.shortCode}`, `Transcrevendo/analisando reel ${candidate.shortCode}`, () => extractReelContent(candidate.url)),
              JOHN_HULK_STEP_TIMEOUT_MS, `extractReelContent(${candidate.shortCode})`
            );
            db.saveJohnHulkTranscript(candidate.shortCode, content);
          } catch (e) {
            console.warn(`[JohnHulk] extractReelContent falhou (${candidate.shortCode}):`, e.message);
            errors.push(`extract-${candidate.shortCode}: ${e.message}`);
            continue; // tenta o próximo candidato
          }
        }

        const hasUsableText = (content.transcription && content.transcription.trim().length >= 30)
          || (content.caption && content.caption.trim().length >= 40);
        if (!hasUsableText) {
          console.warn(`[JohnHulk] reel ${candidate.shortCode} sem transcrição/legenda usável — marcando visto e tentando o próximo.`);
          db.addJohnHulkSeen(candidate.shortCode);
          continue;
        }

        picked = candidate;
        extracted = content;
        break;
      }

      if (!picked) {
        note = candidates.length
          ? 'nenhum reel candidato tinha transcrição/legenda usável'
          : 'sem reel novo (todos já usados ou nenhum encontrado no perfil)';
        console.log(`[JohnHulk] ${note}.`);
      } else {
        reelShortCode = picked.shortCode;
        reelUrl = picked.url;

        const derived = await withTimeout(
          runStep(steps, 'derive-topic', 'Derivando tema/tom/emoção (Claude Haiku)', () => deriveTopic(extracted)),
          90 * 1000, 'deriveTopic'
        );
        topic = derived.topic;

        const instructions = buildInstructions(extracted);

        const carouselResult = await withTimeout(
          runStep(steps, 'generate-carousel', 'Gerando carrossel FMTeam', () => generateCarousel({
            topic,
            instructions,
            niche: NICHE,
            instagramHandle: HANDLE,
            creatorName: CREATOR,
            numSlides: 7,
            contentTone: derived.tone,
            dominantEmotion: derived.emotion,
            layoutStyle: 'fmteam',
            ctaStyle: 'dark-fullbleed',
            fmteamCover: { showContext: false },
            imageSubject: IMAGE_SUBJECT,
            avoidPhotoUrls: db.getRecentPhotoUrls ? db.getRecentPhotoUrls() : [],
          })),
          JOHN_HULK_STEP_TIMEOUT_MS, 'generateCarousel'
        );

        try { if (db.addRecentPhotoUrls) db.addRecentPhotoUrls(carouselResult.photoUrlsUsed || []); } catch (_) { /* ignora */ }

        let screenshots = [];
        try {
          const outputDir = path.join(OUTPUT_DIR, carouselResult.folderName);
          screenshots = await runStep(steps, 'screenshots', 'Gerando screenshots (Playwright)', () => takeScreenshotsPixelPerfect(carouselResult.html, outputDir));
        } catch (e) {
          console.warn('[JohnHulk] screenshots indisponíveis:', e.message);
          errors.push(`screenshots: ${e.message}`);
        }

        carouselId = `carousel_${Date.now()}_johnhulk`;
        db.saveCarousel({
          id: carouselId,
          topic: carouselResult.topic,
          folderName: carouselResult.folderName,
          numSlides: carouselResult.numSlides,
          screenshots,
          legenda: carouselResult.legenda,
          layoutStyle: 'fmteam',
          source: 'john-hulk',
          archived: false,
          sourceReel: { shortCode: reelShortCode, url: reelUrl, handle },
          sourceTranscript: extracted.transcription || null,
          derivedTopic: topic,
        });

        db.addJohnHulkSeen(reelShortCode);

        // Auto-agendamento OPCIONAL (item 9 — default OFF, fica rascunho pra revisão).
        try {
          const cfg = db.getJohnHulkSettings();
          if (cfg.autoScheduleJohnHulk && screenshots.length) {
            const mlabs = require('./mlabsService');
            const { v4: uuidv4 } = require('uuid');
            const dates = mlabs.computeDefaultDates();
            const recId = uuidv4();
            db.createMlabsSchedule({
              id: recId, contentType: 'carousel', contentId: carouselId,
              caption: carouselResult.legenda || '', dates, platforms: null, status: 'enviando',
            });
            try {
              const r = await mlabs.scheduleContent({
                type: 'IMAGE',
                mediaPaths: screenshots.map((name) => path.join(OUTPUT_DIR, carouselResult.folderName, name)),
                caption: carouselResult.legenda || '',
                dates,
              });
              db.updateMlabsSchedule(recId, { status: 'agendado', mlabsResponse: r.scheduleResponse || null });
              console.log(`[JohnHulk] carrossel ${carouselId} agendado automaticamente no mLabs (${dates.length} datas).`);
            } catch (e) {
              db.updateMlabsSchedule(recId, { status: 'erro', error: e.message });
              console.warn('[JohnHulk] auto-agendar mLabs falhou:', e.message);
            }
          }
        } catch (e) {
          console.warn('[JohnHulk] auto-agendamento mLabs indisponível:', e.message);
        }

        try { await notifyDraftReady({ topic, reelUrl, carouselId }); } catch (_) { /* best-effort */ }
      }
    } catch (e) {
      console.error('[JohnHulk] geração falhou:', e.message);
      errors.push(`geração: ${e.message}`);
    }

    // SEMPRE salva um batch — mesmo em falha total ou "sem reel novo".
    const batch = {
      id: batchId,
      date,
      trigger,
      handle,
      reelShortCode,
      reelUrl,
      topic,
      carouselId,
      steps,
      note,
      status: errors.length === 0 ? 'done' : (carouselId ? 'partial' : 'error'),
      errors,
    };
    try { db.updateJohnHulkBatch(batchId, batch); } catch (e) { console.error('[JohnHulk] falha ao salvar batch:', e.message); }
    state.lastFinishedAt = new Date().toISOString();
    state.lastError = errors.length ? errors.join(' | ') : null;
    return batch;
  } finally {
    state.generating = false;
  }
}

// Hidrata um batch com o carrossel completo (pra UI)
function hydrateBatch(batch) {
  const carousels = db.getAllCarousels();
  return {
    ...batch,
    carousel: batch.carouselId ? (carousels.find((c) => c.id === batch.carouselId) || null) : null,
  };
}

function getState() {
  return { ...state };
}

module.exports = {
  generateDailyCarousel, hydrateBatch, getState,
  // exportados pra teste unitário do seletor (pickReel/rankReelCandidates)
  pickReel, rankReelCandidates, listProfileReels, deriveTopic, buildInstructions,
};
