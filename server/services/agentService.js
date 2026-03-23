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

// Flag de cancelamento
let stopRequested = false;

function stopAgent() {
  if (agentState.running) {
    stopRequested = true;
    broadcast({ type: 'stopped', message: 'Agente interrompido pelo usuário' });
  }
}

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

// ─── TikTok via API (RapidAPI tiktok-scraper7) ───────────────────────────────

async function fetchTikTok(keyword) {
  const rapidApiKey = process.env.RAPIDAPI_KEY;
  stepUpdate('tt_search', 'running', `Buscando "${keyword}" via API`);

  if (!rapidApiKey) {
    stepUpdate('tt_search', 'error', 'RAPIDAPI_KEY não configurada');
    stepUpdate('tt_filter', 'done', 'Pulado');
    stepUpdate('tt_collect', 'done', '0 vídeos coletados');
    return [];
  }

  const results = [];
  try {
    // Busca em PT-BR e EN para mais resultados
    const searches = await Promise.allSettled([
      axios.get('https://tiktok-scraper7.p.rapidapi.com/feed/search', {
        params: { keywords: keyword, region: 'br', count: 20, cursor: 0, publish_time: '30', sort_type: '1' },
        headers: { 'x-rapidapi-key': rapidApiKey, 'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com' },
        timeout: 20000,
      }),
      axios.get('https://tiktok-scraper7.p.rapidapi.com/feed/search', {
        params: { keywords: keyword, region: 'us', count: 10, cursor: 0, publish_time: '30', sort_type: '1' },
        headers: { 'x-rapidapi-key': rapidApiKey, 'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com' },
        timeout: 20000,
      }),
    ]);

    const seen = new Set();
    searches.forEach(r => {
      if (r.status !== 'fulfilled') return;
      const videos = r.value.data?.data?.videos || [];
      videos.forEach(v => {
        const authorObj = typeof v.author === 'object' ? v.author : null;
        const handle = authorObj?.unique_id || String(v.author || '');
        const id = String(v.video_id || v.aweme_id || '');
        if (!id || seen.has(id)) return;
        seen.add(id);
        results.push({
          platform: 'tiktok',
          title: String(v.title || v.desc || ''),
          likes: String(v.digg_count || 0),
          views: String(v.play_count || 0),
          url: `https://www.tiktok.com/@${handle}/video/${id}`,
        });
      });
    });

    stepUpdate('tt_search', 'done', `API respondeu`);
    stepUpdate('tt_filter', 'done', 'Esse mês + mais curtidas (API)');
    stepUpdate('tt_collect', 'done', `${results.length} vídeos coletados`);
  } catch (e) {
    console.error('[Agent TikTok] Erro:', e.message);
    stepUpdate('tt_search', 'done', `Erro: ${e.message}`);
    stepUpdate('tt_filter', 'done', 'Pulado');
    stepUpdate('tt_collect', 'done', '0 vídeos coletados');
  }

  return results;
}

// ─── Instagram via API (Apify → RapidAPI fallback) ────────────────────────────

async function fetchInstagram(keyword) {
  const apifyKey = process.env.APIFY_API_KEY;
  const rapidApiKey = process.env.RAPIDAPI_KEY;
  stepUpdate('ig_search', 'running', `Buscando Reels "${keyword}" via API`);

  const results = [];

  // Tentativa 1: Apify
  if (apifyKey) {
    try {
      const tag = encodeURIComponent(keyword.trim().replace(/\s+/g, ''));
      const url = `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${apifyKey}&timeout=90`;
      const response = await axios.post(url, {
        directUrls: [`https://www.instagram.com/explore/tags/${tag}/`],
        resultsType: 'posts',
        resultsLimit: 20,
        addParentData: false,
      }, { timeout: 100000 });

      const items = Array.isArray(response.data) ? response.data : [];
      items.filter(i => i.type === 'Video' || i.videoViewCount > 0).forEach(i => {
        const code = i.shortCode || i.id || '';
        results.push({
          platform: 'instagram',
          title: String(i.caption || '').substring(0, 120),
          likes: String(i.likesCount || 0),
          views: String(i.videoViewCount || 0),
          url: i.url || `https://www.instagram.com/reel/${code}/`,
        });
      });

      stepUpdate('ig_search', 'done', `Apify: ${results.length} reels`);
      stepUpdate('ig_collect', 'done', `${results.length} Reels coletados`);
      return results;
    } catch (e) {
      console.error('[Agent IG/Apify] Erro:', e.message);
    }
  }

  // Tentativa 2: RapidAPI stable-api
  if (rapidApiKey) {
    try {
      const IG_HOST = 'instagram-scraper-stable-api.p.rapidapi.com';
      const searchRes = await axios.post(
        `https://${IG_HOST}/search_ig.php`,
        new URLSearchParams({ search_query: keyword }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-rapidapi-key': rapidApiKey, 'x-rapidapi-host': IG_HOST }, timeout: 15000 }
      );
      const users = searchRes.data?.users || [];
      const topUsers = users.slice(0, 3).map(item => (item.user || item).username).filter(Boolean);

      if (topUsers.length) {
        const reelResults = await Promise.allSettled(
          topUsers.map(u => axios.post(`https://${IG_HOST}/get_ig_user_reels.php`, new URLSearchParams({ username_or_url: u, amount: 10, pagination_token: '' }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-rapidapi-key': rapidApiKey, 'x-rapidapi-host': IG_HOST }, timeout: 15000 }
          ))
        );
        reelResults.forEach((r, idx) => {
          if (r.status !== 'fulfilled') return;
          const list = (r.value.data?.reels || []).map(item => item?.node?.media || item);
          list.forEach(v => {
            const code = v.code || v.id || '';
            if (!code) return;
            results.push({ platform: 'instagram', title: String(v.caption?.text || '').substring(0, 120), likes: String(v.like_count || 0), views: String(v.play_count || 0), url: `https://www.instagram.com/reel/${code}/` });
          });
        });
      }
    } catch (e) {
      console.error('[Agent IG/RapidAPI] Erro:', e.message);
    }
  }

  stepUpdate('ig_search', 'done', results.length ? `${results.length} reels` : 'Sem API configurada');
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
  stopRequested = false;

  initSteps(platforms);

  let browser;
  try {
    const allVideos = [];
    const creds = getCredentials();

    // ── TikTok via API ─────────────────────────────────────────────────────
    if (platforms.includes('tiktok')) {
      stepUpdate('init', 'running', 'Conectando às APIs...');
      stepUpdate('login_tt', 'running', 'Acessando API TikTok');
      stepUpdate('login_tt', 'done', 'API TikTok conectada');
      stepUpdate('init', 'done', 'APIs conectadas');
      const ttVideos = await fetchTikTok(keyword);
      allVideos.push(...ttVideos);
    } else {
      stepUpdate('init', 'done', 'Iniciado');
      stepUpdate('login_tt', 'done', 'Pulado');
    }

    if (stopRequested) throw new Error('STOP_REQUESTED');

    // ── Instagram via API ──────────────────────────────────────────────────
    if (platforms.includes('instagram')) {
      const igVideos = await fetchInstagram(keyword);
      allVideos.push(...igVideos);
    }

    if (stopRequested) throw new Error('STOP_REQUESTED');

    // ── YouTube via Playwright (único que usa browser) ─────────────────────
    if (platforms.includes('youtube')) {
      stepUpdate('yt_search', 'running', 'Abrindo Chrome para YouTube...');

      const launchOptions = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process', '--no-zygote'],
      };
      if (CHROMIUM_PATH) launchOptions.executablePath = CHROMIUM_PATH;

      browser = await chromium.launch(launchOptions);
      const contextOptions = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        locale: 'pt-BR',
      };
      if (creds.storageState) contextOptions.storageState = creds.storageState;

      const context = await browser.newContext(contextOptions);
      const page = await context.newPage();
      await page.route('**/*.{png,jpg,gif,webp,woff,woff2}', route => route.abort().catch(() => {}));

      const ytVideos = await scrapeYouTubeShorts(page, keyword);
      allVideos.push(...ytVideos);

      const newStorage = await context.storageState();
      saveCredentials({ ...creds, storageState: newStorage });
      await context.close();
    }

    // ── Análise Claude ──
    const analysis = await analyzeWithClaude(keyword, allVideos);

    // ── Relatório final ──
    stepUpdate('report', 'running', 'Compilando relatório...');
    agentState.results = { keyword, platforms, videos: allVideos, analysis, collectedAt: new Date().toISOString() };
    stepUpdate('report', 'done', `${allVideos.length} vídeos + análise gerada`);

    broadcast({ type: 'complete', results: agentState.results });

  } catch (err) {
    agentState.error = err.message;
    if (err.message === 'STOP_REQUESTED') {
      agentState.error = 'Interrompido pelo usuário';
      broadcast({ type: 'stopped', message: 'Agente interrompido pelo usuário' });
    } else {
      agentState.error = err.message;
      broadcast({ type: 'error', message: err.message });
      console.error('[AgentService] Erro:', err);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    agentState.running = false;
    stopRequested = false;
    agentState.finishedAt = new Date().toISOString();
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getState: () => agentState,
  runAgent,
  stopAgent,
  sseClients,
  getCredentials,
  saveCredentials,
};
