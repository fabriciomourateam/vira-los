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
// Cada tema tem um `group` (assunto macro) e várias variações de ângulo (`topics`).
// - `group` evita que os 2 carrosséis do dia (e os de dias seguidos) falem do MESMO
//   assunto: metade dos temas antigos era "testosterona", então caíam parecidos.
// - `topics` dá 3 ângulos por tema, então mesmo quando um tema volta, o título/enfoque
//   muda (antes o tema = sempre o MESMO título exato → posts iguais).
const THEMES = [
  // ── HORMONAL ──
  { id: 'testo-baixa', group: 'hormonal', tone: 'investigativo', emotion: 'preocupação', keywords: ['testosterona', 'testo', 'hormonal', 'hormônio'],
    topics: ['Sinais de testosterona baixa no homem', '5 sintomas silenciosos de testosterona baixa', 'Testosterona baixa aos 30+: os sinais que você ignora'] },
  { id: 'libido', group: 'hormonal', tone: 'direto', emotion: 'preocupação', keywords: ['libido', 'desejo', 'sexual', 'ereção'],
    topics: ['Libido baixa não é frescura: o que ela revela', 'Quando a libido cai, o corpo está te avisando', 'Perda de desejo: o sinal que os homens ignoram'] },
  { id: 'vitd-zinco', group: 'hormonal', tone: 'investigativo', emotion: 'curiosidade', keywords: ['vitamina d', 'zinco', 'magnésio', 'suplemento'],
    topics: ['Vitamina D, zinco e magnésio baixos derrubam a testosterona', 'Os 3 micronutrientes que seu hormônio precisa', 'Deficiência de vitamina D e queda de performance'] },
  // ── METABÓLICO ──
  { id: 'falso-magro', group: 'metabolico', tone: 'provocativo', emotion: 'surpresa', keywords: ['falso magro', 'gordura visceral', 'magro', 'barriga'],
    topics: ['Falso magro: magro por fora, gordo por dentro', 'Barriga que não sai mesmo estando magro', 'Gordura visceral: a que não aparece e é a pior'] },
  { id: 'insulina', group: 'metabolico', tone: 'investigativo', emotion: 'alerta', keywords: ['insulina', 'açúcar', 'glicose', 'carboidrato'],
    topics: ['Resistência à insulina travando seu shape', 'Açúcar escondido sabotando sua composição corporal', 'Picos de insulina e a barriga que não sai'] },
  { id: 'glp1', group: 'metabolico', tone: 'investigativo', emotion: 'alerta', keywords: ['mounjaro', 'ozempic', 'glp', 'semaglutida', 'tirzepatida', 'emagrecimento rápido'],
    topics: ['Emagrecimento rápido que rouba o seu músculo', 'O lado que ninguém conta do emagrecimento com caneta', 'Perder peso rápido e perder músculo junto'] },
  // ── TREINO ──
  { id: 'plato', group: 'treino', tone: 'direto', emotion: 'frustração', keywords: ['não cresce', 'platô', 'estagnado', 'hipertrofia', 'massa muscular'],
    topics: ['Treina pesado e não cresce: o que está travando', 'Platô muscular: por que você estagnou', 'O erro de volume que trava sua hipertrofia'] },
  { id: 'cardio', group: 'treino', tone: 'provocativo', emotion: 'contra-intuição', keywords: ['cardio', 'corrida', 'aeróbico', 'esteira'],
    topics: ['Cardio em excesso comendo o seu músculo', 'Muito aeróbico e pouco resultado: o furo', 'Cardio demais sabotando seu ganho de massa'] },
  { id: 'tecnica', group: 'treino', tone: 'direto', emotion: 'frustração', keywords: ['execução', 'técnica', 'amplitude', 'série', 'carga'],
    topics: ['Execução errada: esforço de treino jogado fora', 'Amplitude e cadência: o que muda o resultado', 'Por que treinar mais nem sempre é treinar melhor'] },
  // ── RECUPERAÇÃO ──
  { id: 'sono', group: 'recuperacao', tone: 'investigativo', emotion: 'preocupação', keywords: ['sono', 'dormir', 'dorme', 'insônia'],
    topics: ['Sono ruim sabotando sua testosterona e seu shape', 'Dormir mal está destruindo sua recuperação', 'As horas de sono que definem seu hormônio'] },
  { id: 'cortisol', group: 'recuperacao', tone: 'investigativo', emotion: 'frustração', keywords: ['cortisol', 'estresse', 'estressado', 'ansiedade'],
    topics: ['Estresse e cortisol travando o seu shape', 'Cortisol alto: o inimigo silencioso do shape', 'Estresse crônico e a gordura que não sai'] },
  { id: 'energia', group: 'recuperacao', tone: 'direto', emotion: 'cansaço', keywords: ['energia', 'disposição', 'cansaço', 'cansado', 'fadiga'],
    topics: ['Falta de energia que não passa nem dormindo', 'Cansaço o dia todo: o que seu corpo esconde', 'Fadiga constante mesmo dormindo bem'] },
  // ── ROTINA ──
  { id: 'rotina', group: 'rotina', tone: 'direto', emotion: 'frustração', keywords: ['rotina', 'tempo', 'hábito', 'agenda'],
    topics: ['Por que você não encaixa treino e dieta na rotina', 'Falta de tempo x falta de método: a real', 'Como manter treino e dieta na correria'] },
  { id: 'depois-30', group: 'rotina', tone: 'direto', emotion: 'preocupação', keywords: ['depois dos 30', 'idade', 'metabolismo', 'envelhec'],
    topics: ['Depois dos 30 o shape fica mais difícil — e por quê', 'Metabolismo aos 30+: o que realmente muda', 'Por que o que funcionava aos 20 parou'] },
  { id: 'consistencia', group: 'rotina', tone: 'provocativo', emotion: 'contra-intuição', keywords: ['consistência', 'disciplina', 'desiste', 'motivação'],
    topics: ['Não é falta de força de vontade, é falta de método', 'Por que você desiste na 3ª semana', 'Consistência vence intensidade: a matemática'] },
  // ── NUTRIÇÃO ──
  { id: 'alcool', group: 'nutricao', tone: 'provocativo', emotion: 'surpresa', keywords: ['álcool', 'bebida', 'cerveja', 'beber'],
    topics: ['Como o álcool sabota seu shape e sua testosterona', 'Aquela cerveja do fim de semana e o seu shape', 'Álcool e recuperação: a conta que ninguém faz'] },
  { id: 'proteina', group: 'nutricao', tone: 'direto', emotion: 'surpresa', keywords: ['proteína', 'whey', 'carne', 'frango'],
    topics: ['Você come menos proteína do que imagina', 'Proteína insuficiente travando seu ganho', 'Quanto de proteína seu shape realmente exige'] },
  { id: 'ultraprocessado', group: 'nutricao', tone: 'investigativo', emotion: 'alerta', keywords: ['ultraprocessado', 'industrializado', 'processado', 'fast food'],
    topics: ['Ultraprocessados sabotando sua composição corporal', 'A comida "fit" que não é fit', 'Calorias líquidas: o vilão escondido da dieta'] },
  { id: 'fome-doce', group: 'nutricao', tone: 'investigativo', emotion: 'curiosidade', keywords: ['doce', 'açúcar', 'compulsão', 'vontade'],
    topics: ['Fome de doce à noite não é falta de força', 'Compulsão por doce: o que ela revela', 'Vontade de açúcar e o seu cortisol'] },
  { id: 'agua', group: 'nutricao', tone: 'direto', emotion: 'surpresa', keywords: ['água', 'hidratação', 'hidratar', 'desidrat'],
    topics: ['Desidratação leve derrubando seu treino', 'Água de menos e a energia que some', 'Hidratação: o detalhe que muda a performance'] },
  // ── HORMONAL (extra) ──
  { id: 'saude-sexual', group: 'hormonal', tone: 'direto', emotion: 'preocupação', keywords: ['sexual', 'ereção', 'desempenho', 'libido'],
    topics: ['Desempenho sexual caindo pode ser hormonal', 'Saúde sexual masculina: o sinal que o corpo dá', 'Quando o desempenho cai, o hormônio avisa antes'] },
  // ── METABÓLICO (extra) ──
  { id: 'barriga-teimosa', group: 'metabolico', tone: 'provocativo', emotion: 'frustração', keywords: ['barriga', 'abdominal', 'gordura', 'pochete'],
    topics: ['A barriga teimosa que não sai nem no déficit', 'Gordura abdominal: por que ela resiste', 'Barriga de homem 30+: o que está por trás'] },
  { id: 'metabolismo-lento', group: 'metabolico', tone: 'investigativo', emotion: 'contra-intuição', keywords: ['metabolismo', 'lento', 'queima', 'gasto'],
    topics: ['Metabolismo lento é desculpa ou é real?', 'O que de fato desacelera sua queima', 'Por que seu metabolismo parece travado'] },
  // ── TREINO (extra) ──
  { id: 'sedentarismo', group: 'treino', tone: 'direto', emotion: 'alerta', keywords: ['sentado', 'sedentário', 'sedentarismo', 'escritório'],
    topics: ['8 horas sentado sabotando seu shape', 'Sedentarismo: o dano que o treino não apaga', 'Trabalha sentado o dia todo? Isso muda seu corpo'] },
  { id: 'volume-excesso', group: 'treino', tone: 'provocativo', emotion: 'contra-intuição', keywords: ['volume', 'séries', 'exagero', 'treino demais'],
    topics: ['Treino de volume demais travando o ganho', 'Mais séries não é mais músculo', 'O excesso de treino que te deixa parado'] },
  // ── RECUPERAÇÃO (extra) ──
  { id: 'overtraining', group: 'recuperacao', tone: 'direto', emotion: 'contra-intuição', keywords: ['overtraining', 'descanso', 'recuperação', 'pausa'],
    topics: ['Treinar todo dia está te deixando pior', 'Overtraining: quando falta é descanso', 'Recuperação: o treino que acontece fora da academia'] },
  // ── MENTE (foco / humor / névoa) ──
  { id: 'nevoa-mental', group: 'mente', tone: 'investigativo', emotion: 'preocupação', keywords: ['névoa', 'foco', 'concentração', 'memória', 'cabeça'],
    topics: ['Névoa mental: quando a cabeça não engata', 'Falta de foco pode ser hormonal', 'Cabeça lenta o dia todo: o que está por trás'] },
  { id: 'humor', group: 'mente', tone: 'direto', emotion: 'preocupação', keywords: ['humor', 'irritado', 'irritabilidade', 'ânimo', 'motivação'],
    topics: ['Irritado à toa? O hormônio pode explicar', 'Humor instável e a testosterona', 'Ânimo lá embaixo: o sinal que os homens ignoram'] },
  // ── MITOS vs CIÊNCIA ──
  { id: 'testo-idade-mito', group: 'mitos', tone: 'provocativo', emotion: 'surpresa', keywords: ['idade', 'velho', 'jovem', 'novo'],
    topics: ['Testosterona baixa não é coisa de velho', 'Homem de 28 com hormônio de 50: acontece', 'A idade não é a única culpada pela testo baixa'] },
  { id: 'jejum-mito', group: 'mitos', tone: 'investigativo', emotion: 'contra-intuição', keywords: ['jejum', 'intermitente'],
    topics: ['Jejum intermitente: o que ninguém te conta', 'Jejum funciona pra todo mundo? A real', 'O erro de fazer jejum do jeito errado'] },
  { id: 'lowcarb-mito', group: 'mitos', tone: 'investigativo', emotion: 'contra-intuição', keywords: ['low carb', 'carboidrato', 'cetogênica', 'carbo'],
    topics: ['Cortar carboidrato não é o que te trava', 'Low carb: mito e verdade pro seu shape', 'Carboidrato à noite engorda? A ciência'] },
  { id: 'abdomen-mito', group: 'mitos', tone: 'provocativo', emotion: 'surpresa', keywords: ['abdominal', 'abdômen', 'localizado', 'seca'],
    topics: ['Abdominal todo dia não seca a barriga', 'O mito do exercício localizado', 'Fazer abdominal x perder barriga: a verdade'] },
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
    instructions: 'Mire o HOMEM 25-40. Gancho na capa que para o scroll. Cada slide de conteúdo entrega 1 ponto técnico traduzido.',
    niche: NICHE,
    instagramHandle: HANDLE,
    creatorName: CREATOR,
    numSlides: 9,
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
  const themes = pickThemes();
  const carouselIds = [];
  const reelIds = [];
  let photosUsed = 0;
  const errors = [];

  // Resolve o ângulo (título) de cada tema agora, evitando títulos usados recentemente.
  const resolved = themes.map((t) => ({ ...t, topic: pickAngle(t) }));

  try {
    for (const theme of resolved) {
      try {
        const r = await buildOne(theme);
        if (r.carouselId) carouselIds.push(r.carouselId);
        if (r.reelId) reelIds.push(r.reelId);
        photosUsed += r.photosUsed;
        // Registra o título usado pra os próximos dias não repetirem o mesmo ângulo.
        try { if (db.addRecentTopics) db.addRecentTopics([theme.topic]); } catch (_) {}
      } catch (e) {
        console.error(`[DailyContent] tema ${theme.id} falhou:`, e.message);
        errors.push(`${theme.id}: ${e.message}`);
      }
    }

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
