/**
 * mlabsService.js — automação de agendamento no mLabs (que não tem API pública).
 *
 * Estratégia (mapeada a partir do HAR real do fluxo de agendamento):
 *   1. Conecta a um Chrome headless hospedado (Browserless self-hosted no Fly) via Playwright.
 *   2. Mantém a SESSÃO do mLabs persistida (storageState: cookies + localStorage). Login com
 *      captcha só acontece raramente — `persistent:true` deixa a sessão longa. Quando o login
 *      automático esbarra no captcha, dá pra "semear" a sessão importando os cookies de um login
 *      manual (rota POST /api/mlabs/session).
 *   3. APRENDE os cabeçalhos de auth do próprio app (Authorization/accept-version/current-profile)
 *      interceptando uma requisição real — assim não dependemos de adivinhar o token (o HAR
 *      sanitizado removeu os corpos/headers de resposta).
 *   4. Sobe a mídia: POST uploader.mlabs.io/files/ingest (devolve URL assinada do S3) → PUT no S3.
 *   5. Cria o agendamento: POST post-api.mlabs.io/schedules com TODAS as datas de uma vez
 *      (array `dates`), convertendo horário America/Sao_Paulo → UTC.
 *
 * IDs de canal/perfil e o nome do campo do id numérico da imagem são confirmados na 1ª execução
 * real (rota POST /api/mlabs/calibrate grava o que o app de verdade enviou).
 *
 * Segredos (Fly secrets, nunca commitados):
 *   MLABS_EMAIL, MLABS_PASSWORD          — conta dedicada de automação
 *   BROWSERLESS_WS_URL                   — ex.: ws://viralos-browserless.internal:3000?token=XXedge
 *   BROWSERLESS_TOKEN                    — (opcional) token, se não embutido na URL
 */

const fs = require('fs');
const path = require('path');
const db = require('../db/database');

// ── Endpoints do mLabs (do HAR) ────────────────────────────────────────────────
const MLABS = {
  app: 'https://publish.mlabs.io/',
  login: 'https://accounts.mlabs.io/',
  signIn: 'https://auth-api.mlabs.io/accounts/sign_in',
  ingest: 'https://uploader.mlabs.io/files/ingest',
  schedules: 'https://post-api.mlabs.io/schedules',
};

// SP é UTC-03:00 o ano todo (sem horário de verão desde 2019).
const SP_OFFSET = '-03:00';

// ── Conexão com o Browserless ───────────────────────────────────────────────────
let _chromium = null;
function getChromium() {
  if (_chromium) return _chromium;
  ({ chromium: _chromium } = require('playwright'));
  return _chromium;
}

function browserlessUrl() {
  let url = process.env.BROWSERLESS_WS_URL || '';
  if (!url) return null;
  const token = process.env.BROWSERLESS_TOKEN;
  if (token && !/token=/.test(url)) {
    url += (url.includes('?') ? '&' : '?') + 'token=' + token;
  }
  return url;
}

// Conecta ao browser. Dois modos:
//  • BROWSERLESS_WS_URL setado → conecta ao Browserless self-hosted (Playwright protocol,
//    fallback CDP). Bom pra isolar o Chromium da máquina do app.
//  • Sem URL → lança o Chromium local do próprio servidor (que já vem com Playwright +
//    Chromium do sistema, igual o gerador de carrosséis). Zero infra extra.
// Retorna { browser, remote } — quem fechar decide se mata o browser (local) ou só desconecta.
async function connectBrowser() {
  const chromium = getChromium();
  const url = browserlessUrl();
  if (url) {
    try {
      return { browser: await chromium.connect(url, { timeout: 60000 }), remote: true };
    } catch (_) {
      return { browser: await chromium.connectOverCDP(url, { timeout: 60000 }), remote: true };
    }
  }
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
  const browser = await chromium.launch({
    headless: true, executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  return { browser, remote: false };
}

// ── Sessão persistida (storageState) ────────────────────────────────────────────
function loadSession() {
  const s = db.getMlabsSession ? db.getMlabsSession() : null;
  return s && s.cookies ? s : null;
}
function saveSession(storageState) {
  if (db.setMlabsSession) db.setMlabsSession(storageState);
}

async function newContext(browser) {
  const storageState = loadSession();
  const ctx = await browser.newContext({
    storageState: storageState || undefined,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  });
  return ctx;
}

// ── Login + detecção de sessão válida ───────────────────────────────────────────
// Navegação resiliente: waitUntil 'commit' (assim que a navegação confirma, sem
// esperar a SPA/Cloudflare carregar tudo) + 1 retry. Evita timeout em páginas pesadas.
async function gotoSafe(page, url, { timeout = 60000 } = {}) {
  for (let i = 0; i < 2; i++) {
    try {
      await page.goto(url, { waitUntil: 'commit', timeout });
      return true;
    } catch (e) {
      if (i === 1) throw e;
      await page.waitForTimeout(1500);
    }
  }
}

// Testa a sessão batendo numa API autenticada do mLabs (cookies viajam junto).
// 401/403 = não logado; 2xx/3xx = logado; null = ambíguo (deixa o caller decidir).
async function apiProbeLoggedIn(page) {
  const cfg = db.getMlabsSettings ? db.getMlabsSettings() : {};
  const profile = cfg.profileId ? String(cfg.profileId) : '';
  const status = await page.evaluate(async (profile) => {
    try {
      const r = await fetch('https://post-api.mlabs.io/schedules/limits', {
        credentials: 'include',
        headers: { accept: 'application/vnd.api+json', 'accept-version': 'v1', ...(profile ? { 'current-profile': profile } : {}) },
      });
      return r.status;
    } catch { return 0; }
  }, profile).catch(() => 0);
  if (status === 401 || status === 403) return false;
  if (status >= 200 && status < 400) return true;
  return null;
}

// Considera "logado" via probe de API; cai pro sniff de URL se o probe for ambíguo.
async function isLoggedIn(page) {
  try {
    await gotoSafe(page, MLABS.app);
    await page.waitForTimeout(1800);
    const probe = await apiProbeLoggedIn(page);
    if (probe !== null) return probe;
    return !/accounts\.mlabs\.io|\/login|sign_in/i.test(page.url());
  } catch (_) {
    return false;
  }
}

// Tenta login automático por preenchimento de formulário. Se houver captcha, lança erro
// orientando a semear a sessão manualmente (import de cookies).
async function attemptLogin(page) {
  const email = process.env.MLABS_EMAIL;
  const password = process.env.MLABS_PASSWORD;
  if (!email || !password) throw new Error('MLABS_EMAIL/MLABS_PASSWORD não configurados.');

  await gotoSafe(page, MLABS.login);
  await page.waitForTimeout(2500);

  // Campos de e-mail/senha (seletores tolerantes; calibrados na 1ª run se mudarem).
  const emailSel = 'input[type="email"], input[name="email"], input#email';
  const passSel = 'input[type="password"], input[name="password"], input#password';
  await page.fill(emailSel, email, { timeout: 20000 });
  await page.fill(passSel, password, { timeout: 20000 });

  // Captcha bloqueia login headless. Se aparecer, não dá pra resolver sozinho.
  const hasCaptcha = await page
    .locator('iframe[src*="recaptcha"], .g-recaptcha, iframe[src*="hcaptcha"]')
    .count()
    .catch(() => 0);
  if (hasCaptcha) {
    throw new Error(
      'CAPTCHA no login do mLabs — login automático bloqueado. Faça login manual no navegador, ' +
      'exporte os cookies (storageState) e importe via POST /api/mlabs/session para semear a sessão.'
    );
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}),
    page.click('button[type="submit"], button:has-text("Entrar"), button:has-text("Login")'),
  ]);
  await page.waitForTimeout(3000);

  if (/accounts\.mlabs\.io|\/login|sign_in/i.test(page.url())) {
    throw new Error('Login no mLabs falhou (credenciais ou captcha). Verifique MLABS_EMAIL/SENHA.');
  }
}

// Garante uma página logada no app. Prefere a sessão semeada (cookies); só tenta
// login automático se NÃO houver sessão salva (login tem captcha e costuma travar).
async function ensureSession(ctx) {
  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(60000);
  const hasSession = !!loadSession();

  if (await isLoggedIn(page)) return page;

  if (hasSession) {
    throw new Error(
      'Sessão do mLabs inválida ou expirada. Reexporte os cookies no Cookie-Editor ' +
      '(logado no mLabs) e cole de novo em "Sessão do mLabs" na engrenagem. ' +
      'Dica: exporte na aba já logada de app.mlabs.com.br.'
    );
  }

  await attemptLogin(page);
  if (!(await isLoggedIn(page))) throw new Error('Não consegui validar a sessão do mLabs após login.');
  saveSession(await ctx.storageState());
  return page;
}

// ── Aprender headers de auth do app real ────────────────────────────────────────
// Intercepta as requisições que o próprio app dispara contra *-api.mlabs.io e captura
// Authorization, accept-version, current-profile, current-timezone. Reutilizamos isso
// nas chamadas de ingest/schedules.
async function learnAuthHeaders(page) {
  const learned = {};
  const wanted = ['authorization', 'accept-version', 'current-profile', 'current-timezone'];

  const onRequest = (req) => {
    const u = req.url();
    if (!/(post-api|core-api|uploader|auth-api)\.mlabs\.io/.test(u)) return;
    const h = req.headers();
    for (const k of wanted) if (h[k] && !learned[k]) learned[k] = h[k];
  };
  page.on('request', onRequest);

  // Reabre o app pra disparar as chamadas de fundo (schedules/limits, hashtags, etc).
  await gotoSafe(page, MLABS.app).catch(() => {});
  await page.waitForTimeout(5000);
  page.off('request', onRequest);

  // current-profile é essencial (id do perfil). Se não veio em header, tenta da sessão salva.
  const cfg = db.getMlabsSettings ? db.getMlabsSettings() : {};
  if (!learned['current-profile'] && cfg.profileId) learned['current-profile'] = String(cfg.profileId);
  if (!learned['current-timezone']) learned['current-timezone'] = 'America/Sao_Paulo';
  if (!learned['accept-version']) learned['accept-version'] = 'v1';
  return learned;
}

// Faz uma chamada autenticada de DENTRO do contexto do browser (cookies viajam junto),
// adicionando os headers aprendidos (caso a auth seja Bearer em localStorage).
async function apiFetch(page, url, { method = 'GET', headers = {}, json, raw } = {}, auth = {}) {
  const allHeaders = { ...auth, ...headers };
  return page.evaluate(
    async ({ url, method, allHeaders, json, raw }) => {
      const opts = { method, headers: allHeaders, credentials: 'include' };
      if (json !== undefined) {
        opts.headers['content-type'] = opts.headers['content-type'] || 'application/json';
        opts.body = JSON.stringify(json);
      } else if (raw !== undefined) {
        opts.body = raw;
      }
      const r = await fetch(url, opts);
      const text = await r.text();
      let body;
      try { body = JSON.parse(text); } catch { body = text; }
      return { status: r.status, ok: r.ok, body };
    },
    { url, method, allHeaders, json, raw }
  );
}

// ── Upload de mídia: ingest → PUT no S3 ─────────────────────────────────────────
// Retorna o id que o /schedules espera (numérico). O nome exato do campo do id é
// confirmado na calibração — tentamos os candidatos conhecidos.
async function uploadMedia(page, filePath, auth, ownerId, fileType /* IMAGE|VIDEO */) {
  const ext = path.extname(filePath).replace('.', '').toLowerCase() || (fileType === 'VIDEO' ? 'mp4' : 'png');
  const { v4: uuidv4 } = require('uuid');
  const uuid = uuidv4();
  const fileName = `${uuid}.${ext}`;

  // 1) ingest → pede a URL assinada do S3.
  // IMPORTANTE: o uploader só aceita os headers "simples" (content-type + accept) +
  // cookies. Mandar accept-version/current-profile/authorization dispara preflight CORS
  // que o uploader rejeita ("Failed to fetch"). Por isso NÃO passamos `auth` aqui.
  const ingestRes = await apiFetch(
    page,
    MLABS.ingest,
    {
      method: 'POST',
      headers: { accept: 'application/json, text/plain, */*' },
      json: { uuid, ownerId: String(ownerId), fileType, extension: ext, fileName, name: fileName, configuration: {}, formats: false },
    },
    {} // sem headers de auth — só cookies (credentials:include)
  );
  if (!ingestRes.ok) {
    throw new Error(`ingest falhou (${ingestRes.status}): ${JSON.stringify(ingestRes.body).slice(0, 300)}`);
  }
  const ing = ingestRes.body || {};
  // A URL assinada do S3 vem como `s3SignedUrl` (confirmado na resposta real); cobrimos
  // outros nomes e, por garantia, varremos por uma string que pareça URL assinada do S3.
  const uploadUrl = findUploadUrl(ing);
  if (!uploadUrl) {
    throw new Error(`ingest sem URL de upload — resposta: ${JSON.stringify(ing).slice(0, 600)}`);
  }

  // 2) PUT dos bytes no S3 (precisa rodar fora do browser pra mandar o binário do disco).
  const buf = fs.readFileSync(filePath);
  const contentType = fileType === 'VIDEO' ? `video/${ext}` : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': contentType }, body: buf });
  if (!put.ok) throw new Error(`PUT no S3 falhou (${put.status}) para ${fileName}`);

  // O id numérico NÃO vem aqui — só aparece no GET /file/{uuid} depois que o mLabs
  // termina de PROCESSAR (status sai de UPLOADED). Esperamos isso depois, em paralelo
  // pra todas as mídias (waitForMediaIds).
  return { uuid, fileName, ingestResponse: ing };
}

// Espera o mLabs processar os uploads e devolver o id numérico de cada um.
// Polla GET /file/{uuid} de TODAS as mídias em paralelo (dentro do browser) até cada
// uma ter id, ou até o deadline. Retorna { ids:{uuid:id}, last:{uuid:resposta} }.
//
// IMPORTANTE: o app real manda `authorization: Bearer` pro uploader.mlabs.io ao consultar
// o arquivo — e o id numérico do registro processado parece só voltar pra requisição
// autenticada. Por isso tentamos PRIMEIRO com os headers de auth aprendidos; se o preflight
// CORS barrar (fetch "throws"), caímos pra cookies-só (que é o que basta pro ingest).
async function waitForMediaIds(page, uuids, auth = {}, deadlineMs = 120000) {
  return page.evaluate(
    async ({ uuids, auth, deadlineMs }) => {
      const idKeys = ['id', 'mediaId', 'imageId', 'videoId', 'fileId', 'file_id', 'image_id', 'video_id'];
      const findId = (o) => {
        if (!o || typeof o !== 'object') return null;
        for (const k of idKeys) {
          const v = o[k];
          if (typeof v === 'number' && Number.isFinite(v)) return v;
          if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
        }
        for (const v of Object.values(o)) {
          if (v && typeof v === 'object') { const r = findId(v); if (r) return r; }
        }
        return null;
      };
      const ids = {}, last = {};
      const deadline = Date.now() + deadlineMs;
      while (Date.now() < deadline && Object.keys(ids).length < uuids.length) {
        await Promise.all(uuids.map(async (u) => {
          if (ids[u]) return;
          // Tenta com auth (igual o app real) e, se barrar, sem auth.
          for (const headers of [
            { accept: 'application/json, text/plain, */*', ...auth },
            { accept: 'application/json, text/plain, */*' },
          ]) {
            try {
              const r = await fetch('https://uploader.mlabs.io/file/' + u, { credentials: 'include', headers });
              const b = await r.json().catch(() => ({}));
              last[u] = b;
              const id = findId(b);
              if (id) { ids[u] = id; break; }
              // Resposta veio (não vazia) mas ainda sem id: está PROCESSANDO — não tenta o fallback.
              if (b && typeof b === 'object' && Object.keys(b).length) break;
            } catch (e) { last[u] = String(e); /* preflight/CORS: cai pro próximo header set */ }
          }
        }));
        if (Object.keys(ids).length < uuids.length) await new Promise((r) => setTimeout(r, 2000));
      }
      return { ids, last };
    },
    { uuids, auth, deadlineMs }
  );
}

// Procura a URL assinada do S3 na resposta do ingest (nomes conhecidos + varredura).
function findUploadUrl(o) {
  const keys = ['s3SignedUrl', 'uploadUrl', 'url', 'signedUrl', 'presignedUrl', 's3_signed_url'];
  if (o && typeof o === 'object') {
    for (const k of keys) if (typeof o[k] === 'string' && /^https?:\/\//.test(o[k])) return o[k];
    if (o.data) { const u = findUploadUrl(o.data); if (u) return u; }
    for (const v of Object.values(o)) {
      if (typeof v === 'string' && /^https?:\/\/.*(amazonaws|X-Amz-)/i.test(v)) return v;
    }
  }
  return null;
}

// Procura o id numérico da mídia (recursivo). uuid tem hífens → só casa dígitos puros.
function findNumericId(o) {
  const keys = ['id', 'mediaId', 'imageId', 'videoId', 'fileId', 'file_id', 'image_id', 'video_id'];
  const scan = (obj) => {
    if (!obj || typeof obj !== 'object') return null;
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') { const r = scan(v); if (r) return r; }
    }
    return null;
  };
  return scan(o);
}

// ── Datas padrão (amanhã + offsets em meses, na hora SP padrão das settings) ────
// Retorna strings "AAAA-MM-DDTHH:MM" (hora local SP) — mesmo formato do <input datetime-local>.
function computeDefaultDates() {
  const cfg = (db.getMlabsSettings && db.getMlabsSettings()) || {};
  const [hh, mm] = (cfg.defaultTime || '11:00').split(':').map((n) => parseInt(n, 10));
  const base = new Date();
  base.setDate(base.getDate() + 1); // amanhã
  const fmt = (d) => {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${da}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };
  return (cfg.dateOffsetsMonths || [0, 3, 6, 9]).map((off) => {
    const d = new Date(base);
    d.setMonth(d.getMonth() + off);
    return fmt(d);
  });
}

// ── Conversão de horário SP → UTC ───────────────────────────────────────────────
// Aceita "2026-06-29T11:00" (hora local SP) → "2026-06-29T14:00:00.000Z".
function spToUtcIso(localDateTime) {
  const m = String(localDateTime).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?/);
  if (!m) throw new Error(`Data/hora inválida: "${localDateTime}" (use AAAA-MM-DDTHH:MM).`);
  return new Date(`${m[1]}T${m[2]}:00${SP_OFFSET}`).toISOString();
}

// ── Montagem do payload de /schedules (formato exato dos HARs reais) ────────────
// Observação importante (confirmada no HAR de reel): os flags reel/is-video/is-image
// ficam SEMPRE false — o mLabs identifica reel pelos CANAIS (reels/shorts/tiktok),
// não por booleanos. O vídeo entra em video-objects-attributes com screenshot:0.
// Para YouTube Shorts, o `options` precisa do item kind:"title-video" com o título.
function buildSchedulePayload({
  caption, mediaIds, type, dates, channelSourceIds, profileId, requestId,
  youtubeTitle, youtubeShortsChannelId,
}) {
  const isVideo = type === 'VIDEO';
  const dateObjs = dates.map((d) => ({
    'channel-source-ids': channelSourceIds,
    date: spToUtcIso(d),
    'post-now': false,
    status: null,
  }));

  const imageObjs = !isVideo
    ? mediaIds.map((id, i) => ({ id: null, 'image-id': id, position: i }))
    : [];
  const videoObjs = isVideo
    ? mediaIds.map((id, i) => ({ id: null, 'video-id': id, position: i, screenshot: 0 }))
    : [];

  // YouTube Shorts exige título (e o app envia mais 4 opções com valid:false → defaults).
  let options = [];
  const ytId = youtubeShortsChannelId;
  if (isVideo && ytId && channelSourceIds.includes(Number(ytId)) && videoObjs.length) {
    const ytTitle = (youtubeTitle || caption || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    const csid = String(ytId);
    const key = 'youtube_shorts';
    options = [
      { title: 'Título do vídeo', icon: 'align-left', kind: 'title-video', titles: [{ text: ytTitle, img_id: videoObjs[0]['video-id'] }], channel_source_id: csid, channel_source_key: key, valid: true, hiddenTour: false },
      { title: 'Privacidade', icon: 'user-secret', kind: 'privacy', privacies: [], channel_source_id: csid, channel_source_key: key, valid: false, hiddenTour: false },
      { title: 'Tags', icon: 'tags', kind: 'tag', tags: [], channel_source_id: csid, channel_source_key: key, valid: false, hiddenTour: false },
      { title: 'Categoria', icon: 'sitemap', kind: 'category', categories: [], channel_source_id: csid, channel_source_key: key, valid: false, hiddenTour: false },
      { title: 'Conteúdo para crianças', icon: 'toggle-on', kind: 'made-for-kids', channel_source_id: csid, channel_source_key: key, valid: false, hiddenTour: false },
    ];
  }

  return {
    data: {
      type: 'schedules',
      attributes: {
        date: null,
        message: caption || '',
        title: null,
        'message-resume': null,
        status: 1,
        'channel-source-id': null,
        description: null,
        'error-message': null,
        'message-error': '',
        'adicional-info': null,
        'warning-message': null,
        'can-edit-all': false,
        'can-edit': false,
        image360: false,
        reel: false,
        'is-image': false,
        'is-video': false,
        'is-link': false,
        'is-hint': false,
        'media-stories': [],
        options,
        'from-other-schedule': false,
        'verify-more-schedules': false,
        'approval-link': null,
        'loaded-preview': false,
        version: null,
        'publish-now': false,
        'profile-ids': [profileId],
        'request-id': requestId,
        'channel-source-ids': channelSourceIds,
        'youtube-shorts': false,
        'schedule-messages': [],
        'schedule-accounts': [],
        'image-objects-attributes': imageObjs,
        'video-objects-attributes': videoObjs,
        'document-objects-attributes': [],
        'url-data': {},
        dates: dateObjs,
        'action-type': null,
        'reference-id': null,
        'reference-type': null,
      },
    },
  };
}

// ── Função pública: agenda 1 conteúdo em N datas ────────────────────────────────
/**
 * scheduleContent({
 *   type: 'IMAGE'|'VIDEO',
 *   mediaPaths: string[],        // PNGs do carrossel (em ordem) ou [mp4] do reel
 *   caption: string,
 *   dates: string[],             // ["2026-06-29T11:00", ...] hora local SP
 *   channelSourceIds?: number[], // default das settings
 *   profileId?: number,          // default das settings
 * }) → { ok, mlabsStatus, dates, scheduleResponse }
 */
async function scheduleContent({ type = 'IMAGE', mediaPaths, caption, dates, channelSourceIds, profileId, youtubeTitle }) {
  if (!mediaPaths || !mediaPaths.length) throw new Error('Nenhuma mídia para subir.');
  if (!dates || !dates.length) throw new Error('Nenhuma data informada.');

  const cfg = (db.getMlabsSettings && db.getMlabsSettings()) || {};
  const isVideo = type === 'VIDEO';
  // Reel usa o conjunto de canais de reels/shorts; carrossel usa o de feed.
  channelSourceIds = channelSourceIds
    || (isVideo ? (cfg.channelSourceIdsReel && cfg.channelSourceIdsReel.length ? cfg.channelSourceIdsReel : cfg.channelSourceIds) : cfg.channelSourceIds);
  profileId = profileId || cfg.profileId;
  if (!channelSourceIds || !channelSourceIds.length) {
    throw new Error(`channelSourceIds${isVideo ? ' (reel)' : ''} não definido — rode a calibração ou configure nas settings do mLabs.`);
  }
  if (!profileId) throw new Error('profileId não definido — rode a calibração primeiro.');

  // Carrossel: tira o Threads. Ele corta legenda em 500 chars e, quando a legenda passa
  // disso, o mLabs recusa o POST /schedules inteiro (412 "Limite de caracteres do Threads
  // excedido") — derrubando também o Instagram/Facebook. O comprador está no Instagram, então
  // o carrossel não vai mais pro Threads. Id configurável via settings (default 23 = Threads
  // nesta conta). Reels usam outro conjunto de canais e não passam por aqui.
  if (!isVideo) {
    const exclude = (cfg.excludeChannelSourceIdsImage && cfg.excludeChannelSourceIdsImage.length)
      ? cfg.excludeChannelSourceIdsImage.map(Number)
      : [23];
    const kept = channelSourceIds.filter((id) => !exclude.includes(Number(id)));
    const dropped = channelSourceIds.filter((id) => !kept.includes(id));
    if (dropped.length) console.log(`[mLabs] carrossel: canais removidos (Threads/limite): ${dropped.join(',')}`);
    if (!kept.length) {
      throw new Error(`Sobrou nenhum canal pro carrossel depois de remover o Threads (${channelSourceIds.join(',')}). Ajuste channelSourceIds nas settings do mLabs.`);
    }
    channelSourceIds = kept;
  }

  const { browser } = await connectBrowser();
  try {
    const ctx = await newContext(browser);
    const page = await ensureSession(ctx);
    const auth = await learnAuthHeaders(page);
    const ownerId = cfg.ownerId || (auth['current-profile'] && cfg.ownerId) || cfg.ownerId;

    // 1) sobe cada mídia (ingest + PUT no S3) EM PARALELO. Mantém a ordem dos slides
    //    (Promise.all preserva a ordem do array), que vira a `position` no carrossel.
    const uploads = await Promise.all(
      mediaPaths.map((p) => uploadMedia(page, p, auth, ownerId || profileId, type))
    );

    // 2) espera o mLabs processar e devolver o id numérico de cada uma (em paralelo).
    const { ids, last } = await waitForMediaIds(page, uploads.map((u) => u.uuid), auth);
    const mediaIds = uploads.map((u) => ids[u.uuid]);
    if (mediaIds.some((id) => !id)) {
      const faltou = uploads.filter((u) => !ids[u.uuid]);
      // Despeja a resposta REAL de cada /file/{uuid} que ficou sem id — é o que precisamos
      // ver pra confirmar de onde sai o id numérico, caso ainda não esteja vindo.
      const dump = faltou.map((u) => `${u.uuid} → ${JSON.stringify(last[u.uuid])}`).join(' | ');
      throw new Error(
        `Mídia subiu mas o id numérico não apareceu no processamento. Respostas /file/{uuid}: ${dump}`.slice(0, 1800)
      );
    }

    // 3) cria o agendamento com TODAS as datas
    const { v4: uuidv4 } = require('uuid');
    const payload = buildSchedulePayload({
      caption, mediaIds, type, dates, channelSourceIds, profileId, requestId: uuidv4(),
      youtubeTitle, youtubeShortsChannelId: cfg.youtubeShortsChannelId,
    });
    const res = await apiFetch(
      page,
      MLABS.schedules,
      { method: 'POST', headers: { 'content-type': 'application/vnd.api+json', accept: 'application/vnd.api+json' }, json: payload },
      auth
    );
    if (!res.ok) {
      throw new Error(`POST /schedules falhou (${res.status}): ${JSON.stringify(res.body).slice(0, 400)}`);
    }
    saveSession(await ctx.storageState());
    return { ok: true, mlabsStatus: res.status, dates: dates.map(spToUtcIso), scheduleResponse: res.body };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ── Calibração: roda 1 vez, abre o app real e grava o que dá pra inferir ─────────
// Captura: headers de auth, profileId, channelSourceIds vistos nas chamadas do app,
// e (se possível) o formato da resposta do ingest. Salva nas settings.
async function calibrate() {
  const { browser } = await connectBrowser();
  const seen = { profileIds: new Set(), channelSourceIds: new Set(), ownerIds: new Set() };
  try {
    const ctx = await newContext(browser);
    const page = await ensureSession(ctx);

    page.on('request', (req) => {
      const u = req.url();
      const h = req.headers();
      if (h['current-profile']) seen.profileIds.add(Number(h['current-profile']));
      const pd = req.postData();
      if (pd && /channel-source-ids|profile-ids|ownerId/.test(pd)) {
        try {
          const j = JSON.parse(pd);
          const attr = j?.data?.attributes || j;
          (attr['channel-source-ids'] || []).forEach((x) => seen.channelSourceIds.add(x));
          (attr['profile-ids'] || []).forEach((x) => seen.profileIds.add(x));
          if (j.ownerId) seen.ownerIds.add(Number(j.ownerId));
        } catch (_) {}
      }
    });

    const auth = await learnAuthHeaders(page);
    await page.waitForTimeout(3000);
    saveSession(await ctx.storageState());

    const result = {
      auth: { 'accept-version': auth['accept-version'], hasAuthorization: !!auth.authorization },
      profileId: [...seen.profileIds][0] || null,
      channelSourceIds: [...seen.channelSourceIds],
      ownerId: [...seen.ownerIds][0] || null,
    };
    // Persiste o que aprendeu (sem sobrescrever com vazio).
    const cur = (db.getMlabsSettings && db.getMlabsSettings()) || {};
    db.setMlabsSettings &&
      db.setMlabsSettings({
        ...cur,
        profileId: result.profileId || cur.profileId,
        channelSourceIds: result.channelSourceIds.length ? result.channelSourceIds : cur.channelSourceIds,
        ownerId: result.ownerId || cur.ownerId,
      });
    return result;
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { scheduleContent, calibrate, computeDefaultDates, spToUtcIso, buildSchedulePayload };
