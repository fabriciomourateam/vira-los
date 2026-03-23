/**
 * agentService.js
 * Agente autônomo — usa Apify para coletar vídeos virais do TikTok, Instagram e YouTube
 * sem necessidade de browser. 100% cloud.
 */

const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const CREDENTIALS_FILE = path.join(DATA_DIR, 'agent-credentials.json');
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

// ─── Helper Apify: roda ator e retorna dataset ────────────────────────────────
async function runApifyActor(actorId, input, timeoutSecs = 120) {
  const apiKey = process.env.APIFY_API_KEY;
  if (!apiKey) throw new Error('APIFY_API_KEY não configurada');
  const id = actorId.replace('/', '~');
  const url = `https://api.apify.com/v2/acts/${id}/run-sync-get-dataset-items?token=${apiKey}&timeout=${timeoutSecs}`;
  const response = await axios.post(url, input, { timeout: (timeoutSecs + 15) * 1000 });
  return Array.isArray(response.data) ? response.data : [];
}

// ─── TikTok via Apify (clockworks/tiktok-scraper) ────────────────────────────
async function fetchTikTok(keyword) {
  stepUpdate('tt_search', 'running', `Buscando "${keyword}" via Apify`);

  if (!process.env.APIFY_API_KEY && !process.env.RAPIDAPI_KEY) {
    stepUpdate('tt_search', 'error', 'Nenhuma API configurada');
    stepUpdate('tt_filter', 'done', 'Pulado');
    stepUpdate('tt_collect', 'done', '0 vídeos coletados');
    return [];
  }

  const results = [];

  // Tentativa 1: Apify (clockworks/tiktok-scraper)
  if (process.env.APIFY_API_KEY) {
    try {
      const items = await runApifyActor('clockworks/tiktok-scraper', {
        searchQueries: [keyword],
        searchSection: '/video',
        resultsPerPage: 25,
      }, 90);

      items.forEach(v => {
        const handle = v.authorMeta?.name || v.author?.uniqueId || '';
        const id = v.id || v.webVideoUrl?.split('/video/')?.[1] || '';
        results.push({
          platform: 'tiktok',
          title: String(v.text || v.desc || '').substring(0, 150),
          likes: String(v.diggCount || v.stats?.diggCount || 0),
          views: String(v.playCount || v.stats?.playCount || 0),
          url: v.webVideoUrl || `https://www.tiktok.com/@${handle}/video/${id}`,
        });
      });

      stepUpdate('tt_search', 'done', `Apify: ${results.length} vídeos`);
      stepUpdate('tt_filter', 'done', 'Ordenado por relevância');
      stepUpdate('tt_collect', 'done', `${results.length} vídeos coletados`);
      return results;
    } catch (e) {
      console.error('[Agent TikTok/Apify]', e.message);
    }
  }

  // Fallback: RapidAPI tiktok-scraper7
  if (process.env.RAPIDAPI_KEY) {
    try {
      const r = await axios.get('https://tiktok-scraper7.p.rapidapi.com/feed/search', {
        params: { keywords: keyword, region: 'br', count: 20, cursor: 0, publish_time: '30', sort_type: '1' },
        headers: { 'x-rapidapi-key': process.env.RAPIDAPI_KEY, 'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com' },
        timeout: 20000,
      });
      (r.data?.data?.videos || []).forEach(v => {
        const authorObj = typeof v.author === 'object' ? v.author : null;
        const handle = authorObj?.unique_id || String(v.author || '');
        const id = String(v.video_id || v.aweme_id || '');
        if (!id) return;
        results.push({ platform: 'tiktok', title: String(v.title || v.desc || ''), likes: String(v.digg_count || 0), views: String(v.play_count || 0), url: `https://www.tiktok.com/@${handle}/video/${id}` });
      });
    } catch (e) {
      console.error('[Agent TikTok/RapidAPI]', e.message);
    }
  }

  stepUpdate('tt_search', 'done', `${results.length} vídeos`);
  stepUpdate('tt_filter', 'done', 'Filtros aplicados');
  stepUpdate('tt_collect', 'done', `${results.length} vídeos coletados`);
  return results;
}

// ─── Instagram via API (Apify → RapidAPI fallback) ────────────────────────────

async function fetchInstagramViaGraph(keyword) {
  const igToken = db.getPlatformToken('instagram');
  if (!igToken) return [];

  const hashtag = keyword.trim().replace(/^#/, '').toLowerCase();
  if (!hashtag) return [];

  const { access_token, user_id } = igToken;
  const hashRes = await axios.get('https://graph.facebook.com/v21.0/ig_hashtag_search', {
    params: { user_id, q: hashtag, access_token },
    timeout: 15000,
  });
  const hashId = hashRes.data?.data?.[0]?.id;
  if (!hashId) return [];

  const mediaRes = await axios.get(`https://graph.facebook.com/v21.0/${hashId}/top_media`, {
    params: {
      user_id,
      fields: 'id,media_type,like_count,comments_count,thumbnail_url,media_url,permalink,caption',
      access_token,
    },
    timeout: 15000,
  });

  return (mediaRes.data?.data || []).map((item) => ({
    platform: 'instagram',
    title: String(item.caption || '').substring(0, 120),
    likes: String(item.like_count || 0),
    views: '0',
    url: item.permalink || '',
  }));
}

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

  if (!results.length) {
    try {
      const graphResults = await fetchInstagramViaGraph(keyword);
      results.push(...graphResults);
      if (graphResults.length) {
        stepUpdate('ig_search', 'done', `Graph API: ${graphResults.length} reels`);
        stepUpdate('ig_collect', 'done', `${graphResults.length} Reels coletados`);
        return results;
      }
    } catch (e) {
      console.error('[Agent IG/Graph] Erro:', e.response?.data || e.message);
    }
  }

  const igReason = results.length
    ? `${results.length} reels`
    : (apifyKey || rapidApiKey)
      ? 'Busca executada, mas sem resultados'
      : db.getPlatformToken('instagram')
        ? 'Instagram conectado, mas a hashtag nÃ£o retornou mÃ­dia'
        : 'Sem APIFY/RapidAPI e sem Instagram conectado';

  stepUpdate('ig_search', 'done', igReason);
  stepUpdate('ig_collect', 'done', `${results.length} Reels coletados`);
  return results;
}

// ─── YouTube Shorts via Apify (aimscrape/youtube-search-video-scraper) FREE ──
async function fetchYouTube(keyword) {
  stepUpdate('yt_search', 'running', `Buscando Shorts "${keyword}" via Apify`);

  const results = [];

  if (process.env.APIFY_API_KEY) {
    try {
      const items = await runApifyActor('aimscrape/youtube-search-video-scraper', {
        searchQueries: [keyword],
        type: 'Short',
        sortBy: 'Popularity',
        uploadDate: 'ThisMonth',
        country: 'BR',
        maxPage: 1,
      }, 90);

      items.forEach(v => {
        results.push({
          platform: 'youtube',
          title: String(v.title || '').substring(0, 150),
          likes: String(v.likes || 0),
          views: String(v.viewCount || v.views || 0),
          url: v.url || v.videoUrl || '',
        });
      });

      stepUpdate('yt_search', 'done', `Apify: ${results.length} Shorts`);
      stepUpdate('yt_collect', 'done', `${results.length} Shorts coletados`);
      return results;
    } catch (e) {
      console.error('[Agent YouTube/Apify]', e.message);
    }
  }

  stepUpdate('yt_search', 'done', 'APIFY_API_KEY não configurada');
  stepUpdate('yt_collect', 'done', '0 Shorts coletados');
  return results;
}

// ─── Análise Claude ───────────────────────────────────────────────────────────

async function analyzeWithClaude(keyword, allVideos, diagnostics = []) {
  stepUpdate('analyze', 'running', 'Montando dossiÃª editorial...');

  if (!allVideos.length) {
    stepUpdate('analyze', 'done', 'Sem referÃªncias suficientes para roteirizar');
    const notes = diagnostics.length
      ? diagnostics.map((item) => `- ${item}`).join('\n')
      : '- Nenhuma plataforma retornou vÃ­deos dentro dos filtros atuais.';

    return [
      '# DossiÃª Editorial',
      '',
      '## Status da Coleta',
      `Nenhum vÃ­deo foi coletado para a palavra-chave **${keyword}**.`,
      '',
      '## DiagnÃ³stico',
      notes,
      '',
      '## O que falta para sair com roteiro pronto',
      '- Coletar de 5 a 10 referÃªncias reais alinhadas ao passo 1 do roteiro.',
      '- Priorizar TikTok com ordenaÃ§Ã£o por curtidas e recÃªncia.',
      '- Usar Instagram como apoio quando houver Apify, RapidAPI ou conta oficial conectada em Plataformas.',
      '',
      '## PrÃ³ximo passo recomendado',
      '- Rode a busca primeiro no TikTok e valide os formatos repetidos.',
      '- Depois gere o dossiÃª para obter Formato A, Formato B e o roteiro pronto.',
    ].join('\n');
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    stepUpdate('analyze', 'done', 'Coleta pronta; falta ANTHROPIC_API_KEY para gerar o dossiÃª');
    return [
      '# DossiÃª Editorial',
      '',
      `Foram coletados **${allVideos.length} vÃ­deos**, mas o backend estÃ¡ sem **ANTHROPIC_API_KEY** para transformar essas referÃªncias em roteiro pronto.`,
      '',
      '## PrÃ³ximo passo',
      '- Configurar a chave da Anthropic para gerar Formato A, Formato B e os roteiros completos automaticamente.',
    ].join('\n');
  }

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

  const promptV2 = `VocÃª Ã© um estrategista editorial do mÃ©todo Vira-Los.

Sua funÃ§Ã£o Ã© transformar vÃ­deos virais reais em um dossiÃª pronto para gravaÃ§Ã£o, seguindo rigorosamente o roteiro:
- Passo 1: pesquisar palavra-chave, priorizar TikTok, olhar curtidas + recÃªncia, salvar 5-10 referÃªncias
- Passo 2: identificar formatos repetidos e escolher FORMATO A e FORMATO B
- Passo 3: entregar gancho, desenvolvimento, CTA e emoÃ§Ã£o central para gravar

Palavra-chave pesquisada: "${keyword}"

VÃ­deos virais encontrados (${allVideos.length} total):
${videoList}

Regras:
- Use SOMENTE os dados acima como base factual.
- Se inferir algo, deixe claro que Ã© inferÃªncia.
- Priorize formatos meio de funil, educativos, com curiosidade, medo, revelaÃ§Ã£o, prova social ou lista.
- Entregue algo que o criador possa abrir e gravar hoje.

Responda EXATAMENTE neste formato:

# DossiÃª Editorial

## ReferÃªncias-Chave
- liste 5 referÃªncias com tÃ­tulo curto, plataforma, motivo e link

## PadrÃµes Identificados
- 3 a 5 padrÃµes recorrentes

## FORMATO A
TÃ­tulo sugerido: ...
Por que encaixa no roteiro: ...
Hook de abertura: ...
Estrutura: ...
CTA: ...

## FORMATO B
TÃ­tulo sugerido: ...
Por que encaixa no roteiro: ...
Hook de abertura: ...
Estrutura: ...
CTA: ...

## Roteiro Pronto 1
Gancho (0-3s): ...
Desenvolvimento (10-60s): ...
CTA final: ...

## Roteiro Pronto 2
Gancho (0-3s): ...
Desenvolvimento (10-60s): ...
CTA final: ...

## ObservaÃ§Ãµes de GravaÃ§Ã£o
- enquadramento
- quebra de padrÃ£o
- texto na tela
- emoÃ§Ã£o central

## PrÃ³ximos Passos
- 3 aÃ§Ãµes objetivas para gravar ainda esta semana`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 2200,
      messages: [{ role: 'user', content: promptV2 }],
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
    const collectionDiagnostics = [];
    const creds = getCredentials();

    // ── TikTok via API ─────────────────────────────────────────────────────
    if (platforms.includes('tiktok')) {
      stepUpdate('init', 'running', 'Conectando às APIs...');
      stepUpdate('login_tt', 'running', 'Acessando API TikTok');
      stepUpdate('login_tt', 'done', 'API TikTok conectada');
      stepUpdate('init', 'done', 'APIs conectadas');
      const ttVideos = await fetchTikTok(keyword);
      allVideos.push(...ttVideos);
      if (!ttVideos.length) {
        collectionDiagnostics.push('TikTok sem resultados suficientes na coleta atual. O roteiro continua melhor servido por TikTok, mas depende de provedor configurado e filtro de recÃªncia.');
      }
    } else {
      stepUpdate('init', 'done', 'Iniciado');
      stepUpdate('login_tt', 'done', 'Pulado');
    }

    if (stopRequested) throw new Error('STOP_REQUESTED');

    // ── Instagram via API ──────────────────────────────────────────────────
    if (platforms.includes('instagram')) {
      const igVideos = await fetchInstagram(keyword);
      allVideos.push(...igVideos);
      if (!igVideos.length) {
        collectionDiagnostics.push('Instagram sem resultados. Hoje o backend depende de Apify, RapidAPI ou Instagram oficial conectado em Plataformas; sessionid salvo no agente nÃ£o Ã© usado na busca.');
      }
    }

    if (stopRequested) throw new Error('STOP_REQUESTED');

    // ── YouTube via Apify (sem browser) ───────────────────────────────────
    if (platforms.includes('youtube')) {
      const ytVideos = await fetchYouTube(keyword);
      allVideos.push(...ytVideos);
      if (!ytVideos.length) {
        collectionDiagnostics.push('YouTube sem resultados. A coleta de Shorts no agente ainda depende de APIFY_API_KEY.');
      }
    }

    // ── Análise Claude ──
    const analysis = await analyzeWithClaude(keyword, allVideos, collectionDiagnostics);

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
