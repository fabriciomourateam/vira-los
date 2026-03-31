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
  if (!key) return [];

  try {
    const r = await axios.get('https://api.unsplash.com/search/photos', {
      params: { query, per_page: count, orientation: 'portrait' },
      headers: { Authorization: `Client-ID ${key}` },
      timeout: 10000,
    });
    return (r.data?.results || []).map(img => ({
      url: img.urls?.regular || '',
      alt: img.alt_description || query,
    }));
  } catch (err) {
    console.error('[CarouselService/Unsplash]', err.message);
    return [];
  }
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
  instagramHandle, numSlides, contentTone, redditTrends, unsplashImages }) {

  const handle = (instagramHandle || 'seucanal').replace('@', '');
  const handleAt = `@${handle}`;
  const monthYear = currentMonthYear();
  const totalContent = numSlides - 2;
  const cssTemplate = buildCSSTemplate({ primaryColor, accentColor, bgColor, fontFamily });

  const trendsSection = redditTrends.length
    ? `\nTendências do Reddit sobre "${niche}" esta semana:\n${redditTrends.map((t, i) =>
        `${i + 1}. [r/${t.subreddit}] ${t.title} (${t.score} upvotes)`).join('\n')}`
    : '';

  const imagesSection = unsplashImages.length
    ? `\nImagens Unsplash disponíveis — use estas URLs exatas no HTML (uma por slide):\n${unsplashImages.map((img, i) =>
        `${i + 1}. ${img.url}`).join('\n')}`
    : '\n(Sem imagens Unsplash — use gradientes CSS criativos no fundo dos slides de foto)';

  return `Você é um agente especializado em criar carrosseis profissionais para Instagram no estilo editorial/investigativo.

Tema: "${topic}"
Nicho: ${niche}
Tom: ${contentTone}
Instagram: ${handleAt}
Total de slides: ${numSlides} (1 capa + ${totalContent} conteúdo + 1 CTA final)
${trendsSection}
${imagesSection}

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
- Máximo 30 palavras por slide. Capitalize natural, SEM CAIXA ALTA nos internos
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

async function takeScreenshots(htmlFilePath, outputDir, bgColor, primaryColor) {
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
    await page.goto(`file://${htmlFilePath}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

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
    numSlides = 7,
    contentTone = 'investigativo',
  } = config;

  if (!topic || !topic.trim()) throw new Error('Tema obrigatório');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');

  const slidesCount = Math.min(10, Math.max(5, Number(numSlides)));

  // Passo 1 + 2: Reddit e Unsplash em paralelo
  const [redditTrends, unsplashImages] = await Promise.all([
    fetchRedditTrends(topic),
    fetchUnsplashImages(topic, slidesCount + 2),
  ]);

  // Passo 3 + 4: HTML e legenda em paralelo
  const htmlPrompt = buildHTMLPrompt({
    topic: topic.trim(), niche, primaryColor, accentColor, bgColor,
    fontFamily, instagramHandle, numSlides: slidesCount, contentTone,
    redditTrends, unsplashImages,
  });

  const [htmlRes, legendaRes] = await Promise.all([
    anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 10000,
      messages: [{ role: 'user', content: htmlPrompt }],
    }),
    anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 500,
      messages: [{ role: 'user', content: buildLegendaPrompt({ topic: topic.trim(), instagramHandle, niche }) }],
    }),
  ]);

  // Limpa possíveis code fences que Claude retorne
  let html = (htmlRes.content[0]?.text || '').trim()
    .replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  if (!html.startsWith('<!DOCTYPE') && !html.startsWith('<html')) {
    throw new Error('Claude não retornou HTML válido');
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
    screenshots = await takeScreenshots(htmlFilePath, outputDir, bgColor, primaryColor);
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

module.exports = { generateCarousel };
