/**
 * reelsGeneratorService.js
 * Converte um carrossel salvo em um roteiro completo de Reels (formato split-screen)
 * com hook, body por segmentos, CTA, teleprompter pronto pra ler e queries de imagem.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { FMTEAM_EDITORIAL } = require('./fmteamEditorial');
const { SUBSTANCE_INTEL } = require('./substanceIntel');
const db = require('../db/database');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Fórmulas de gancho extraídas dos CAMPEÕES do próprio perfil — molde pra fraseTela.
// Público: HOMEM 25-40 (o COMPRADOR) que desconfia que algo hormonal trava o resultado
// (testo baixa, cortisol, insulina/resistência), ou usa/pensa em usar caneta (GLP-1) ou
// repor hormônio. Voz de treinador pra treinador: direto, sem drama, por sintoma (anti-ban).
const HOOK_FORMULAS = [
  'sintoma-oculto: junta sintomas soltos num alerta hormonal ("cansaço, libido baixa e barriga que não sai não é só idade")',
  'esforço ≠ resultado ("treina pesado, come certo e o shape travou — e o problema pode não ser o treino")',
  'erro da caneta ("emagreceu rápido na caneta e perdeu músculo junto — a conta vem depois")',
  'mito quebrado ("repor testosterona sem exame é apostar no escuro")',
  'bastidor/autoridade ("todo homem que chega travado no shape costuma ignorar esse exame")',
  'contra-intuição ("não é treinar mais: é o sono ruim derrubando tua testosterona")',
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
   • Ação CONCRETA + palavra-chave específica para comentar (ex: "comenta DIETA pra receber X", "salva pra não esquecer").
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
    "palavra_chave": "PALAVRA EM MAIÚSCULAS que o espectador comenta (ex: DIETA, CARDÁPIO, RECEITA)",
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
 * e engajamento altos, levando o HOMEM certo (25-40, o comprador) pra DM/consultoria.
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
  const ctaKeyword = String(ctaCfg.keyword || 'DIETA').toUpperCase().trim();
  const ctaBenefit = String(ctaCfg.benefit || 'um cardápio que vai te fazer secar sem passar fome').trim();
  // CTA principal montado (uma frase só) + alvo do "marca" (share). O comprador é
  // HOMEM (ver cérebro editorial), então o "marca" mira o parceiro de treino.
  // "para receber" (não "que eu"): o comentário cai no funil (auto-DM do cardápio).
  const ctaSentence = `Comenta ${ctaKeyword} para receber ${ctaBenefit}.`;
  const audienceTag = ctaCfg.marca || 'aquele parceiro que treina firme e ainda não vê resultado';

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
   • ERRADO (entrega a resposta): "Comer só salada não emagrece".
   • CERTO (lacuna): "Eu parei de fazer ISSO e a barriga começou a secar em 30 dias" / "Tem 1 erro que trava o teu emagrecimento e não é treino".
   • Curta: cabe na tela, no máximo 2 linhas (≤ 12 palavras). Linguagem de HOMEM 25-40: direto, sem drama, papo de treinador pra treinador.
   • TOM INFORMAL, papo reto de treinador — do jeito que você fala no dia a dia. Gíria leve é bem-vinda ("ó", "se liga", "presta atenção", "cara", "tá"). NADA corporativo ou formal demais.
   • Use gancho de número, contra-intuição ou dor nomeada. PROIBIDO morno ("dicas pra...", "você sabia").
   • Molde de gancho (inspiração dos tops do nicho — use a estrutura, NÃO copie): ${HOOK_FORMULAS.join(' · ')}.
   • DESTAQUE DOURADO: coloque EXATAMENTE 1 palavra-chave entre **duplo asterisco** — ela aparecerá em dourado na tela. Ex.: "Eu parei de fazer **ISSO** e a barriga secou" / "Tem 1 **erro** que trava o teu emagrecimento".

2. LEGENDA (legendaPost) — é onde mora o conteúdo, capricha. Ela é MATERIAL DE REFERÊNCIA: a pessoa tem que querer SALVAR pra aplicar depois e ENCAMINHAR pra alguém. Siga os 5 blocos nesta ordem:
   • BLOCO 1 — GANCHO (1ª linha): RE-FISGA sozinha (o Instagram corta em "... mais"). Dor ou promessa, NUNCA um pedido/CTA. Não começa com "Bom," nem repete a frase da tela igual.
   • BLOCO 2 — O ERRO + O PORQUÊ: mostra o erro comum e explica o MECANISMO que ninguém explica (é o que gera AUTORIDADE). Técnico traduzido, fecha a lacuna que a frase de tela abriu.
   • BLOCO 3 — PASSO A PASSO NUMERADO (é o que faz SALVAR): 3 passos práticos e executáveis, numerados "1) ... 2) ... 3) ...", cada um numa linha. Concreto (o QUE fazer), com número/quantidade quando couber. 1 ideia central do carrossel, não cobre tudo.
   • BLOCO 4 — O QUE ESPERAR: 1 linha de expectativa realista (prazo/resultado) pra dar prova e esperança.
   • BLOCO 5 — FECHO (2 linhas): primeiro a linha passiva de save+share "📌 Salva esse pra aplicar quando precisar — e marca ${audienceTag}."; depois, em linha separada, o CTA PRINCIPAL FIXO: "${ctaSentence}". NÃO invente outra palavra-chave nem troque o benefício. O "comenta" é o CTA principal e fica SOZINHO na última linha antes das hashtags.
   • Quebra em linhas curtas / parágrafos de 1-2 frases (legibilidade no app). Use \\n.
   • 4-6 hashtags relevantes ao nicho. ANTI-BAN: SEM hashtag de substância (testosterona/TRT/ozempic/etc), SEM nome comercial de droga.
   • Respeita a VOZ e o ANTI-BAN do cérebro editorial acima (você/não tu, sem "não é X é Y", português não gringo, por sintoma).

3. VÍDEO SUGERIDO (videoSugerido): o criador tem MUITO B-roll TREINANDO — então prefira SEMPRE um corte de TREINO que combine com a emoção (ex.: "criador numa série pesada de supino, suado, foco fechado" / "criador ofegante descansando entre séries, sério, olhando pra câmera" / "criador puxando costas, close no esforço"). Se o tema não casar com treino, sugira SPLIT-SCREEN: criador treinando EM CIMA + uma imagem/foto que ilustra o tema EMBAIXO. Vertical, sem fala.

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
  "fraseTela": "frase que para o scroll (lacuna aberta, ≤12 palavras) com **1 palavra** em destaque dourado",
  "fraseTelaTiming": "0-4s",
  "ctaTela": "👇 LEIA A LEGENDA",
  "ctaTelaTiming": "4-5s",
  "legendaPost": "Legenda COMPLETA em 5 blocos: (1) gancho que re-fisga, (2) erro+porquê/mecanismo, (3) passo a passo NUMERADO '1) 2) 3)' (faz salvar), (4) o que esperar, (5) fecho: linha '📌 Salva esse pra aplicar quando precisar — e marca ${audienceTag}.' e, na última linha antes das hashtags, o CTA principal SOZINHO '${ctaSentence}'. + 4-6 hashtags ban-safe. Use \\n para quebrar linhas.",
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

/**
 * Gera um REEL CURTO (~7s) de texto-na-tela DIRETO DE UM TEMA (sem carrossel base).
 * É o motor METRIC-DRIVEN da rotina diária: a rotina escolhe um TEMA vencedor pro
 * HOMEM 25-40 (hormônio/caneta/história/comparação), com anti-repetição, e chama aqui.
 * Mesmo formato validado: vídeo mudo + frase de tela (lacuna) + "👇 LEIA A LEGENDA" +
 * conteúdo na legenda. Mira o COMPRADOR (homem), voz de treinador, anti-ban duro.
 *
 * @param {Object} args
 * @param {string} args.topic      - o ângulo/título do tema (ex.: "Cansaço e libido baixa: e se for hormonal?")
 * @param {string} args.niche
 * @param {string} args.instagramHandle
 * @param {number} args.duration   - alvo em segundos (default 7)
 * @param {Object} args.cta        - { keyword, benefit, marca } (sobrescreve as settings)
 * @param {string} args.audience   - 'homem' (default) | 'mulher'
 * @param {boolean} args.isHormone - true pra temas de hormônio/GLP-1 → anti-ban reforçado
 */
async function generateShortReelFromTheme({ topic, niche = 'Saúde hormonal e performance do homem 25-40', instagramHandle = '', duration = 7, cta, audience = 'homem', isHormone = false }) {
  if (!topic || !String(topic).trim()) throw new Error('generateShortReelFromTheme: tema (topic) vazio.');

  const handle = (instagramHandle || '').replace('@', '');
  const handleAt = handle ? `@${handle}` : 'criador';

  const ctaCfg = { ...(db.getReelsCta ? db.getReelsCta() : {}), ...(cta || {}) };
  const ctaKeyword = String(ctaCfg.keyword || 'DIETA').toUpperCase().trim();
  const ctaBenefit = String(ctaCfg.benefit || 'um cardápio que vai te fazer secar sem passar fome').trim();
  const ctaSentence = `Comenta ${ctaKeyword} para receber ${ctaBenefit}.`;
  const audienceTag = ctaCfg.marca || 'aquele parceiro que treina firme e ainda não vê resultado';

  const publico = audience === 'mulher'
    ? 'MULHER 35-44 que quer emagrecer na vida real (correria, trabalho, filhos, casa).'
    : 'HOMEM 25-40 (o COMPRADOR): desconfia que algo hormonal trava o resultado (cansaço, libido baixa, barriga teimosa, treino sem evolução, sono ruim) ou usa/pensa em usar caneta (GLP-1) ou repor hormônio.';

  // Anti-ban reforçado só quando o tema é hormônio/caneta (zona de ban da Meta).
  const antiBan = isHormone ? ('\n━━━ ANTI-BAN — REGRA DURA (hormônio é zona de ban da Meta) ━━━\n'
    + '• NUNCA ensine/indique/venda/dose nem cite nome comercial de substância ou remédio. Fale por SINTOMA e MECANISMO.\n'
    + '• Proibido: "compre/use/tome/aplique", miligrama, protocolo, nome de droga/marca, promessa de cura/resultado garantido.\n'
    + '• O destino é SEMPRE investigar com EXAME e ACOMPANHAMENTO (a consultoria), nunca por conta própria.\n'
    + SUBSTANCE_INTEL) : '';

  const prompt = `Você é especialista em Reels do Instagram de TEXTO-NA-TELA (silenciosos) que viralizam organicamente no nicho de ${niche}.

Crie UM reel curto de ~${duration} segundos no formato "vídeo + frase de tela + leia a legenda" sobre o tema abaixo. NÃO TEM FALA. O criador NÃO narra nada.

${FMTEAM_EDITORIAL}

━━━ TEMA DE HOJE ━━━
${topic}

━━━ CRIADOR ━━━
${handleAt} · Nicho: ${niche}

━━━ PÚBLICO (mire exatamente este) ━━━
${publico}
${antiBan}

━━━ COMO ESSE FORMATO FUNCIONA (siga à risca) ━━━
• O vídeo é um B-ROLL do criador fazendo algo (treinando, cozinhando, andando, se olhando no espelho) — SEM falar.
• Por cima do vídeo aparece UMA frase escrita que PARA O SCROLL.
• Nos primeiros ~4s só a frase. No segundo 4-5 aparece "👇 LEIA A LEGENDA".
• O CONTEÚDO COMPLETO vai na LEGENDA. É ela que entrega o valor — o vídeo só fisga.
• A pessoa fica relendo (o reel de 7s re-roda) e vai pra legenda → retenção + comentário.

━━━ REGRAS NÃO-NEGOCIÁVEIS ━━━

1. FRASE DE TELA (fraseTela) — é o que decide tudo:
   • É uma LACUNA ABERTA: cria curiosidade mas NÃO entrega a resposta. Só a legenda fecha.
   • Curta: cabe na tela, no máximo 2 linhas (≤ 12 palavras). Voz de ${audience === 'mulher' ? 'mulher 35-44 na correria' : 'HOMEM 25-40, treinador pra treinador: direto, sem drama'}.
   • TOM INFORMAL, papo reto de treinador. Gíria leve é bem-vinda ("ó", "se liga", "presta atenção", "cara", "tá"). NADA corporativo.
   • Use gancho de número, contra-intuição ou dor/sintoma nomeado. PROIBIDO morno ("dicas pra...", "você sabia").
   • Molde de gancho (use a ESTRUTURA, não copie): ${HOOK_FORMULAS.join(' · ')}.
   • DESTAQUE DOURADO: coloque EXATAMENTE 1 palavra-chave entre **duplo asterisco** — ela aparece em dourado na tela. Ex.: "Tem 1 **exame** que todo homem travado ignora".

2. LEGENDA (legendaPost) — onde mora o conteúdo. É MATERIAL DE REFERÊNCIA: a pessoa tem que querer SALVAR e ENCAMINHAR. Siga os 5 blocos nesta ordem:
   • BLOCO 1 — GANCHO (1ª linha): RE-FISGA sozinho (o Instagram corta em "... mais"). Dor/sintoma ou promessa, NUNCA um pedido/CTA. Não repete a frase da tela igual.
   • BLOCO 2 — O ERRO + O PORQUÊ: mostra o erro comum e explica o MECANISMO (liga SINTOMA → MECANISMO). Técnico traduzido, fecha a lacuna da frase de tela. É o que gera AUTORIDADE.
   • BLOCO 3 — PASSO A PASSO NUMERADO (faz SALVAR): 3 passos práticos "1) ... 2) ... 3) ...", cada um numa linha. Pro tema hormonal, inclua "o que investigar / o que pedir no exame" quando couber. Concreto. 1 ideia central.
   • BLOCO 4 — O QUE ESPERAR: 1 linha de expectativa realista (prazo/resultado), sem prometer.
   • BLOCO 5 — FECHO (2 linhas): primeiro "📌 Salva esse pra aplicar quando precisar — e marca ${audienceTag}."; depois, em linha separada, o CTA PRINCIPAL FIXO: "${ctaSentence}". NÃO invente outra palavra-chave nem troque o benefício. O "comenta" fica SOZINHO na última linha antes das hashtags.
   • Quebra em linhas curtas (legibilidade no app). Use \\n.
   • 4-6 hashtags relevantes ao nicho. ANTI-BAN: SEM hashtag de substância (testosterona/TRT/ozempic/mounjaro/etc), SEM nome comercial de droga.
   • Respeita a VOZ e o ANTI-BAN do cérebro editorial acima (você/não tu, sem "não é X é Y", português não gringo, por sintoma).

3. VÍDEO SUGERIDO (videoSugerido): o criador tem MUITO B-roll TREINANDO — prefira SEMPRE um corte de TREINO que combine com a emoção (ex.: "criador numa série pesada de supino, suado, foco fechado"). Se o tema não casar com treino, sugira SPLIT-SCREEN: criador treinando EM CIMA + imagem que ilustra o tema EMBAIXO. Vertical, sem fala.

4. PROMPTS DE VÍDEO IA (promptsVideo): dois prompts PRONTOS PRA COLAR, a partir do vídeo/foto que o criador SEMPRE envia como referência:
   • SEMPRE comece mandando USAR O VÍDEO/FOTO DE REFERÊNCIA enviado pelo criador como base — NUNCA cite nome de arquivo (diga "the reference video/photo provided by the creator"). Mesma cara e corpo da referência.
   • REALISMO ANTI-IA: pele com textura/poros e imperfeições reais, luz natural imperfeita, leve tremida de câmera (handheld), motion blur sutil, ambiente real (academia/cozinha de verdade), suor e respiração reais, estética documental/candid de celular. PROIBIDO: pele plástica, brilho artificial, movimento robótico, cenário perfeito demais.
   • Vídeo VERTICAL 9:16, ~${duration}s, texto na tela GRANDE e legível (fraseTela 0-4s e "👇 LEIA A LEGENDA" 4-5s). O TEXTO NA TELA fica SEMPRE em PORTUGUÊS.
   • promptsVideo.heygen — avatar FALANDO: escreva a FALA em PORTUGUÊS (1 frase curta de impacto adaptada da fraseTela, 3-5s, tom da emoção). 4-6 frases de direção.
   • promptsVideo.broll — Sora/Veo/Higgsfield (texto→vídeo MUDO): DESCRIÇÃO DE CENA EM INGLÊS (seguem melhor em inglês), com todo o realismo anti-IA. Texto sobreposto continua em PORTUGUÊS. 4-6 frases.

5. EMOÇÃO DOMINANTE (emocao): escolha UMA e mantenha: curiosidade | medo de perder | urgência | surpresa | indignação.

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
  "fraseTela": "frase que para o scroll (lacuna aberta, ≤12 palavras) com **1 palavra** em destaque dourado",
  "fraseTelaTiming": "0-4s",
  "ctaTela": "👇 LEIA A LEGENDA",
  "ctaTelaTiming": "4-5s",
  "legendaPost": "Legenda COMPLETA em 5 blocos: (1) gancho que re-fisga, (2) erro+porquê/mecanismo, (3) passo a passo NUMERADO '1) 2) 3)', (4) o que esperar, (5) fecho: linha '📌 Salva esse pra aplicar quando precisar — e marca ${audienceTag}.' e, na última linha antes das hashtags, o CTA principal SOZINHO '${ctaSentence}'. + 4-6 hashtags ban-safe. Use \\n para quebrar linhas.",
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

  if (!parsed.fraseTela || !parsed.legendaPost) {
    throw new Error('Resposta incompleta — fraseTela ou legendaPost faltando.');
  }
  parsed.tipo = 'short';
  if (!parsed.duration) parsed.duration = duration;
  if (!parsed.ctaTela) parsed.ctaTela = '👇 LEIA A LEGENDA';

  return parsed;
}

module.exports = { generateReelsFromCarousel, generateShortReelFromCarousel, generateShortReelFromTheme, extractSlidesText };
