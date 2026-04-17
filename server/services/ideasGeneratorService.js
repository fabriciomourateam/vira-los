/**
 * ideasGeneratorService.js
 * Usa Claude para analisar dados reais de engajamento e gerar ideias de conteúdo
 * baseadas em padrões comprovados nas plataformas.
 */

const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Gerador de Ideias ────────────────────────────────────────────────────────

async function generateIdeas(scrapedData, config) {
  const {
    niche = 'fitness e nutrição',
    instagramHandle = '',
    hashtags = [],
  } = config;

  const { instagram = [], tiktok = [], reddit = [], trends = [] } = scrapedData;
  const totalPosts = instagram.length + tiktok.length + reddit.length;

  // ── Montar resumo dos dados para o Claude ──
  const fmtIG = instagram.slice(0, 12).map(
    p => `  • [IG] "${p.title.substring(0, 120)}" — ${p.likes.toLocaleString()} curtidas, ${p.comments} comentários`
  ).join('\n') || '  (sem dados)';

  const fmtTT = tiktok.slice(0, 12).map(
    p => `  • [TikTok] "${p.title.substring(0, 120)}" — ${p.likes.toLocaleString()} likes, ${p.shares} shares`
  ).join('\n') || '  (sem dados)';

  const fmtReddit = reddit.slice(0, 12).map(
    p => `  • [Reddit r/${p.subreddit}] "${p.title}" — ${p.score} upvotes, ${p.comments} comentários`
  ).join('\n') || '  (sem dados)';

  const fmtTrends = trends.length
    ? `QUERIES EM ALTA NO GOOGLE (Brasil, 7 dias):\n  ${trends.join(' • ')}`
    : '';

  const dataSection = totalPosts > 0
    ? `Coletei ${totalPosts} posts reais de alto engajamento sobre o nicho "${niche}".\n\n` +
      `INSTAGRAM — top posts por hashtag:\n${fmtIG}\n\n` +
      `TIKTOK — vídeos mais engajados:\n${fmtTT}\n\n` +
      `REDDIT — perguntas e dores reais da audiência:\n${fmtReddit}\n\n` +
      fmtTrends
    : `Sem dados de scraping disponíveis. Use expertise sobre "${niche}" para gerar ideias baseadas em princípios virais comprovados.`;

  const prompt = `Você é um estrategista de conteúdo viral especializado em Instagram para o nicho de ${niche}.

━━━ DADOS REAIS DE ENGAJAMENTO (coletados agora) ━━━
${dataSection}

━━━ PERFIL DO CRIADOR ━━━
Instagram: @${instagramHandle || 'criador'}
Nicho: ${niche}
Objetivo estratégico: Construir audiência de meio de funil que gera leads qualificados para consultoria
Frequência: 2-3 posts/dia
Estratégia: Informação de valor + entretenimento = audiência qualificada para comprar consultoria de alto ticket

━━━ TAREFA ━━━
Com base nos dados reais acima, identifique os padrões que geram mais engajamento e crie 12 ideias originais para Instagram. Cada ideia deve:
1. Ser baseada em padrão COMPROVADO pelos dados coletados
2. Servir ao meio de funil viral (educa + entretém + cria desejo pela consultoria)
3. NÃO vender diretamente — criar desejo e autoridade
4. Ter hook forte que para o scroll nos primeiros 2 segundos

MIX OBRIGATÓRIO:
• 4 ideias TOFU — gancho amplo, alcance máximo, dor/curiosidade universal do nicho
• 5 ideias MOFU — aprofundamento técnico, autoridade, especificidade, lacuna de curiosidade
• 3 ideias BOFU — prova social, transformação, resultado concreto, CTA suave para consultoria

FORMATOS disponíveis: lista, revelação, mito-busting, antes-depois, tutorial, polêmica, série, pergunta

RESPONDA APENAS com um array JSON válido. Nenhum texto antes ou depois.

[
  {
    "id": "ideia-1",
    "title": "Título exato do post (como vai aparecer no carrossel — curto, impactante)",
    "hook": "Primeira frase/linha que para o scroll — deve ter número específico OU dor real OU pergunta desafiadora",
    "format": "lista|revelação|mito-busting|antes-depois|tutorial|polêmica|série|pergunta",
    "funnelStage": "TOFU|MOFU|BOFU",
    "emotion": "emoção dominante (ex: medo de perder, curiosidade, aspiração, surpresa, urgência, esperança)",
    "cta": "CTA específico para o último slide (ex: 'Comenta QUERO que te explico como funciona no seu caso')",
    "contentType": "carrossel|reels|ambos",
    "numSlides": 8,
    "slideOutline": ["Capa: gancho", "Slide 2: subtema", "Slide 3: subtema", "..."],
    "whyItWorks": "1 frase: o padrão dos dados que valida esta ideia",
    "viralScore": 8.5
  }
]`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4500,
    system: 'Você é um estrategista de conteúdo viral especializado em Instagram. Responde SEMPRE com JSON válido e absolutamente nada mais — sem markdown, sem texto explicativo.',
    messages: [{ role: 'user', content: prompt }],
  });

  const text = (response.content[0]?.text || '').trim();
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Resposta inválida do modelo ao gerar ideias.');
  return JSON.parse(jsonMatch[0]);
}

// ─── Conversor de Ideia → Roteiro de Reels ────────────────────────────────────

async function generateReelsScript(idea, config) {
  const { niche = 'fitness e nutrição', instagramHandle = '' } = config;

  const prompt = `Crie um roteiro completo de Reels para Instagram baseado nesta ideia:

IDEIA:
• Título: ${idea.title}
• Hook: ${idea.hook}
• Formato: ${idea.format}
• Funil: ${idea.funnelStage}
• Emoção: ${idea.emotion}
• CTA: ${idea.cta}
${idea.slideOutline?.length ? `• Estrutura sugerida: ${idea.slideOutline.join(' | ')}` : ''}

CRIADOR: @${instagramHandle} | Nicho: ${niche}

REGRAS DO ROTEIRO:
• Hook nos primeiros 2-3 segundos: deve prender imediatamente (sem "olá" ou apresentação)
• Ritmo: 1 ideia por corte, cortes a cada 3-5 segundos
• Legenda na tela: máx. 5 palavras por tela, grandes e legíveis
• CTA natural, não forçado, ligado ao conteúdo
• Tom: conversa direta, especialista, não acadêmico

Responda com este formato EXATO:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DURAÇÃO ESTIMADA: [X-X segundos]
FORMATO: ${idea.format?.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[0–3s] 🎯 HOOK (fala + legenda na tela):
FALA: "..."
TELA: "..."

[3–12s] 📌 DESENVOLVIMENTO — ponto 1:
FALA: "..."
TELA: "..."

[12–25s] 📌 DESENVOLVIMENTO — ponto 2:
FALA: "..."
TELA: "..."

[25–38s] 💡 REVELAÇÃO / virada:
FALA: "..."
TELA: "..."

[38–50s] 📣 CTA:
FALA: "..."
TELA: "..."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎬 DICAS DE PRODUÇÃO:
• ...
• ...
• ...

📝 LEGENDA SUGERIDA (com hashtags):
...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1800,
    messages: [{ role: 'user', content: prompt }],
  });

  return (response.content[0]?.text || '').trim();
}

module.exports = { generateIdeas, generateReelsScript };
