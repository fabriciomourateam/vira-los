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
const db = require('../db/database');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function topPostsByEngagement(posts, limit = 12) {
  return [...posts]
    .filter((p) => (p.caption || '').trim().length > 0)
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

/**
 * @param {Object} params
 * @param {string} [params.note]  - Foco opcional da semana (ex: "creatina", "cutting")
 * @param {number} [params.count] - Quantos pares gerar (default 6)
 * @returns {Promise<{ pairs: Array<{pergunta:string,resposta:string,tema:string}>, baseadoEm: object }>}
 */
async function generateQaStickers({ note, count = 6 } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada.');

  const posts = db.getInstagramPosts() || [];
  if (!posts.length) {
    throw new Error('Nenhum post sincronizado. Conecte e sincronize seu Instagram na aba Analytics primeiro.');
  }

  const analysis = db.getInstagramAnalysis() || {};
  const ideas    = db.getIdeasConfig() || {};
  const niche    = ideas.niche || 'fitness';
  const handle   = ideas.handle || ideas.instagramHandle || '';

  // Prioriza carrosséis (legenda mais rica) + top por engajamento de qualquer tipo
  const carousels = topPostsByEngagement(posts.filter((p) => p.mediaType === 'CAROUSEL_ALBUM'), 8);
  const topAny    = topPostsByEngagement(posts, 12);
  // Une sem duplicar, carrosséis primeiro
  const seen = new Set();
  const chosen = [...carousels, ...topAny].filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  }).slice(0, 14);

  const insightsText = typeof analysis.aiInsights === 'string'
    ? analysis.aiInsights.slice(0, 1500)
    : (analysis.aiInsights ? JSON.stringify(analysis.aiInsights).slice(0, 1500) : '');

  const focoLine = note && note.trim()
    ? `\nFOCO DESTA LEVA (priorize perguntas sobre isto): ${note.trim()}\n`
    : '';

  const prompt = `Você cria "caixinhas de perguntas" pro Instagram Stories de um criador.
O criador posta a PERGUNTA no sticker "Faça uma pergunta" e RESPONDE ele mesmo,
simulando dúvida de seguidor pra gerar engajamento e autoridade.

NICHO: ${niche}${handle ? `\nHANDLE: @${String(handle).replace('@', '')}` : ''}
${focoLine}
POSTS QUE MAIS ENGAJARAM (use os TEMAS reais que o público dele responde — não invente assunto fora disso):
${buildPostsBlock(chosen)}
${insightsText ? `\nLEITURA DE PADRÕES DO PERFIL:\n${insightsText}\n` : ''}
REGRAS:
- Gere ${count} pares pergunta+resposta.
- A PERGUNTA: curta (cabe no sticker, máx ~12 palavras), na voz de um seguidor real, dúvida genuína do nicho.
- A RESPOSTA: voz de especialista do criador, direta e com valor real, 1-3 frases, sem enrolação, tom de quem entende do assunto. Termine puxando autoridade ou um micro-CTA quando fizer sentido (sem ser vendedor demais).
- Ancore nos temas que JÁ engajam no perfil (acima). Nada genérico/fora do nicho.
- Sem hashtags, sem emojis em excesso (no máx 1 por resposta).
- Português do Brasil.

Responda APENAS com JSON, sem markdown:
{"pairs":[{"pergunta":"...","resposta":"...","tema":"palavra-chave do tema"}]}`;

  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = (res.content[0]?.text || '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('A IA não retornou JSON válido.');
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error('Falha ao interpretar a resposta da IA.');
  }
  const pairs = Array.isArray(parsed.pairs) ? parsed.pairs.filter((p) => p?.pergunta && p?.resposta) : [];
  if (!pairs.length) throw new Error('Nenhum par válido gerado. Tente de novo.');

  return {
    pairs,
    baseadoEm: {
      postsAnalisados: chosen.length,
      carrosseis: carousels.length,
      niche,
      temAnalise: !!insightsText,
    },
  };
}

module.exports = { generateQaStickers };
