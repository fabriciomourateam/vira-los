/**
 * qaStickersService.js
 * Gera pares pergunta+resposta ("caixinhas de perguntas") pro sticker do Stories,
 * baseados no Instagram REAL do usuário: posts que mais engajam + nicho + público.
 *
 * O usuário posta a pergunta no sticker "Faça uma pergunta" e responde ele mesmo,
 * simulando interação e gerando engajamento. Objetivo: 3x/semana.
 *
 * Fonte de dados (já populada pelo fluxo Analytics → Sincronizar/Analisar):
 *   db.getInstagramPosts()    — legendas + métricas de engajamento por post
 *   db.getInstagramAnalysis() — temas/sinais do que funciona (aiInsights, stats)
 *   db.getIdeasConfig()       — nicho/handle do usuário
 */

const Anthropic = require('@anthropic-ai/sdk');
const { jsonrepair } = require('jsonrepair');
const db = require('../db/database');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Template padrão (placeholders {{...}} são substituídos por dados reais) ──
// O usuário pode sobrescrever pela UI → vira db.getCaixinhasPrompt(). Reset
// volta pra essa string. Lista de placeholders disponíveis em PLACEHOLDERS abaixo.
const DEFAULT_PROMPT_TEMPLATE = `Você cria "caixinhas de perguntas" pro Instagram Stories de um criador.
O criador posta a PERGUNTA no sticker "Faça uma pergunta" e RESPONDE ele mesmo,
simulando dúvida de seguidor pra gerar engajamento e autoridade.

NICHO: {{niche}}{{handleBlock}}
{{audienceBlock}}{{focusBlock}}
POSTS QUE MAIS ENGAJARAM (use os TEMAS reais que o público dele responde — não invente assunto fora disso):
{{postsBlock}}
{{insightsBlock}}
REGRAS:
- Gere {{count}} pares pergunta+resposta.
- A PERGUNTA: curta (cabe no sticker, máx ~12 palavras), na voz de um seguidor real, dúvida genuína do nicho.
- A RESPOSTA: voz de especialista do criador, direta e com valor real, 1-3 frases, sem enrolação, tom de quem entende do assunto. Termine puxando autoridade ou um micro-CTA quando fizer sentido (sem ser vendedor demais).
- Ancore nos temas que JÁ engajam no perfil (acima). Nada genérico/fora do nicho.
- Sem hashtags, sem emojis em excesso (no máx 1 por resposta).
- Português do Brasil.

Responda APENAS com JSON, sem markdown:
{"pairs":[{"pergunta":"...","resposta":"...","tema":"palavra-chave do tema"}]}`;

const PLACEHOLDERS = [
  { key: 'niche',          desc: 'Seu nicho (de Configurações)' },
  { key: 'handleBlock',    desc: '"\\nHANDLE: @seu_handle" ou vazio' },
  { key: 'audienceBlock',  desc: 'Demografia real do público ou vazio' },
  { key: 'focusBlock',     desc: 'Foco da semana digitado na UI ou vazio' },
  { key: 'postsBlock',     desc: 'Top posts (carrosséis priorizados + engajamento)' },
  { key: 'insightsBlock',  desc: 'Análise de IA (aiInsights) ou vazio' },
  { key: 'count',          desc: 'Quantos pares (slider da UI, 3-10)' },
];

function substitute(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] != null ? String(vars[key]) : ''));
}

// Captions só com CTA genérico de seguir não agregam tema — descarta.
const LOW_VALUE_CAPTION_RE = /^siga\s+@\S+\s+para\s+mais\s+conte[uú]dos?\.?\s*$/i;

function isUsefulCaption(cap) {
  const t = (cap || '').replace(/\s+/g, ' ').trim();
  if (t.length < 30) return false;
  if (LOW_VALUE_CAPTION_RE.test(t)) return false;
  return true;
}

function topPostsByEngagement(posts, limit = 12) {
  return [...posts]
    .filter((p) => isUsefulCaption(p.caption))
    .sort((a, b) => (b.engagementRate || 0) - (a.engagementRate || 0))
    .slice(0, limit);
}

function buildPostsBlock(posts) {
  return posts
    .map((p, i) => {
      const cap = (p.caption || '').replace(/\s+/g, ' ').trim().slice(0, 280);
      return `${i + 1}. [${p.mediaType}] eng ${p.engagementRate ?? 0}% · ${p.likes ?? 0} likes · ${p.comments ?? 0} coments\n   "${cap}"`;
    })
    .join('\n');
}

function topN(map, n = 3) {
  return Object.entries(map || {}).sort((a, b) => b[1] - a[1]).slice(0, n);
}

// aiInsights pode vir como string (texto livre) OU objeto estruturado
// (summary, topFormat, hookPattern, etc). Renderiza como bullets legíveis
// em vez de JSON.stringify cru — evita JSON truncado no meio de string
// dentro do prompt, que confundia a IA.
function formatInsights(ai) {
  if (!ai) return '';
  if (typeof ai === 'string') return ai.slice(0, 2000);
  if (typeof ai !== 'object') return '';
  const lines = [];
  const push = (label, val) => {
    if (!val) return;
    const t = String(val).replace(/\s+/g, ' ').trim();
    if (t) lines.push(`- ${label}: ${t}`);
  };
  push('resumo',          ai.summary);
  push('formato top',     ai.topFormat);
  push('por que',         ai.topFormatReason);
  push('padrão de hook',  ai.hookPattern);
  push('melhor horário',  ai.bestTime);
  push('oportunidade',    ai.reelsOpportunity || ai.opportunity);
  push('padrões',         Array.isArray(ai.patterns) ? ai.patterns.join('; ') : ai.patterns);
  push('ações',           Array.isArray(ai.actions)  ? ai.actions.join('; ')  : ai.actions);
  return lines.join('\n').slice(0, 2000);
}

function buildAudienceLine(aud) {
  if (!aud) return '';
  const parts = [];
  if (aud.gender) {
    const g = topN(aud.gender, 3).map(([k, v]) => `${k}:${v}`).join(' ');
    if (g) parts.push(`gênero (${g})`);
  }
  if (aud.age) {
    const a = topN(aud.age, 3).map(([k]) => k).join(', ');
    if (a) parts.push(`faixas etárias predominantes: ${a}`);
  }
  if (aud.country) {
    const c = topN(aud.country, 3).map(([k]) => k).join(', ');
    if (c) parts.push(`países: ${c}`);
  }
  return parts.length
    ? `\nPÚBLICO REAL (calibre linguagem, exemplos e referências por isto): ${parts.join(' · ')}\n`
    : '';
}

/**
 * Monta o prompt final (template + dados reais do IG). Usado tanto pra gerar
 * de verdade quanto pra preview na UI.
 */
function buildPrompt({ note, count = 6 } = {}) {
  const posts = db.getInstagramPosts() || [];
  if (!posts.length) {
    throw new Error('Nenhum post sincronizado. Conecte e sincronize seu Instagram na aba Analytics primeiro.');
  }

  const analysis = db.getInstagramAnalysis() || {};
  const ideas    = db.getIdeasConfig() || {};
  const audience = db.getInstagramAudience() || null;
  const niche    = ideas.niche || 'fitness';
  const handle   = ideas.handle || ideas.instagramHandle || '';

  const carousels = topPostsByEngagement(posts.filter((p) => p.mediaType === 'CAROUSEL_ALBUM'), 8);
  const topAny    = topPostsByEngagement(posts, 12);
  const seen = new Set();
  const chosen = [...carousels, ...topAny].filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  }).slice(0, 14);

  const insightsText = formatInsights(analysis.aiInsights);

  const vars = {
    niche,
    handleBlock:   handle ? `\nHANDLE: @${String(handle).replace('@', '')}` : '',
    audienceBlock: buildAudienceLine(audience),
    focusBlock:    note && note.trim() ? `\nFOCO DESTA LEVA (priorize perguntas sobre isto): ${note.trim()}\n` : '',
    postsBlock:    buildPostsBlock(chosen),
    insightsBlock: insightsText ? `\nLEITURA DE PADRÕES DO PERFIL:\n${insightsText}\n` : '',
    count,
  };

  const customConfig = db.getCaixinhasPrompt ? db.getCaixinhasPrompt() : null;
  const template = (customConfig?.template && customConfig.template.trim())
    ? customConfig.template
    : DEFAULT_PROMPT_TEMPLATE;

  return {
    prompt: substitute(template, vars),
    isCustom: !!(customConfig?.template && customConfig.template.trim()),
    chosen,
    carousels: carousels.length,
    niche,
    temAnalise: !!insightsText,
    temPublico: !!audience,
  };
}

/**
 * @param {Object} params
 * @param {string} [params.note]  - Foco opcional da semana (ex: "creatina", "cutting")
 * @param {number} [params.count] - Quantos pares gerar (default 6)
 * @returns {Promise<{ pairs: Array<{pergunta:string,resposta:string,tema:string}>, baseadoEm: object }>}
 */
async function generateQaStickers({ note, count = 6 } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada.');

  const built = buildPrompt({ note, count });
  const prompt = built.prompt;

  // Prefill: força a resposta a começar dentro do JSON. Elimina prosa antes,
  // fences markdown, "Aqui está:" etc. Concatenamos com o que a IA continuar.
  const PREFILL = '{"pairs":[';
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [
      { role: 'user', content: prompt },
      { role: 'assistant', content: PREFILL },
    ],
  });

  const continuation = (res.content[0]?.text || '').trim();
  // Junta prefill + continuação. Tira qualquer prosa que tenha vindo depois do JSON fechado.
  let raw = PREFILL + continuation;
  // Se a IA continuou após `]}` com comentário, corta no último `]}`
  const lastClose = raw.lastIndexOf(']}');
  if (lastClose !== -1) raw = raw.slice(0, lastClose + 2);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // jsonrepair conserta newlines crus, vírgulas trailing, aspas mal escapadas.
    try {
      parsed = JSON.parse(jsonrepair(raw));
    } catch (err) {
      console.error('[QaStickers/Parse] falhou após repair:', err.message, '\nRaw:', raw.slice(0, 800));
      const e = new Error('Falha ao interpretar a resposta da IA.');
      e.rawSnippet = raw.slice(0, 1500);
      throw e;
    }
  }
  const pairs = Array.isArray(parsed.pairs)
    ? parsed.pairs.filter((p) => p?.pergunta && (p?.resposta || p?.respostaCurta || p?.respostaAudio))
    : [];
  if (!pairs.length) throw new Error('Nenhum par válido gerado. Tente de novo.');

  return {
    pairs,
    baseadoEm: {
      postsAnalisados: built.chosen.length,
      carrosseis: built.carousels,
      niche: built.niche,
      temAnalise: built.temAnalise,
      temPublico: built.temPublico,
    },
  };
}

module.exports = { generateQaStickers, buildPrompt, DEFAULT_PROMPT_TEMPLATE, PLACEHOLDERS };
