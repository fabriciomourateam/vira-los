/**
 * instagramAnalyticsService.js
 * Claude Sonnet → deep analysis of IG post performance data
 */

const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function sanitizeText(s) {
  if (!s) return '';
  // Remove lone surrogates and other invalid unicode that break JSON
  return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
          .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

// ─── Main Analysis ────────────────────────────────────────────────────────────

async function analyzeWithAI(posts, igAccount) {
  const reels     = posts.filter((p) => p.mediaType === 'REELS' || p.mediaType === 'VIDEO');
  const carousels = posts.filter((p) => p.mediaType === 'CAROUSEL_ALBUM');
  const images    = posts.filter((p) => p.mediaType === 'IMAGE');

  const avgEngAll      = avg(posts.map((p) => p.engagementRate));
  const avgReelsEng    = avg(reels.map((p) => p.engagementRate));
  const avgCarouselEng = avg(carousels.map((p) => p.engagementRate));
  const avgImagesEng   = avg(images.map((p) => p.engagementRate));
  const avgSaveRate    = avg(posts.map((p) => p.saveRate));

  // ── Reel Candidates: carousels + images with above-average save rate ──────
  const reelCandidates = [...carousels, ...images]
    .filter((p) => p.saveRate > avgSaveRate * 1.4 || p.reelCandidateScore > 2)
    .sort((a, b) => b.reelCandidateScore - a.reelCandidateScore)
    .slice(0, 6);

  // ── Redo Candidates: high-reach posts with below-average engagement ───────
  const sortedByReach = [...posts].sort((a, b) => b.reach - a.reach);
  const top30Ids      = new Set(sortedByReach.slice(0, Math.ceil(posts.length * 0.3)).map((p) => p.id));
  const redoCandidates = posts
    .filter((p) => top30Ids.has(p.id) && p.engagementRate < avgEngAll * 0.8)
    .sort((a, b) => b.reach - a.reach)
    .slice(0, 6);

  // ── Build prompt ──────────────────────────────────────────────────────────
  const top10   = [...posts].sort((a, b) => b.engagementRate - a.engagementRate).slice(0, 10);
  const bottom5 = [...posts].sort((a, b) => a.engagementRate - b.engagementRate).slice(0, 5);
  const topSaved = [...posts].sort((a, b) => b.saves - a.saves).slice(0, 5);
  const topShared = [...posts].sort((a, b) => (b.shares || 0) - (a.shares || 0)).slice(0, 5);
  const topFollows = [...posts].filter(p => (p.follows || 0) > 0).sort((a, b) => b.follows - a.follows).slice(0, 5);

  const avgShareRate = avg(posts.map(p => p.shares ? (p.shares / Math.max(p.reach, 1)) * 100 : 0));

  const fmt = (p, i) =>
    `${i + 1}. [${p.mediaType}] Eng: ${p.engagementRate}% | ` +
    `Likes: ${p.likes} | Saves: ${p.saves} | Shares: ${p.shares} | ` +
    `Comments: ${p.comments} | Follows: ${p.follows || 0} | Reach: ${p.reach} | ` +
    `${new Date(p.timestamp).toLocaleDateString('pt-BR')} | ` +
    `"${sanitizeText((p.caption || '').substring(0, 120))}"`;

  const prompt = `Você é um estrategista de crescimento no Instagram especializado em analisar dados reais para recomendar ações concretas.

CONTA: @${igAccount.username || 'criador'} — ${(igAccount.followersCount || 0).toLocaleString('pt-BR')} seguidores

━━━ ESTATÍSTICAS GERAIS (${posts.length} posts analisados) ━━━
• Engajamento médio: ${avgEngAll.toFixed(2)}%
• Save rate médio: ${avgSaveRate.toFixed(2)}%
• Share rate médio: ${avgShareRate.toFixed(2)}%
• Reels: ${avgReelsEng.toFixed(2)}% eng (${reels.length} posts)
• Carrosseis: ${avgCarouselEng.toFixed(2)}% eng (${carousels.length} posts)
• Imagens: ${avgImagesEng.toFixed(2)}% eng (${images.length} posts)

━━━ TOP 10 — Maior engajamento ━━━
${top10.map(fmt).join('\n')}

━━━ TOP 5 — Mais salvos (indica conteúdo de valor) ━━━
${topSaved.map(fmt).join('\n')}

━━━ TOP 5 — Mais compartilhados (indica potencial viral) ━━━
${topShared.map(fmt).join('\n')}

${topFollows.length > 0 ? `━━━ TOP — Posts que mais trouxeram seguidores ━━━\n${topFollows.map(fmt).join('\n')}\n` : ''}━━━ 5 — Menor engajamento (identificar o que evitar) ━━━
${bottom5.map(fmt).join('\n')}

━━━ CARROSSEIS CANDIDATOS A VIRAR REELS ━━━
${reelCandidates.length > 0
  ? reelCandidates.map(fmt).join('\n')
  : 'Nenhum carrossel com save rate acima da média'}

HIERARQUIA DE SINAIS (do mais forte ao mais fraco):
1. Saves (salvamentos) = conteúdo de valor que as pessoas querem rever
2. Shares (compartilhamentos) = potencial viral, o algoritmo prioriza
3. Comentários = engajamento profundo, gera conversa
4. Follows = prova que o conteúdo converte em seguidores
5. Likes = sinal fraco, todo mundo curte sem pensar

Analise os dados acima usando essa hierarquia. Identifique QUAIS TEMAS e FORMATOS geram mais saves e shares (não likes).
RESPONDA APENAS com JSON válido — nenhum texto antes ou depois:

{
  "summary": "2-3 frases sobre o padrão dominante. Foque em saves e shares, não em likes.",
  "topFormat": "Reels|Carrossel|Imagem",
  "topFormatReason": "por quê este formato gera mais saves/shares nos dados",
  "hookPattern": "padrão nos hooks dos posts mais salvos e compartilhados — cite exemplos concretos dos dados",
  "bestPostingInsight": "insight acionável sobre frequência, tipo de conteúdo ou abordagem",
  "reelsOpportunity": "quais carrosséis/posts deveriam virar Reels e por quê (com base nos saves/shares)",
  "patterns": [
    { "title": "Nome do padrão", "description": "explicação com dados concretos dos posts", "impact": "alto|médio|baixo" }
  ],
  "actionPriority": [
    { "action": "Ação específica e mensurável", "why": "conectado aos dados de saves/shares", "urgency": "alta|média|baixa" }
  ]
}

Inclua 3-5 padrões e 3-5 ações. Use números reais dos dados para embasar cada observação. Priorize saves e shares sobre likes.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system:
      'Você é um especialista em crescimento no Instagram. Responde SEMPRE com JSON válido e absolutamente nada mais — sem markdown, sem texto fora do JSON.',
    messages: [{ role: 'user', content: prompt }],
  });

  const text = (response.content[0]?.text || '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Resposta inválida do modelo ao analisar performance');
  const aiInsights = JSON.parse(match[0]);

  return {
    aiInsights,
    signals: { reelCandidates, redoCandidates },
    stats: {
      totalPosts:      posts.length,
      avgEngagement:   Math.round(avgEngAll      * 100) / 100,
      reelsCount:      reels.length,
      carouselsCount:  carousels.length,
      imagesCount:     images.length,
      avgReelsEng:     Math.round(avgReelsEng    * 100) / 100,
      avgCarouselEng:  Math.round(avgCarouselEng * 100) / 100,
    },
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { analyzeWithAI };
