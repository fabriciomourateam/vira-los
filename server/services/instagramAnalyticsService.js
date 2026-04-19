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

  const fmt = (p, i) =>
    `${i + 1}. [${p.mediaType}] Eng: ${p.engagementRate}% | ` +
    `Likes: ${p.likes} | Saves: ${p.saves} | Shares: ${p.shares} | ` +
    `Follows: ${p.follows || 0} | Reach: ${p.reach} | ` +
    `${new Date(p.timestamp).toLocaleDateString('pt-BR')} | ` +
    `"${sanitizeText((p.caption || '').substring(0, 100))}"`;

  const prompt = `Você é um especialista em crescimento no Instagram para o nicho de fitness, nutrição esportiva e hormônios estéticos.

CONTA: @${igAccount.username || 'criador'} — ${(igAccount.followersCount || 0).toLocaleString('pt-BR')} seguidores

ESTATÍSTICAS GERAIS (${posts.length} posts analisados):
• Engajamento médio geral: ${avgEngAll.toFixed(2)}%
• Reels: ${avgReelsEng.toFixed(2)}% eng médio (${reels.length} posts)
• Carrosseis: ${avgCarouselEng.toFixed(2)}% eng médio (${carousels.length} posts)
• Imagens: ${avgImagesEng.toFixed(2)}% eng médio (${images.length} posts)
• Save rate médio: ${avgSaveRate.toFixed(2)}%

TOP 10 POSTS — maior engajamento:
${top10.map(fmt).join('\n')}

5 POSTS DE MENOR ENGAJAMENTO:
${bottom5.map(fmt).join('\n')}

Com base nesses dados reais, forneça uma análise estratégica profunda e específica para este perfil.
RESPONDA APENAS com JSON válido — nenhum texto antes ou depois:

{
  "summary": "análise geral em 2-3 frases diretas sobre o padrão dominante de performance desta conta",
  "topFormat": "Reels|Carrossel|Imagem",
  "topFormatReason": "1 frase explicando por quê este formato performa melhor nos dados apresentados",
  "hookPattern": "padrão identificado nos hooks/temas dos posts com maior engajamento — seja específico com os dados",
  "bestPostingInsight": "insight acionável sobre frequência, tipo de conteúdo ou abordagem baseado nos dados",
  "patterns": [
    { "title": "Nome do padrão identificado", "description": "explicação em 1 frase com dados concretos", "impact": "alto|médio|baixo" }
  ],
  "actionPriority": [
    { "action": "Ação específica e mensurável", "why": "por que esta ação vai melhorar a performance — conectado aos dados", "urgency": "alta|média|baixa" }
  ]
}

Inclua 3-5 padrões e 3-5 ações prioritárias. Use números dos dados para embasar cada observação.`;

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
