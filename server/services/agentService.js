/**
 * agentService.js
 * Agente autônomo que segue o Passo 1 do roteiro Vira-Los:
 * abre um navegador real, pesquisa no TikTok / Instagram / YouTube Shorts,
 * coleta os vídeos mais virais e gera análise com Claude.
 */

const { chromium } = require('playwright');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');

// Caminhos possíveis do Chromium (container Docker → cache local → auto-detect)
const CHROMIUM_PATHS = [
  '/root/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',  // imagem playwright:jammy
  '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',  // versão anterior
  '/ms-playwright/chromium-1161/chrome-linux/chrome',              // path alternativo do container
  path.join(process.env.HOME || '/root', '.cache/ms-playwright/chromium-1161/chrome-linux/chrome'),
  path.join(process.env.HOME || '/root', '.cache/ms-playwright/chromium-1194/chrome-linux/chrome'),
];
const CHROMIUM_PATH = CHROMIUM_PATHS.find(p => fs.existsSync(p)) || null;

const CREDENTIALS_FILE = path.join(__dirname, '../db/agent-credentials.json');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Estado global do agente ────────────────────────────────────────────────

let agentState = {
  running: false,
  steps: [],       // { id, label, status: 'pending'|'running'|'done'|'error', detail }
  results: null,   // dados coletados + análise Claude
  startedAt: null,
  finishedAt: null,
  error: null,
};

// Listeners SSE registrados pelo route
const sseClients = new Set();

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch (_) { sseClients.delete(res); }
  }
}

function stepUpdate(id, status, detail = '') {
  const step = agentState.steps.find(s => s.id === id);
  if (step) {
    step.status = status;
    if (detail) step.detail = detail;
  }
  broadcast({ type: 'step', step: agentState.steps.find(s => s.id === id) });
}

function initSteps(platforms) {
  const steps = [
    { id: 'init',     label: 'Inicializando navegador',         status: 'pending', detail: '' },
    { id: 'login_tt', label: 'Acessando TikTok',                status: 'pending', detail: '' },
  ];

  if (platforms.includes('tiktok')) {
    steps.push(
      { id: 'tt_search',  label: 'Buscando palavra-chave no TikTok',     status: 'pending', detail: '' },
      { id: 'tt_filter',  label: 'Aplicando filtros (esse mês + curtidas)', status: 'pending', detail: '' },
      { id: 'tt_collect', label: 'Coletando top 10 vídeos do TikTok',    status: 'pending', detail: '' },
    );
  }
  if (platforms.includes('instagram')) {
    steps.push(
      { id: 'ig_search',  label: 'Buscando Reels no Instagram',          status: 'pending', detail: '' },
      { id: 'ig_collect', label: 'Coletando top 10 Reels do Instagram',  status: 'pending', detail: '' },
    );
  }
  if (platforms.includes('youtube')) {
    steps.push(
      { id: 'yt_search',  label: 'Buscando Shorts no YouTube',           status: 'pending', detail: '' },
      { id: 'yt_collect', label: 'Coletando top 10 Shorts do YouTube',   status: 'pending', detail: '' },
    );
  }

  steps.push(
    { id: 'analyze',  label: 'Analisando com Claude (IA)',               status: 'pending', detail: '' },
    { id: 'report',   label: 'Gerando relatório final',                  status: 'pending', detail: '' },
  );

  agentState.steps = steps;
  broadcast({ type: 'init', steps: agentState.steps });
}

// ─── Helpers de navegação ────────────────────────────────────────────────────

async function humanDelay(min = 800, max = 2200) {
  const ms = Math.floor(Math.random() * (max - min) + min);
  await new Promise(r => setTimeout(r, ms));
}

async function typeSlowly(page, selector, text) {
  await page.click(selector);
  for (const char of text) {
    await page.keyboard.type(char);
    await new Promise(r => setTimeout(r, 60 + Math.random() * 80));
  }
}

// ─── Credenciais ─────────────────────────────────────────────────────────────

function getCredentials() {
  if (!fs.existsSync(CREDENTIALS_FILE)) return {};
  return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
}

function saveCredentials(data) {
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2));
}

// ─── TikTok ──────────────────────────────────────────────────────────────────

async function scrapeTikTok(page, keyword) {
  const results = [];

  stepUpdate('tt_search', 'running', `Buscando "${keyword}"`);
  await page.goto('https://www.tiktok.com/search?q=' + encodeURIComponent(keyword), { waitUntil: 'domcontentloaded', timeout: 30000 });
  await humanDelay(2000, 3500);
  stepUpdate('tt_search', 'done', `Buscou "${keyword}"`);

  // Clica em Vídeos se houver aba
  try {
    const videosTab = page.locator('[data-e2e="search-tab-video"], a:has-text("Vídeos"), a:has-text("Videos")').first();
    if (await videosTab.count() > 0) {
      await videosTab.click();
      await humanDelay(1500, 2500);
    }
  } catch (_) {}

  stepUpdate('tt_filter', 'running', 'Aplicando filtros');

  // Abre painel de filtros
  try {
    const filterBtn = page.locator('[data-e2e="search-filter"], button:has-text("Filtros"), button:has-text("Filter")').first();
    if (await filterBtn.count() > 0) {
      await filterBtn.click();
      await humanDelay(1000, 1800);

      // Seleciona "Este mês"
      const thisMonth = page.locator('text="Este mês", text="This month", text="Este mes"').first();
      if (await thisMonth.count() > 0) { await thisMonth.click(); await humanDelay(400, 800); }

      // Seleciona "Mais curtidas"
      const mostLiked = page.locator('text="Mais curtidas", text="Most liked", text="Most liked"').first();
      if (await mostLiked.count() > 0) { await mostLiked.click(); await humanDelay(400, 800); }

      // Confirma filtros
      const applyBtn = page.locator('button:has-text("Aplicar"), button:has-text("Apply")').first();
      if (await applyBtn.count() > 0) { await applyBtn.click(); await humanDelay(1500, 2500); }
    }
  } catch (_) {}

  stepUpdate('tt_filter', 'done', 'Filtros: esse mês + mais curtidas');
  stepUpdate('tt_collect', 'running', 'Coletando vídeos...');

  // Coleta cards de vídeo
  await humanDelay(2000, 3000);

  try {
    const videoCards = await page.$$('[data-e2e="search_top-item"], [class*="DivItemContainerV2"], article');
    const limit = Math.min(videoCards.length, 10);

    for (let i = 0; i < limit; i++) {
      try {
        const card = videoCards[i];
        const title = await card.$eval('[data-e2e="search-card-desc"], [class*="SpanText"], .video-meta-caption', el => el.innerText.trim()).catch(() => '');
        const likes = await card.$eval('[data-e2e="like-count"], [class*="like"]', el => el.innerText.trim()).catch(() => '');
        const views = await card.$eval('[data-e2e="video-views"], [class*="play-count"]', el => el.innerText.trim()).catch(() => '');
        const url   = await card.$eval('a', el => el.href).catch(() => '');

        if (url) results.push({ platform: 'tiktok', title, likes, views, url });
      } catch (_) {}
    }
  } catch (_) {}

  // Fallback: pega todos os links /video/ da página
  if (results.length === 0) {
    const links = await page.$$eval('a[href*="/video/"]', els =>
      els.slice(0, 10).map(el => ({
        platform: 'tiktok',
        title: el.innerText?.trim() || el.getAttribute('aria-label') || '',
        likes: '',
        views: '',
        url: el.href,
      }))
    ).catch(() => []);
    results.push(...links);
  }

  stepUpdate('tt_collect', 'done', `${results.length} vídeos coletados`);
  return results;
}

// ─── Instagram ───────────────────────────────────────────────────────────────

async function scrapeInstagram(page, keyword) {
  const results = [];

  stepUpdate('ig_search', 'running', `Buscando Reels "${keyword}"`);
  await page.goto('https://www.instagram.com/reels/explore/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await humanDelay(2000, 3500);

  // Usa a busca do Instagram
  try {
    await page.goto(`https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(keyword)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(2000, 3000);
  } catch (_) {}

  stepUpdate('ig_search', 'done', `Buscou "${keyword}"`);
  stepUpdate('ig_collect', 'running', 'Coletando Reels...');

  try {
    const posts = await page.$$('article a[href*="/reel/"], a[href*="/reel/"]');
    const seen = new Set();
    for (const post of posts.slice(0, 10)) {
      const url = await post.getAttribute('href').catch(() => '');
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const fullUrl = url.startsWith('http') ? url : `https://www.instagram.com${url}`;
      results.push({ platform: 'instagram', title: '', likes: '', views: '', url: fullUrl });
    }
  } catch (_) {}

  stepUpdate('ig_collect', 'done', `${results.length} Reels coletados`);
  return results;
}

// ─── YouTube Shorts ───────────────────────────────────────────────────────────

async function scrapeYouTubeShorts(page, keyword) {
  const results = [];

  stepUpdate('yt_search', 'running', `Buscando Shorts "${keyword}"`);

  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword + ' shorts')}&sp=EgIYAQ%253D%253D`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await humanDelay(2000, 3500);

  stepUpdate('yt_search', 'done', `Buscou "${keyword}"`);
  stepUpdate('yt_collect', 'running', 'Coletando Shorts...');

  try {
    // Extrai títulos + URLs dos Shorts
    const shorts = await page.$$eval('ytd-video-renderer, ytd-short-shelf-cell-renderer a, a#thumbnail[href*="/shorts/"]', els =>
      els
        .filter(el => el.href && el.href.includes('/shorts/'))
        .slice(0, 10)
        .map(el => ({
          platform: 'youtube',
          title: el.getAttribute('title') || el.innerText?.trim() || '',
          likes: '',
          views: '',
          url: el.href,
        }))
    ).catch(() => []);

    // Fallback: qualquer link de shorts
    if (shorts.length === 0) {
      const allLinks = await page.$$eval('a[href*="/shorts/"]', els =>
        [...new Set(els.map(el => el.href))]
          .slice(0, 10)
          .map(href => ({ platform: 'youtube', title: '', likes: '', views: '', url: href }))
      ).catch(() => []);
      results.push(...allLinks);
    } else {
      results.push(...shorts);
    }
  } catch (_) {}

  stepUpdate('yt_collect', 'done', `${results.length} Shorts coletados`);
  return results;
}

// ─── Análise Claude ───────────────────────────────────────────────────────────

async function analyzeWithClaude(keyword, allVideos) {
  stepUpdate('analyze', 'running', 'Enviando para Claude...');

  const videoList = allVideos.map((v, i) =>
    `${i + 1}. [${v.platform.toUpperCase()}] ${v.title || '(sem título)'} | Views: ${v.views || '?'} | Likes: ${v.likes || '?'} | URL: ${v.url}`
  ).join('\n');

  const prompt = `Você é um estrategista de conteúdo viral para o nicho de saúde/fitness (TRT, hormônios, suplementação).

Palavra-chave pesquisada: "${keyword}"

Vídeos virais encontrados (${allVideos.length} total):
${videoList}

Com base nesses vídeos, gere um relatório seguindo EXATAMENTE este formato:

## 📊 Padrões Identificados
(Liste os 3-5 formatos/estruturas que mais se repetem nos títulos/temas)

## 🏆 Top 3 Vídeos para Referência
(Destaque os 3 mais promissores com justificativa)

## 🎯 FORMATO A (Obrigatório)
Título sugerido: ...
Estrutura: ...
Hook de abertura: ...

## 🎯 FORMATO B (Obrigatório)
Título sugerido: ...
Estrutura: ...
Hook de abertura: ...

## ✅ Próximos Passos
(3 ações concretas para gravar essa semana)`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
    const analysis = response.content[0].text;
    stepUpdate('analyze', 'done', 'Análise concluída');
    return analysis;
  } catch (err) {
    stepUpdate('analyze', 'error', 'Erro na análise: ' + err.message);
    return null;
  }
}

// ─── Função principal ─────────────────────────────────────────────────────────

async function runAgent({ keyword, platforms = ['tiktok', 'instagram', 'youtube'] }) {
  if (agentState.running) throw new Error('Agente já está em execução');

  agentState.running = true;
  agentState.startedAt = new Date().toISOString();
  agentState.finishedAt = null;
  agentState.results = null;
  agentState.error = null;

  initSteps(platforms);

  let browser;
  try {
    stepUpdate('init', 'running', 'Abrindo Chrome...');

    // Usa cookies salvos para não precisar logar toda vez
    const creds = getCredentials();
    const storageState = creds.storageState || undefined;

    const launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
      ],
    };

    // Usa o Chromium encontrado (Docker container ou cache local)
    if (CHROMIUM_PATH) {
      launchOptions.executablePath = CHROMIUM_PATH;
      console.log('[Agent] Chromium encontrado em:', CHROMIUM_PATH);
    } else {
      console.log('[Agent] Usando Chromium padrão do Playwright');
    }

    browser = await chromium.launch(launchOptions);

    const contextOptions = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'pt-BR',
    };
    if (storageState) contextOptions.storageState = storageState;

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    // Bloqueia rastreadores pesados para velocidade
    await page.route('**/*.{png,jpg,gif,webp,woff,woff2}', route => route.abort().catch(() => {}));

    stepUpdate('init', 'done', 'Navegador iniciado');

    const allVideos = [];

    // ── TikTok ──
    if (platforms.includes('tiktok')) {
      stepUpdate('login_tt', 'running', 'Acessando tiktok.com');
      await page.goto('https://www.tiktok.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanDelay(1500, 2500);
      stepUpdate('login_tt', 'done', 'TikTok acessado');
      const ttVideos = await scrapeTikTok(page, keyword);
      allVideos.push(...ttVideos);
    }

    // ── Instagram ──
    if (platforms.includes('instagram')) {
      const igVideos = await scrapeInstagram(page, keyword);
      allVideos.push(...igVideos);
    }

    // ── YouTube Shorts ──
    if (platforms.includes('youtube')) {
      const ytVideos = await scrapeYouTubeShorts(page, keyword);
      allVideos.push(...ytVideos);
    }

    // Salva cookies para próximas execuções
    const newStorage = await context.storageState();
    saveCredentials({ ...creds, storageState: newStorage });

    await context.close();

    // ── Análise Claude ──
    const analysis = await analyzeWithClaude(keyword, allVideos);

    // ── Relatório final ──
    stepUpdate('report', 'running', 'Compilando relatório...');
    agentState.results = { keyword, platforms, videos: allVideos, analysis, collectedAt: new Date().toISOString() };
    stepUpdate('report', 'done', `${allVideos.length} vídeos + análise gerada`);

    broadcast({ type: 'complete', results: agentState.results });

  } catch (err) {
    agentState.error = err.message;
    broadcast({ type: 'error', message: err.message });
    console.error('[AgentService] Erro:', err);
  } finally {
    if (browser) await browser.close().catch(() => {});
    agentState.running = false;
    agentState.finishedAt = new Date().toISOString();
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getState: () => agentState,
  runAgent,
  sseClients,
  getCredentials,
  saveCredentials,
};
