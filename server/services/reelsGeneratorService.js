/**
 * reelsGeneratorService.js
 * Converte um carrossel salvo em um roteiro completo de Reels (formato split-screen)
 * com hook, body por segmentos, CTA, teleprompter pronto pra ler e queries de imagem.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { FMTEAM_EDITORIAL } = require('./fmteamEditorial');
const db = require('../db/database');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Fórmulas de gancho extraídas dos perfis-modelo (MODELOS-GANCHOS.md) — molde pra fraseTela.
const HOOK_FORMULAS = [
  'sintoma-espelho: junta sintomas soltos num alerta ("cansaço, libido baixa e barriga teimosa não são preguiça")',
  'exame normal ≠ ideal ("deu tudo normal e você continua no chão")',
  'idade-alarme ("o que muda no corpo do homem depois dos 30 que ninguém avisou")',
  'mito quebrado ("cardio em jejum pra secar? você tá perdendo é músculo")',
  'custo de não agir ("ignorar isso hoje cobra energia, foco e anos depois")',
  'bastidor/autoridade ("todo homem que chega pra mim com X tem isso em comum")',
];

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

━━━ CRITÉRIOS DE VIRALIDADE (não-negociáveis) ━━━

1. HOOK (0-3s) — peso 30%:
   • OBRIGATORIAMENTE um destes: (a) número específico/estatística surpreendente, (b) dor real e concreta da audiência, (c) pergunta provocadora que desafia crença comum, (d) afirmação polêmica.
   • PROIBIDO: "olá", apresentação, "você sabia", motivacional genérico ("sucesso é...", "a chave para...").

2. CURIOSITY GAPS — peso 20%:
   • Cada segmento do body termina com lacuna que força ouvir o próximo ("mas tem algo pior...", "espera que vai virar a chave...", "e o que ninguém te conta é...").
   • Sem isso, o espectador trafega.

3. EMOÇÃO DOMINANTE — peso 20%:
   • Escolha UMA: medo de perder | curiosidade | urgência | surpresa | aspiração | indignação.
   • Mantida do hook ao CTA. Não mistura emoções.

4. CTA — peso 15%:
   • Ação CONCRETA + palavra-chave específica para comentar (ex: "comenta SHAPE pra receber X", "salva pra não esquecer").
   • Ligado ao tema. PROIBIDO: "siga para mais conteúdo", "curte se gostou".

5. FORMATO VIRAL — peso 15%:
   • Escolha UM e siga: lista numerada | revelação | mito-busting | antes-depois | tutorial | polêmica.
   • Declare no JSON. Estrutura facilita compartilhamento.

━━━ REGRAS TÉCNICAS ━━━
• Linguagem: conversa direta, amigo inteligente. Tom de descoberta, não de aula.
• 1 ideia central — escolha o ponto MAIS forte do carrossel, não cobre tudo.
• Ritmo: cortes a cada 3-5s, frases curtas (máx 12-15 palavras).
• Legenda na tela: máx 5 palavras, GRANDE, marca SÓ ponto-chave (não duplica fala inteira).
• ${bodySegments} segmentos no body (sem contar hook e cta).
• Vocabulário proibido: "saiba", "descubra", "você sabia que", "isso vai mudar sua vida".

━━━ FORMATO DE SAÍDA ━━━
RESPONDA APENAS com JSON válido, nada antes ou depois.

{
  "title": "Título curto do reels (máx 60 caracteres) — para o histórico",
  "duration": ${duration},
  "formato": "lista|revelação|mito-busting|antes-depois|tutorial|polêmica",
  "emocao": "medo de perder|curiosidade|urgência|surpresa|aspiração|indignação",
  "hook": {
    "tipo": "número|dor|pergunta|polêmica",
    "fala": "exatamente o que você fala no hook (0-3s) — deve respeitar o tipo escolhido",
    "legenda": "texto na tela (máx 5 palavras)",
    "imagem": "descrição curta da imagem que aparece embaixo"
  },
  "body": [
    {
      "timestamp": "3-12s",
      "fala": "o que falar nesse segmento — máx 15 palavras",
      "legenda": "texto na tela (máx 5 palavras)",
      "imagem": "imagem que aparece embaixo",
      "curiosity_gap": "frase de transição que cria lacuna para o próximo segmento — ex: 'mas tem algo pior'"
    }
  ],
  "cta": {
    "palavra_chave": "PALAVRA EM MAIÚSCULAS que o espectador comenta (ex: SHAPE, ROTINA, FOCO)",
    "acao": "comentar|salvar|seguir|clicar-link",
    "fala": "frase final pedindo a ação específica + entregando o benefício de quem responder",
    "legenda": "texto na tela com a palavra-chave em destaque",
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

/**
 * Gera um REEL CURTO (~7s) no formato "vídeo + frase de tela + leia a legenda".
 *
 * Conceito (validado pelo Fabricio): NÃO tem fala. O vídeo é um B-roll do criador
 * fazendo algo (treinando, cozinhando, andando) + uma FRASE NA TELA que para o
 * scroll com uma LACUNA ABERTA. No segundo 4-5 aparece "👇 LEIA A LEGENDA" e o
 * CONTEÚDO COMPLETO mora na LEGENDA — é ela que entrega o valor e fecha a lacuna.
 * Objetivo: loop de re-leitura (7s re-roda várias vezes) + comentário = retenção
 * e engajamento altos, levando o homem certo pra DM/consultoria.
 *
 * @param {Object} args
 * @param {Object} args.carousel - { id, topic, html, legenda, ... }
 * @param {string} args.niche
 * @param {string} args.instagramHandle
 * @param {number} args.duration - duração-alvo do vídeo (default 7s)
 */
async function generateShortReelFromCarousel({ carousel, niche = 'fitness', instagramHandle = '', duration = 7, cta }) {
  if (!carousel || !carousel.html) throw new Error('Carrossel sem HTML — não dá pra gerar reels.');

  const slides = extractSlidesText(carousel.html);
  if (slides.length === 0) throw new Error('Não encontrei texto nos slides do carrossel.');

  const slidesText = slides.map(s => `Slide ${s.num}: ${s.text}`).join('\n');
  const handle = (instagramHandle || '').replace('@', '');
  const handleAt = handle ? `@${handle}` : 'criador';

  // CTA configurável (default: COMENTA TESTO → passo a passo natural). Vem das settings
  // (db.getReelsCta) e pode ser sobrescrito por chamada. Só afeta os reels.
  const ctaCfg = { ...(db.getReelsCta ? db.getReelsCta() : {}), ...(cta || {}) };
  const ctaKeyword = String(ctaCfg.keyword || 'TESTO').toUpperCase().trim();
  const ctaBenefit = String(ctaCfg.benefit || 'te envio um passo a passo pra subir a sua testosterona de forma natural').trim();

  const prompt = `Você é especialista em Reels do Instagram de TEXTO-NA-TELA (silenciosos) que viralizam organicamente no nicho de ${niche}.

Transforme este carrossel em UM reel curto de ~${duration} segundos no formato "vídeo + frase de tela + leia a legenda". NÃO TEM FALA. O criador NÃO narra nada.

${FMTEAM_EDITORIAL}

━━━ CARROSSEL BASE — tema: "${carousel.topic || 'sem tema'}" ━━━
${slidesText}

━━━ CRIADOR ━━━
${handleAt} · Nicho: ${niche}

━━━ COMO ESSE FORMATO FUNCIONA (siga à risca) ━━━
• O vídeo é um B-ROLL do criador fazendo algo (treinando, cozinhando, andando, se olhando no espelho) — SEM falar.
• Por cima do vídeo aparece UMA frase escrita que PARA O SCROLL.
• Nos primeiros ~4s só a frase. No segundo 4-5 aparece "👇 LEIA A LEGENDA".
• O CONTEÚDO COMPLETO vai na LEGENDA. É ela que entrega o valor — o vídeo só fisga.
• A pessoa fica relendo (o reel de 7s re-roda) e vai pra legenda → retenção + comentário.

━━━ REGRAS NÃO-NEGOCIÁVEIS ━━━

1. FRASE DE TELA (fraseTela) — é o que decide tudo:
   • É uma LACUNA ABERTA: cria curiosidade mas NÃO entrega a resposta. Só a legenda fecha.
   • ERRADO (entrega a resposta): "Cardio em excesso queima músculo".
   • CERTO (lacuna): "Eu parei de fazer ISSO e meu shape mudou em 30 dias" / "Tem 1 erro que tá travando seu shape e não é treino".
   • Curta: cabe na tela, no máximo 2 linhas (≤ 12 palavras). Linguagem de homem 25-40.
   • TOM INFORMAL, papo reto de treinador — do jeito que você fala no dia a dia. Gíria leve é bem-vinda ("ó", "se liga", "presta atenção", "cara", "tá"). NADA corporativo ou formal demais.
   • Use gancho de número, contra-intuição ou dor nomeada. PROIBIDO morno ("dicas pra...", "você sabia").
   • Molde de gancho (inspiração dos tops do nicho — use a estrutura, NÃO copie): ${HOOK_FORMULAS.join(' · ')}.

2. LEGENDA (legendaPost) — é onde mora o conteúdo, capricha:
   • PRIMEIRA LINHA tem que RE-FISGAR sozinha (o Instagram corta em "... mais"). Não começa com "Bom," nem repete a frase da tela igual.
   • Corpo: entrega o conteúdo de verdade, técnico traduzido, FECHA a lacuna que a frase de tela abriu. 1 ideia central do carrossel (a mais forte), não cobre tudo.
   • Quebra em linhas curtas / parágrafos de 1-2 frases (legibilidade no app).
   • Fecha com o CTA FIXO: peça pra pessoa comentar a palavra "${ctaKeyword}" que você ${ctaBenefit}. Escreva com a sua voz, ex.: "COMENTA: ${ctaKeyword} que eu ${ctaBenefit}." NÃO invente outra palavra-chave nem troque o benefício.
   • 4-6 hashtags relevantes ao nicho. ANTI-BAN: SEM hashtag de substância (testosterona/TRT/ozempic/etc), SEM nome comercial de droga.
   • Respeita a VOZ e o ANTI-BAN do cérebro editorial acima (você/não tu, sem "não é X é Y", português não gringo, por sintoma).

3. VÍDEO SUGERIDO (videoSugerido): descreva em 1 frase o B-roll do criador que combina com a emoção (ex.: "Fabricio treinando supino pesado, suado, foco fechado" / "Fabricio montando o prato na cozinha"). Vertical, sem fala.

4. PROMPTS DE VÍDEO IA (promptsVideo): dois prompts PRONTOS PRA COLAR pra gerar o clipe a partir do vídeo/foto que o criador SEMPRE envia como referência. REGRAS QUE VALEM PROS DOIS:
   • SEMPRE comece o prompt mandando USAR O VÍDEO/FOTO DE REFERÊNCIA enviado pelo criador como base — NUNCA cite nome de arquivo (diga "the reference video/photo provided by the creator" / "o vídeo de referência enviado"). Se citar nome de arquivo as ferramentas ignoram e não fazem. A cara e o corpo têm que ser os MESMOS da referência.
   • REALISMO ANTI-IA — quanto MAIS detalhe, MENOS cara de IA: peça pele com textura e poros reais e imperfeições naturais, luz natural imperfeita, leve tremida de câmera na mão (handheld), motion blur sutil no movimento, ambiente real (academia/cozinha de verdade, não estúdio limpo), suor e respiração reais, estética documental/candid de celular. PROIBIDO: pele plástica ou super-suavizada, brilho artificial, movimento robótico, cenário "perfeito demais".
   • Vídeo VERTICAL 9:16, ~${duration}s, texto na tela GRANDE e legível (a fraseTela de 0-4s e "👇 LEIA A LEGENDA" de 4-5s). O TEXTO NA TELA fica SEMPRE em PORTUGUÊS (é o que a audiência lê).
   • promptsVideo.heygen — pro HeyGen (avatar FALANDO): escreva a FALA do avatar EM PORTUGUÊS (1 frase curta de impacto adaptada da fraseTela pra soar natural falada, 3-5s, tom da emoção). A direção de cena/realismo pode vir em português. Instrução direta, 4-6 frases.
   • promptsVideo.broll — pro Sora / Veo / Higgsfield / YouTube Creator (texto→vídeo, MUDO, sem fala): escreva a DESCRIÇÃO DE CENA EM INGLÊS (esses modelos de vídeo seguem MUITO melhor o prompt em inglês), detalhando ação/movimento/ambiente/energia/emoção do videoSugerido como B-roll cinematográfico realista, COM todo o realismo anti-IA acima. O texto sobreposto na tela continua em PORTUGUÊS. Instrução direta, 4-6 frases.

5. EMOÇÃO DOMINANTE (emocao): escolha UMA e mantenha em tudo: curiosidade | medo de perder | urgência | surpresa | indignação.

━━━ FORMATO DE SAÍDA ━━━
RESPONDA APENAS com JSON válido, nada antes ou depois.

{
  "title": "Título curto pro histórico (máx 60 caracteres)",
  "tipo": "short",
  "duration": ${duration},
  "formato": "curiosidade-aberta|contra-intuição|dor-nomeada|número|polêmica",
  "emocao": "curiosidade|medo de perder|urgência|surpresa|indignação",
  "videoSugerido": "B-roll do criador, vertical, SEM fala — 1 frase concreta",
  "promptsVideo": {
    "heygen": "PT-BR. Use o vídeo/foto de referência enviado pelo criador como base (NÃO cite nome de arquivo), mesma cara e corpo. O avatar fala em português: '<frase de impacto>'. 9:16, ~${duration}s. Realismo anti-IA: pele e poros reais, luz natural, leve tremida de câmera. Texto na tela em PT. 4-6 frases.",
    "broll": "Scene description in ENGLISH. Use the reference video/photo provided by the creator as the base (do NOT name any file); same face and body. <cinematic realistic B-roll: action, real environment, energy, emotion; handheld slight shake, natural imperfect light, real skin texture and pores, subtle motion blur, candid phone-documentary look; no plastic/over-smoothed skin>. Vertical 9:16, ~${duration}s, silent. On-screen text stays in Portuguese. 4-6 sentences."
  },
  "fraseTela": "a frase que para o scroll (lacuna aberta, ≤12 palavras, máx 2 linhas)",
  "fraseTelaTiming": "0-4s",
  "ctaTela": "👇 LEIA A LEGENDA",
  "ctaTelaTiming": "4-5s",
  "legendaPost": "Legenda COMPLETA: 1ª linha re-fisga + corpo que entrega o conteúdo e fecha a lacuna + CTA FIXO (comenta ${ctaKeyword} → ${ctaBenefit}) + 4-6 hashtags ban-safe. Use \\n para quebrar linhas.",
  "imagensSugeridas": ["alternativa de B-roll 1", "alternativa de B-roll 2"]
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    system: 'Você é especialista em Reels virais de texto-na-tela (silenciosos). Responde SEMPRE com JSON válido e absolutamente nada mais — sem markdown, sem texto antes ou depois.',
    messages: [{ role: 'user', content: sanitize(prompt) }],
  });

  const text = (response.content[0]?.text || '').trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Modelo não retornou JSON válido.');

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    const fixed = jsonMatch[0]
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/[\x00-\x1F\x7F]/g, ' ');
    try { parsed = JSON.parse(fixed); }
    catch { throw new Error('JSON inválido na resposta do modelo. Tente novamente.'); }
  }

  // Validação mínima — o coração do formato é a frase de tela + a legenda.
  if (!parsed.fraseTela || !parsed.legendaPost) {
    throw new Error('Resposta incompleta — fraseTela ou legendaPost faltando.');
  }
  parsed.tipo = 'short';
  if (!parsed.duration) parsed.duration = duration;
  if (!parsed.ctaTela) parsed.ctaTela = '👇 LEIA A LEGENDA';

  return parsed;
}

module.exports = { generateReelsFromCarousel, generateShortReelFromCarousel, extractSlidesText };
