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

// ─── Passo 3: CSS template — design dark editorial ───────────────────────────

function buildCSSTemplate({ primaryColor, bgColor, fontFamily }) {
  const font = fontFamily.replace(/ /g, '+');
  return `
  <link href="https://fonts.googleapis.com/css2?family=${font}:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: ${bgColor}; }

    /* ══ CAPA (.slide-cover) ══════════════════════════════════════════════════ */
    .slide-cover {
      width: 1080px; height: 1350px;
      position: relative; overflow: hidden;
      font-family: '${fontFamily}', sans-serif;
      display: flex; flex-direction: column;
      page-break-after: always;
    }
    .cv-bg {
      position: absolute; inset: 0; z-index: 0;
      background-size: cover; background-position: center;
      filter: brightness(0.42);
    }
    .cv-overlay {
      position: absolute; inset: 0; z-index: 1;
      background: linear-gradient(to bottom,
        rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.25) 45%, rgba(0,0,0,0.92) 100%);
    }
    .cv-top {
      position: relative; z-index: 2;
      display: flex; justify-content: space-between; align-items: flex-start;
      padding: 36px 44px 0;
    }
    .cv-top span {
      font-size: 13px; line-height: 1.55; color: rgba(255,255,255,0.6); font-weight: 400;
    }
    .cv-author {
      position: relative; z-index: 2;
      flex: 1; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 8px; padding: 0 48px;
    }
    .cv-avatar {
      width: 80px; height: 80px; border-radius: 50%;
      border: 3px solid rgba(255,255,255,0.9); object-fit: cover;
      display: block; margin-bottom: 6px;
    }
    .cv-avatar-initials {
      width: 80px; height: 80px; border-radius: 50%;
      background: linear-gradient(135deg, #f97316, ${primaryColor});
      border: 3px solid rgba(255,255,255,0.9);
      display: flex; align-items: center; justify-content: center;
      font-size: 26px; font-weight: 800; color: white; margin-bottom: 6px;
    }
    .cv-name {
      font-size: 22px; font-weight: 700; color: white;
      display: flex; align-items: center; gap: 7px;
    }
    .cv-badge {
      width: 21px; height: 21px; border-radius: 50%; background: #1d9bf0;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 11px; color: white; font-weight: 900; flex-shrink: 0;
    }
    .cv-handle { font-size: 15px; color: rgba(255,255,255,0.7); }
    .cv-body {
      position: relative; z-index: 2; padding: 0 52px 60px;
    }
    .cv-title {
      font-size: 58px; font-weight: 900; line-height: 1.09;
      letter-spacing: -1.5px; color: white; margin-bottom: 20px;
    }
    .cv-arrow { font-size: 17px; color: rgba(255,255,255,0.55); font-weight: 400; }

    /* ══ SLIDES DE CONTEÚDO (.slide-content) ══════════════════════════════════ */
    .slide-content {
      width: 1080px; height: 1350px;
      background: ${bgColor};
      font-family: '${fontFamily}', sans-serif;
      color: white; position: relative; overflow: hidden;
      display: flex; flex-direction: column;
      padding: 72px 56px 0;
      page-break-after: always;
    }
    .ct-title {
      font-size: 58px; font-weight: 800; line-height: 1.1;
      letter-spacing: -1.5px; color: #ffffff;
      margin-bottom: 24px; flex-shrink: 0;
    }
    .ct-body {
      font-size: 22px; font-weight: 400; line-height: 1.65;
      color: rgba(255,255,255,0.80);
      margin-bottom: 28px; flex-shrink: 0;
    }
    .ct-photo {
      flex: 1; min-height: 0; border-radius: 20px; overflow: hidden;
    }
    .ct-photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
    /* Espaçador para não sobrepor o rodapé */
    .ct-spacer { height: 104px; flex-shrink: 0; }

    /* ══ RODAPÉ UNIVERSAL (.slide-footer) ════════════════════════════════════ */
    .slide-footer {
      position: absolute; bottom: 0; left: 0; right: 0;
      display: flex; align-items: center; justify-content: space-between;
      padding: 20px 52px 26px; background: ${bgColor}; z-index: 10;
    }
    .fp-name {
      background: linear-gradient(135deg, #f97316, ${primaryColor});
      border-radius: 100px; padding: 11px 26px;
      font-size: 19px; font-weight: 700; color: white; white-space: nowrap;
    }
    .fp-handle {
      border: 1.5px solid rgba(255,255,255,0.3); border-radius: 100px;
      padding: 11px 26px; font-size: 17px; color: rgba(255,255,255,0.85);
      white-space: nowrap;
    }
    .fp-arrow { font-size: 14px; color: rgba(255,255,255,0.45); white-space: nowrap; }
  </style>`;
}

// ─── Passo 3: Prompt Claude para gerar o HTML ─────────────────────────────────

function buildHTMLPrompt({ topic, niche, primaryColor, bgColor, fontFamily,
  instagramHandle, brandName, brandAvatarUrl, numSlides, contentTone,
  redditTrends, unsplashImages, customScript }) {

  const handle    = (instagramHandle || 'seucanal').replace('@', '');
  const handleAt  = `@${handle}`;
  const name      = (brandName || handle).trim();
  const year      = new Date().getFullYear();
  const cssTemplate = buildCSSTemplate({ primaryColor, bgColor, fontFamily });

  // Initials for avatar placeholder (max 2 chars)
  const initials = name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  const avatarHtml = brandAvatarUrl
    ? `<img src="${brandAvatarUrl}" class="cv-avatar" alt="${name}" />`
    : `<div class="cv-avatar-initials">${initials}</div>`;

  // Images: number each one so Claude can reference them
  const imagesSection = unsplashImages.length
    ? `Imagens Unsplash disponíveis (atribua uma diferente a cada slide com foto, em ordem):\n${unsplashImages.map((img, i) => `IMG${i + 1}: ${img.url}`).join('\n')}`
    : '(Sem imagens — omita o .ct-photo nos slides de conteúdo)';

  const contentSection = customScript
    ? `━━ SCRIPT FORNECIDO — use este conteúdo exato ━━\n${customScript}`
    : `Tema: "${topic}"\nNicho: ${niche}\nTom: ${contentTone}\nTotal de slides: ${numSlides} (1 capa + ${numSlides - 2} conteúdo + 1 último)`;

  const trendsNote = (!customScript && redditTrends.length)
    ? `\nReferência de tendências (use para enriquecer o conteúdo):\n${redditTrends.map((t, i) => `${i + 1}. ${t.title}`).join('\n')}`
    : '';

  return `Você é um gerador de HTML de carrosseis para Instagram. Retorne APENAS o HTML completo — sem markdown, sem explicações, sem code fences.

${contentSection}${trendsNote}

${imagesSection}

━━ CSS TEMPLATE (inclua no <head> sem modificações) ━━
${cssTemplate}

━━ ESTRUTURA OBRIGATÓRIA DOS SLIDES ━━

SLIDE 1 — CAPA (.slide-cover) — use IMG1 no cv-bg:
<div class="slide-cover">
  <div class="cv-bg" style="background-image:url('IMG1_URL_AQUI')"></div>
  <div class="cv-overlay"></div>
  <div class="cv-top">
    <span>Powered by<br>ViralOS</span>
    <span>Copyright ©<br>${year}</span>
  </div>
  <div class="cv-author">
    ${avatarHtml}
    <div class="cv-name">${name} <span class="cv-badge">✓</span></div>
    <div class="cv-handle">${handleAt}</div>
  </div>
  <div class="cv-body">
    <div class="cv-title">[TÍTULO IMPACTANTE — 2 a 3 linhas, NÃO em caixa alta]</div>
    <div class="cv-arrow">Arrasta para o lado &gt;</div>
  </div>
</div>

SLIDES 2 a ${numSlides - 1} — CONTEÚDO (.slide-content) — use IMG2, IMG3... em ordem:
<div class="slide-content">
  <div class="ct-title">[Título direto do slide — 1 a 2 linhas]</div>
  <div class="ct-body">[Texto explicativo — 2 a 4 linhas, ~40-70 palavras]</div>
  <div class="ct-photo"><img src="IMGN_URL_AQUI" alt="foto" /></div>
  <div class="ct-spacer"></div>
  <div class="slide-footer">
    <div class="fp-name">${name}</div>
    <div class="fp-handle">${handleAt}</div>
    <div class="fp-arrow">Arrasta para o lado &gt;</div>
  </div>
</div>

SLIDE ${numSlides} — ÚLTIMO (.slide-content) — mesma estrutura, mas fp-arrow diz "Salva este post ★":
<div class="slide-content">
  <div class="ct-title">[Título conclusivo ou CTA]</div>
  <div class="ct-body">[Mensagem final — incentiva salvar, comentar ou seguir]</div>
  <div class="ct-photo"><img src="IMGN_URL_AQUI" alt="foto" /></div>
  <div class="ct-spacer"></div>
  <div class="slide-footer">
    <div class="fp-name">${name}</div>
    <div class="fp-handle">${handleAt}</div>
    <div class="fp-arrow">Salva este post ★</div>
  </div>
</div>

━━ REGRAS ━━
1. Retorne SOMENTE <!DOCTYPE html>...</html> — nada antes, nada depois
2. Use as classes CSS EXATAMENTE como definidas acima — não invente novas
3. Preencha [TÍTULO...] e [Texto...] com conteúdo real sobre o tema
4. Use as URLs Unsplash exatamente como fornecidas — não troque nem modifique
5. Cada slide de conteúdo usa uma imagem diferente (IMG2, IMG3, IMG4...)
${customScript ? '6. Use o texto EXATO do script fornecido — cada "SLIDE N" vira um .slide-content' : ''}

Gere o HTML completo agora:`;
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

      // Detectar cor de fundo do slide (suporta classes antigas e novas)
      const classes = await slides[i].evaluate(el => el.className);
      const isContent  = classes.includes('slide-content') || classes.includes('slide-editorial');
      const isAccentBg = classes.includes('accent-bg');
      const slideBg    = isAccentBg ? primaryColor : isContent ? bgColor : '#0c0c0c';

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
    niche          = 'Inteligência Artificial',
    primaryColor   = '#B078FF',
    bgColor        = '#111111',
    fontFamily     = 'Inter',
    instagramHandle = '',
    brandName      = '',
    brandAvatarUrl = '',
    numSlides      = 7,
    contentTone    = 'investigativo',
    customScript   = null,
  } = config;

  if (!topic || !topic.trim()) throw new Error('Tema obrigatório');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');

  // Conta slides reais do script se fornecido
  let slidesCount = Math.min(10, Math.max(5, Number(numSlides)));
  if (customScript) {
    const count = (customScript.match(/^SLIDE\s+\d+/gim) || []).length;
    if (count >= 3) slidesCount = Math.min(10, count);
  }

  // Passo 1 + 2: Reddit e Unsplash em paralelo
  // Busca slidesCount + 2 imagens para ter variedade suficiente (1 por slide)
  const [redditTrends, unsplashImages] = await Promise.all([
    customScript ? Promise.resolve([]) : fetchRedditTrends(topic),
    fetchUnsplashImages(topic, slidesCount + 3),
  ]);

  // Passo 3 + 4: HTML e legenda em paralelo
  const htmlPrompt = buildHTMLPrompt({
    topic: topic.trim(), niche, primaryColor, bgColor,
    fontFamily, instagramHandle, brandName, brandAvatarUrl,
    numSlides: slidesCount, contentTone,
    redditTrends, unsplashImages, customScript,
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
  const htmlLower = html.toLowerCase();
  if (!htmlLower.startsWith('<!doctype') && !htmlLower.startsWith('<html')) {
    const idx = html.search(/<!doctype\s+html|<html[\s>]/i);
    if (idx > 0) html = html.substring(idx);
    else throw new Error('Claude não retornou HTML válido. Tente novamente.');
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
