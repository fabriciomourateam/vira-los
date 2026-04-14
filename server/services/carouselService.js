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

// Cascata: tenta Unsplash → Pexels
async function fetchImages(query, count = 12) {
  const images = await fetchUnsplashImages(query, count);
  if (images.length) return images;
  console.log('[CarouselService] Unsplash vazio, tentando Pexels...');
  return fetchPexelsImages(query, count);
}

// ─── Passo 3: CSS template completo (baseado no gist) ────────────────────────

function buildCSSTemplate({ primaryColor, accentColor, bgColor, fontFamily }) {
  const font = fontFamily.replace(/ /g, '+');
  return `
  <link href="https://fonts.googleapis.com/css2?family=${font}:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,500;1,600;1,700&family=Space+Grotesk:wght@300;400;500;600;700&display=swap" rel="stylesheet">
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
      filter: brightness(0.5); z-index: 0;
    }
    .slide-overlay {
      position: absolute; top: 0; left: 0;
      width: 100%; height: 100%;
      background: linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.7) 100%);
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

function buildHTMLPrompt({ topic, niche, primaryColor, accentColor, bgColor, fontFamily,
  instagramHandle, profilePhotoUrl, numSlides, contentTone, redditTrends, unsplashImages, roteiro }) {

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
    ? `\nImagens disponíveis — use estas URLs exatas no HTML (uma por slide):\n${unsplashImages.map((img, i) =>
        `${i + 1}. ${img.url}`).join('\n')}`
    : '\n(Sem imagens — use gradientes CSS criativos no fundo dos slides de foto)';

  const roteiroSection = roteiro && roteiro.trim()
    ? `\n━━━ ROTEIRO DO CRIADOR — siga este conteúdo, não invente ━━━\n${roteiro.trim()}\n\nDistribua este roteiro pelos ${numSlides} slides:\n- SLIDE 1 (capa): gancho principal / título do roteiro\n- SLIDES 2 a ${numSlides - 1}: divida o desenvolvimento ponto a ponto\n- SLIDE ${numSlides} (CTA): use o CTA do roteiro ou crie um adequado\nUse APENAS o conteúdo acima — não adicione informações externas.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    : '';

  return `Você é um agente especializado em criar carrosseis profissionais para Instagram no estilo editorial/investigativo.

Tema: "${topic}"
Nicho: ${niche}
Tom: ${contentTone}
Instagram: ${handleAt}
Total de slides: ${numSlides} (1 capa + ${totalContent} conteúdo + 1 CTA final)
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

━━━ ESTRUTURA DOS SLIDES ━━━

SLIDE 1 — CAPA (.slide):
- <div class="slide-bg"> com foto Unsplash ou gradiente como fundo
- <div class="slide-overlay">
- .top-header com os 3 elementos acima
- .cover-branding: SVG IG + "${handleAt}" centralizados
- .slide-content com .title (CAIXA ALTA, 1-2 palavras em <span class="highlight">)
- .subtitle explicando o tema
- .footer SEM número de página

SLIDES 2 a ${numSlides - 1} — CONTEÚDO (.slide-editorial):
- Use as 4 variantes distribuídas (NÃO coloque todas as fotos na mesma posição):
  • Variante A (foto no meio): texto grande → foto → texto menor
  • Variante B (foto na base): texto grande → texto médio → foto
  • Variante C (foto no topo): foto → texto grande → texto menor
  • Variante D (sem foto, .slide-editorial.accent-bg): use em 1-2 slides para impacto máximo
- .top-header em todos
- .editorial-content com .narrative-text (principal 38px) e .narrative-text.secondary (28px)
- Palavras-chave: <span class="highlight"> (${primaryColor}) ou <span class="highlight-green"> (verde)
- Frases importantes: <strong>
- Preencher TODO o espaço — sem áreas vazias grandes
${customScript
  ? '- Use o texto EXATO do SCRIPT OBRIGATÓRIO acima — cada "SLIDE N" do script vira um slide de conteúdo. Não invente nem altere o texto.'
  : '- Máximo 30 palavras por slide. Capitalize natural, SEM CAIXA ALTA nos internos'}
- .footer com número de página N/${totalContent} (começando em 1/${totalContent} no slide 2)

SLIDE ${numSlides} — CTA (.slide):
- Foto de fundo + overlay
- .top-header
- .title com "SALVE ESTE POST", "COMPARTILHE" etc., palavras em .highlight
- Ícones SVG inline de salvar (bookmark), enviar (paper plane) e curtir (heart)
- Box destacado com "SIGA ${handleAt}" em #D9D353
- .footer com número ${numSlides - 1}/${totalContent}

━━━ CSS TEMPLATE OBRIGATÓRIO ━━━
${cssTemplate}

━━━ SVG DO INSTAGRAM (copie exatamente em todos os footer-left e cover-branding) ━━━
${IG_SVG}

Gere o HTML completo agora (apenas HTML, nada mais):`;
}

// ─── CSS template layout "Clean" (estilo Fabricio Moura) ─────────────────────

function buildCleanCSSTemplate({ primaryColor, fontFamily }) {
  const font = fontFamily.replace(/ /g, '+');
  return `
  <link href="https://fonts.googleapis.com/css2?family=${font}:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
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
      filter: brightness(0.45); z-index: 0;
    }
    .clean-cover .overlay {
      position: absolute; inset: 0;
      background: linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.72) 55%, rgba(0,0,0,0.85) 100%);
      z-index: 1;
    }
    .clean-cover .profile-badge {
      position: absolute;
      top: 44%; left: 50%; transform: translate(-50%, -50%);
      z-index: 2;
      display: flex; flex-direction: column; align-items: center; gap: 20px;
    }
    /* Anel degradê estilo Instagram Stories */
    .clean-cover .avatar-ring {
      width: 120px; height: 120px; border-radius: 50%;
      background: linear-gradient(135deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%);
      padding: 4px;
      display: flex; align-items: center; justify-content: center;
    }
    .clean-cover .avatar-circle {
      width: 100%; height: 100%; border-radius: 50%;
      background: #111;
      overflow: hidden;
      display: flex; align-items: center; justify-content: center;
      font-size: 34px; font-weight: 800; color: white;
    }
    .clean-cover .avatar-circle img { width: 100%; height: 100%; object-fit: cover; }
    .clean-cover .profile-name {
      font-size: 36px; font-weight: 700; color: white; text-align: center;
      display: flex; align-items: center; gap: 10px;
    }
    /* Badge verificado azul (estilo Instagram) */
    .clean-cover .verified-badge svg { width: 32px; height: 32px; display: block; }
    .clean-cover .profile-handle {
      font-size: 24px; font-weight: 400; color: rgba(255,255,255,0.65); text-align: center;
      margin-top: -10px;
    }
    .clean-cover .cover-title {
      position: absolute; bottom: 148px; left: 64px; right: 64px; z-index: 2;
      font-size: 70px; font-weight: 900; line-height: 1.08; color: white;
    }
    .clean-cover .cover-title .hl { color: ${primaryColor}; }
    .clean-cover .swipe-hint {
      position: absolute; bottom: 76px; left: 0; right: 0;
      text-align: center; z-index: 2;
      font-size: 22px; color: rgba(255,255,255,0.55);
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
      background: ${primaryColor};
      border-radius: 60px;
      padding: 16px 40px;
      font-size: 26px; font-weight: 700; color: white;
      white-space: nowrap;
    }
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
    }
    .clean-cta .cta-footer {
      position: absolute; bottom: 60px; left: 0; right: 0;
      text-align: center; z-index: 2;
      font-size: 22px; color: rgba(255,255,255,0.5);
    }
  </style>`;
}

// ─── Prompt HTML layout "Clean" ───────────────────────────────────────────────

function buildCleanHTMLPrompt({ topic, niche, primaryColor, fontFamily,
  instagramHandle, creatorName, profilePhotoUrl, numSlides, contentTone, unsplashImages, roteiro }) {

  const handle = (instagramHandle || 'seucanal').replace('@', '');
  const handleAt = `@${handle}`;
  const displayName = creatorName || handle.replace(/team$/, '').replace(/[._-]/g, ' ').trim() || handle;
  const totalContent = numSlides - 2;
  const cssTemplate = buildCleanCSSTemplate({ primaryColor, fontFamily });

  const imagesSection = unsplashImages.length
    ? `\nImagens disponíveis — use estas URLs exatas (uma por slide de conteúdo):\n${unsplashImages.map((img, i) =>
        `${i + 1}. ${img.url}`).join('\n')}`
    : '\n(Sem imagens — omita os .photo-card e .top-photo-wrap; use apenas texto nos slides de conteúdo)';

  const roteiroSection = roteiro && roteiro.trim()
    ? `\n━━━ ROTEIRO DO CRIADOR — use este conteúdo, não invente ━━━\n${roteiro.trim()}\n\n- SLIDE 1 (capa): gancho/título do roteiro\n- SLIDES 2 a ${numSlides - 1}: distribua o desenvolvimento ponto a ponto\n- SLIDE ${numSlides} (CTA): CTA do roteiro ou adequado\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    : '';

  // Avatar: foto de perfil ou iniciais
  const avatarContent = profilePhotoUrl
    ? `<img src="${profilePhotoUrl}" alt="${handle}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`
    : handle.slice(0, 2).toUpperCase();

  return `Você é um agente especializado em criar carrosseis profissionais para Instagram no estilo limpo/minimalista.

Tema: "${topic}"
Nicho: ${niche}
Tom: ${contentTone}
Instagram: ${handleAt}
Total de slides: ${numSlides} (1 capa + ${totalContent} conteúdo + 1 CTA final)
${imagesSection}
${roteiroSection}

━━━ REGRAS ABSOLUTAS ━━━
- Retorne APENAS o código HTML completo. Comece com <!DOCTYPE html> e termine com </html>
- NÃO use markdown, code fences, comentários ou qualquer texto fora do HTML
- Use EXATAMENTE as classes CSS do template abaixo
- Máximo 35 palavras por slide de conteúdo — menos é mais

━━━ ESTRUTURA OBRIGATÓRIA ━━━

SLIDE 1 — CAPA (.clean-cover):
<div class="clean-cover">
  <div class="bg" style="background-image: url('FOTO_1')"></div>
  <div class="overlay"></div>
  <div class="profile-badge">
    <div class="avatar-ring">
      <div class="avatar-circle">${avatarContent}</div>
    </div>
    <div class="profile-name">
      ${displayName}
      <span class="verified-badge"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="12" fill="#0095f6"/><path d="M6.5 12.5l3.5 3.5 7.5-8" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
    </div>
    <div class="profile-handle">${handleAt}</div>
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
    <span class="footer-name-pill">${displayName}</span>
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
    <span class="footer-name-pill">${displayName}</span>
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

async function takeScreenshots(htmlFilePath, outputDir, bgColor, primaryColor, folderName) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (_) {
    console.warn('[CarouselService] Playwright não disponível — pulando screenshots');
    return [];
  }

  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

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
    await page.waitForTimeout(1000);

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

      await page.waitForTimeout(350);

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
    await browser.close();
  }
}

// ─── Função principal ─────────────────────────────────────────────────────────

async function generateCarousel(config) {
  const {
    topic,
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
    roteiro = '',
    layoutStyle = 'editorial',
  } = config;

  if (!topic || !topic.trim()) throw new Error('Tema obrigatório');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');

  // Conta slides reais se roteiro tiver marcadores "SLIDE N"
  let slidesCount = Math.min(10, Math.max(5, Number(numSlides)));
  if (roteiro) {
    const count = (roteiro.match(/^SLIDE\s+\d+/gim) || []).length;
    if (count >= 3) slidesCount = Math.min(10, count);
  }

  // Passo 1 + 2: Reddit (skip se tiver roteiro) e imagens (Unsplash → Pexels) em paralelo
  const [redditTrends, unsplashImages] = await Promise.all([
    roteiro ? Promise.resolve([]) : fetchRedditTrends(topic),
    fetchImages(topic, slidesCount + 2),
  ]);

  // Passo 3 + 4: HTML e legenda em paralelo
  const htmlPrompt = layoutStyle === 'clean'
    ? buildCleanHTMLPrompt({
        topic: topic.trim(), niche, primaryColor, fontFamily,
        instagramHandle, creatorName, profilePhotoUrl, numSlides: slidesCount, contentTone, roteiro,
        unsplashImages,
      })
    : buildHTMLPrompt({
        topic: topic.trim(), niche, primaryColor, accentColor, bgColor,
        fontFamily, instagramHandle, creatorName, profilePhotoUrl, numSlides: slidesCount, contentTone, roteiro,
        redditTrends, unsplashImages,
      });

  const [htmlRes, legendaRes] = await Promise.all([
    anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
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

  // Passo 5: Screenshots com Playwright (graceful fallback se não disponível)
  let screenshots = [];
  try {
    screenshots = await takeScreenshots(htmlFilePath, outputDir, bgColor, primaryColor, folderName);
  } catch (err) {
    console.warn('[CarouselService] Screenshots falhou:', err.message);
  }

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

module.exports = { generateCarousel, takeScreenshots, OUTPUT_DIR };
