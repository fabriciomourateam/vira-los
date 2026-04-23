/**
 * carouselService.js
 * Implementação completa do agente de carrosseis para Instagram.
 * Baseado em: https://gist.github.com/hudsonbrendon/384eb612d4e5cedf562ef88b2bc9ceec
 *
 * Fluxo:
 *  1. Pesquisa tendências no Reddit via Apify (trudax/reddit-scraper, 8 subreddits de IA)
 *  2. Busca imagens portrait no Unsplash API
 *  3. Gera HTML completo via Claude (com CSS template exato do gist)
 *  4. Gera legenda.txt com caption + hashtags
 *  5. Captura screenshots PNG com Playwright (compensação de DPR conforme gist)
 *  6. Salva tudo em data/output/<slug>-<timestamp>/
 */

const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const OUTPUT_DIR = path.join(DATA_DIR, 'output');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ─── Mês atual em português ───────────────────────────────────────────────────

const MONTHS_PT = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
];
function currentMonthYear() {
  const now = new Date();
  return `${MONTHS_PT[now.getMonth()]} ${now.getFullYear()} ®`;
}

// ─── SVG Instagram (reutilizado em todos os slides) ───────────────────────────

const IG_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>`;

// ─── Passo 1: Reddit — API pública direta (sem Apify) + fallback Apify ───────

const REDDIT_SUBREDDITS = [
  'artificial', 'ChatGPT', 'OpenAI', 'MachineLearning',
  'singularity', 'ArtificialIntelligence', 'ClaudeAI', 'LocalLLaMA',
];

async function fetchRedditDirect() {
  const results = [];
  // Busca os 3 primeiros subreddits em paralelo (API pública do Reddit, sem auth)
  const requests = REDDIT_SUBREDDITS.slice(0, 3).map(sub =>
    axios.get(`https://www.reddit.com/r/${sub}/top.json`, {
      params: { t: 'week', limit: 5 },
      headers: { 'User-Agent': 'ViralOS/1.0 (carousel-agent)' },
      timeout: 10000,
    }).catch(() => null)
  );
  const responses = await Promise.all(requests);
  for (const res of responses) {
    if (!res) continue;
    const posts = res.data?.data?.children || [];
    for (const p of posts) {
      const d = p.data;
      if (!d?.title) continue;
      results.push({
        title: String(d.title).substring(0, 200),
        score: d.score || 0,
        subreddit: d.subreddit || '',
        url: d.url || '',
      });
    }
  }
  return results.slice(0, 8);
}

async function fetchRedditApify() {
  const apiKey = process.env.APIFY_API_KEY;
  if (!apiKey) return [];
  const id = 'trudax~reddit-scraper';
  const url = `https://api.apify.com/v2/acts/${id}/run-sync-get-dataset-items?token=${apiKey}&timeout=90`;
  const response = await axios.post(url, {
    startUrls: REDDIT_SUBREDDITS.map(s => ({ url: `https://www.reddit.com/r/${s}/top/?t=week` })),
    maxItems: 30,
    sort: 'top',
    time: 'week',
  }, { timeout: 105000 });
  const items = Array.isArray(response.data) ? response.data : [];
  return items.slice(0, 8).map(p => ({
    title: String(p.title || '').substring(0, 200),
    score: p.score || 0,
    subreddit: p.community || p.subreddit || '',
    url: p.url || '',
  }));
}

async function fetchRedditTrends() {
  // Tenta Apify primeiro; se falhar (403/erro) usa API pública direta do Reddit
  try {
    if (process.env.APIFY_API_KEY) {
      const results = await fetchRedditApify();
      if (results.length) return results;
    }
  } catch (err) {
    console.warn('[CarouselService/Reddit/Apify]', err.message, '— usando API direta');
  }
  try {
    return await fetchRedditDirect();
  } catch (err) {
    console.error('[CarouselService/Reddit/Direct]', err.message);
    return [];
  }
}

// ─── Passo 2: Unsplash API ────────────────────────────────────────────────────

async function fetchUnsplashImages(query, count = 12) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) {
    console.warn('[CarouselService/Unsplash] UNSPLASH_ACCESS_KEY não definida — sem imagens');
    return [];
  }

  try {
    const r = await axios.get('https://api.unsplash.com/search/photos', {
      params: { query, per_page: count, orientation: 'portrait' },
      headers: { Authorization: `Client-ID ${key}` },
      timeout: 10000,
    });
    const results = r.data?.results || [];
    console.log(`[CarouselService/Unsplash] ${results.length} imagens para "${query}"`);
    return results.map(img => ({
      url: img.urls?.regular || '',
      alt: img.alt_description || query,
    })).filter(img => img.url);
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.errors?.[0] || err.message;
    console.error(`[CarouselService/Unsplash] Erro ${status || ''}: ${detail}`);
    return [];
  }
}

// ─── Passo 2b: Pexels API (fallback) ─────────────────────────────────────────

async function fetchPexelsImages(query, count = 12) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) {
    console.warn('[CarouselService/Pexels] PEXELS_API_KEY não definida');
    return [];
  }

  try {
    const r = await axios.get('https://api.pexels.com/v1/search', {
      params: { query, per_page: count, orientation: 'portrait' },
      headers: { Authorization: key },
      timeout: 10000,
    });
    const photos = r.data?.photos || [];
    console.log(`[CarouselService/Pexels] ${photos.length} imagens para "${query}"`);
    return photos.map(p => ({
      url: p.src?.large2x || p.src?.large || p.src?.portrait || '',
      alt: p.alt || query,
    })).filter(p => p.url);
  } catch (err) {
    const status = err.response?.status;
    console.error(`[CarouselService/Pexels] Erro ${status || ''}: ${err.message}`);
    return [];
  }
}

// Cascata: tenta Unsplash → Pexels (1 imagem por query)
async function fetchImages(query, count = 12) {
  const images = await fetchUnsplashImages(query, count);
  if (images.length) return images;
  console.log('[CarouselService] Unsplash vazio, tentando Pexels...');
  return fetchPexelsImages(query, count);
}

// Busca uma imagem por slide com query específica (fallback para o tema geral)
async function fetchOneImage(query, fallbackQuery) {
  try {
    let imgs = await fetchUnsplashImages(query, 1);
    if (!imgs.length) imgs = await fetchPexelsImages(query, 1);
    if (!imgs.length && fallbackQuery) {
      imgs = await fetchUnsplashImages(fallbackQuery, 1);
      if (!imgs.length) imgs = await fetchPexelsImages(fallbackQuery, 1);
    }
    return imgs[0] || null;
  } catch {
    return null;
  }
}

// Gera queries de imagem específicas por slide via Claude (chamada leve)
async function generateSlideImageQueries(topic, roteiro, slidesCount, niche) {
  const roteiroContext = roteiro
    ? `Roteiro:\n${roteiro.slice(0, 1200)}`
    : `Tema: "${topic}" — nicho: ${niche}`;

  const prompt = `${roteiroContext}

Gere exatamente ${slidesCount} queries de busca de imagens no Unsplash/Pexels, uma por slide.
Cada query deve ser em INGLÊS, 2-4 palavras, descrevendo a imagem ideal para aquele slide.
Slide 1 = capa (foto impactante do tema), slides 2 a ${slidesCount - 1} = conteúdo específico de cada ponto, slide ${slidesCount} = CTA/motivação.

Responda APENAS com um JSON array de strings, sem markdown:
["query slide 1", "query slide 2", ...]`;

  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = (res.content[0]?.text || '').trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return null;
    const queries = JSON.parse(match[0]);
    return Array.isArray(queries) ? queries : null;
  } catch {
    return null;
  }
}

// ─── Passo 3: CSS template completo (baseado no gist) ────────────────────────

// URL única que carrega todas as fontes disponíveis no editor
const ALL_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900' +
  '&family=Poppins:wght@300;400;500;600;700;800;900' +
  '&family=Montserrat:wght@300;400;500;600;700;800;900' +
  '&family=Raleway:wght@300;400;500;600;700;800;900' +
  '&family=Oswald:wght@300;400;500;600;700' +
  '&family=Playfair+Display:wght@400;500;600;700;800;900' +
  '&family=Bebas+Neue:wght@400' +
  '&family=Anton:wght@400' +
  '&family=Roboto:wght@300;400;500;700;900' +
  '&family=Lato:wght@300;400;700;900' +
  '&family=Open+Sans:wght@300;400;500;600;700;800' +
  '&family=Ubuntu:wght@300;400;500;700' +
  '&family=Nunito:wght@300;400;500;600;700;800;900' +
  '&family=DM+Sans:wght@300;400;500;600;700' +
  '&family=Space+Grotesk:wght@300;400;500;600;700' +
  '&family=Syne:wght@400;500;600;700;800' +
  '&display=swap';

function buildCSSTemplate({ primaryColor, accentColor, bgColor, fontFamily }) {
  return `
  <link href="${ALL_FONTS_URL}" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    /* ── SLIDE CAPA / CTA (foto de fundo) ── */
    .slide {
      width: 1080px; height: 1350px;
      position: relative; overflow: hidden;
      font-family: '${fontFamily}', sans-serif;
      color: #ffffff;
      display: flex; flex-direction: column; justify-content: flex-end;
      padding: 60px 56px 90px;
      page-break-after: always;
    }
    .slide-bg {
      position: absolute; top: 0; left: 0;
      width: 100%; height: 100%;
      background-size: cover; background-position: center;
      z-index: 0;
    }
    .slide-overlay {
      position: absolute; top: 0; left: 0;
      width: 100%; height: 100%;
      background: linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.88) 62%, rgba(0,0,0,0.97) 100%);
      z-index: 1;
    }
    .slide-content {
      position: relative; z-index: 2;
      width: 100%; display: flex; flex-direction: column; gap: 24px;
    }

    /* ── BRANDING CENTRALIZADO (só capa) ── */
    .cover-branding {
      display: flex; align-items: center; justify-content: center;
      gap: 12px; margin-bottom: 16px;
    }
    .cover-branding svg { width: 32px; height: 32px; fill: #ffffff; }
    .cover-branding span {
      font-size: 24px; font-weight: 700; color: #ffffff;
      text-shadow: 2px 2px 8px rgba(0,0,0,0.8);
    }

    /* ── HEADER TOPO (todos os slides) ── */
    .top-header {
      position: absolute; top: 0; left: 0; right: 0;
      display: flex; justify-content: space-between; align-items: center;
      padding: 22px 40px; z-index: 10;
      font-family: 'Space Grotesk', sans-serif;
    }
    .top-header span {
      font-size: 14px; font-weight: 400;
      color: rgba(255,255,255,0.55);
      letter-spacing: 0.8px; text-transform: uppercase;
    }

    /* ── RODAPÉ (todos os slides) ── */
    .footer {
      position: absolute; bottom: 0; left: 0; right: 0;
      display: flex; justify-content: space-between; align-items: center;
      padding: 18px 40px; background: rgba(0,0,0,0.5); z-index: 10;
    }
    .footer-left { display: flex; align-items: center; gap: 10px; }
    .footer-left svg { width: 22px; height: 22px; fill: #ffffff; }
    .footer-left span { font-size: 18px; font-weight: 600; color: #ffffff; }
    .footer-right { font-size: 18px; font-weight: 500; color: rgba(255,255,255,0.6); }

    /* ── TIPOGRAFIA CAPA/CTA ── */
    .title {
      font-size: 56px; font-weight: 900; line-height: 1.1;
      letter-spacing: -1px; text-transform: uppercase;
      text-shadow: 2px 2px 8px rgba(0,0,0,0.8);
    }
    .title .highlight { color: ${primaryColor}; }
    .title .highlight-yellow { color: #D9D353; }
    .subtitle {
      font-size: 24px; font-weight: 500;
      color: rgba(255,255,255,0.85); line-height: 1.5;
      text-shadow: 1px 1px 4px rgba(0,0,0,0.8); max-width: 900px;
    }
    .subtitle-accent {
      font-size: 22px; font-weight: 600; color: ${accentColor};
      line-height: 1.5; text-shadow: 1px 1px 4px rgba(0,0,0,0.8);
      text-transform: uppercase; letter-spacing: 0.5px;
    }

    /* ── SLIDES INTERNOS (estilo editorial/narrativo) ── */
    .slide-editorial {
      width: 1080px; height: 1350px;
      position: relative; overflow: hidden;
      font-family: '${fontFamily}', sans-serif;
      color: #ffffff; background: ${bgColor};
      display: flex; flex-direction: column; justify-content: center;
      padding: 80px 56px 90px;
      page-break-after: always;
    }

    /* Variante D: fundo cor sólida (roxo/primary) */
    .slide-editorial.accent-bg { background: ${primaryColor}; }

    .slide-editorial .editorial-content {
      display: flex; flex-direction: column; gap: 28px;
      z-index: 2; flex: 1; justify-content: center;
    }

    /* Texto principal — GRANDE, 36-42px */
    .slide-editorial .narrative-text {
      font-family: '${fontFamily}', sans-serif;
      font-size: 38px; font-weight: 400; line-height: 1.45; color: #ffffff;
    }

    /* Texto secundário — menor, 26-30px */
    .slide-editorial .narrative-text.secondary {
      font-size: 28px; font-weight: 400; line-height: 1.5;
    }

    /* Destaques inline */
    .slide-editorial .narrative-text .highlight {
      color: ${primaryColor}; font-weight: 700; font-style: italic;
    }
    .slide-editorial .narrative-text .highlight-green {
      color: #3CD3A4; font-weight: 700; font-style: italic;
    }
    .slide-editorial .narrative-text .highlight-yellow {
      color: #D9D353; font-weight: 700; font-style: italic;
    }
    .slide-editorial .narrative-text strong { font-weight: 700; }

    /* No fundo de cor sólida, destaques em branco/amarelo */
    .slide-editorial.accent-bg .narrative-text .highlight {
      color: #ffffff; text-decoration: underline; text-decoration-thickness: 3px;
    }
    .slide-editorial.accent-bg .narrative-text .highlight-green {
      color: #D9D353; font-weight: 700; font-style: italic;
    }

    /* Foto contextual contida no slide (~90% largura) */
    .slide-editorial .editorial-photo-container {
      width: 100%; border-radius: 8px; overflow: hidden;
    }
    .slide-editorial .editorial-photo-container img {
      width: 100%; height: 380px; object-fit: cover; display: block;
    }
  </style>`;
}

// ─── Passo 3: Prompt Claude para gerar o HTML ─────────────────────────────────

// ─── Estrutura de conteúdo viral adaptada ao número de slides ────────────────

function buildViralStructure({ numSlides, dominantEmotion, handleAt, roteiro }) {
  const emo = (dominantEmotion || 'medo de perder').toUpperCase();
  const roteiroNote = roteiro && roteiro.trim()
    ? 'Distribuir o ROTEIRO DO CRIADOR por essa estrutura mantendo a emoção dominante. Não inventar nem alterar o texto.'
    : 'Linguagem direta, sem travessão no meio das frases, sem clichês, cada slide com insight novo.';

  const rules = `
REGRAS DE ESCRITA:
- Linguagem direta, como alguém falando com um amigo inteligente
- Sem travessão no meio das frases
- Sem clichês ou frases genéricas
- Cada slide entrega um insight novo, nunca repete o anterior
- Tom provocador e inteligente, nunca agressivo
- Máximo 40 palavras por slide de conteúdo
- ${roteiroNote}`;

  // Blocos reutilizáveis
  const HOOK        = (n) => `SLIDE ${n} — HOOK (para o scroll): número específico, promessa clara ou dor real. Proibido: abertura genérica, frase motivacional ou pergunta retórica fraca.`;
  const QUEBRA      = (n) => `SLIDE ${n} — QUEBRA DE EXPECTATIVA: contradiga a crença mais comum do nicho. Gera a sensação "espera, não é isso que eu sempre ouvi?". Termine com frase que cria lacuna — o leitor precisa ir para o próximo slide.`;
  const AMPLI       = (n, extra='') => `SLIDE ${n} — AMPLIFICAÇÃO${extra}: comportamento incoerente que a maioria tem (o leitor pensa "isso sou eu") + consequência real e específica de continuar assim.`;
  const REVELACAO   = (n, extra='') => `SLIDE ${n} — REVELAÇÃO${extra}: insight central que reframe tudo que veio antes + metáfora simples e visual que qualquer pessoa entende em 3 segundos.`;
  const CONSEQUENCIA = (n) => `SLIDE ${n} — CONSEQUÊNCIA: custo real e específico de ignorar a revelação — use dados, prazo ou comparação concreta. Sem generalização.`;
  const FRASE       = (n) => `SLIDE ${n} — FRASE FINAL DE IMPACTO: uma única ideia curta que sintetize a emoção dominante (${dominantEmotion}). Sem explicação. Sem suavização.`;
  const CTA         = (n) => `SLIDE ${n} — CTA: ação concreta e específica atrelada ao tema. Peça comentar uma palavra-chave + seguir ${handleAt} para mais conteúdos. Não use CTA genérico.`;

  let structure = `━━━ ESTRUTURA DOS SLIDES (emoção dominante: ${emo}) ━━━\nMáximo 40 palavras por slide.\n\n`;

  if (numSlides <= 5) {
    structure += [
      HOOK(1),
      QUEBRA(2),
      `SLIDE 3 — AMPLIFICAÇÃO + REVELAÇÃO: comportamento incoerente da maioria + insight central que reframe. Metáfora simples e visual.`,
      `SLIDE 4 — CONSEQUÊNCIA + FRASE FINAL: custo específico de ignorar + uma frase curta que sintetize a emoção (${dominantEmotion}).`,
      CTA(5),
    ].join('\n\n');
  } else if (numSlides === 6) {
    structure += [
      HOOK(1),
      QUEBRA(2),
      AMPLI(3),
      REVELACAO(4),
      `SLIDE 5 — CONSEQUÊNCIA + FRASE FINAL: custo específico de ignorar (dados/prazo/comparação) + frase curta que sintetize a emoção (${dominantEmotion}).`,
      CTA(6),
    ].join('\n\n');
  } else if (numSlides === 7) {
    structure += [
      HOOK(1),
      QUEBRA(2),
      AMPLI(3),
      REVELACAO(4),
      CONSEQUENCIA(5),
      FRASE(6),
      CTA(7),
    ].join('\n\n');
  } else if (numSlides === 8) {
    structure += [
      HOOK(1),
      QUEBRA(2),
      AMPLI(3, ' pt.1'),
      AMPLI(4, ' pt.2'),
      REVELACAO(5),
      CONSEQUENCIA(6),
      FRASE(7),
      CTA(8),
    ].join('\n\n');
  } else {
    // 9 ou 10 slides — estrutura completa
    structure += [
      HOOK(1),
      QUEBRA(2),
      AMPLI(3, ' pt.1'),
      AMPLI(4, ' pt.2'),
      REVELACAO(5, ' pt.1'),
      REVELACAO(6, ' pt.2'),
      CONSEQUENCIA(7),
      FRASE(8),
      ...(numSlides >= 10 ? [`SLIDE 9 — REFORÇO: exemplo real ou dado extra que solidifica a revelação. Direto e específico.`] : []),
      CTA(numSlides),
    ].join('\n\n');
  }

  return structure + rules;
}

// ─── Prompt HTML layout "Editorial" ──────────────────────────────────────────

function buildHTMLPrompt({ topic, instructions, niche, primaryColor, accentColor, bgColor, fontFamily,
  instagramHandle, profilePhotoUrl, numSlides, contentTone, dominantEmotion, redditTrends, unsplashImages, roteiro }) {

  const handle = (instagramHandle || 'seucanal').replace('@', '');
  const handleAt = `@${handle}`;
  const monthYear = currentMonthYear();
  const totalContent = numSlides - 2;
  const cssTemplate = buildCSSTemplate({ primaryColor, accentColor, bgColor, fontFamily });

  const trendsSection = (!roteiro?.trim() && redditTrends.length)
    ? `\nTendências do Reddit sobre "${niche}" esta semana:\n${redditTrends.map((t, i) =>
        `${i + 1}. [r/${t.subreddit}] ${t.title} (${t.score} upvotes)`).join('\n')}`
    : '';

  const imagesSection = unsplashImages.length
    ? `\nImagens — cada uma foi buscada para aquele slide específico. Use a URL exata na ordem:\n${unsplashImages.map((img, i) =>
        img.url ? `Slide ${i + 1}: ${img.url}` : `Slide ${i + 1}: (sem imagem — use gradiente CSS)`).join('\n')}`
    : '\n(Sem imagens — use gradientes CSS criativos no fundo dos slides de foto)';

  const roteiroSection = roteiro && roteiro.trim()
    ? `\n━━━ ROTEIRO DO CRIADOR — siga este conteúdo, não invente ━━━\n${roteiro.trim()}\n\nDistribua este roteiro pelos ${numSlides} slides:\n- SLIDE 1 (capa): gancho principal / título do roteiro\n- SLIDES 2 a ${numSlides - 1}: divida o desenvolvimento ponto a ponto\n- SLIDE ${numSlides} (CTA): use o CTA do roteiro ou crie um adequado\nUse APENAS o conteúdo acima — não adicione informações externas.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    : '';

  const instructionsSection = instructions && instructions.trim()
    ? `\n━━━ DIRETRIZ DE CONTEÚDO — OBRIGATÓRIO SEGUIR EM TODOS OS SLIDES ━━━\n${instructions.trim()}\nEsta diretriz define como o conteúdo deve ser abordado. Aplique em CADA slide sem exceção.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    : '';

  return `Você é um agente especializado em criar carrosseis profissionais para Instagram no estilo editorial/investigativo.

Tema: "${topic}"
Nicho: ${niche}
Tom: ${contentTone}
Instagram: ${handleAt}
Total de slides: ${numSlides} (1 capa + ${totalContent} conteúdo + 1 CTA final)
${instructionsSection}
${trendsSection}
${imagesSection}
${roteiroSection}

━━━ REGRAS ABSOLUTAS ━━━
- Retorne APENAS o código HTML completo. Comece com <!DOCTYPE html> e termine com </html>
- NÃO use markdown, code fences, comentários explicativos ou qualquer texto fora do HTML
- Use EXATAMENTE as classes CSS do template abaixo — não invente outras
- Substitua TODOS os [SEU_INSTAGRAM] e [handle] por "${handleAt}"

━━━ HEADER TOPO (obrigatório em TODOS os slides) ━━━
<div class="top-header">
  <span>Powered by Postlab</span>
  <span>${handleAt}</span>
  <span>${monthYear}</span>
</div>

━━━ RODAPÉ (obrigatório em TODOS os slides) ━━━
Footer esquerdo: SVG do Instagram + "${handleAt}"
Footer direito: número N/${totalContent} — APENAS slides 2 a ${numSlides - 1}
A CAPA (slide 1) e o CTA (slide ${numSlides}) NÃO têm número no rodapé direito

━━━ CLASSES HTML OBRIGATÓRIAS POR TIPO DE SLIDE ━━━
SLIDE 1 (capa) → use .slide: slide-bg + slide-overlay + top-header + cover-branding + slide-content (.title CAIXA ALTA + .subtitle) + .footer SEM número
SLIDES INTERNOS → use .slide-editorial: top-header + editorial-content (.narrative-text 38px + .narrative-text.secondary 28px) + .footer com número N/${totalContent}
  Variantes de foto: A (meio) | B (base) | C (topo) | D (.accent-bg sem foto, use em 1-2 slides de impacto)
  Destaques: <span class="highlight"> ou <span class="highlight-green">
SLIDE ${numSlides} (CTA) → use .slide: foto + overlay + top-header + .title com CTA + box "SIGA ${handleAt}" em #D9D353 + .footer com ${numSlides - 1}/${totalContent}

${buildViralStructure({ numSlides, dominantEmotion, handleAt, roteiro })}

━━━ CSS TEMPLATE OBRIGATÓRIO ━━━
${cssTemplate}

━━━ SVG DO INSTAGRAM (copie exatamente em todos os footer-left e cover-branding) ━━━
${IG_SVG}

Gere o HTML completo agora (apenas HTML, nada mais):`;
}

// ─── CSS template layout "Clean" (estilo Fabricio Moura) ─────────────────────

function buildCleanCSSTemplate({ primaryColor, fontFamily }) {
  return `
  <link href="${ALL_FONTS_URL}" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    /* ── CAPA ── */
    .clean-cover {
      width: 1080px; height: 1350px;
      position: relative; overflow: hidden;
      font-family: '${fontFamily}', sans-serif;
      page-break-after: always;
    }
    .clean-cover .bg {
      position: absolute; inset: 0;
      background-size: cover; background-position: center;
      z-index: 0;
    }
    .clean-cover .overlay {
      position: absolute; inset: 0;
      background: linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 38%, rgba(0,0,0,0.88) 60%, rgba(0,0,0,0.97) 100%);
      z-index: 1;
    }
    /* ── CAPA: bloco compacto na metade inferior ── */
    .clean-cover .profile-badge {
      position: absolute;
      top: 52%; left: 50%; transform: translateX(-50%);
      z-index: 2;
      display: flex; flex-direction: row; align-items: center; gap: 22px;
      white-space: nowrap;
    }
    /* Anel degradê estilo Instagram Stories */
    .clean-cover .avatar-ring {
      width: 96px; height: 96px; border-radius: 50%; flex-shrink: 0;
      background: linear-gradient(135deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%);
      padding: 4px;
      display: flex; align-items: center; justify-content: center;
    }
    .clean-cover .avatar-circle {
      width: 100%; height: 100%; border-radius: 50%;
      background: #111;
      overflow: hidden;
      display: flex; align-items: center; justify-content: center;
      font-size: 28px; font-weight: 800; color: white;
    }
    .clean-cover .avatar-circle img { width: 100%; height: 100%; object-fit: cover; }
    .clean-cover .profile-text {
      display: flex; flex-direction: column; gap: 6px;
    }
    .clean-cover .profile-name {
      font-size: 34px; font-weight: 700; color: white;
      display: flex; align-items: center; gap: 8px;
    }
    .clean-cover .verified-badge svg { width: 28px; height: 28px; display: block; flex-shrink: 0; }
    .clean-cover .profile-handle {
      font-size: 22px; font-weight: 400; color: rgba(255,255,255,0.60);
    }
    /* Título centralizado abaixo do badge */
    .clean-cover .cover-title {
      position: absolute; bottom: 130px; left: 60px; right: 60px; z-index: 2;
      font-size: 68px; font-weight: 900; line-height: 1.1; color: white;
      text-align: center;
    }
    .clean-cover .cover-title .hl { color: ${primaryColor}; }
    .clean-cover .swipe-hint {
      position: absolute; bottom: 64px; left: 0; right: 0;
      text-align: center; z-index: 2;
      font-size: 22px; color: rgba(255,255,255,0.50);
      font-weight: 400;
    }

    /* ── SLIDE DE CONTEÚDO — fundo escuro + foto em card ── */
    .clean-content {
      width: 1080px; height: 1350px;
      position: relative; overflow: hidden;
      background: #0f0f0f;
      font-family: '${fontFamily}', sans-serif;
      padding: 80px 64px 110px;
      display: flex; flex-direction: column;
      page-break-after: always;
    }
    .clean-content .content-title {
      font-size: 66px; font-weight: 900; line-height: 1.08;
      color: #ffffff; margin-bottom: 32px;
    }
    .clean-content .content-title .hl { color: ${primaryColor}; }
    .clean-content .content-body {
      font-size: 30px; font-weight: 400; line-height: 1.55;
      color: rgba(255,255,255,0.68);
    }
    .clean-content .photo-card {
      margin-top: auto; margin-bottom: 84px;
      width: 100%; height: 510px;
      border-radius: 24px; overflow: hidden; flex-shrink: 0;
    }
    .clean-content .photo-card img {
      width: 100%; height: 100%; object-fit: cover; display: block;
    }
    .clean-content .slide-footer {
      position: absolute; bottom: 0; left: 0; right: 0;
      display: flex; justify-content: space-between; align-items: center;
      padding: 28px 56px;
    }
    .clean-content .footer-name-pill {
      background: linear-gradient(90deg, #f58529 0%, #dd2a7b 50%, #8134af 100%);
      border-radius: 60px;
      padding: 16px 40px;
      font-size: 26px; font-weight: 700; color: white;
      white-space: nowrap;
      display: inline-flex; align-items: center; gap: 8px;
    }
    .clean-content .footer-name-pill .verified-badge svg { width: 26px; height: 26px; display: block; flex-shrink: 0; }
    .clean-content .footer-handle-pill {
      border: 2px solid rgba(255,255,255,0.30);
      border-radius: 60px;
      padding: 16px 40px;
      font-size: 26px; font-weight: 500; color: rgba(255,255,255,0.88);
      background: rgba(255,255,255,0.04);
      white-space: nowrap;
    }
    .clean-content .footer-swipe {
      font-size: 22px; color: rgba(255,255,255,0.42);
      white-space: nowrap;
    }

    /* ── SLIDE DE CONTEÚDO — variante com foto no TOPO (meia altura) ── */
    .clean-content.top-photo {
      padding: 0 0 110px;
      flex-direction: column;
    }
    .clean-content.top-photo .top-photo-wrap {
      width: 100%; height: 540px; overflow: hidden; flex-shrink: 0;
    }
    .clean-content.top-photo .top-photo-wrap img {
      width: 100%; height: 100%; object-fit: cover; display: block;
    }
    .clean-content.top-photo .text-section {
      padding: 48px 64px 0;
      display: flex; flex-direction: column; gap: 24px;
    }
    /* faixa "Me siga" no topo (usada uma vez) */
    .follow-banner {
      background: #FF7B8B; width: 100%;
      padding: 22px 64px;
      display: flex; align-items: center; gap: 18px; flex-shrink: 0;
      font-size: 27px; font-weight: 700; color: white;
    }
    .follow-banner svg { width: 36px; height: 36px; fill: white; flex-shrink: 0; }

    /* ── CTA FINAL ── */
    .clean-cta {
      width: 1080px; height: 1350px;
      position: relative; overflow: hidden;
      font-family: '${fontFamily}', sans-serif;
      page-break-after: always;
    }
    .clean-cta .bg {
      position: absolute; inset: 0;
      background-size: cover; background-position: center;
      filter: brightness(0.3); z-index: 0;
    }
    .clean-cta .overlay {
      position: absolute; inset: 0;
      background: rgba(0,0,0,0.62); z-index: 1;
    }
    .clean-cta .cta-inner {
      position: relative; z-index: 2; height: 100%;
      display: flex; flex-direction: column; justify-content: center; align-items: center;
      padding: 80px 72px; text-align: center; gap: 48px;
    }
    .clean-cta .cta-title {
      font-size: 70px; font-weight: 900; line-height: 1.08; color: white;
    }
    .clean-cta .cta-title .hl { color: ${primaryColor}; }
    .clean-cta .follow-pill {
      background: white; color: #0f0f0f;
      border-radius: 60px; padding: 28px 72px;
      font-size: 34px; font-weight: 900;
      display: inline-flex; align-items: center; gap: 10px;
    }
    .clean-cta .follow-pill .verified-badge svg { width: 30px; height: 30px; display: block; flex-shrink: 0; }
    .clean-cta .cta-footer {
      position: absolute; bottom: 60px; left: 0; right: 0;
      text-align: center; z-index: 2;
      font-size: 22px; color: rgba(255,255,255,0.5);
    }

    /* ── SLIDE ANTES/DEPOIS (split screen vertical) ── */
    .clean-split {
      width: 1080px; height: 1350px;
      position: relative; overflow: hidden;
      background: #0f0f0f;
      font-family: '${fontFamily}', sans-serif;
      display: flex; flex-direction: column;
      page-break-after: always;
    }
    .clean-split .split-photos {
      /* Altura fixa: 840 px = 62% do slide (1350 px).
         flex-shrink:0 impede que o conteúdo de baixo comprima as fotos. */
      display: flex; height: 840px; flex-shrink: 0; gap: 0; overflow: hidden;
    }
    .clean-split .split-panel {
      flex: 1; position: relative; overflow: hidden;
    }
    .clean-split .split-panel + .split-panel {
      border-left: 4px solid #0f0f0f;
    }
    .clean-split .split-img,
    .clean-split .split-panel img {
      width: 100%; height: 100%; object-fit: cover; display: block;
    }
    .clean-split .split-label {
      position: absolute; bottom: 28px; left: 50%; transform: translateX(-50%);
      background: rgba(0,0,0,0.72); color: white; backdrop-filter: blur(4px);
      padding: 12px 40px; border-radius: 60px;
      font-size: 30px; font-weight: 900; letter-spacing: 3px; white-space: nowrap;
    }
    .clean-split .split-label.after {
      background: ${primaryColor};
    }
    .clean-split .split-divider {
      position: absolute; top: 0; bottom: 0; left: 50%;
      width: 4px; background: #0f0f0f; transform: translateX(-50%);
      z-index: 2;
    }
    .clean-split .split-content {
      /* Ocupa os 510 px restantes (1350 - 840) */
      flex: 1; overflow: hidden;
      padding: 32px 64px 100px; background: #0f0f0f;
      display: flex; flex-direction: column; gap: 12px;
    }
    .clean-split .split-eyebrow {
      font-size: 24px; font-weight: 700; letter-spacing: 3px;
      color: ${primaryColor}; text-transform: uppercase;
    }
    .clean-split .split-title {
      font-size: 58px; font-weight: 900; line-height: 1.1; color: white;
    }
    .clean-split .split-title .hl { color: ${primaryColor}; }
    .clean-split .split-stats {
      font-size: 30px; font-weight: 600; color: rgba(255,255,255,0.65);
    }
    .clean-split .split-footer {
      position: absolute; bottom: 0; left: 0; right: 0;
      display: flex; justify-content: space-between; align-items: center;
      padding: 28px 56px; background: transparent;
    }
  </style>`;
}

// ─── Prompt baseado em template HTML salvo ────────────────────────────────────

function buildTemplateHTMLPrompt({ templateHtml, topic, instructions, niche, instagramHandle, creatorName, contentTone, dominantEmotion, unsplashImages, roteiro, numSlides }) {
  const handle = (instagramHandle || 'seucanal').replace('@', '');
  const handleAt = `@${handle}`;
  const displayName = creatorName
    || handle.replace(/team$/i, '').replace(/[._-]/g, ' ').trim()
         .replace(/\b\w/g, c => c.toUpperCase())
    || handle;

  // Remove data:... base64 URIs (muito grandes para o contexto)
  const cleanedHtml = templateHtml
    .replace(/src="data:[^"]{10,}"/g, 'src=""')
    .replace(/url\('data:[^']{10,}'\)/g, "url('')")
    .replace(/url\("data:[^"]{10,}"\)/g, 'url("")');

  const validImages = (unsplashImages || []).filter(img => img.url);
  const imagesSection = validImages.length
    ? `Novas imagens — substitua as URLs de imagem existentes por essas, na ordem dos slides:\n${validImages.map((img, i) => `Slide ${i + 1}: ${img.url}`).join('\n')}`
    : '(Sem novas imagens — mantenha as URLs existentes no template)';

  const roteiroSection = roteiro && roteiro.trim()
    ? `\n━━━ ROTEIRO DO CRIADOR — use este conteúdo nos textos ━━━\n${roteiro.trim()}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    : '';

  const instructionsSection = instructions && instructions.trim()
    ? `\n━━━ DIRETRIZ DE CONTEÚDO — OBRIGATÓRIO SEGUIR EM TODOS OS SLIDES ━━━\n${instructions.trim()}\nEsta diretriz define como o conteúdo deve ser abordado. Aplique em CADA slide sem exceção.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    : '';

  return `Você é um especialista em carrosseis para Instagram. Sua tarefa é criar um NOVO carrossel reutilizando EXATAMENTE o layout visual de um template existente.

Tema: "${topic}"
Nicho: ${niche}
Tom: ${contentTone}
Emoção dominante: ${dominantEmotion || 'medo de perder'}
Instagram: ${handleAt} | Nome: ${displayName}
${instructionsSection}
${roteiroSection}

${buildViralStructure({ numSlides, dominantEmotion: dominantEmotion || 'medo de perder', handleAt, roteiro })}

━━━ O QUE VOCÊ DEVE MANTER IDÊNTICO (NÃO ALTERE) ━━━
1. O bloco <style>...</style> INTEIRO — copie caractere por caractere
2. A estrutura HTML de cada slide (tags, classes, hierarquia de divs)
3. Todos os atributos "style" inline de TODOS os elementos — posição (top, left, right, bottom), transform, tamanhos, margens, cores de fundo
4. FONTES: mantenha EXATAMENTE o font-family, font-size, font-weight, line-height, letter-spacing de cada elemento. NÃO mude nenhum tamanho de letra nem fonte.
5. SLIDE DE CAPA: preserve a posição e estilo de TODOS os elementos (.profile-badge, .avatar-circle, .profile-name, .profile-handle, .verified-badge, .cover-title, .swipe-hint, .follow-pill, .follow-banner)
6. SLIDES INTERNOS: preserve EXATAMENTE a posição e estilo de:
   - .slide-footer / .footer-name-pill / .footer-handle-pill (badges inferiores com nome/handle)
   - .top-header / header com numeração
   - .subtitle-accent / bullets decorativos
   - Qualquer elemento com position:absolute — mantenha top/left/right/bottom idênticos
6. SLIDE CTA (último): preserve toda a estrutura de layout, botões, posicionamento
7. Número de slides: EXATAMENTE igual ao template

━━━ O QUE VOCÊ DEVE SUBSTITUIR ━━━
- Textos de conteúdo: .title, .narrative-text, .content-title, .content-body, .cover-title (trocar pelo novo tema)
- Handle do Instagram → ${handleAt}
- Nome do criador → ${displayName}
- URLs de imagens de fundo (se novas imagens forem fornecidas abaixo)
- Máximo 35 palavras por slide de conteúdo

━━━ REGRAS DE FORMATO ━━━
- Retorne APENAS o HTML completo. Comece com <!DOCTYPE html> e termine com </html>
- NÃO use markdown, code fences ou texto fora do HTML
- NÃO altere font-size, color, ou qualquer propriedade CSS dos elementos
- NÃO mova badges, footers, headers ou elementos de perfil — eles ficam onde estão

${imagesSection}

━━━ TEMPLATE HTML BASE ━━━
${cleanedHtml}`;
}

// ─── Prompt HTML layout "Clean" ───────────────────────────────────────────────

function buildCleanHTMLPrompt({ topic, instructions, niche, primaryColor, fontFamily,
  instagramHandle, creatorName, profilePhotoUrl, numSlides, contentTone, dominantEmotion, unsplashImages, roteiro }) {

  const handle = (instagramHandle || 'seucanal').replace('@', '');
  const handleAt = `@${handle}`;
  const displayName = creatorName
    || handle.replace(/team$/i, '').replace(/[._-]/g, ' ').trim()
         .replace(/\b\w/g, c => c.toUpperCase())
    || handle;
  const totalContent = numSlides - 2;
  const cssTemplate = buildCleanCSSTemplate({ primaryColor, fontFamily });

  const validImages = unsplashImages.filter(img => img.url);
  const imagesSection = validImages.length
    ? `\nImagens — cada uma foi buscada especificamente para aquele slide. Use a URL exata na ordem indicada:\n${unsplashImages.map((img, i) =>
        img.url ? `Slide ${i + 1}: ${img.url}` : `Slide ${i + 1}: (sem imagem — use fundo escuro)`).join('\n')}`
    : '\n(Sem imagens — omita os .photo-card e .top-photo-wrap; use apenas texto nos slides de conteúdo)';

  const roteiroSection = roteiro && roteiro.trim()
    ? `\n━━━ ROTEIRO DO CRIADOR — use este conteúdo, não invente ━━━\n${roteiro.trim()}\n\n- SLIDE 1 (capa): gancho/título do roteiro\n- SLIDES 2 a ${numSlides - 1}: distribua o desenvolvimento ponto a ponto\n- SLIDE ${numSlides} (CTA): CTA do roteiro ou adequado\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    : '';

  const instructionsSection = instructions && instructions.trim()
    ? `\n━━━ DIRETRIZ DE CONTEÚDO — OBRIGATÓRIO SEGUIR EM TODOS OS SLIDES ━━━\n${instructions.trim()}\nEsta diretriz define como o conteúdo deve ser abordado. Aplique em CADA slide sem exceção.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    : '';

  // Avatar: Claude gera apenas as iniciais; a foto é injetada em pós-processamento
  const avatarContent = handle.slice(0, 2).toUpperCase();

  return `Você é um agente especializado em criar carrosseis profissionais para Instagram no estilo limpo/minimalista.

Tema: "${topic}"
Nicho: ${niche}
Tom: ${contentTone}
Emoção dominante: ${dominantEmotion}
Instagram: ${handleAt}
Total de slides: ${numSlides} (1 capa + ${totalContent} conteúdo + 1 CTA final)
${instructionsSection}
${imagesSection}
${roteiroSection}

━━━ REGRAS ABSOLUTAS ━━━
- Retorne APENAS o código HTML completo. Comece com <!DOCTYPE html> e termine com </html>
- NÃO use markdown, code fences, comentários ou qualquer texto fora do HTML
- Use EXATAMENTE as classes CSS do template abaixo
- Máximo 40 palavras por slide de conteúdo

${buildViralStructure({ numSlides, dominantEmotion, handleAt, roteiro })}

━━━ ESTRUTURA HTML OBRIGATÓRIA ━━━

SLIDE 1 — CAPA (.clean-cover):
<div class="clean-cover">
  <div class="bg" style="background-image: url('FOTO_1')"></div>
  <div class="overlay"></div>
  <div class="profile-badge">
    <div class="avatar-ring">
      <div class="avatar-circle">${avatarContent}</div>
    </div>
    <div class="profile-text">
      <div class="profile-name">
        ${displayName}
        <span class="verified-badge"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="12" fill="#0095f6"/><path d="M6.5 12.5l3.5 3.5 7.5-8" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      </div>
      <div class="profile-handle">${handleAt}</div>
    </div>
  </div>
  <div class="cover-title">[título impactante — até 12 palavras — 1-2 palavras em <span class="hl">destaque</span>]</div>
  <div class="swipe-hint">Arrasta para o lado ›</div>
</div>

SLIDE 2 — COM FAIXA "ME SIGA" + FOTO NO TOPO (.clean-content.top-photo):
<div class="clean-content top-photo">
  <div class="follow-banner">
    <svg viewBox="0 0 24 24"><path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
    Me siga para mais conteúdos como esse!
  </div>
  <div class="top-photo-wrap"><img src="FOTO_2" alt="${topic}" /></div>
  <div class="text-section">
    <div class="content-title">[título do 1º ponto]</div>
    <div class="content-body">[texto de apoio]</div>
  </div>
  <div class="slide-footer">
    <span class="footer-name-pill">${displayName}<span class="verified-badge"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="12" fill="#0095f6"/><path d="M6.5 12.5l3.5 3.5 7.5-8" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span></span>
    <span class="footer-handle-pill">${handleAt}</span>
    <span class="footer-swipe">Arrasta para o lado ›</span>
  </div>
</div>

SLIDES 3 a ${numSlides - 1} — CONTEÚDO (.clean-content):
<div class="clean-content">
  <div class="content-title">[título do ponto — até 10 palavras — 1-2 em <span class="hl">destaque</span>]</div>
  <div class="content-body">[texto de apoio — até 30 palavras]</div>
  <div class="photo-card"><img src="FOTO_N" alt="${topic}" /></div>
  <div class="slide-footer">
    <span class="footer-name-pill">${displayName}<span class="verified-badge"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="12" fill="#0095f6"/><path d="M6.5 12.5l3.5 3.5 7.5-8" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span></span>
    <span class="footer-handle-pill">${handleAt}</span>
    <span class="footer-swipe">Arrasta para o lado ›</span>
  </div>
</div>

SLIDE OPCIONAL — ANTES/DEPOIS (.clean-split) — use quando o tema envolver transformação, resultado de aluno, comparação visual:
<div class="clean-split">
  <div class="split-photos">
    <div class="split-panel">
      <img src="FOTO_ANTES" alt="Antes" class="split-img" />
      <div class="split-label">ANTES</div>
    </div>
    <div class="split-panel">
      <img src="FOTO_DEPOIS" alt="Depois" class="split-img" />
      <div class="split-label after">DEPOIS</div>
    </div>
  </div>
  <div class="split-content">
    <div class="split-eyebrow">Resultado real</div>
    <div class="split-title">[conquista em destaque — até 8 palavras — 1-2 em <span class="hl">destaque</span>]</div>
    <div class="split-stats">[dado concreto, ex: -8kg · 12 semanas · 3x/semana]</div>
  </div>
  <div class="split-footer">
    <span class="footer-name-pill">${displayName}<span class="verified-badge"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="12" fill="#0095f6"/><path d="M6.5 12.5l3.5 3.5 7.5-8" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span></span>
    <span class="footer-handle-pill">${handleAt}</span>
    <span class="footer-swipe">Arrasta para o lado ›</span>
  </div>
</div>

SLIDE ${numSlides} — CTA (.clean-cta):
<div class="clean-cta">
  <div class="bg" style="background-image: url('ULTIMA_FOTO')"></div>
  <div class="overlay"></div>
  <div class="cta-inner">
    <div class="cta-title">Salve esse post e <span class="hl">compartilhe</span> com quem precisa</div>
    <div class="follow-pill">Siga ${handleAt}</div>
  </div>
  <div class="cta-footer">${handleAt}</div>
</div>

━━━ CSS TEMPLATE OBRIGATÓRIO ━━━
${cssTemplate}

Gere o HTML completo agora (apenas HTML, nada mais):`;
}

// ─── Passo 4: Legenda via Claude ──────────────────────────────────────────────

function buildLegendaPrompt({ topic, instagramHandle, niche }) {
  const handle = (instagramHandle || 'seucanal').replace('@', '');
  return `Crie uma legenda profissional para um post do Instagram sobre: "${topic}" (nicho: ${niche}).

Retorne EXATAMENTE neste formato, sem explicações:

[LEGENDA]
Texto da legenda aqui — 3 a 5 linhas, tom ${niche === 'Inteligência Artificial' ? 'investigativo/provocativo' : 'direto e impactante'}, sem hashtags.

Siga @${handle} para mais conteúdo sobre ${niche}.

[HASHTAGS]
#ia #inteligenciaartificial #chatgpt #openai #tecnologia #futuro #inovacao #machinelearning #artificialintelligence #conteudodigital`;
}

// ─── Passo 5: Screenshots com Playwright (lógica DPR do gist) ────────────────

// ─── Browser pool: reutiliza instância entre requisições ─────────────────────
let _browserInstance = null;
let _browserLaunchPromise = null;

async function getBrowser() {
  if (_browserInstance) {
    try { await _browserInstance.version(); return _browserInstance; } catch (_) { _browserInstance = null; }
  }
  if (_browserLaunchPromise) return _browserLaunchPromise;
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (_) { return null; }
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
  _browserLaunchPromise = chromium.launch({
    headless: true, executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  }).then(b => { _browserInstance = b; _browserLaunchPromise = null; return b; })
    .catch(e => { _browserLaunchPromise = null; throw e; });
  return _browserLaunchPromise;
}

async function takeScreenshots(htmlFilePath, outputDir, bgColor, primaryColor, folderName) {
  const browser = await getBrowser();
  if (!browser) {
    console.warn('[CarouselService] Playwright não disponível — pulando screenshots');
    return [];
  }

  const context = await browser.newContext({
    viewport: { width: 1080, height: 1350 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  try {
    // Usa HTTP em vez de file:// para que o Chromium carregue imagens externas (Unsplash)
    const port = process.env.PORT || 3001;
    const httpUrl = `http://localhost:${port}/output/${folderName}/carrossel.html`;
    await page.goto(httpUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Aguarda todas as imagens do DOM carregarem antes de capturar
    await page.evaluate(() => Promise.all(
      Array.from(document.images).map(img =>
        img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })
      )
    ));
    await page.waitForTimeout(400);

    // Verificar DPR e viewport CSS real (conforme gist)
    const cssW = await page.evaluate(() => window.innerWidth);
    const cssH = await page.evaluate(() => window.innerHeight);
    const scale = cssW / 1080;

    const slides = await page.locator('body > div').all();
    const total = slides.length;

    // Esconder todos os slides
    for (let i = 0; i < total; i++) {
      await slides[i].evaluate(el => el.style.display = 'none');
    }

    const screenshots = [];

    for (let i = 0; i < total; i++) {
      const num = String(i + 1).padStart(2, '0');
      const filePath = path.join(outputDir, `slide_${num}.png`);

      // Detectar cor de fundo do slide
      const classes = await slides[i].evaluate(el => el.className);
      const isAccentBg = classes.includes('accent-bg');
      const isEditorial = classes.includes('slide-editorial');
      const slideBg = isAccentBg ? primaryColor : isEditorial ? bgColor : '#1a1a1a';

      // Setar background html+body para a cor do slide (conforme gist)
      await page.evaluate(c => {
        document.documentElement.style.background = c;
        document.body.style.background = c;
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        document.body.style.overflow = 'hidden';
      }, slideBg);

      // Posicionar slide fixed + aplicar scale para preencher viewport CSS
      await slides[i].evaluate((el, s) => {
        el.style.display = 'flex';
        el.style.position = 'fixed';
        el.style.top = '0';
        el.style.left = '0';
        el.style.width = '1080px';
        el.style.height = '1350px';
        el.style.zIndex = '9999';
        if (s !== 1) {
          el.style.transform = `scale(${s})`;
          el.style.transformOrigin = 'top left';
        }
      }, scale);

      await page.waitForTimeout(150);

      // Screenshot com clip no tamanho do viewport CSS (conforme gist)
      await page.screenshot({
        path: filePath,
        clip: { x: 0, y: 0, width: cssW, height: cssH },
      });

      screenshots.push(`slide_${num}.png`);

      // Resetar slide
      await slides[i].evaluate(el => {
        el.style.display = 'none';
        el.style.position = '';
        el.style.top = '';
        el.style.left = '';
        el.style.width = '';
        el.style.height = '';
        el.style.zIndex = '';
        el.style.transform = '';
        el.style.transformOrigin = '';
      });
    }

    // Restaurar
    await page.evaluate(() => {
      document.documentElement.style.background = '';
      document.body.style.background = '';
    });
    for (let i = 0; i < total; i++) {
      await slides[i].evaluate(el => el.style.display = '');
    }

    return screenshots;

  } finally {
    await context.close(); // fecha só o contexto, mantém browser vivo para próxima geração
  }
}

// ─── Função principal ─────────────────────────────────────────────────────────

async function generateCarousel(config) {
  const {
    topic,
    instructions = '',             // foco / diretrizes de conteúdo (opcional)
    niche = 'Inteligência Artificial',
    primaryColor = '#B078FF',
    accentColor = '#5197b5',
    bgColor = '#292A25',
    fontFamily = 'Raleway',
    instagramHandle = '',
    creatorName = '',
    profilePhotoUrl = '',
    numSlides = 7,
    contentTone = 'investigativo',
    dominantEmotion = 'medo de perder',
    roteiro = '',
    layoutStyle = 'editorial',
    templateHtml = '',   // HTML de modelo salvo para usar como base de layout
  } = config;

  if (!topic || !topic.trim()) throw new Error('Tema obrigatório');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');

  // Conta slides reais se roteiro tiver marcadores "SLIDE N"
  let slidesCount = Math.min(10, Math.max(5, Number(numSlides)));
  if (roteiro) {
    const count = (roteiro.match(/^SLIDE\s+\d+/gim) || []).length;
    if (count >= 3) slidesCount = Math.min(10, count);
  }

  // Passo 1: Reddit (skip se tiver roteiro) + queries por slide, em paralelo
  const [redditTrends, slideQueries] = await Promise.all([
    roteiro ? Promise.resolve([]) : fetchRedditTrends(topic),
    generateSlideImageQueries(topic, roteiro, slidesCount, niche),
  ]);

  // Passo 2: busca imagem específica para cada slide em paralelo
  let unsplashImages;
  if (slideQueries && slideQueries.length >= slidesCount) {
    const perSlide = await Promise.all(
      slideQueries.map(q => fetchOneImage(q, topic))
    );
    unsplashImages = perSlide.map((img, i) => img || { url: '', query: slideQueries[i] });
    // Filtra slots sem imagem mas mantém a ordem
    console.log(`[CarouselService] Imagens por slide: ${perSlide.filter(Boolean).length}/${slidesCount} encontradas`);
  } else {
    // Fallback: busca genérica pelo tema
    unsplashImages = await fetchImages(topic, slidesCount + 2);
  }

  // Passo 3 + 4: HTML e legenda em paralelo
  let htmlPrompt;
  if (templateHtml && templateHtml.trim()) {
    htmlPrompt = buildTemplateHTMLPrompt({
      templateHtml: templateHtml.trim(),
      topic: topic.trim(), instructions: instructions.trim(), niche, instagramHandle, creatorName,
      contentTone, dominantEmotion, roteiro, unsplashImages, numSlides: slidesCount,
    });
  } else if (layoutStyle === 'clean') {
    htmlPrompt = buildCleanHTMLPrompt({
      topic: topic.trim(), instructions: instructions.trim(), niche, primaryColor, fontFamily,
      instagramHandle, creatorName, profilePhotoUrl, numSlides: slidesCount,
      contentTone, dominantEmotion, roteiro, unsplashImages,
    });
  } else {
    htmlPrompt = buildHTMLPrompt({
      topic: topic.trim(), instructions: instructions.trim(), niche, primaryColor, accentColor, bgColor,
      fontFamily, instagramHandle, creatorName, profilePhotoUrl, numSlides: slidesCount,
      contentTone, dominantEmotion, roteiro, redditTrends, unsplashImages,
    });
  }

  const [htmlRes, legendaRes] = await Promise.all([
    anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      messages: [{ role: 'user', content: htmlPrompt }],
    }),
    anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{ role: 'user', content: buildLegendaPrompt({ topic: topic.trim(), instagramHandle, niche }) }],
    }),
  ]);

  // Limpa possíveis code fences que Claude retorne
  let html = (htmlRes.content[0]?.text || '').trim()
    .replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  // Extrai HTML se Claude adicionou preâmbulo
  if (!/^<!doctype/i.test(html) && !/^<html/i.test(html)) {
    const idx = html.search(/<!doctype\s+html|<html[\s>]/i);
    if (idx > 0) {
      html = html.substring(idx);
    } else {
      throw new Error('Claude não retornou HTML válido. Tente novamente.');
    }
  }

  const legenda = (legendaRes.content[0]?.text || '').trim();

  // Pós-processamento: injeta foto de perfil no avatar-circle (evita passar base64 enorme pro Claude)
  if (profilePhotoUrl && profilePhotoUrl.trim()) {
    const imgTag = `<img src="${profilePhotoUrl}" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
    html = html.replace(
      /(<div[^>]*class="avatar-circle"[^>]*>)([\s\S]*?)(<\/div>)/,
      `$1${imgTag}$3`
    );
  }

  // Pós-processamento: garante que o selo verificado aparece no .profile-name
  // (Claude às vezes omite ou corrompe o SVG inline)
  const VERIFIED_SVG = `<span class="verified-badge"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="12" fill="#0095f6"/><path d="M6.5 12.5l3.5 3.5 7.5-8" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
  // Se já tem o badge, não faz nada; caso contrário injeta antes do </div> do profile-name
  if (!html.includes('verified-badge')) {
    html = html.replace(
      /(<div[^>]*class="profile-name"[^>]*>)([\s\S]*?)(<\/div>)/,
      (_, open, inner, close) => {
        // Remove qualquer ✓ ou ✔ textual que Claude possa ter colocado
        const cleaned = inner.replace(/[✓✔☑✅]/g, '').trimEnd();
        return `${open}${cleaned}${VERIFIED_SVG}${close}`;
      }
    );
  }

  // Passo 6: Salvar arquivos (output/<slug>-<ts>/)
  const slug = topic.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').substring(0, 40).replace(/-$/, '');
  const folderName = `${slug}-${Date.now()}`;
  const outputDir = path.join(OUTPUT_DIR, folderName);
  fs.mkdirSync(outputDir, { recursive: true });

  const htmlFilePath = path.join(outputDir, 'carrossel.html');
  fs.writeFileSync(htmlFilePath, html, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'legenda.txt'), legenda, 'utf8');

  // Screenshots gerados no cliente (browser) via html-to-image — sem Playwright no servidor
  const screenshots = [];

  return {
    html,
    legenda,
    topic: topic.trim(),
    folderName,
    numSlides: slidesCount,
    screenshots,
    redditTrendsUsed: redditTrends.length,
    unsplashImagesUsed: unsplashImages.length,
  };
}

// ─── Regenerar slide individual ───────────────────────────────────────────────

async function regenerateSlide({ slideIndex, numSlides, slideHtml, topic, instructions, niche,
  contentTone, dominantEmotion, instagramHandle, userHint }) {

  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');

  const handle = (instagramHandle || 'seucanal').replace('@', '');
  const handleAt = `@${handle}`;
  const slideNum = (slideIndex ?? 0) + 1;
  const n = numSlides || 7;

  // Extrai descrição da função deste slide a partir da estrutura viral
  const fullStructure = buildViralStructure({ numSlides: n, dominantEmotion: dominantEmotion || 'medo de perder', handleAt, roteiro: '' });
  const typeDesc = fullStructure.split('\n\n').find(s => s.trimStart().startsWith(`SLIDE ${slideNum} —`)) || `SLIDE ${slideNum}`;

  const instructionsLine = instructions && instructions.trim() ? `\nDiretriz de conteúdo: ${instructions.trim()}` : '';
  const hintLine = userHint && userHint.trim() ? `\nPedido do criador: "${userHint.trim()}"` : '';

  const prompt = `Você é especialista em carrosseis virais para Instagram.

Regenere APENAS o conteúdo de texto do SLIDE ${slideNum} de ${n}, mantendo EXATAMENTE a estrutura HTML.

Tema: "${topic}"
Nicho: ${niche || 'Geral'}
Tom: ${contentTone || 'investigativo'}
Emoção dominante: ${dominantEmotion || 'medo de perder'}${instructionsLine}${hintLine}

Função deste slide:
${typeDesc}

REGRAS OBRIGATÓRIAS:
- Retorne SOMENTE o elemento <div> externo do slide, nada mais
- NÃO altere classes CSS, styles inline, estrutura de divs ou src de imagens
- Substitua APENAS os textos em: .title, .subtitle, .narrative-text, .content-title, .content-body, .cover-title, .cta-title
- Máximo 40 palavras por slide
- Sem travessão (—) no meio de frases
- Sem clichês ou frases genéricas

HTML atual:
${slideHtml}

Retorne apenas o <div> externo com novo conteúdo:`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  });

  let result = (response.content[0]?.text || '').trim()
    .replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

  // Garante que retornou um <div> (não HTML completo)
  if (!result.startsWith('<div') && !result.startsWith('<section')) {
    const match = result.match(/<div[\s\S]*<\/div>/);
    if (match) result = match[0];
    else throw new Error('Resposta inválida: Claude não retornou um elemento de slide');
  }

  return result;
}

module.exports = { generateCarousel, takeScreenshots, OUTPUT_DIR, regenerateSlide };
