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
const fs = require('fs');
const os = require('os');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db/database');
const {
  generateCarousel, takeScreenshotsPixelPerfect, OUTPUT_DIR,
} = require('./carouselService');
const {
  extractReelContent, runApifyActor,
  // Helpers de baixo nível reaproveitados pra extractAdContent (fonte "Anúncios").
  transcribeAudio, analyzeVisuals, downloadBuffer, ffmpegAvailable,
} = require('./reelsAnalyzerService');

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
// `limit` é opcional (default 30, comportamento igual ao de sempre) — a biblioteca
// (refreshLibrary) chama com um limite maior (ex.: 100) pra varrer mais histórico.
async function listProfileReels(handle, limit = 30) {
  const input = {
    directUrls: [`https://www.instagram.com/${handle}/`],
    resultsType: 'posts',
    resultsLimit: limit,
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
          thumbnailUrl: it.displayUrl || it.images?.[0] || null,
          views: it.videoViewCount || it.videoPlayCount || 0,
          likes: it.likesCount || 0,
          comments: it.commentsCount || 0,
          durationSec: it.videoDuration || it.videoDurationSeconds || null,
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
// `faithful` (modo fiel): quando true, o tema extraído tem que ser FIEL ao assunto
// central real do material (ex.: se o material fala de Epitalon/telômeros, o topic
// tem que ser sobre isso — não um tema "inspirado" que desvia pra outro assunto do
// nicho). Default false = comportamento antigo (tema livre, só inspiração).
async function deriveTopic({ transcription, caption, visualAnalysis } = {}, { faithful = false } = {}) {
  const context = [
    transcription ? `TRANSCRIÇÃO DO ÁUDIO:\n${transcription.slice(0, 2000)}` : '',
    visualAnalysis ? `ANÁLISE VISUAL:\n${String(visualAnalysis).slice(0, 1000)}` : '',
    caption ? `LEGENDA ORIGINAL:\n${caption.slice(0, 500)}` : '',
  ].filter(Boolean).join('\n\n');

  const fallbackTopic = (caption || transcription || 'Treino sério e composição corporal')
    .toString().slice(0, 80).trim() || 'Treino sério e composição corporal';

  const promptFaithful = `Você vai extrair o TEMA CENTRAL REAL de um material de referência (bodybuilding/fitness) pra virar um carrossel FIEL ao assunto do material — o carrossel será reescrito na voz FMTeam, mas SEM MUDAR DE ASSUNTO: o tema tem que ser exatamente sobre o que o material trata (se fala de um suplemento/protocolo/substância específica, é sobre ISSO; não desvie pra um tema genérico do nicho).

MATERIAL DE ORIGEM:
${context || '(sem transcrição/análise disponível — use o bom senso do nicho bodybuilding)'}

Responda APENAS com um JSON (sem markdown, sem comentário):
{"topic":"o tema central REAL do material em PT-BR, 4-14 palavras, fiel ao assunto (cite o produto/protocolo/conceito específico se houver), sem citar nenhum perfil","tone":"um de: direto|investigativo|provocativo|acolhedor|motivacional","emotion":"um de: surpresa|curiosidade|urgência|indignação|motivação|orgulho"}`;

  const promptLoose = `Você vai extrair o GANCHO/TEMA de um Reel de referência (bodybuilding/fitness) — o material abaixo é só INSPIRAÇÃO pra um carrossel NOVO, que será totalmente reescrito (sem copiar frase nem citar o autor original).

MATERIAL DE ORIGEM:
${context || '(sem transcrição/análise disponível — use o bom senso do nicho bodybuilding)'}

Responda APENAS com um JSON (sem markdown, sem comentário):
{"topic":"gancho/tema em PT-BR, 4-12 palavras, sem citar nenhum perfil","tone":"um de: direto|investigativo|provocativo|acolhedor|motivacional","emotion":"um de: surpresa|curiosidade|urgência|indignação|motivação|orgulho"}`;

  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 220,
      messages: [{
        role: 'user',
        content: faithful ? promptFaithful : promptLoose,
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
// `extraDirective` (opcional) — usado pelas VARIAÇÕES (item B): injeta uma linha extra
// de ângulo/tom pro Claude diversificar carrosséis do MESMO reel.
function buildInstructions({ transcription, caption, visualAnalysis } = {}, extraDirective = '', { faithful = false } = {}) {
  const material = [
    transcription ? `Transcrição do áudio:\n${transcription.slice(0, 3000)}` : '',
    visualAnalysis ? `Análise visual:\n${String(visualAnalysis).slice(0, 1200)}` : '',
    caption ? `Legenda original:\n${caption.slice(0, 600)}` : '',
  ].filter(Boolean).join('\n\n');

  // Diretriz de reescrita: no modo fiel, preserva o assunto/tese/argumentos/oferta
  // reais do material (adaptados à voz FMTeam), sem trocar de tema. No modo padrão
  // (default), usa o material só como inspiração de ideia/tema (comportamento antigo).
  const rewriteDirective = faithful
    ? [
        'MODO FIEL — reescreva na voz FMTeam MANTENDO-SE FIEL ao material acima: o carrossel tem que tratar do MESMO assunto/tese, cobrir os MESMOS argumentos/pontos principais e manter a MESMA promessa/oferta do material de origem. NÃO troque de tema, NÃO invente um ângulo novo que desvie do assunto, NÃO generalize pra um tema "do nicho".',
        'Adapte só a LINGUAGEM e a ESTRUTURA pro estilo FMTeam (não copie frases literais nem cite o autor/perfil original), mas o CONTEÚDO — o que é dito, os dados, o produto/protocolo/conceito específico e a conclusão — tem que bater com o material.',
      ].join('\n')
    : 'REESCREVA na voz FMTeam, NÃO copie literalmente o texto acima, NÃO cite o autor/perfil original — use só a IDEIA/TEMA do material como inspiração, com as palavras e a estrutura do FMTeam.';

  return [
    'MATERIAL DE ORIGEM (transcrição/análise de um reel de referência):',
    material || '(sem material detalhado disponível — use o bom senso do nicho bodybuilding/fitness)',
    '',
    rewriteDirective,
    'Fala com quem treina sério e quer shape/composição corporal de verdade — direto, prático, sem jargão gringo, sem clichê ("não é X é Y", "jornada").',
    extraDirective ? `\n${extraDirective}` : '',
  ].filter(Boolean).join('\n');
}

// ── Passo 4b: "por que viralizou" (item C do plano de melhorias) — 1 call Haiku,
// curto e defensivo. Devolve null se não houver material ou se a chamada falhar
// (nunca derruba modelReel por causa disso).
async function deriveViralInsight({ transcription, caption, visualAnalysis } = {}) {
  const context = [
    transcription ? `TRANSCRIÇÃO:\n${transcription.slice(0, 1500)}` : '',
    visualAnalysis ? `ANÁLISE VISUAL:\n${String(visualAnalysis).slice(0, 800)}` : '',
    caption ? `LEGENDA:\n${caption.slice(0, 400)}` : '',
  ].filter(Boolean).join('\n\n');
  if (!context) return null;

  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: `Analise por que este Reel de bodybuilding/fitness provavelmente viralizou (gancho, formato, promessa, emoção). Responda em PT-BR, 1-2 frases DIRETAS, sem introdução ("o reel viralizou porque..."), sem markdown, sem citar nome de perfil.

MATERIAL:
${context}`,
      }],
    });
    const text = (res.content[0]?.text || '').trim();
    return text ? text.slice(0, 400) : null;
  } catch (e) {
    console.warn('[JohnHulk] deriveViralInsight falhou (ignorado):', e.message);
    return null;
  }
}

// Presets de ângulo/tom pras VARIAÇÕES (item B) — cada índice muda tom, emoção e
// nº de slides levemente, pra gerar carrosséis visivelmente diferentes do MESMO reel.
const ANGLE_PRESETS = [
  { tone: null, emotion: null, slideDelta: 0, note: 'Ângulo 1/N — tom padrão (o derivado do reel).' },
  { tone: 'provocativo', emotion: 'indignação', slideDelta: -1, note: 'Ângulo 2/N — tom mais provocativo/direto, questione a crença comum do nicho.' },
  { tone: 'acolhedor', emotion: 'orgulho', slideDelta: +1, note: 'Ângulo 3/N — tom mais acolhedor, foco em conquista/progresso, menos confronto.' },
];

// ── Modo anúncio (tráfego pago) ─────────────────────────────────────────────
// OPCIONAL, escolhido na hora da geração — default continua 'organico' (sem
// nenhuma mudança de comportamento). Em 'anuncio': (1) o CTA final do carrossel
// troca o "COMENTA: <keyword>" orgânico por uma CTA de resposta direta pro
// destino escolhido (via ctaOverride no generateCarousel) e (2) a legenda vira
// copy de anúncio (deriveAdCaption), em vez da legenda orgânica padrão.
const AD_CTA_DESTINATIONS = ['whatsapp', 'link', 'dm'];

// Monta o ctaOverride (label/keyword/benefit) do slide de CTA pro modo anúncio,
// a partir do destino escolhido + a oferta livre (opcional) do dono. Mantém o
// mesmo formato visual do CTA orgânico (kbox: label curto + keyword em
// destaque + benefit em 1 linha) — só troca o conteúdo pra resposta direta.
function buildAdCtaOverride({ ctaDestination, offer } = {}) {
  const offerTrim = offer ? String(offer).trim().slice(0, 60) : '';
  if (ctaDestination === 'link') {
    return {
      label: 'CLIQUE EM SAIBA MAIS',
      keyword: offerTrim || 'GARANTA AGORA',
      benefit: 'Toque no botão abaixo do anúncio e garanta sua vaga',
    };
  }
  if (ctaDestination === 'dm') {
    return {
      label: 'CHAME NA DM',
      keyword: offerTrim || 'ME CHAMA',
      benefit: 'Manda uma mensagem agora e eu te respondo pessoalmente',
    };
  }
  // default: 'whatsapp'
  return {
    label: 'CHAME NO WHATSAPP',
    keyword: offerTrim || 'FALE COMIGO',
    benefit: 'Clique no botão do anúncio e fala comigo agora mesmo',
  };
}

// Diretriz extra (somada ao `extraDirective` de buildInstructions) SÓ pro modo
// anúncio — deixa explícito pro modelo que isso é peça de TRÁFEGO PAGO (CTA de
// resposta direta, não "comenta/salva/link na bio") e injeta a segurança de
// política de anúncio da Meta (diferente do anti-ban orgânico, que este fluxo
// não usa — ver comentário no topo do arquivo). Isso reduz o risco de rejeição
// do anúncio na revisão da Meta.
function buildAdDirective({ ctaDestination, offer } = {}) {
  const destinoTexto = ctaDestination === 'link'
    ? 'um LINK (saiba mais / página de vendas)'
    : ctaDestination === 'dm'
      ? 'a DM do Instagram'
      : 'o WhatsApp';
  return [
    'ESTE CARROSSEL É UMA PEÇA DE ANÚNCIO PAGO (tráfego pago via Meta Ads), não um post orgânico.',
    `O CTA final deve ser uma chamada de RESPOSTA DIRETA pro leitor entrar em contato AGORA por ${destinoTexto} — NÃO use "comenta a palavra", "salva esse post" ou "link na bio" (isso é mecânica de post orgânico, não de anúncio).`,
    offer ? `Oferta/gancho da campanha (use como contexto, sem inventar promessa além disso): ${String(offer).slice(0, 200)}` : '',
    'SEGURANÇA — POLÍTICA DE ANÚNCIO DA META (obrigatório em TODOS os slides, pra reduzir risco de reprovação do anúncio):',
    '- NÃO se dirija nem faça suposição sobre o corpo/aparência de quem está lendo (nada de "você está acima do peso", "seu corpo", "olha pro seu shape" etc.) — fale do problema/tema de forma GERAL, nunca apontando pra pessoa.',
    '- NÃO prometa resultado garantido nem use antes/depois agressivo ou alegação de saúde sensacionalista — enquadre como problema → solução, de forma realista e sem promessa de resultado específico.',
  ].filter(Boolean).join('\n');
}

// Legenda de ANÚNCIO (primary text) — separada da legenda orgânica (que já é
// gerada dentro de generateCarousel). 1 call Haiku, PT-BR, curta e defensiva:
// gancho → agitação leve → solução → CTA pro destino escolhido. Segue a mesma
// segurança de política de anúncio da Meta do buildAdDirective (sem apontar
// corpo/aparência, sem promessa de resultado garantido), sem hashtag-spam nem
// "comenta/link na bio". Devolve null em caso de falha (fallback fica a cargo
// de quem chama — não derruba a modelagem por causa disso).
async function deriveAdCaption({
  topic, offer, ctaDestination, content,
} = {}) {
  const destinoTexto = ctaDestination === 'link'
    ? 'clicar no link do anúncio (saiba mais)'
    : ctaDestination === 'dm'
      ? 'chamar na DM do Instagram'
      : 'chamar no WhatsApp';
  const context = [
    content && content.transcription ? `TRANSCRIÇÃO DO REEL DE INSPIRAÇÃO:\n${content.transcription.slice(0, 1200)}` : '',
    content && content.caption ? `LEGENDA ORIGINAL:\n${content.caption.slice(0, 400)}` : '',
  ].filter(Boolean).join('\n\n');

  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 350,
      messages: [{
        role: 'user',
        content: `Escreva o texto principal (primary text) de um ANÚNCIO pago (Meta Ads) em PT-BR, na voz da FMTeam (Fabricio Moura, bodybuilding/composição corporal), pra acompanhar um carrossel de imagens.

Tema do carrossel: "${topic}"
${offer ? `Oferta/gancho da campanha: ${String(offer).slice(0, 200)}` : ''}
CTA final: chamar o leitor pra ${destinoTexto} agora.
${context ? `\nMaterial de inspiração (NÃO copie, só use como contexto de tema):\n${context}` : ''}

Estrutura: gancho forte na 1ª linha → agitação leve do problema (SEM apontar corpo/aparência de quem lê, sem "você está...") → solução/promessa realista (SEM garantir resultado específico nem antes/depois agressivo) → CTA claro pra ${destinoTexto}.
Regras: direto, sem clichê ("não é X é Y", "jornada"), SEM hashtag, SEM "comenta a palavra" nem "link na bio" (isso não se aplica aqui). Responda APENAS com o texto do anúncio, sem aspas, sem markdown, sem título.`,
      }],
    });
    const text = (res.content[0]?.text || '').trim();
    return text ? text.slice(0, 900) : null;
  } catch (e) {
    console.warn('[JohnHulk] deriveAdCaption falhou (ignorado, mantém legenda original):', e.message);
    return null;
  }
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

// ── Biblioteca de Reels (Reel Library) ────────────────────────────────────────
// Estado em memória do refresh — só 1 por vez, mesmo padrão de `state` acima.
const libraryState = {
  refreshing: false, startedAt: null, lastHandle: null, lastError: null, lastFinishedAt: null,
};
function getLibraryState() { return { ...libraryState }; }

// Varre o(s) perfil(is) (via listProfileReels com limite maior) e faz upsert na
// biblioteca (`john_hulk_reels`). Sem `handle`, roda por TODOS os HANDLES
// configurados (rotação completa, não só o do dia). Best-effort por handle — um
// perfil que falhe não derruba o refresh dos outros.
// `mode` (item F): 'full' (default, limit 100) varre mais histórico; 'incremental'
// (limit 30) é mais rápido/barato pra refresh frequente — o upsert já preserva o
// que existe e só atualiza métricas, então incremental é seguro pra rodar mais vezes.
async function refreshLibrary({ handle, limit, mode } = {}) {
  const resolvedLimit = limit != null ? limit : (mode === 'incremental' ? 30 : 100);
  return refreshLibraryImpl({ handle, limit: resolvedLimit });
}

async function refreshLibraryImpl({ handle, limit = 100 } = {}) {
  if (libraryState.refreshing) throw new Error('Já existe um refresh da biblioteca em andamento.');
  libraryState.refreshing = true;
  libraryState.startedAt = new Date().toISOString();
  libraryState.lastError = null;

  const handles = handle ? [handle] : HANDLES;
  let totalAdded = 0;
  let totalUpdated = 0;
  const errs = [];
  try {
    for (const h of handles) {
      libraryState.lastHandle = h;
      try {
        const reels = await withTimeout(listProfileReels(h, limit), JOHN_HULK_STEP_TIMEOUT_MS, `listProfileReels(${h})`);
        const normalized = reels.map((r) => ({
          shortCode: r.shortCode,
          handle: h,
          url: r.url,
          thumbnailUrl: r.thumbnailUrl || null,
          caption: r.caption || '',
          timestampMs: r.timestampMs || 0,
          views: r.views || 0,
          likes: r.likes || 0,
          comments: r.comments || 0,
          durationSec: r.durationSec != null ? r.durationSec : null,
        }));
        const { added, updated } = db.upsertJohnHulkReels(normalized);
        totalAdded += added;
        totalUpdated += updated;
      } catch (e) {
        console.warn(`[JohnHulk] refreshLibrary(@${h}) falhou:`, e.message);
        errs.push(`${h}: ${e.message}`);
      }
    }
    libraryState.lastError = errs.length ? errs.join(' | ') : null;
    libraryState.lastFinishedAt = new Date().toISOString();
    return { added: totalAdded, updated: totalUpdated, total: db.getJohnHulkReels().length };
  } finally {
    libraryState.refreshing = false;
  }
}

// ── Biblioteca de Anúncios (Meta Ad Library) — fonte "Anúncios" ADITIVA ────────
// Mesmo padrão da Biblioteca de Reels acima (upsert na MESMA tabela
// `john_hulk_reels`, agora com `sourceType:'ad'` pra diferenciar), mas via Apify
// (`curious_coder/facebook-ads-library-scraper`) em vez do instagram-scraper. O
// item da Ad Library não tem métricas de engajamento (views/likes/comments ficam
// 0) — o que importa aqui é `runningDays` (peça rodando há muito tempo = validada
// pelo mercado) em vez de performance social.

// Monta a URL da Ad Library pra uma página — EXATAMENTE o template validado
// manualmente contra a página real (ver instruções da tarefa).
function buildAdLibraryUrl(pageId, country = 'BR') {
  return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${encodeURIComponent(country)}&is_targeted_country=false&media_type=all&search_type=page&sort_data[mode]=total_impressions&sort_data[direction]=desc&view_all_page_id=${encodeURIComponent(pageId)}`;
}

// Estado em memória do refresh da Ad Library — lock PRÓPRIO (separado de
// `libraryState`, que é só da biblioteca de reels) pra um refresh de anúncios
// não bloquear nem ser bloqueado por um refresh de reels rodando ao mesmo tempo.
const adLibraryState = {
  refreshing: false, startedAt: null, lastPageId: null, lastError: null, lastFinishedAt: null,
};
function getAdLibraryState() { return { ...adLibraryState }; }

// Busca os anúncios da página via Apify, com o mesmo retry/backoff (2s/4s/8s,
// até 3 tentativas) usado por listProfileReels — scrapers de terceiros são flaky.
async function listAdLibraryAds(pageId, country, count = 30) {
  const url = buildAdLibraryUrl(pageId, country);
  const input = {
    urls: [{ url, method: 'GET' }],
    count,
    'scrapePageAds.activeStatus': 'all',
  };
  const delays = [2000, 4000, 8000];
  let lastErr = null;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const items = await runApifyActor('curious_coder/facebook-ads-library-scraper', input, 180);
      return Array.isArray(items) ? items : [];
    } catch (e) {
      lastErr = e;
      if (attempt < delays.length) {
        console.warn(`[JohnHulk] listAdLibraryAds(page ${pageId}) falhou (tentativa ${attempt + 1}/${delays.length + 1}): ${e.message} — retry em ${delays[attempt] / 1000}s`);
        await sleep(delays[attempt]);
      }
    }
  }
  throw lastErr || new Error(`listAdLibraryAds(page ${pageId}) falhou sem detalhe.`);
}

// Normaliza 1 item bruto do actor pro shape da biblioteca (mesma tabela dos
// reels, campos extras marcados com sourceType:'ad'). shortCode prefixado com
// 'ad_' pra nunca colidir com um shortCode de reel do Instagram.
function normalizeAdItem(ad, pageId) {
  if (!ad || !ad.ad_archive_id) return null;
  const snapshot = ad.snapshot || {};
  const video = Array.isArray(snapshot.videos) && snapshot.videos[0] ? snapshot.videos[0] : null;
  const image = Array.isArray(snapshot.images) && snapshot.images[0] ? snapshot.images[0] : null;
  const adCopy = (snapshot.body && snapshot.body.text) || '';
  const thumbnailUrl = (video && video.video_preview_image_url)
    || (image && image.original_image_url)
    || snapshot.page_profile_picture_url
    || null;
  const adVideoUrl = (video && (video.video_hd_url || video.video_sd_url)) || null;
  const startDate = ad.start_date != null ? Number(ad.start_date) : null;
  const endDate = ad.end_date != null ? Number(ad.end_date) : null;
  const totalActiveTime = ad.total_active_time != null ? Number(ad.total_active_time) : null;
  // runningDays: preferência pelo total_active_time do actor (mais preciso —
  // conta só o tempo em que o anúncio esteve de fato ativo); fallback pra
  // (agora - start_date) se o actor não devolver total_active_time.
  let runningDays = null;
  if (totalActiveTime != null) {
    runningDays = Math.round(totalActiveTime / 86400);
  } else if (startDate) {
    runningDays = Math.round((Date.now() / 1000 - startDate) / 86400);
  }

  return {
    shortCode: `ad_${ad.ad_archive_id}`,
    sourceType: 'ad',
    handle: ad.page_name || pageId,
    url: ad.ad_library_url || ad.url || '',
    caption: adCopy,
    adCopy,
    thumbnailUrl,
    adVideoUrl,
    displayFormat: snapshot.display_format || null,
    adActive: !!ad.is_active,
    adStartDate: startDate,
    adEndDate: endDate,
    runningDays,
    timestampMs: startDate ? startDate * 1000 : 0,
    // Ads não têm métrica de engajamento social — ficam 0, mesmo shape dos reels
    // (mantém upsertJohnHulkReels/ordenação por views funcionando sem branch extra).
    views: 0,
    likes: 0,
    comments: 0,
    durationSec: null,
    linkUrl: snapshot.link_url || null,
    ctaType: snapshot.cta_type || null,
  };
}

// Varre a Ad Library de UMA página (a informada, ou `adLibraryPageId` das
// settings) e faz upsert na MESMA tabela da biblioteca de reels
// (`john_hulk_reels`), via `db.upsertJohnHulkReels` (já preserva
// status/favorite/carouselId/etc. de itens existentes). `count` (opcional,
// default 30) é repassado direto pro actor.
async function refreshAdLibrary({ pageId, count = 30 } = {}) {
  if (adLibraryState.refreshing) throw new Error('Já existe um refresh da biblioteca de anúncios em andamento.');

  const settings = db.getJohnHulkSettings();
  const resolvedPageId = pageId || settings.adLibraryPageId;
  const country = settings.adLibraryCountry || 'BR';
  if (!resolvedPageId) throw new Error('adLibraryPageId não configurado (settings.adLibraryPageId).');

  adLibraryState.refreshing = true;
  adLibraryState.startedAt = new Date().toISOString();
  adLibraryState.lastError = null;
  adLibraryState.lastPageId = resolvedPageId;

  try {
    const items = await withTimeout(
      listAdLibraryAds(resolvedPageId, country, count),
      JOHN_HULK_STEP_TIMEOUT_MS, `listAdLibraryAds(${resolvedPageId})`
    );
    const normalized = items.map((ad) => normalizeAdItem(ad, resolvedPageId)).filter(Boolean);
    const { added, updated } = db.upsertJohnHulkReels(normalized);
    adLibraryState.lastFinishedAt = new Date().toISOString();
    return { added, updated, total: db.getJohnHulkReels().length };
  } catch (e) {
    adLibraryState.lastError = e.message;
    adLibraryState.lastFinishedAt = new Date().toISOString();
    throw e;
  } finally {
    adLibraryState.refreshing = false;
  }
}

// Extração de conteúdo de UM anúncio (equivalente ao extractReelContent, mas pra
// item da Ad Library) — reusa os helpers de baixo nível do reelsAnalyzerService
// (transcribeAudio/analyzeVisuals/downloadBuffer/ffmpegAvailable). Devolve o MESMO
// shape de extractReelContent ({caption, transcription, visualAnalysis, ...}) pra
// alimentar deriveTopic/buildInstructions sem nenhuma mudança nelas.
// - Com vídeo (VIDEO/DCO) + ffmpeg disponível: baixa o mp4, transcreve (Whisper) e
//   roda a análise visual sobre a thumbnail/preview.
// - Sem vídeo (IMAGE) ou sem ffmpeg/download falhou: cai pra análise visual só da
//   thumbnail (ou nota baseada na legenda, se nem isso der).
// Defensivo: nunca lança por causa de download/transcrição/visão — sempre devolve
// pelo menos {caption, transcription:null, visualAnalysis}.
async function extractAdContent(item) {
  if (!item) throw new Error('extractAdContent requer o item (anúncio) da biblioteca.');
  const caption = item.adCopy || item.caption || '';

  // Fallback só-thumbnail (usado tanto pra IMAGE quanto quando o vídeo falha).
  async function thumbnailOnlyAnalysis() {
    let visualAnalysis = '';
    if (item.thumbnailUrl) {
      try {
        const buf = await downloadBuffer(item.thumbnailUrl, 20000);
        visualAnalysis = await analyzeVisuals([], buf.toString('base64'), caption);
      } catch (e) {
        console.warn('[JohnHulk] extractAdContent: análise visual (thumbnail) falhou:', e.message);
      }
    }
    if (!visualAnalysis) {
      visualAnalysis = caption
        ? `Análise contextual baseada na legenda do anúncio:\n${caption}`
        : 'Sem dados visuais disponíveis para análise.';
    }
    return visualAnalysis;
  }

  const hasVideo = !!item.adVideoUrl;
  if (!hasVideo || !ffmpegAvailable()) {
    return {
      caption, transcription: null, visualAnalysis: await thumbnailOnlyAnalysis(), thumbnailUrl: item.thumbnailUrl || null,
    };
  }

  const tempDir = path.join(os.tmpdir(), `viralos-jh-ad-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(tempDir, { recursive: true });
  try {
    const videoPath = path.join(tempDir, 'ad.mp4');
    try {
      const buf = await downloadBuffer(item.adVideoUrl, 90000);
      fs.writeFileSync(videoPath, buf);
    } catch (e) {
      console.warn('[JohnHulk] extractAdContent: download do vídeo do anúncio falhou:', e.message);
      return {
        caption, transcription: null, visualAnalysis: await thumbnailOnlyAnalysis(), thumbnailUrl: item.thumbnailUrl || null,
      };
    }

    let transcription = null;
    try {
      transcription = await transcribeAudio(videoPath);
    } catch (e) {
      console.warn('[JohnHulk] extractAdContent: transcrição falhou:', e.message);
    }

    let thumbnailBase64 = null;
    if (item.thumbnailUrl) {
      try {
        const tbuf = await downloadBuffer(item.thumbnailUrl, 20000);
        thumbnailBase64 = tbuf.toString('base64');
      } catch (e) { /* segue sem thumbnail — analyzeVisuals ainda funciona só com caption */ }
    }

    let visualAnalysis = '';
    try {
      visualAnalysis = await analyzeVisuals([], thumbnailBase64, caption);
    } catch (e) {
      console.warn('[JohnHulk] extractAdContent: análise visual falhou:', e.message);
      visualAnalysis = caption ? `Análise contextual baseada na legenda do anúncio:\n${caption}` : '';
    }

    return {
      caption, transcription, visualAnalysis, thumbnailUrl: item.thumbnailUrl || null,
    };
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) { /* ignora */ }
  }
}

// ── Modelagem (Modeling Studio) — núcleo usado tanto pelo fluxo manual (rotas
// /reels/:shortCode/model, /reels/model-url, /reels/model-batch) quanto pela
// rotina diária automática (generateDailyCarousel, abaixo). ──────────────────
// Lock em memória POR REEL — evita duas modelagens simultâneas do mesmo shortCode
// (ex.: clique duplo, cron + manual ao mesmo tempo).
const modelingLocks = new Set();
function isReelModeling(shortCode) { return modelingLocks.has(shortCode); }

// Extrai o shortCode de uma URL avulsa do Instagram (/reel/, /p/ ou /tv/).
function extractShortCodeFromUrl(url) {
  const m = String(url || '').match(/\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

// Status que travam re-modelagem sem regenerate:true (o reel já virou conteúdo
// de verdade). 'novo' e 'erro' (item A) são livres — 'erro' se comporta como
// 'novo' pro guard, já que a tentativa anterior não produziu nada aproveitável.
const REEL_LOCKED_STATUSES = new Set(['modelado', 'editado', 'agendado', 'postado']);

// Modela UM reel (da biblioteca, via shortCode, ou de uma URL avulsa) em carrossel(s)
// FMTeam — mesmo pipeline reel→transcrição→tema→carrossel→screenshots→rascunho que
// a rotina diária sempre usou, agora reutilizável pra qualquer reel da biblioteca.
// `variants` (1-3, item B): gera N carrosséis do MESMO reel com ângulo/tom/nº de
// slides diferentes. `angle` (opcional): direcionamento extra livre do dono,
// somado ao(s) preset(s) de ângulo em TODAS as variações geradas.
// `numSlides` (opcional, 4-10, default 7): nº base de slides do carrossel — cada
// variação ainda aplica o slideDelta do ANGLE_PRESETS em cima desse valor, sempre
// clampado em 4-10.
// `mode` (opcional): 'organico' (default, comportamento 100% igual ao de antes) ou
// 'anuncio' (peça de tráfego pago — troca o CTA final e a legenda pra resposta
// direta, com segurança de política de anúncio da Meta — ver buildAdDirective).
// `ctaDestination` ('whatsapp'|'link'|'dm') e `offer` (texto livre da oferta) só
// fazem sentido em mode:'anuncio'.
// Resiliência (item A): a tentativa inteira roda com 1 auto-retry (delay curto);
// se as duas falharem, o reel vai pra status:'erro' com errorMessage/errorAt e a
// exceção é relançada pro chamador (rota/batch/rotina diária) tratar.
async function modelReel({
  shortCode, url, regenerate = false, variants = 1, angle,
  mode = 'organico', ctaDestination, offer, numSlides, faithful = false,
} = {}) {
  let resolvedShortCode = shortCode || null;
  let resolvedUrl = url || null;
  let reel = resolvedShortCode ? db.getJohnHulkReel(resolvedShortCode) : null;
  if (reel && !resolvedUrl) resolvedUrl = reel.url;

  // Fluxo "URL avulsa" (sem shortCode conhecido) — deriva o shortCode da URL e
  // tenta achar o reel já existente na biblioteca (pode já ter sido descoberto
  // pelo refresh, mesmo sem o dono ter clicado nele ainda).
  if (!resolvedShortCode && resolvedUrl) {
    resolvedShortCode = extractShortCodeFromUrl(resolvedUrl) || `url_${Date.now()}`;
    reel = db.getJohnHulkReel(resolvedShortCode);
  }

  if (!resolvedShortCode) throw new Error('modelReel requer shortCode ou url.');
  if (!resolvedUrl) throw new Error(`Reel ${resolvedShortCode} não tem URL resolvida (nem no parâmetro, nem na biblioteca).`);
  if (modelingLocks.has(resolvedShortCode)) throw new Error(`Reel ${resolvedShortCode} já está sendo modelado.`);
  if (reel && REEL_LOCKED_STATUSES.has(reel.status) && !regenerate) {
    throw new Error(`Reel ${resolvedShortCode} já foi modelado (status=${reel.status}). Use regenerate:true pra refazer.`);
  }

  const numVariants = Math.min(3, Math.max(1, Number(variants) || 1));
  const isAdMode = mode === 'anuncio';
  const baseSlides = Math.min(10, Math.max(4, Number(numSlides) || 7));

  modelingLocks.add(resolvedShortCode);
  try {
    const attempt = () => modelReelAttempt({
      resolvedShortCode,
      resolvedUrl,
      regenerate,
      numVariants,
      angle,
      mode: isAdMode ? 'anuncio' : 'organico',
      ctaDestination: isAdMode ? ctaDestination : undefined,
      offer: isAdMode ? offer : undefined,
      numSlides: baseSlides,
      faithful: !!faithful,
    });

    try {
      const result = await attempt();
      try { db.updateJohnHulkReel(resolvedShortCode, { errorMessage: null, errorAt: null }); } catch (_) { /* best-effort */ }
      return result;
    } catch (e1) {
      console.warn(`[JohnHulk] modelReel(${resolvedShortCode}) falhou na 1ª tentativa — retry em 3s:`, e1.message);
      await sleep(3000);
      try {
        const result = await attempt();
        try { db.updateJohnHulkReel(resolvedShortCode, { errorMessage: null, errorAt: null }); } catch (_) { /* best-effort */ }
        return result;
      } catch (e2) {
        console.error(`[JohnHulk] modelReel(${resolvedShortCode}) falhou de novo (retry esgotado):`, e2.message);
        try {
          db.updateJohnHulkReel(resolvedShortCode, {
            status: 'erro', errorMessage: e2.message, errorAt: new Date().toISOString(),
          });
        } catch (_) { /* best-effort */ }
        throw e2;
      }
    }
  } finally {
    modelingLocks.delete(resolvedShortCode);
  }
}

// Uma tentativa completa de modelagem — separado de modelReel só pra permitir o
// auto-retry acima sem duplicar a lógica. Não mexe em modelingLocks (já é feito
// pelo chamador).
async function modelReelAttempt({
  resolvedShortCode, resolvedUrl, regenerate, numVariants, angle,
  mode = 'organico', ctaDestination, offer, numSlides = 7, faithful = false,
} = {}) {
  const isAdMode = mode === 'anuncio';
  const steps = [];
  let reel = db.getJohnHulkReel(resolvedShortCode);
  // sourceType:'ad' = item veio da Biblioteca de Anúncios (Meta Ad Library) — NÃO
  // confundir com `mode`/`isAdMode` acima (modo "anúncio pago" da geração, que se
  // aplica igualmente a reels e a ads). Reel normal: sourceType ausente/'reel' —
  // comportamento 100% igual ao de antes.
  const isAdSource = !!(reel && reel.sourceType === 'ad');

  let content = regenerate ? null : db.getJohnHulkTranscript(resolvedShortCode);
  if (content) {
    console.log(`[JohnHulk] transcript em cache pra ${resolvedShortCode} — sem re-scrape/re-transcrever.`);
  } else if (isAdSource) {
    content = await withTimeout(
      runStep(steps, 'extract', `Transcrevendo/analisando anúncio ${resolvedShortCode}`, () => extractAdContent(reel)),
      JOHN_HULK_STEP_TIMEOUT_MS, `extractAdContent(${resolvedShortCode})`
    );
    db.saveJohnHulkTranscript(resolvedShortCode, content);
  } else {
    content = await withTimeout(
      runStep(steps, 'extract', `Transcrevendo/analisando reel ${resolvedShortCode}`, () => extractReelContent(resolvedUrl)),
      JOHN_HULK_STEP_TIMEOUT_MS, `extractReelContent(${resolvedShortCode})`
    );
    db.saveJohnHulkTranscript(resolvedShortCode, content);
  }

  // Reel ainda não está na biblioteca (fluxo de URL avulsa totalmente nova) —
  // cria uma entrada mínima pra ele aparecer na biblioteca depois de modelado.
  if (!reel) {
    db.upsertJohnHulkReels([{
      shortCode: resolvedShortCode,
      handle: null,
      url: resolvedUrl,
      thumbnailUrl: content.thumbnailUrl || null,
      caption: content.caption || '',
      timestampMs: 0,
      views: content.views || 0,
      likes: content.likes || 0,
      comments: 0,
      durationSec: null,
    }]);
    reel = db.getJohnHulkReel(resolvedShortCode);
  }

  // Item E — enriquece métricas do reel com o que veio fresco de extractReelContent
  // (só sobe se for maior/mais completo do que o que já está salvo; nunca reduz).
  try {
    const patch = {};
    if (content.views && content.views > (reel.views || 0)) patch.views = content.views;
    if (content.likes && content.likes > (reel.likes || 0)) patch.likes = content.likes;
    if (Object.keys(patch).length) {
      const hist = Array.isArray(reel.metricsHistory) ? reel.metricsHistory.slice() : [];
      hist.push({
        at: new Date().toISOString(),
        views: patch.views != null ? patch.views : reel.views,
        likes: patch.likes != null ? patch.likes : reel.likes,
        comments: reel.comments || 0,
      });
      reel = db.updateJohnHulkReel(resolvedShortCode, { ...patch, metricsHistory: hist }) || reel;
    }
  } catch (e) {
    console.warn('[JohnHulk] enriquecer métricas falhou (ignorado):', e.message);
  }

  const derived = await withTimeout(
    runStep(steps, 'derive-topic', `Derivando tema/tom/emoção (Claude Haiku)${faithful ? ' [MODO FIEL]' : ''}`, () => deriveTopic(content, { faithful })),
    90 * 1000, 'deriveTopic'
  );
  const topic = derived.topic;

  // Item C — "por que viralizou" (1 call, cacheado no reel). Só recalcula se o
  // reel ainda não tem (evita gastar Haiku de novo em regenerate/retry).
  let viralInsight = reel.viralInsight || null;
  if (!viralInsight) {
    viralInsight = await withTimeout(
      runStep(steps, 'viral-insight', 'Derivando "por que viralizou" (Claude Haiku)', () => deriveViralInsight(content)),
      60 * 1000, 'deriveViralInsight'
    ).catch((e) => { console.warn('[JohnHulk] deriveViralInsight (timeout/erro, ignorado):', e.message); return null; });
  }

  // Item B — 1 a 3 variações do MESMO reel, cada uma com ângulo/tom/nº de slides
  // levemente diferente (ANGLE_PRESETS) + o `angle` livre do dono (se informado).
  const carouselIds = [];
  let screenshotError = null;
  for (let i = 0; i < numVariants; i++) {
    const preset = ANGLE_PRESETS[i] || ANGLE_PRESETS[0];
    const tone = preset.tone || derived.tone;
    const emotion = preset.emotion || derived.emotion;
    // Base = numSlides escolhido na chamada (default 7, clampado 4-10 em modelReel);
    // cada variação ainda aplica o slideDelta do preset em cima dessa base, sempre
    // clampado em 4-10.
    const slideCountForVariant = Math.min(10, Math.max(4, numSlides + preset.slideDelta));
    const angleNote = [
      numVariants > 1 ? preset.note.replace('/N', `/${numVariants}`) : '',
      angle ? `Direcionamento extra pedido pelo dono: ${String(angle).slice(0, 200)}` : '',
      isAdMode ? buildAdDirective({ ctaDestination, offer }) : '',
    ].filter(Boolean).join('\n\n');
    const instructions = buildInstructions(content, angleNote, { faithful });
    // Modo anúncio: troca o CTA final (kbox) pra resposta direta ao destino
    // escolhido — ausente/undefined em modo orgânico, mantendo o CTA configurado
    // (db.getCarouselCta()) 100% igual ao de antes.
    const ctaOverride = isAdMode ? buildAdCtaOverride({ ctaDestination, offer }) : undefined;

    const carouselResult = await withTimeout(
      runStep(steps, `generate-carousel-${i + 1}`, `Gerando carrossel FMTeam${numVariants > 1 ? ` (variação ${i + 1}/${numVariants})` : ''}${isAdMode ? ' [ANÚNCIO]' : ''}`, () => generateCarousel({
        topic,
        instructions,
        niche: NICHE,
        instagramHandle: HANDLE,
        creatorName: CREATOR,
        numSlides: slideCountForVariant,
        contentTone: tone,
        dominantEmotion: emotion,
        layoutStyle: 'fmteam',
        ctaStyle: 'dark-fullbleed',
        fmteamCover: { showContext: false },
        imageSubject: IMAGE_SUBJECT,
        avoidPhotoUrls: db.getRecentPhotoUrls ? db.getRecentPhotoUrls() : [],
        ctaOverride,
      })),
      JOHN_HULK_STEP_TIMEOUT_MS, 'generateCarousel'
    );

    try { if (db.addRecentPhotoUrls) db.addRecentPhotoUrls(carouselResult.photoUrlsUsed || []); } catch (_) { /* ignora */ }

    // Modo anúncio: substitui a legenda orgânica (gerada dentro de generateCarousel)
    // por uma copy de anúncio (gancho → agitação leve → solução → CTA). Defensivo —
    // se a call falhar, mantém a legenda original em vez de derrubar a geração.
    let legenda = carouselResult.legenda;
    if (isAdMode) {
      try {
        const adCaption = await withTimeout(
          runStep(steps, `ad-caption-${i + 1}`, `Gerando legenda de anúncio (Claude Haiku)${numVariants > 1 ? ` (variação ${i + 1}/${numVariants})` : ''}`, () => deriveAdCaption({
            topic, offer, ctaDestination, content,
          })),
          60 * 1000, 'deriveAdCaption'
        );
        if (adCaption) legenda = adCaption;
      } catch (e) {
        console.warn('[JohnHulk] deriveAdCaption (timeout/erro, mantém legenda original):', e.message);
      }
    }

    let screenshots = [];
    try {
      const outputDir = path.join(OUTPUT_DIR, carouselResult.folderName);
      screenshots = await runStep(steps, `screenshots-${i + 1}`, `Gerando screenshots (Playwright)${numVariants > 1 ? ` (variação ${i + 1}/${numVariants})` : ''}`, () => takeScreenshotsPixelPerfect(carouselResult.html, outputDir));
    } catch (e) {
      console.warn('[JohnHulk] screenshots indisponíveis:', e.message);
      screenshotError = screenshotError ? `${screenshotError} | v${i + 1}: ${e.message}` : e.message;
    }

    const carouselId = `carousel_${Date.now()}_johnhulk_v${i + 1}`;
    db.saveCarousel({
      id: carouselId,
      topic: carouselResult.topic,
      folderName: carouselResult.folderName,
      numSlides: carouselResult.numSlides,
      screenshots,
      legenda,
      layoutStyle: 'fmteam',
      source: 'john-hulk',
      archived: false,
      sourceReel: { shortCode: resolvedShortCode, url: resolvedUrl, handle: (reel && reel.handle) || null },
      sourceTranscript: content.transcription || null,
      derivedTopic: topic,
      viralInsight: viralInsight || null,
      variantIndex: numVariants > 1 ? i + 1 : undefined,
      mode: isAdMode ? 'anuncio' : 'organico',
      ctaDestination: isAdMode ? ctaDestination : undefined,
      offer: isAdMode && offer ? String(offer).slice(0, 200) : undefined,
      // Rótulo de origem do rascunho — 'ad' quando o material-fonte veio da
      // Biblioteca de Anúncios (Meta Ad Library), ausente/undefined pra reel
      // (comportamento 100% igual ao de antes).
      sourceType: isAdSource ? 'ad' : undefined,
      // Modo fiel — registra no rascunho se foi gerado preservando o assunto/tese
      // do material de origem (true) ou como reinterpretação livre (ausente = antigo).
      faithful: faithful ? true : undefined,
    });
    carouselIds.push(carouselId);
  }

  const carouselId = carouselIds[0];
  db.updateJohnHulkReel(resolvedShortCode, {
    status: 'modelado', usedAt: new Date().toISOString(), carouselId, carouselIds, topic, viralInsight: viralInsight || null,
  });
  db.addJohnHulkSeen(resolvedShortCode);

  try { await notifyDraftReady({ topic, reelUrl: resolvedUrl, carouselId }); } catch (_) { /* best-effort */ }

  return {
    carouselIds, carouselId, topic, reelShortCode: resolvedShortCode, screenshotError,
  };
}

// Modela vários reels em sequência — resiliente: 1 falha não para o lote.
// Fica sempre em modo orgânico (sem opções de anúncio) — só `numSlides` (opcional)
// passa direto pro modelReel de cada reel do lote, pra manter o batch simples.
async function modelBatch({ shortCodes, numSlides } = {}) {
  const list = Array.isArray(shortCodes) ? shortCodes.filter(Boolean) : [];
  const results = [];
  for (const shortCode of list) {
    try {
      const r = await modelReel({ shortCode, numSlides });
      results.push({ shortCode, ok: true, ...r });
    } catch (e) {
      console.warn(`[JohnHulk] modelBatch: falha em ${shortCode}:`, e.message);
      results.push({ shortCode, ok: false, error: e.message });
    }
  }
  return results;
}

// ── Fluxo principal (rotina diária automática) — agora PUXA da BIBLIOTECA ─────
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
      // Biblioteca vazia ou sem refresh nas últimas ~24h → atualiza antes de
      // escolher (rotina diária agora PUXA da biblioteca, não faz mais o próprio
      // listProfileReels toda vez — a biblioteca é a fonte de candidatos).
      const libraryBefore = db.getJohnHulkReels();
      const staleCutoff = Date.now() - 24 * 60 * 60 * 1000;
      const freshestFetch = libraryBefore.reduce(
        (max, r) => Math.max(max, r.fetchedAt ? new Date(r.fetchedAt).getTime() : 0), 0
      );
      if (!libraryBefore.length || freshestFetch < staleCutoff) {
        await runStep(steps, 'refresh-library', 'Atualizando biblioteca de reels', () => refreshLibrary({}));
      }

      handle = pickHandleForToday();

      // Só reels com status:'novo' entram no pool de candidatos, e o legado
      // `getJohnHulkSeen()` (marcações de qualidade ruim/já usados de antes da
      // biblioteca existir) continua excluindo — fallback conforme item 4/plano.
      const seen = new Set(db.getJohnHulkSeen());
      const novos = db.getJohnHulkReels().filter((r) => r.status === 'novo' && !seen.has(r.shortCode));
      // Tenta até 3 candidatos (do ranking híbrido — mesma regra: corte de dias +
      // performance) até achar um com texto usável — guard de qualidade (item 1
      // do plano): pula reel sem fala/legenda suficiente.
      const candidates = rankReelCandidates(novos, []).slice(0, 3);

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
          // Guard de qualidade: o reel PERMANECE 'novo' na biblioteca (dono pode
          // querer modelar manualmente com outro material), mas some do pool
          // automático via `seen` — assim a rotina diária não fica tentando o
          // mesmo reel sem texto usável todo dia.
          console.warn(`[JohnHulk] reel ${candidate.shortCode} sem transcrição/legenda usável — marcando visto (fallback) e tentando o próximo.`);
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
          : 'sem reel novo na biblioteca (todos já modelados/usados ou biblioteca vazia)';
        console.log(`[JohnHulk] ${note}.`);
      } else {
        reelShortCode = picked.shortCode;
        reelUrl = picked.url;
        handle = picked.handle || handle;

        // Transcrição do candidato escolhido já está em cache (foi salva no loop
        // do guard de qualidade acima) — modelReel só reaproveita, sem re-bater
        // Apify/Whisper.
        const result = await runStep(
          steps, 'model-reel', `Modelando reel ${picked.shortCode} em carrossel FMTeam`,
          () => modelReel({ shortCode: picked.shortCode, url: picked.url })
        );
        topic = result.topic;
        carouselId = result.carouselId;
        if (result.screenshotError) errors.push(`screenshots: ${result.screenshotError}`);

        // Auto-agendamento OPCIONAL (item 9 — default OFF, fica rascunho pra revisão).
        try {
          const cfg = db.getJohnHulkSettings();
          const carousel = db.getAllCarousels().find((c) => c.id === carouselId);
          if (cfg.autoScheduleJohnHulk && carousel && carousel.screenshots && carousel.screenshots.length) {
            const mlabs = require('./mlabsService');
            const { v4: uuidv4 } = require('uuid');
            const dates = mlabs.computeDefaultDates();
            const recId = uuidv4();
            db.createMlabsSchedule({
              id: recId, contentType: 'carousel', contentId: carouselId,
              caption: carousel.legenda || '', dates, platforms: null, status: 'enviando',
            });
            try {
              const r = await mlabs.scheduleContent({
                type: 'IMAGE',
                mediaPaths: carousel.screenshots.map((name) => path.join(OUTPUT_DIR, carousel.folderName, name)),
                caption: carousel.legenda || '',
                dates,
              });
              db.updateMlabsSchedule(recId, { status: 'agendado', mlabsResponse: r.scheduleResponse || null });
              try { db.updateJohnHulkReel(reelShortCode, { status: 'agendado' }); } catch (_) { /* best-effort */ }
              console.log(`[JohnHulk] carrossel ${carouselId} agendado automaticamente no mLabs (${dates.length} datas).`);
            } catch (e) {
              db.updateMlabsSchedule(recId, { status: 'erro', error: e.message });
              console.warn('[JohnHulk] auto-agendar mLabs falhou:', e.message);
            }
          }
        } catch (e) {
          console.warn('[JohnHulk] auto-agendamento mLabs indisponível:', e.message);
        }
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
  pickReel, rankReelCandidates, listProfileReels, deriveTopic, buildInstructions, deriveViralInsight,
  // Biblioteca de Reels + Modeling Studio
  refreshLibrary, getLibraryState,
  modelReel, modelBatch, isReelModeling,
  // Modo anúncio (item novo) — exportados pra teste/reuso
  buildAdCtaOverride, buildAdDirective, deriveAdCaption, AD_CTA_DESTINATIONS,
  // Biblioteca de Anúncios (Meta Ad Library) — fonte "Anúncios" (ADITIVO)
  refreshAdLibrary, getAdLibraryState, buildAdLibraryUrl, extractAdContent,
};
