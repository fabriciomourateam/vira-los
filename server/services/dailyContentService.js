/**
 * dailyContentService.js — Rotina diária automática do Fabricio Moura.
 *
 * Todo dia (cron 09h America/Sao_Paulo) gera 2 CARROSSÉIS de temas DISTINTOS
 * (template fmteam, com o cérebro editorial: voz + anti-ban + ângulos) e 2 REELS
 * CURTOS tirados da FILA de roteiros pré-escritos (reel_content_queue), um por
 * horário (default 14h e 19h30), renderizados no estilo dourado, cada um com um
 * clipe cru DIFERENTE (do dia e dos dias anteriores). Fila vazia → reel por IA
 * (reserva). Salva tudo DENTRO do viralos (carousels.json + reels.json +
 * daily_content.json) — sem Notion.
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
  // `format:'comparacao'` = carrossel de NÚMERO/COMPARAÇÃO (formato dos posts de
  // 8-20k views: cru x cozido, X kcal x Y kcal, tabela de cortes, ÓTIMO/BOM/EVITE).
  // A rotina garante 1 desses por dia (pickThemes) com instrução de comparação.
  { id: 'comparacao-refeicao', group: 'comida', format: 'comparacao', tone: 'direto', emotion: 'surpresa', keywords: ['calorias', 'refeição', 'café da manhã', 'prato'],
    topics: ['A mesma refeição, o dobro de calorias — e você escolhe errado', 'Café da manhã de 280 x 500 kcal: a diferença que trava seu peso', 'Pão com ovo x tapioca com frango: qual seca de verdade?'] },
  { id: 'calorias-liquidas', group: 'comida', format: 'comparacao', tone: 'investigativo', emotion: 'surpresa', keywords: ['suco', 'bebida', 'líquido', 'refrigerante', 'café com leite'],
    topics: ['As calorias que você BEBE sem perceber (com números)', 'Suco natural x refrigerante: a diferença de kcal que engana', 'O cafezinho com leite e açúcar que soma o dia inteiro'] },
  { id: 'cru-cozido', group: 'comida', format: 'comparacao', tone: 'direto', emotion: 'surpresa', keywords: ['cru', 'cozido', 'porção', 'arroz', 'macarrão', 'gramas'],
    topics: ['Cru x cozido: a porção que você pesa errado todo dia', '100g de arroz cru viram quanto no prato? A conta que muda tudo', 'Você mede a comida crua ou cozida? A diferença é enorme'] },
  { id: 'cortes-carne', group: 'comida', format: 'comparacao', tone: 'investigativo', emotion: 'surpresa', keywords: ['carne', 'corte', 'proteína', 'patinho', 'calorias'],
    topics: ['Carne na dieta não é só patinho: a tabela de cortes por kcal e proteína', 'O corte de carne mais barato que tem tanta proteína quanto o filé', 'Kcal x proteína dos cortes: qual escolher pra secar'] },
  { id: 'otimo-bom-evite', group: 'comida', format: 'comparacao', tone: 'direto', emotion: 'curiosidade', keywords: ['ovo', 'batata', 'queijo', 'ótimo', 'evite', 'escolha'],
    topics: ['Ovo, batata e queijo: ÓTIMO x BOM x EVITE (o mapa do preparo)', 'A forma de preparar que transforma comida boa em vilã', 'Mesmo alimento, 3 preparos: qual seca e qual engorda'] },
  { id: 'proteina-saciedade', group: 'comida', tone: 'direto', emotion: 'curiosidade', keywords: ['proteína', 'saciedade', 'fome', 'ovo', 'frango'],
    topics: ['Você come muito menos proteína do que imagina', 'A proteína que segura a fome até a próxima refeição', 'Prato sem proteína é fome garantida daqui 2 horas'] },
  { id: 'montar-prato', group: 'comida', tone: 'direto', emotion: 'curiosidade', keywords: ['prato', 'montar', 'porção', 'refeição'],
    topics: ['Como montar o prato pra secar sem passar fome', 'A ordem dos alimentos no prato muda o teu resultado', 'O prato que enche o olho e ainda seca'] },
  // ── TROCAS (parece igual mas não é — viraliza no teu perfil) ──
  { id: 'parece-igual', group: 'trocas', format: 'comparacao', tone: 'provocativo', emotion: 'surpresa', keywords: ['parece igual', 'troca', 'leite em pó', 'composto'],
    topics: ['Parece igual, mas um seca e o outro engorda', 'Leite em pó x composto lácteo: a pegadinha do mercado', 'Duas comidas idênticas no olho, opostas no corpo'] },
  { id: 'fit-que-nao-e', group: 'trocas', format: 'comparacao', tone: 'provocativo', emotion: 'indignação', keywords: ['fit', 'zero', 'diet', 'barrinha'],
    topics: ['A comida "fit" que não é fit', 'O "zero açúcar" que engorda do mesmo jeito', 'Barrinha de proteína x chocolate: surpresa no rótulo'] },
  { id: 'rotulo', group: 'trocas', format: 'comparacao', tone: 'investigativo', emotion: 'curiosidade', keywords: ['rótulo', 'ingredientes', 'tabela', 'industrializado'],
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

  // ── HISTÓRIA DE CLIENTE (format:'historia') — o DNA do post nº1 do Fabricio
  // (38k views, 280 shares, 36 seguidores): "[Ele/Ela] usava X há Y e [problema
  // oculto] — o que mudamos". Mix de público: homem (comprador) e mulher (alcance).
  // A rotina garante 1 desses por dia (pickThemes) com INSTRUCTION_HISTORIA.
  { id: 'hist-caneta-musculo-h', group: 'historia', format: 'historia', audience: 'homem', tone: 'história', emotion: 'curiosidade', keywords: ['caneta', 'músculo', 'tirzepatida', 'mounjaro', 'ozempic', 'flácido'],
    topics: ['Ele usava a caneta há 6 meses e perdia músculo sem saber. O que mudamos', 'Ele secou na caneta mas ficou fraco e flácido. O que mudamos', 'Ele emagreceu rápido e o shape sumiu junto. O que mudamos'] },
  { id: 'hist-testo-cansaco-h', group: 'historia', format: 'historia', audience: 'homem', tone: 'história', emotion: 'curiosidade', keywords: ['cansaço', 'testosterona', 'energia', 'libido', 'reposição'],
    topics: ['Ele repunha testosterona há 8 meses e ainda vivia cansado. O que mudamos', 'Ele tinha tudo pra render e vivia sem energia. O que mudamos', 'Ele achava que o cansaço era da idade — era a rotina. O que mudamos'] },
  { id: 'hist-barriga-treino-h', group: 'historia', format: 'historia', audience: 'homem', tone: 'história', emotion: 'surpresa', keywords: ['barriga', 'treino', 'shape', 'gordura', 'cardio'],
    topics: ['Ele treinava pesado e a barriga não saía. O que mudamos', 'Ele cortava tudo e não secava. O que mudamos', 'Ele fazia cardio todo dia e travou. O que mudamos'] },
  { id: 'hist-caneta-flacida-m', group: 'historia', format: 'historia', audience: 'mulher', tone: 'história', emotion: 'curiosidade', keywords: ['caneta', 'flácida', 'músculo', 'tirzepatida', 'emagrecer'],
    topics: ['Ela usava tirzepatida há 6 meses e perdia músculo sem saber. O que mudamos', 'Ela emagreceu na caneta e ficou magra flácida. O que mudamos', 'Ela secou rápido e a pele não acompanhou. O que mudamos'] },
  { id: 'hist-dieta-travou-m', group: 'historia', format: 'historia', audience: 'mulher', tone: 'história', emotion: 'acolhimento', keywords: ['dieta', 'travou', 'platô', 'emagrecer', 'tentou de tudo'],
    topics: ['Ela tentou de tudo e não descia. O que mudamos', 'Ela vivia de dieta e não secava. O que mudamos', 'Ela comia quase nada e a balança parada. O que mudamos'] },
  { id: 'hist-doce-noite-m', group: 'historia', format: 'historia', audience: 'mulher', tone: 'história', emotion: 'curiosidade', keywords: ['doce', 'noite', 'ansiedade', 'compulsão'],
    topics: ['Ela segurava o dia todo e atacava a geladeira à noite. O que mudamos', 'Ela achava que era falta de força de vontade. O que mudamos', 'Ela vivia refém do doce à noite. O que mudamos'] },
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

// Escolhe 2 temas/dia com equilíbrio entre PERFORMANCE e VARIEDADE (feed não pode
// ficar previsível): o 1º é um dos formatos VENCEDORES — comparação/número OU
// história de cliente, sorteado (~50/50), então nem sempre o mesmo formato; o 2º é
// um tema VARIADO, de grupo E formato DIFERENTES do 1º (hábito, mente, trocas,
// corpo, caneta...). Assim todo dia tem 1 formato campeão, mas o feed alterna e
// respira. Evita ids recentes (14d) e desincentiva grupos usados nos últimos dias.
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

  // 1º tema: um formato VENCEDOR, sorteando o LANE (~50/50) pra não repetir o mesmo
  // formato todo dia. Se o lane sorteado não tiver tema fresco, tenta o outro.
  const lanes = Math.random() < 0.5 ? ['comparacao', 'historia'] : ['historia', 'comparacao'];
  let first = null;
  for (const lane of lanes) {
    let lanePool = pool.filter((t) => t.format === lane);
    if (!lanePool.length) lanePool = THEMES.filter((t) => t.format === lane);
    if (lanePool.length) { first = weightedSample(lanePool, lanePool.map(weightOf), 1)[0]; break; }
  }
  if (!first) first = weightedSample(pool, pool.map(weightOf), 1)[0];
  if (!first) return [];

  // 2º tema: VARIADO — grupo E formato diferentes do 1º (feed fresco). Fallbacks
  // progressivos: relaxa formato, depois grupo, por último qualquer outro id.
  let rest = pool.filter((t) => t.id !== first.id && t.group !== first.group && t.format !== first.format);
  if (!rest.length) rest = pool.filter((t) => t.id !== first.id && t.group !== first.group);
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

// Instrução PADRÃO (habitos/mente/corpo — conteúdo de ideia).
const INSTRUCTION_DEFAULT = 'Fale com quem quer emagrecer sem passar fome, na correria da vida real (trabalho, filhos, casa) — serve pro homem e pra mulher. Gancho na capa que para o scroll. Ponto prático traduzido, sem jargão de academia.';

// Instrução de COMPARAÇÃO/NÚMERO — o formato dos posts de 8-20k views do Fabricio
// (cru x cozido, X kcal x Y kcal, tabela de cortes, ÓTIMO/BOM/EVITE). Força número
// concreto e comparação lado a lado em vez de texto genérico.
const INSTRUCTION_COMPARACAO = [
  'Este é um carrossel de COMPARAÇÃO COM NÚMERO — o formato que mais viraliza no perfil (salva pra consultar).',
  'REGRAS OBRIGATÓRIAS:',
  '• Cada slide de conteúdo compara 2 a 4 opções LADO A LADO com NÚMERO CONCRETO (kcal, gramas de proteína, porção em g). Ex.: "100g arroz = 130 kcal x 6 ovos = 470 kcal".',
  '• Use números plausíveis e realistas de tabela nutricional. Nunca invente valor absurdo. Arredonda pra número redondo e fácil de ler.',
  '• Formato visual de comparação: "A x B", tabela, ou ÓTIMO / BOM / EVITE. Um par ou trio por slide, número em destaque.',
  '• Capa: gancho curto com a promessa da comparação (ex.: "O mesmo prato, o DOBRO de calorias"). Sem parágrafo na capa.',
  '• Fecha com o aprendizado prático: o que escolher no dia a dia.',
  '• Fala com homem 25-40 E mulher 35-44 (comida serve pros dois). Português, sem jargão gringo. Anti-ban: nada de substância.',
].join('\n');

// Instrução de HISTÓRIA DE CLIENTE — o formato do post nº1 do Fabricio (38k views,
// 280 compartilhamentos). Capa em 3ª pessoa (compartilha), miolo em "você"
// (identifica), arco problema→mecanismo→o que mudamos→resultado. Anti-ban rígido.
function instructionHistoria(audience) {
  const publico = audience === 'homem'
    ? 'Fala com HOMEM 25-40: saúde hormonal, performance, energia, shape e composição corporal.'
    : 'Fala com MULHER 35-44: emagrecimento na vida real (correria, trabalho, filhos, casa).';
  return [
    'Este é um carrossel de HISTÓRIA DE CLIENTE — o formato que MAIS compartilha e traz seguidor no perfil (foi o post nº1 do Fabricio).',
    'REGRAS OBRIGATÓRIAS:',
    '• CAPA em 3ª pessoa, formato história: "[Ele/Ela] + [situação com um tema quente] + há [tempo] + [problema que ninguém percebe] + O que mudamos." Lacuna ABERTA — NÃO entrega a resposta na capa. Sem parágrafo na capa.',
    '• Os slides contam a virada num arco: (1) como a pessoa estava / o problema real, (2) POR QUE acontecia (mecanismo simples, traduzido, sem jargão), (3 a 5) "O QUE MUDAMOS" em 2-3 passos concretos e aplicáveis, (6) o resultado — firme, com energia, sustentável.',
    '• DENTRO dos slides, vire pra 2ª pessoa ("se você tá assim...", "o teu corpo faz isso") pra a pessoa se identificar. Capa em 3ª pessoa (faz compartilhar), miolo em "você" (faz se reconhecer).',
    '• É PROVA + EDUCAÇÃO: mostra que o treinador resolveu, com autoridade e sem se gabar. Sem números de venda, sem "antes e depois" agressivo.',
    '• ANTI-BAN RÍGIDO: educativo, por sintoma/mecanismo. NUNCA cite dose, protocolo, "como usar", nome comercial de remédio, nem recomende substância. O tema quente (ex.: a caneta) entra como CONTEXTO da história, jamais como recomendação.',
    '• Fecha com o aprendizado + um convite leve (comentar/DM).',
    '• ' + publico + ' Português, sem jargão gringo.',
  ].join('\n');
}

// Niche por público do tema (história de homem usa o nicho masculino).
const NICHE_HOMEM = 'Saúde hormonal, performance masculina e composição corporal para homens 25-40';
function nicheFor(theme) {
  return theme.audience === 'homem' ? NICHE_HOMEM : NICHE;
}

async function buildOne(theme) {
  // Fotos dos carrosséis recentes — pra NÃO repetir foto entre carrosséis seguidos.
  // Lido fresco a cada carrossel (o anterior já salvou as dele), então os 2 do dia
  // também não repetem entre si.
  const avoidPhotoUrls = db.getRecentPhotoUrls ? db.getRecentPhotoUrls() : [];

  // 1) Carrossel fmteam — instrução muda se o tema é de comparação/número.
  const carouselResult = await generateCarousel({
    topic: theme.topic,
    instructions: theme.format === 'comparacao' ? INSTRUCTION_COMPARACAO
                : theme.format === 'historia'   ? instructionHistoria(theme.audience)
                : INSTRUCTION_DEFAULT,
    niche: nicheFor(theme),
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

  // Reel NÃO é mais gerado por carrossel aqui. Agora sai 1/dia da FILA de roteiros
  // pré-escritos (generateQueuedReel), postado às 19h30. Ver generateDailyBatch.
  // Devolve o html do carrossel pra ser usado só na RESERVA (fila vazia → reel por IA).
  return {
    theme, carouselId, reelId: null, photosUsed: carouselResult.unsplashImagesUsed || 0,
    carousel: { id: carouselId, topic: carousel.topic, legenda: carousel.legenda, numSlides: carousel.numSlides, _html: carouselResult.html },
  };
}

// Ids dos clipes crus usados nos últimos N reels — pra o sorteio EVITAR repetir
// vídeo em dias seguidos (anti-repetição robusta, sobrevive a reset do "saco").
function recentRawVideoIds(n = 6) {
  const used = [];
  for (const r of db.getAllReels()) {            // já vem ordenado do mais novo
    if (r.rawVideoId) used.push(r.rawVideoId);
    if (used.length >= n) break;
  }
  return used;
}

// Horários do reel diário (default 14h + 19h30). Aceita reelDailyTimes (array)
// ou o antigo reelDailyTime (string) por compatibilidade.
function reelDailyTimes() {
  const cfg = db.getMlabsSettings();
  const arr = Array.isArray(cfg.reelDailyTimes) && cfg.reelDailyTimes.length
    ? cfg.reelDailyTimes
    : (cfg.reelDailyTime ? [cfg.reelDailyTime] : ['14:00', '19:30']);
  return arr.map((t) => String(t).slice(0, 5)).filter((t) => /^\d{2}:\d{2}$/.test(t));
}

// Janela em torno do horário alvo (alvo, +30min, +60min) pra SEMPRE achar slot
// livre mesmo se o horário exato colidir com outro post (gap de 1h).
function timeWindow(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const base = h * 60 + m;
  return [0, 30, 60].map((off) => {
    const x = (base + off) % (24 * 60);
    return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
  });
}

// Monta 1 reel (fila → IA reserva), renderiza no dourado com clipe diferente e
// agenda no horário alvo. Retorna { reelId, rawVideoId } pra encadear anti-repetição.
async function buildAndScheduleQueuedReel({ time, carousels = [], avoidRawIds = [] }) {
  const cfg = db.getMlabsSettings();
  let reelId = null;
  let queueSlug = null;

  const item = db.getNextReelQueueItem();
  if (item) {
    reelId = `reel_q_${Date.now()}_${item.slug}`;
    queueSlug = item.slug;
    db.saveReel({
      id: reelId,
      fraseTela: item.fraseTela,
      fraseTelaTiming: '0-4s',
      ctaTela: item.ctaTela || '👇 LEIA A LEGENDA',
      ctaTelaTiming: '4-5s',
      legendaPost: item.legendaPost,
      title: item.title || (item.fraseTela || '').replace(/\*\*/g, '').slice(0, 60),
      niche: NICHE, instagramHandle: `@${HANDLE}`,
      source: 'queue', queueSlug, audience: item.audience || null, archived: false,
    });
    console.log(`[DailyContent] reel da FILA (${time}): ${item.slug} (${item.audience}).`);
  } else if (carousels.length) {
    // Reserva: fila vazia → gera reel por IA a partir de um carrossel do dia.
    try {
      const c = carousels[0];
      const reel = await generateShortReelFromCarousel({
        carousel: { id: c.id, topic: c.topic, html: c._html || '', legenda: c.legenda, numSlides: c.numSlides },
        duration: 7, niche: NICHE, instagramHandle: `@${HANDLE}`,
      });
      reelId = `reel_${Date.now()}_ia`;
      db.saveReel({
        ...reel, id: reelId, carouselId: c.id, carouselTopic: c.topic,
        niche: NICHE, instagramHandle: `@${HANDLE}`, source: 'daily', archived: false,
      });
      console.log(`[DailyContent] fila vazia — reel (${time}) por IA (reserva).`);
    } catch (e) {
      console.warn('[DailyContent] reserva IA do reel falhou:', e.message);
      return { reelId: null, rawVideoId: null };
    }
  } else {
    console.warn('[DailyContent] sem item na fila e sem carrossel — reel pulado.');
    return { reelId: null, rawVideoId: null };
  }

  let rawVideoId = null;
  try {
    if (cfg.autoRenderReel && db.countUsableRawVideos() > 0) {
      const { renderReelVideo, scheduleReelNow } = require('./reelPipelineService');
      // Evita os clipes usados nos últimos dias + os já usados HOJE (avoidRawIds).
      const avoid = recentRawVideoIds(6).concat(avoidRawIds);
      // forceStyle 'fmteam' → os meus roteiros SEMPRE saem dourados (nunca branco/contorno).
      const rendered = await renderReelVideo(reelId, { avoidRawVideoIds: avoid, forceStyle: 'fmteam' });
      rawVideoId = rendered && rendered.rawVideoId;
      console.log(`[DailyContent] reel ${reelId} renderizado (dourado/fmteam).`);
      if (queueSlug) db.markReelQueueItemUsed(queueSlug, reelId);
      if (cfg.autoScheduleReel) {
        const dates = require('./mlabsService').computeNextReelSlots(1, { times: timeWindow(time) });
        const sch = await scheduleReelNow(reelId, { dates });
        console.log(`[DailyContent] reel ${reelId} agendado (~${time}) →`, (sch.dates || []).join(', '));
      }
    } else if (cfg.autoRenderReel) {
      console.warn(`[DailyContent] auto-render ligado mas sem vídeo cru — reel ${reelId} sem vídeo (roteiro NÃO consumido).`);
    } else if (queueSlug) {
      db.markReelQueueItemUsed(queueSlug, reelId); // rascunho pra render manual
    }
  } catch (e) {
    console.warn(`[DailyContent] render/agendar reel (${time}) falhou (${reelId}):`, e.message);
  }

  return { reelId, rawVideoId };
}

// Gera os reels do dia (1 por horário configurado — default 14h e 19h30), da FILA
// de roteiros meus (qualidade), no dourado, cada um com um clipe DIFERENTE (do dia
// e dos dias anteriores). Isolado: falha aqui não derruba o batch de carrosséis.
async function generateQueuedReel({ carousels = [] } = {}) {
  const times = reelDailyTimes();
  const reelIds = [];
  const usedToday = [];   // clipes já usados hoje → não repete entre os reels do dia
  // CADA reel tem seu PRÓPRIO timeout — se o 1º render demorar/falhar, o 2º ainda
  // roda (antes um timeout único cobria os dois e derrubava o 2º, saindo só 1/dia).
  for (const t of times) {
    try {
      const r = await withTimeout(
        buildAndScheduleQueuedReel({ time: t, carousels, avoidRawIds: usedToday }),
        DAILY_THEME_TIMEOUT_MS, `reel ${t}`,
      );
      if (r.reelId) reelIds.push(r.reelId);
      if (r.rawVideoId) usedToday.push(r.rawVideoId);
    } catch (e) {
      console.warn(`[DailyContent] reel ${t} falhou/timeout — segue pro próximo:`, e.message);
    }
  }
  return { reelIds };
}

// Gera o batch do dia (2 temas). Resiliente: falha de 1 tema não derruba o outro.
// Sincroniza os números REAIS dos posts do Instagram (saves/shares/seguidores/etc.)
// pro auto-ajuste por performance (scoreThemes/weightOf) sempre pesar os temas pelo
// dado MAIS RECENTE. Best-effort: nunca derruba a geração do dia.
async function refreshInstagramPerformance() {
  try {
    const tok = db.getInstagramToken && db.getInstagramToken();
    const plat = db.getPlatformToken && db.getPlatformToken('instagram');
    const accessToken = (tok && tok.accessToken) || (plat && plat.access_token);
    if (!accessToken) { console.log('[DailyContent] IG não conectado — auto-ajuste usa o último dado salvo.'); return; }
    const { syncPosts } = require('./instagramService');
    const posts = await withTimeout(syncPosts(accessToken), 90 * 1000, 'sync IG');
    if (Array.isArray(posts) && posts.length) {
      db.saveInstagramPosts(posts);
      console.log(`[DailyContent] performance IG sincronizada (${posts.length} posts) pro auto-ajuste.`);
    }
  } catch (e) {
    console.warn('[DailyContent] sync IG falhou (segue com o dado anterior):', e.message);
  }
}

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

  // Placeholder 'generating' JÁ NO INÍCIO: vira o estado corrente do dia (o poller do
  // workflow espera em vez de ler um batch de erro ANTIGO e desistir). Atualizado no fim.
  try { db.saveDailyBatch({ id: batchId, date, trigger, themes: [], carouselIds: [], reelIds: [], status: 'generating', errors: [] }); } catch (_) {}

  try {
    // pickThemes/pickAngle ficam DENTRO do try: se estourarem, o erro é registrado
    // no batch (visível em /api/daily-content) em vez de sumir no log do Fly.
    try {
      // Auto-ajuste por performance: puxa os números REAIS do Instagram ANTES de
      // escolher os temas, pra o scoreThemes/weightOf pesar pelos saves/shares/
      // seguidores mais recentes (não por dado velho). Best-effort.
      await refreshInstagramPerformance();
      const themes = pickThemes();
      resolved = themes.map((t) => ({ ...t, topic: pickAngle(t) }));

      const dayCarousels = [];
      for (const theme of resolved) {
        try {
          // Teto por tema: se travar, cai no catch e a geração segue (não pendura tudo).
          const r = await withTimeout(buildOne(theme), DAILY_THEME_TIMEOUT_MS, `tema ${theme.id}`);
          if (r.carouselId) carouselIds.push(r.carouselId);
          if (r.carousel) dayCarousels.push(r.carousel);
          photosUsed += r.photosUsed;
          try { if (db.addRecentTopics) db.addRecentTopics([theme.topic]); } catch (_) {}
        } catch (e) {
          console.error(`[DailyContent] tema ${theme.id} falhou:`, e.message);
          errors.push(`${theme.id}: ${e.message}`);
        }
      }

      // 1 reel/dia da FILA de roteiros meus (dourado, 19h30). Reserva: IA a partir
      // de um carrossel do dia se a fila esgotou. Isolado do loop de carrosséis.
      try {
        const rq = await withTimeout(generateQueuedReel({ carousels: dayCarousels }), 3 * DAILY_THEME_TIMEOUT_MS, 'reel-fila');
        for (const id of (rq.reelIds || [])) reelIds.push(id);
      } catch (e) {
        console.error('[DailyContent] reel da fila falhou:', e.message);
        errors.push(`reel-fila: ${e.message}`);
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
    // Atualiza o placeholder 'generating' criado no início (não duplica o batch do dia).
    try { db.updateDailyBatch(batchId, batch); } catch (e) { console.error('[DailyContent] falha ao salvar batch:', e.message); }
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
