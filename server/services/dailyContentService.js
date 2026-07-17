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
const NICHE = 'Emagrecimento e nutrição prática para mulheres 35-44';

// ── Banco de temas (ângulos comprovados do PERFORMANCE-LOG, por SINTOMA = ban-safe) ──
// O cérebro editorial (fmteamEditorial.js) cuida da voz/anti-ban; aqui é só O QUE falar.
// `keywords` = termos pra casar com legendas dos posts reais (ponderação por performance).
// Cada tema tem um `group` (assunto macro) e várias variações de ângulo (`topics`).
// - `group` evita que os 2 carrosséis do dia (e os de dias seguidos) falem do MESMO
//   assunto: metade dos temas antigos era "testosterona", então caíam parecidos.
// - `topics` dá 3 ângulos por tema, então mesmo quando um tema volta, o título/enfoque
//   muda (antes o tema = sempre o MESMO título exato → posts iguais).
const THEMES = [
  // ── COMIDA (comparações/prático — o lane campeão do Fabricio) ──
  { id: 'comparacao-refeicao', group: 'comida', tone: 'direto', emotion: 'surpresa', keywords: ['calorias', 'refeição', 'café da manhã', 'prato'],
    topics: ['A mesma refeição, o dobro de calorias — e você escolhe errado', 'Café da manhã de 280 x 500 kcal: a diferença que trava seu peso', 'Pão com ovo x tapioca com frango: qual seca de verdade?'] },
  { id: 'calorias-liquidas', group: 'comida', tone: 'investigativo', emotion: 'surpresa', keywords: ['suco', 'bebida', 'líquido', 'refrigerante', 'café com leite'],
    topics: ['As calorias que você BEBE sem perceber', 'Suco natural também engorda? A real que ninguém conta', 'O cafezinho com leite e açúcar que soma o dia inteiro'] },
  { id: 'proteina-saciedade', group: 'comida', tone: 'direto', emotion: 'curiosidade', keywords: ['proteína', 'saciedade', 'fome', 'ovo', 'frango'],
    topics: ['Você come muito menos proteína do que imagina', 'A proteína que segura a fome até a próxima refeição', 'Prato sem proteína é fome garantida daqui 2 horas'] },
  { id: 'montar-prato', group: 'comida', tone: 'direto', emotion: 'curiosidade', keywords: ['prato', 'montar', 'porção', 'refeição'],
    topics: ['Como montar o prato pra secar sem passar fome', 'A ordem dos alimentos no prato muda o teu resultado', 'O prato que enche o olho e ainda seca'] },
  // ── TROCAS (parece igual mas não é — viraliza no teu perfil) ──
  { id: 'parece-igual', group: 'trocas', tone: 'provocativo', emotion: 'surpresa', keywords: ['parece igual', 'troca', 'leite em pó', 'composto'],
    topics: ['Parece igual, mas um seca e o outro engorda', 'Leite em pó x composto lácteo: a pegadinha do mercado', 'Duas comidas idênticas no olho, opostas no corpo'] },
  { id: 'fit-que-nao-e', group: 'trocas', tone: 'provocativo', emotion: 'indignação', keywords: ['fit', 'zero', 'diet', 'barrinha'],
    topics: ['A comida "fit" que não é fit', 'O "zero açúcar" que engorda do mesmo jeito', 'Barrinha de proteína x chocolate: surpresa no rótulo'] },
  { id: 'rotulo', group: 'trocas', tone: 'investigativo', emotion: 'curiosidade', keywords: ['rótulo', 'ingredientes', 'tabela', 'industrializado'],
    topics: ['O que o rótulo esconde de você', '3 palavras no rótulo que denunciam que engorda', 'Como ler um rótulo em 10 segundos'] },
  // ── HÁBITOS (rotina real da mulher 35-44) ──
  { id: 'correria', group: 'habitos', tone: 'direto', emotion: 'acolhimento', keywords: ['correria', 'tempo', 'rotina', 'trabalho', 'filho'],
    topics: ['Emagrecer na correria (trabalho, filho, casa)', 'Sem tempo pra dieta? O problema quase nunca é tempo', 'Como não sabotar a semana inteira no domingo'] },
  { id: 'doce-noite', group: 'habitos', tone: 'investigativo', emotion: 'curiosidade', keywords: ['doce', 'noite', 'vontade', 'açúcar'],
    topics: ['A vontade de doce à noite tem explicação', 'Por que você segura o dia todo e ataca a geladeira à noite', 'Fome de doce não é falta de força de vontade'] },
  { id: 'ansiedade-comida', group: 'habitos', tone: 'direto', emotion: 'acolhimento', keywords: ['ansiedade', 'compulsão', 'emocional', 'automático'],
    topics: ['Você não come de fome, come de ansiedade', 'O gatilho que te faz comer sem nem perceber', 'Comer no automático: o vilão silencioso da dieta'] },
  { id: 'balanca', group: 'habitos', tone: 'direto', emotion: 'acolhimento', keywords: ['balança', 'peso', 'pesar'],
    topics: ['Para de surtar com a balança todo dia', 'O número da balança te engana — olha o que importa', 'Peso subiu 2kg da noite pro dia? Calma, é isso'] },
  // ── CANETA (droga popular, curiosidade da mulher — frame emagrecimento) ──
  { id: 'caneta-musculo', group: 'caneta', tone: 'investigativo', emotion: 'alerta', keywords: ['caneta', 'mounjaro', 'ozempic', 'emagrecedor'],
    topics: ['Emagreceu na caneta e virou magra flácida?', 'O que a caneta faz sumir junto com a gordura', 'Perder peso rápido demais cobra a conta depois'] },
  { id: 'caneta-parou', group: 'caneta', tone: 'direto', emotion: 'alerta', keywords: ['parou', 'efeito rebote', 'voltou', 'caneta'],
    topics: ['Parou a caneta e o peso voltou com tudo?', 'A fome que volta em dobro quando você para', 'Caneta sem estratégia é resultado alugado'] },
  // ── MENTE (relação com a comida — emocional, conecta) ──
  { id: 'odiar-espelho', group: 'mente', tone: 'provocativo', emotion: 'conexão', keywords: ['espelho', 'autoestima', 'se odiar', 'aceitar'],
    topics: ['Você quer emagrecer ou parar de se odiar no espelho?', 'A dieta muda quando o motivo muda', 'Emagrecer por raiva x por autocuidado dá resultado diferente'] },
  { id: 'tentou-tudo', group: 'mente', tone: 'acolhedor', emotion: 'acolhimento', keywords: ['tentou de tudo', 'dieta', 'desistir', 'fracasso'],
    topics: ['Já tentou de tudo e não desce? O problema não é você', 'Por que toda dieta funciona 2 semanas e depois trava', 'A dieta da fome não te faz secar, te faz desistir'] },
  { id: 'terceira-semana', group: 'mente', tone: 'direto', emotion: 'curiosidade', keywords: ['terceira semana', 'desiste', 'constância', 'platô'],
    topics: ['Por que você desiste exatamente na terceira semana', 'O ponto onde quase todo mundo larga a dieta', 'A semana que separa quem seca de quem desiste'] },
  // ── CORPO 35+ (mudanças da idade, ban-safe) ──
  { id: 'metabolismo-35', group: 'corpo35', tone: 'investigativo', emotion: 'preocupação', keywords: ['metabolismo', 'idade', 'depois dos 35', 'depois dos 40'],
    topics: ['Depois dos 35 o corpo muda — e por quê', 'O que emagrecia aos 25 e parou de funcionar', 'Metabolismo mais lento com a idade: mito ou real?'] },
  { id: 'inchaco', group: 'corpo35', tone: 'direto', emotion: 'curiosidade', keywords: ['inchaço', 'retenção', 'líquido', 'inchada'],
    topics: ['Vive inchada e retendo líquido?', 'Não é tudo gordura: parte é inchaço (e tem solução)', 'A retenção que te faz parecer 3kg a mais'] },
  { id: 'sono-emagrecer', group: 'corpo35', tone: 'investigativo', emotion: 'surpresa', keywords: ['sono', 'dormir', 'noite', 'fome'],
    topics: ['Dormir mal engorda — e ninguém te conta', 'A noite mal dormida que sabota tua dieta no dia seguinte', 'Sono ruim vira mais fome de doce no dia seguinte'] },
];

// Estado em memória (só 1 geração por vez)
const state = { generating: false, startedAt: null, lastError: null, lastFinishedAt: null };

// Teto por tema: se um carrossel/reel travar (Anthropic retentando, Playwright preso etc.),
// não deixa a geração inteira pendurar sem salvar nada — registra o erro e segue.
const DAILY_THEME_TIMEOUT_MS = 6 * 60 * 1000;
function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label}: timeout ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

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

// Grupos (assuntos macro) usados nos últimos N batches — pra não cair no mesmo
// assunto em dias seguidos (ex.: 3 dias falando de hormônio).
function recentGroups(nBatches = 3) {
  const batches = db.getAllDailyBatches()
    .slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, nBatches);
  const g = new Set();
  batches.forEach((b) => (b.themes || []).forEach((t) => { if (t.group) g.add(t.group); }));
  return g;
}

// Escolhe 2 temas de GRUPOS DIFERENTES, evitando ids recentes (14d) e desincentivando
// grupos usados nos últimos dias. Fallback progressivo se o pool apertar.
function pickThemes() {
  const recentIds = recentThemeIds();
  const recentG = recentGroups(3);
  let pool = THEMES.filter((t) => !recentIds.has(t.id));
  if (pool.length < 2) pool = THEMES.slice(); // todos recentes → libera geral

  const scores = scoreThemes();
  const maxScore = Math.max(0, ...pool.map((t) => scores[t.id] || 0));
  const weightOf = (t) => {
    // base 1 + até +4 por performance real; grupo usado recentemente pesa 1/4.
    let w = 1 + (maxScore > 0 ? (scores[t.id] || 0) / maxScore : 0) * 4;
    if (recentG.has(t.group)) w *= 0.25;
    return w;
  };

  const first = weightedSample(pool, pool.map(weightOf), 1)[0];
  if (!first) return [];
  // 2º tema: grupo DIFERENTE do 1º (fallback: qualquer outro id).
  let rest = pool.filter((t) => t.id !== first.id && t.group !== first.group);
  if (!rest.length) rest = pool.filter((t) => t.id !== first.id);
  const second = rest.length ? weightedSample(rest, rest.map(weightOf), 1)[0] : null;
  return [first, second].filter(Boolean);
}

// Escolhe um ângulo (variação de título) do tema, evitando os títulos usados
// recentemente (recent_topics). Assim, quando um tema volta, o enfoque muda.
function pickAngle(theme) {
  const topics = (Array.isArray(theme.topics) && theme.topics.length)
    ? theme.topics
    : [theme.topic].filter(Boolean);
  if (topics.length <= 1) return topics[0] || theme.topic || '';
  const recent = (db.getRecentTopics && db.getRecentTopics()) || [];
  const fresh = topics.filter((tp) => !recent.includes(tp));
  const from = fresh.length ? fresh : topics;
  return from[Math.floor(Math.random() * from.length)];
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
  // Fotos dos carrosséis recentes — pra NÃO repetir foto entre carrosséis seguidos.
  // Lido fresco a cada carrossel (o anterior já salvou as dele), então os 2 do dia
  // também não repetem entre si.
  const avoidPhotoUrls = db.getRecentPhotoUrls ? db.getRecentPhotoUrls() : [];

  // 1) Carrossel fmteam
  const carouselResult = await generateCarousel({
    topic: theme.topic,
    instructions: 'Mire a MULHER 35-44 que quer emagrecer sem passar fome, na correria da vida real (trabalho, filhos, casa). Gancho na capa que para o scroll. Prefira comparação visual e ponto prático traduzido, nada de jargão de academia masculina.',
    niche: NICHE,
    instagramHandle: HANDLE,
    creatorName: CREATOR,
    numSlides: 7,
    contentTone: theme.tone,
    dominantEmotion: theme.emotion,
    layoutStyle: 'fmteam',
    ctaStyle: 'dark-fullbleed',
    // Capa SÓ com o gancho — sem a frase entre parênteses (capa-context).
    fmteamCover: { showContext: false },
    avoidPhotoUrls,
  });

  // Registra as fotos usadas pra os próximos carrosséis evitarem repetir.
  try { if (db.addRecentPhotoUrls) db.addRecentPhotoUrls(carouselResult.photoUrlsUsed || []); } catch (_) {}

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
  const carouselIds = [];
  const reelIds = [];
  let photosUsed = 0;
  const errors = [];
  let resolved = [];

  try {
    // pickThemes/pickAngle ficam DENTRO do try: se estourarem, o erro é registrado
    // no batch (visível em /api/daily-content) em vez de sumir no log do Fly.
    try {
      const themes = pickThemes();
      resolved = themes.map((t) => ({ ...t, topic: pickAngle(t) }));

      for (const theme of resolved) {
        try {
          // Teto por tema: se travar, cai no catch e a geração segue (não pendura tudo).
          const r = await withTimeout(buildOne(theme), DAILY_THEME_TIMEOUT_MS, `tema ${theme.id}`);
          if (r.carouselId) carouselIds.push(r.carouselId);
          if (r.reelId) reelIds.push(r.reelId);
          photosUsed += r.photosUsed;
          try { if (db.addRecentTopics) db.addRecentTopics([theme.topic]); } catch (_) {}
        } catch (e) {
          console.error(`[DailyContent] tema ${theme.id} falhou:`, e.message);
          errors.push(`${theme.id}: ${e.message}`);
        }
      }
    } catch (e) {
      // Falha ANTES/FORA do loop (ex.: pickThemes). Registra pra não sumir.
      console.error('[DailyContent] geração falhou antes do loop:', e.message);
      errors.push(`geração: ${e.message}`);
    }

    // SEMPRE salva um batch — mesmo em falha total. Assim o erro fica VISÍVEL
    // (status 'error' + mensagem) em vez de o batch nunca aparecer ("none").
    const batch = {
      id: batchId,
      date,
      trigger,
      themes: resolved.map((t) => ({ id: t.id, group: t.group, topic: t.topic })),
      carouselIds,
      reelIds,
      photoSource: photosUsed > 0 ? 'pexels' : 'banco/local',
      status: errors.length === 0 ? 'done' : (carouselIds.length ? 'partial' : 'error'),
      errors,
    };
    try { db.saveDailyBatch(batch); } catch (e) { console.error('[DailyContent] falha ao salvar batch:', e.message); }
    state.lastFinishedAt = new Date().toISOString();
    state.lastError = errors.length ? errors.join(' | ') : null;
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
