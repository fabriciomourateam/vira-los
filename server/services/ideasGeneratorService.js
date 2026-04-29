/**
 * ideasGeneratorService.js
 * Usa Claude para analisar dados reais de engajamento e gerar ideias de conteúdo
 * baseadas em padrões comprovados nas plataformas.
 */

const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function sanitizeText(s) {
  if (!s) return '';
  return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
          .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

// ─── Gerador de Ideias ────────────────────────────────────────────────────────

async function generateIdeas(scrapedData, config) {
  const {
    niche = 'fitness e nutrição',
    instagramHandle = '',
    hashtags = [],
  } = config;

  const { instagram = [], tiktok = [], reddit = [], trends = [], youtube = [] } = scrapedData;
  const totalPosts = instagram.length + tiktok.length + reddit.length + youtube.length;
  const hasScrapeData = totalPosts > 0 || trends.length > 0;

  // ── Formatar cada fonte de dados ──
  const sections = [];

  if (instagram.length > 0) {
    sections.push(
      `INSTAGRAM — posts de maior engajamento por hashtag:\n` +
      instagram.slice(0, 20).map(p =>
        `  • "${sanitizeText((p.title || p.caption || '').substring(0, 120))}" — ${(p.likes || 0).toLocaleString()} curtidas, ${p.comments || 0} comentários`
      ).join('\n')
    );
  }

  if (tiktok.length > 0) {
    // Diferencia entre dados do Creative Center e dados completos
    const ccItems = tiktok.filter(p => p.platform === 'tiktok_cc');
    const fullItems = tiktok.filter(p => p.platform === 'tiktok');
    if (ccItems.length > 0) {
      sections.push(
        `TIKTOK TRENDING (Creative Center Brasil):\n` +
        ccItems.slice(0, 12).map(p => `  • ${sanitizeText(p.title)}`).join('\n')
      );
    }
    if (fullItems.length > 0) {
      sections.push(
        `TIKTOK — vídeos mais engajados:\n` +
        fullItems.slice(0, 10).map(p =>
          `  • "${sanitizeText(p.title.substring(0, 120))}" — ${(p.likes || 0).toLocaleString()} likes`
        ).join('\n')
      );
    }
  }

  if (reddit.length > 0) {
    sections.push(
      `REDDIT — perguntas e dores reais da audiência (top posts da semana):\n` +
      reddit.slice(0, 12).map(p =>
        `  • [r/${p.subreddit}] "${sanitizeText(p.title)}" — ${p.score} upvotes, ${p.comments} comentários`
      ).join('\n')
    );
  }

  if (youtube.length > 0) {
    sections.push(
      `YOUTUBE — vídeos mais vistos do nicho (último mês, BR):\n` +
      youtube.slice(0, 15).map(p =>
        `  • "${sanitizeText(p.title.substring(0, 120))}"${p.channel ? ` [${p.channel}]` : ''}${p.views > 0 ? ` — ${(p.views || 0).toLocaleString()} views, ${(p.likes || 0).toLocaleString()} likes` : ''}`
      ).join('\n')
    );
  }

  if (trends.length > 0) {
    sections.push(`GOOGLE TRENDS — buscas em alta no Brasil hoje:\n  ${trends.join(' • ')}`);
  }

  const dataSection = hasScrapeData
    ? `Dados coletados em tempo real (${totalPosts} posts + ${trends.length} trending topics):\n\n` +
      sections.join('\n\n')
    : `[Sem dados de APIs externas disponíveis nesta rodada. Use seu conhecimento profundo e atualizado sobre o nicho "${niche}" — você foi treinado em milhões de posts, vídeos e discussões sobre fitness, nutrição esportiva e hormônios, e sabe quais formatos e ângulos geram mais engajamento no Instagram e TikTok brasileiros.]`;

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
    max_tokens: 8000,
    system: 'Você é um estrategista de conteúdo viral especializado em Instagram. Responde SEMPRE com JSON válido e absolutamente nada mais — sem markdown, sem texto explicativo.',
    messages: [{ role: 'user', content: sanitizeText(prompt) }],
  });

  const text = (response.content[0]?.text || '').trim();
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Resposta inválida do modelo ao gerar ideias.');

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (parseErr) {
    // Tenta limpar JSON malformado antes de re-tentar
    let fixed = jsonMatch[0]
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/[\x00-\x1F\x7F]/g, ' ')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t');
    try {
      parsed = JSON.parse(fixed);
    } catch {
      // JSON truncado (max_tokens atingido) — tenta recuperar os objetos completos já gerados
      const partialMatch = jsonMatch[0].match(/(\{[\s\S]*?\}(?=\s*,\s*\{|\s*\]))/g);
      if (!partialMatch || partialMatch.length === 0) throw new Error('JSON inválido na resposta do modelo. Tente novamente.');
      parsed = partialMatch.map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
      if (parsed.length === 0) throw new Error('Nenhuma ideia pôde ser extraída da resposta.');
      console.warn(`[Ideas] JSON truncado — recuperadas ${parsed.length} ideias de ${partialMatch.length} fragmentos`);
    }
  }

  return parsed;
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
