/**
 * reelsGeneratorService.js
 * Converte um carrossel salvo em um roteiro completo de Reels (formato split-screen)
 * com hook, body por segmentos, CTA, teleprompter pronto pra ler e queries de imagem.
 */

const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function sanitize(s) {
  if (!s) return '';
  return String(s)
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/**
 * Extrai o conteúdo de texto de cada slide de um HTML de carrossel.
 * Funciona para layouts editorial, clean e fmteam — pega todo texto visível.
 */
function extractSlidesText(html) {
  if (!html) return [];
  // Divide o HTML em <div class="slide..."> blocks
  const slideRegex = /<div[^>]*class="[^"]*\b(?:slide|clean-cover|clean-content|clean-cta|clean-split)\b[^"]*"[\s\S]*?(?=<div[^>]*class="[^"]*\b(?:slide|clean-cover|clean-content|clean-cta|clean-split)\b|$)/gi;
  const matches = html.match(slideRegex) || [];
  return matches.map((slideHtml, i) => {
    // Remove tags HTML, decodifica entidades básicas, colapsa espaços
    const text = slideHtml
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 400);
    return { num: i + 1, text };
  }).filter(s => s.text);
}

/**
 * Gera um roteiro de Reels a partir de um carrossel salvo.
 * @param {Object} args
 * @param {Object} args.carousel - { id, topic, html, legenda, numSlides, ... }
 * @param {number} args.duration - duração desejada do reels em segundos (15-120)
 * @param {string} args.niche
 * @param {string} args.instagramHandle
 */
async function generateReelsFromCarousel({ carousel, duration = 30, niche = 'fitness', instagramHandle = '' }) {
  if (!carousel || !carousel.html) throw new Error('Carrossel sem HTML — não dá pra gerar reels.');

  const slides = extractSlidesText(carousel.html);
  if (slides.length === 0) throw new Error('Não encontrei texto nos slides do carrossel.');

  // Mapeia duração para nº de segmentos do body (hook+body+cta = total)
  const bodySegments =
    duration <= 20 ? 2 :
    duration <= 35 ? 3 :
    duration <= 50 ? 4 :
    duration <= 75 ? 6 : 8;

  const slidesText = slides.map(s => `Slide ${s.num}: ${s.text}`).join('\n');
  const handle = (instagramHandle || '').replace('@', '');
  const handleAt = handle ? `@${handle}` : 'criador';

  const prompt = `Você é especialista em Reels do Instagram que viralizam organicamente no nicho de ${niche}.

Transforme este carrossel em um roteiro completo de Reels de ${duration} segundos no formato split-screen (criador falando em cima, imagem + legenda embaixo).

━━━ CARROSSEL BASE — tema: "${carousel.topic || 'sem tema'}" ━━━
${slidesText}

━━━ CRIADOR ━━━
${handleAt} · Nicho: ${niche}

━━━ REGRAS DO ROTEIRO ━━━
• Hook nos 2-3 primeiros segundos: pergunta provocadora, dor real, estatística surpreendente. SEM "olá", apresentação ou frase motivacional genérica.
• Linguagem: conversa direta, como falando com um amigo inteligente. Tom de descoberta, não de aula.
• 1 ideia central — não cobre o carrossel inteiro, escolhe o ponto MAIS forte.
• Ritmo: cortes a cada 3-5 segundos, frases curtas (máx 12-15 palavras por frase).
• Legenda na tela: máx 5 palavras por tela, GRANDE e legível, marca SÓ pontos-chave (não duplica fala inteira).
• CTA final natural, ligado ao tema. Sem "siga para mais conteúdo".
• Proibido: "saiba", "descubra", "você sabia que", clichês motivacionais.
• ${bodySegments} segmentos no body (sem contar hook e cta).

━━━ FORMATO DE SAÍDA ━━━
RESPONDA APENAS com JSON válido, nada antes ou depois.

{
  "title": "Título curto do reels (máx 60 caracteres) — para o histórico",
  "duration": ${duration},
  "hook": {
    "fala": "exatamente o que você fala no hook (0-3s)",
    "legenda": "texto na tela (máx 5 palavras)",
    "imagem": "descrição curta da imagem que aparece embaixo"
  },
  "body": [
    {
      "timestamp": "3-12s",
      "fala": "o que falar nesse segmento",
      "legenda": "texto na tela (máx 5 palavras)",
      "imagem": "imagem que aparece embaixo"
    }
  ],
  "cta": {
    "fala": "frase final ligada ao conteúdo, sem siga genérico",
    "legenda": "texto na tela",
    "imagem": "imagem do CTA"
  },
  "teleprompter": "TEXTO CORRIDO pronto para ler — hook+body+cta concatenados, uma frase por linha, pontuação para pausa natural, sem timestamps, sem 'HOOK:' ou 'CTA:'",
  "imagensSugeridas": ["query 1 para Pexels/Unsplash em inglês ou português", "query 2", "query 3"],
  "legendaPost": "Legenda do post no Instagram — 2-3 linhas + 5-8 hashtags relevantes ao nicho"
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: 'Você é especialista em Reels virais. Responde SEMPRE com JSON válido e absolutamente nada mais — sem markdown, sem texto antes ou depois.',
    messages: [{ role: 'user', content: sanitize(prompt) }],
  });

  const text = (response.content[0]?.text || '').trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Modelo não retornou JSON válido.');

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    // Tenta limpar JSON malformado
    const fixed = jsonMatch[0]
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/[\x00-\x1F\x7F]/g, ' ');
    try { parsed = JSON.parse(fixed); }
    catch { throw new Error('JSON inválido na resposta do modelo. Tente novamente.'); }
  }

  // Validação mínima
  if (!parsed.hook?.fala || !parsed.cta?.fala) {
    throw new Error('Resposta incompleta — hook ou CTA faltando.');
  }
  if (!Array.isArray(parsed.body)) parsed.body = [];
  if (!parsed.teleprompter) {
    // Constrói teleprompter caso o modelo tenha esquecido
    parsed.teleprompter = [
      parsed.hook.fala,
      ...parsed.body.map(b => b.fala),
      parsed.cta.fala,
    ].filter(Boolean).join('\n\n');
  }

  return parsed;
}

module.exports = { generateReelsFromCarousel, extractSlidesText };
