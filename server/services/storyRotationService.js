/**
 * storyRotationService.js — Cérebro dos Stories automáticos do Fabricio.
 *
 * Faz duas coisas:
 *  1. ROTAÇÃO DE MODOS (anti-repetição) pra não saturar: valor / engajamento /
 *     oferta / prova / conexão. Escolhe o modo do dia evitando repetir e limitando
 *     a oferta (no máx 1-2x/semana), com desincentivo a modos usados nos últimos dias.
 *  2. GERAÇÃO da sequência do dia NA VOZ do Fabricio (destilada da IA de check-in do
 *     controle-de-pacientes — tom já aprovado por ele), amarrada no carrossel/reel do
 *     dia e na palavra-chave que a IA da DM atende.
 *
 * ESTILO VISUAL (contrato pro render, Phase 2): texto em CAIXA NORMAL (1ª letra
 * maiúscula, resto minúsculo — NUNCA as garrafais do reel), alinhado à ESQUERDA,
 * centralizado verticalmente no story. Frases curtas, quebradas pra caber. Opcional:
 * no máximo 1 palavra entre **asteriscos** vira dourado (destaque sutil, não grito).
 */

const Anthropic = require('@anthropic-ai/sdk');
const { FMTEAM_EDITORIAL, stripAiTells, applySkinTone } = require('./fmteamEditorial');
const { SUBSTANCE_INTEL } = require('./substanceIntel');
const db = require('../db/database');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HANDLE = 'fabriciomourateam';

// ── Voz do Fabricio nos stories (destilada da IA de check-in — tom já aprovado) ──
const FABRICIO_STORY_VOICE = `━━━ VOZ DO FABRICIO NOS STORIES (OBRIGATÓRIO — tom já aprovado por ele) ━━━
É o MESMO tom da entrega de check-in dele. Treinador de verdade falando com o cara, não coach genérico, não IA.
- ELOGIO/ENERGIA primeiro, nunca bronca. Mesmo quando cobra, é leve, de parceiro (um "kkk" cai bem). A pessoa termina o story querendo AGIR, não culpada.
- CRU E DIRETO, frase curta. Sem "redação" arrumadinha, sem encheção de linguiça. Afiado e curto vale mais que textão.
- HONESTO, sem hype falso. Fala "top" só quando é top de verdade. A autoridade vem do que ele entende de hormônio/treino/nutrição, não de motivação vazia.
- GÍRIA LEVE de academia OK ("cara", "mano", "olha", "presta atenção", "segura a boca aí", "kkk"). Português, nunca jargão gringo ("falso magro", não "skinny fat").
- TRATAMENTO "você" (seu/sua/te). PROIBIDO "tu/ti/teu/tua".
- SEM TRAÇO: NUNCA travessão ("—"/"–") nem hífen solto entre espaços (" - ") pra emendar ideia. Use vírgula ou ponto. (É regra do próprio Fabricio.)
- BORDÕES PROIBIDOS (soam IA, ele corta): "vou ser direto/sincero/real contigo", "sem drama", "roda isso e me conta"/"aplica e me conta", "ataquei", "imagina se...", "a verdade é que", "spoiler". Não anuncie que vai ser direto: seja direto.
- CLICHÊ Nº1 DE IA, PROIBIDÍSSIMO: a construção espelhada "não é X, é Y" e TODAS as variações: "não é sorte, é método", "não é X. É Y", "o problema não é X, é Y", "não é sobre X, é sobre Y", "menos X, mais Y". NUNCA emende duas ideias nesse formato. Fala direto o que é.
- EMOJI com tom de pele usa SEMPRE o tom do Fabricio: 🏼. Ex.: 💪🏼, 👊🏼, 🙏🏼, 👍🏼. Nunca o amarelo neutro em mão/corpo/pessoa.
- CAIXA NORMAL no texto (1ª maiúscula, resto minúsculo). NÃO escreva em CAIXA ALTA.
- Fecha provocando RESPOSTA: pergunta curta e específica, ou o CTA da palavra.`;

// ── Modos de story. weight = peso base no sorteio. maxPerWeek limita saturação. ──
const STORY_MODES = [
  { key: 'valor',       weight: 4.0,                 label: 'Valor (ensina)' },
  { key: 'engajamento', weight: 3.0,                 label: 'Engajamento (enquete/pergunta)' },
  { key: 'oferta',      weight: 1.2, maxPerWeek: 2,  label: 'Oferta leve (CTA de resultado)' },
  { key: 'prova',       weight: 1.2,                 label: 'Prova (bastidor/aluno)' },
  { key: 'conexao',     weight: 1.0,                 label: 'Conexão (bastidor do Fabricio)' },
];

// Sorteio ponderado simples (1 item).
function weightedPick(items, weights) {
  const total = weights.reduce((s, w) => s + Math.max(w, 0), 0);
  if (total <= 0) return items[0];
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) { r -= Math.max(weights[i], 0); if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

/**
 * Escolhe o modo do dia com anti-repetição.
 * @param {string[]} recentModes  modos dos últimos dias (mais recente primeiro)
 * @param {string[]} weekModes    modos dos últimos 7 dias (pra limitar a oferta)
 */
function pickStoryMode(recentModes = [], weekModes = []) {
  const lastMode = recentModes[0];
  const ofertaWeek = (weekModes || []).filter((m) => m === 'oferta').length;
  let pool = STORY_MODES.filter((m) => {
    if (m.key === lastMode) return false;                                   // nunca 2 dias seguidos
    if (m.key === 'oferta' && ofertaWeek >= (m.maxPerWeek || 2)) return false; // oferta capada
    return true;
  });
  if (!pool.length) pool = STORY_MODES.filter((m) => m.key !== lastMode);
  if (!pool.length) pool = STORY_MODES.slice();
  const recent2 = new Set((recentModes || []).slice(0, 2));
  const weights = pool.map((m) => m.weight * (recent2.has(m.key) ? 0.25 : 1));
  return weightedPick(pool, weights).key;
}

// Estrutura da sequência por modo (injetada no prompt).
function modeInstruction(mode, { ctaKeyword, ctaBenefit }) {
  const cta = `"${ctaKeyword}"`;
  switch (mode) {
    case 'valor':
      return `MODO = VALOR (ensina, sem pedir nada forte). 4 stories:
1) Gancho/sintoma do tema do dia (para o scroll).
2) O erro comum + o porquê (mecanismo simples, traduzido).
3) O que fazer na prática (1 passo concreto, aplicável hoje).
4) Fecho leve conectando ao post: "tem o resto no post de hoje" + convida a arrastar/ver. Sem CTA de venda.`;
    case 'engajamento':
      return `MODO = ENGAJAMENTO (o maior gerador de DM). 5 stories. IMPORTANTE: o autodiagnóstico é por RESPOSTA (texto), NÃO sticker de enquete (sticker nativo não dá pra agendar). Toda interação pede pra pessoa RESPONDER o story, e o reply cai na DM onde a IA assume:
1) Gancho/dor do tema.
2) Agita + mecanismo (liga o sintoma ao hormônio/rotina).
3) Autodiagnóstico EM TEXTO: lista 2 a 4 sintomas curtos (ex.: "1) cansaço mesmo dormindo  2) libido baixa  3) barriga teimosa") e manda RESPONDER qual mais pega ("me responde aqui qual é mais você"). sticker = null.
4) Prova/autoridade curta, SEM clichê (nada de "não é X, é Y").
5) CTA pra DM: manda responder a palavra ${cta} ("respondeu 2 ou mais? manda ${cta} aqui que eu te falo o que investigar"). A palavra vai em "cta".`;
    case 'oferta':
      return `MODO = OFERTA LEVE (direto pra DM, sem queimar). 4 stories:
1) Gancho de resultado/dor ("travado no shape há meses?").
2) Promessa concreta + como ("dá pra destravar com método, não com mais sofrimento").
3) Prova rápida/autoridade.
4) CTA de resultado: "quer ${ctaBenefit}? responde ${cta} aqui" (a palavra vai em "cta"). Tom de convite, não de venda forçada.`;
    case 'prova':
      return `MODO = PROVA (bastidor/aluno, ban-safe, anônimo). 3-4 stories:
1) O ponto de partida do aluno (situação/sintoma, sem nome, sem antes-depois agressivo).
2) O que mudou (2-3 condutas, por mecanismo, sem dose/substância).
3) O resultado (honesto, sem milagre).
4) Convite leve: "quer saber o que mudei no caso dele? me chama". Pode usar a palavra ${cta} opcional em "cta".`;
    case 'conexao':
      return `MODO = CONEXÃO (humaniza, quebra a monotonia). 3 stories:
1) Bastidor real do Fabricio OU uma opinião forte dele sobre treino/nutrição (sem mimimi).
2) Desenvolve com autoridade e papo reto.
3) Fecho com uma PERGUNTA pra abrir conversa, pedindo pra pessoa RESPONDER o story ("me responde aqui..."), NÃO sticker. sticker = null. Sem CTA de venda, "cta" fica null.`;
    default:
      return modeInstruction('valor', { ctaKeyword, ctaBenefit });
  }
}

/**
 * Gera a sequência de stories do dia.
 * @param {Object} a
 * @param {string} a.mode        modo escolhido (pickStoryMode)
 * @param {string} a.topic       tema/título do carrossel/reel do dia
 * @param {string} a.hook        gancho/capa do post do dia (pra amarrar)
 * @param {string} a.legenda     legenda do post (contexto; opcional)
 * @param {string} a.ctaKeyword  palavra que a IA da DM atende (ex.: DIAGNÓSTICO, PLANO)
 * @param {string} a.ctaBenefit  benefício do CTA de oferta
 * @param {boolean} a.isHormone  tema de hormônio/GLP-1 → anti-ban reforçado
 */
async function generateStorySequence({
  mode, topic = '', hook = '', legenda = '',
  ctaKeyword = 'DIAGNÓSTICO', ctaBenefit = 'destravar o shape em até 90 dias',
  isHormone = false, instagramHandle = HANDLE,
}) {
  const handleAt = `@${(instagramHandle || HANDLE).replace('@', '')}`;
  const antiBan = isHormone
    ? `\n━━━ ANTI-BAN (hormônio é zona de ban) ━━━\nSempre por SINTOMA/mecanismo. NUNCA dose, nome comercial de droga, "como tomar", promessa de cura. Destino é investigar com exame/acompanhamento.\n${SUBSTANCE_INTEL}`
    : '';

  const prompt = `Você escreve a sequência de STORIES do dia do Instagram do ${handleAt}, treinador de homens 25-40 (saúde hormonal, performance, composição corporal). O story é a camada que ABRE a DM: o post do dia traz alcance, o story vira conversa.

${FMTEAM_EDITORIAL}

${FABRICIO_STORY_VOICE}
${antiBan}

━━━ POST DO DIA (amarra a sequência nele) ━━━
Tema: ${topic || '(tema do dia)'}
Gancho/capa: ${hook || '(gancho do dia)'}
${legenda ? `Legenda: ${String(legenda).slice(0, 600)}` : ''}

━━━ ESTRUTURA DE HOJE ━━━
${modeInstruction(mode, { ctaKeyword, ctaBenefit })}

━━━ ESTILO DO TEXTO NA TELA (obrigatório) ━━━
- CAIXA NORMAL: 1ª letra maiúscula, resto minúsculo. NUNCA CAIXA ALTA.
- Frases CURTAS, quebradas em 1 a 3 linhas curtas (vai centralizado e alinhado à esquerda no story).
- No MÁXIMO 1 palavra entre **asteriscos** por story (vira dourado, destaque sutil). Pode não ter.
- Nada de travessão. Voz do Fabricio.
- "visual" = instrução curta da imagem de fundo (homem atlético/academia/bastidor que combine com o story).

━━━ SAÍDA (APENAS JSON válido, nada antes/depois) ━━━
{
  "mode": "${mode}",
  "stories": [
    { "n": 1, "texto": "texto na tela, caixa normal, curto", "visual": "cena de fundo", "sticker": null, "cta": null }
  ],
  "resumo": "1 frase do arco da sequência"
}
Regras do JSON: "sticker" é SEMPRE null (no fluxo automático não dá pra agendar sticker nativo; a interação é por RESPOSTA em texto). "cta" só no story de CTA (a palavra ${ctaKeyword} ou o convite pra responder); senão null.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: 'Você escreve stories de Instagram que viram DM, na voz do criador. Responde SEMPRE com JSON válido e nada mais.',
    messages: [{ role: 'user', content: prompt }],
  });

  const text = (response.content[0]?.text || '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Modelo não retornou JSON válido.');
  let parsed;
  try { parsed = JSON.parse(match[0]); }
  catch {
    const fixed = match[0].replace(/,\s*([}\]])/g, '$1').replace(/[\x00-\x1F\x7F]/g, ' ');
    try { parsed = JSON.parse(fixed); } catch { throw new Error('JSON inválido na resposta do modelo.'); }
  }
  if (!Array.isArray(parsed.stories) || !parsed.stories.length) throw new Error('Sequência vazia.');

  // Limpeza anti-IA (travessão) em todo texto que vai pra tela.
  parsed.mode = mode;
  const clean = (t) => applySkinTone(stripAiTells(String(t || '')));
  parsed.stories = parsed.stories.map((s, i) => ({
    n: s.n || i + 1,
    texto: clean(s.texto),
    visual: stripAiTells(String(s.visual || '')), // instrução interna, não vai pra tela
    sticker: null,                                 // fluxo automático não agenda sticker
    cta: s.cta ? clean(s.cta) : null,
  }));
  if (parsed.resumo) parsed.resumo = stripAiTells(String(parsed.resumo));
  return parsed;
}

module.exports = { STORY_MODES, pickStoryMode, generateStorySequence, FABRICIO_STORY_VOICE };
