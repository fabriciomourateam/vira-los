/**
 * igAccounts.js — contas EXTRAS de Instagram (ex.: mentoria) via Instagram Login.
 *
 * Fica separado da conexão principal (instagram_token, usada pelo Analytics/FMTeam):
 * conectar uma conta aqui NUNCA mexe na conta principal.
 *
 * GET  /api/ig-accounts                     → lista contas conectadas (sem token)
 * GET  /api/ig-accounts/connect?key=mentoria → redireciona pro login do Instagram
 *      (o retorno cai em /api/instagram/callback com state=acct:<key>, que chama handleCallback)
 * POST /api/ig-accounts/:key/schedule        → { images:[base64 jpeg|png], caption, scheduledFor }
 * GET  /api/ig-accounts/schedules            → lista agendamentos
 * DELETE /api/ig-accounts/schedules/:id      → cancela agendamento pendente
 * POST /api/ig-accounts/run-due              → publica o que já venceu (chamado no horário;
 *                                              a requisição acorda a máquina do Fly)
 */

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const sharp = (() => { try { return require('sharp'); } catch { return null; } })();
const { exchangeCodeForToken, getIGUserInfo } = require('../services/instagramService');
const db = require('../db/database');

const router = express.Router();
const IG_GRAPH = 'https://graph.instagram.com/v21.0';
const IG_OAUTH = 'https://www.instagram.com/oauth/authorize';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PUB_DIR = path.join(DATA_DIR, 'output', 'igpub');
const SERVER_URL = process.env.SERVER_URL || 'https://vira-los.fly.dev';
const FRONTEND_URL = process.env.FRONTEND_URL || SERVER_URL;
const KEY_RE = /^[a-z0-9_-]{2,32}$/;

const getAccounts = () => db.readObj('ig_accounts');
const saveAccounts = (a) => db.writeObj('ig_accounts', a);
const getSchedules = () => db.readObj('ig_account_schedules');
const saveSchedules = (s) => db.writeObj('ig_account_schedules', s);

const metaErr = (err) => {
  const e = err.response?.data?.error;
  return e ? `[Meta ${e.code}] ${e.message}` : (err.response?.data?.error_message || err.message);
};

// ─── Conexão ────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const out = Object.entries(getAccounts()).map(([key, a]) => ({
    key, username: a.username, igUserId: a.igUserId, expiresAt: a.expiresAt, connectedAt: a.createdAt,
  }));
  res.json(out);
});

router.get('/connect', (req, res) => {
  const key = String(req.query.key || '').toLowerCase();
  if (!KEY_RE.test(key)) return res.status(400).send('key inválida (ex.: ?key=mentoria)');
  const appId = process.env.INSTAGRAM_APP_ID;
  if (!appId) return res.status(503).send('INSTAGRAM_APP_ID não configurado.');
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI || `${SERVER_URL}/api/instagram/callback`;
  const scope = ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_insights'].join(',');
  const url = `${IG_OAUTH}?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}`
    + `&response_type=code&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent('acct:' + key)}`
    + '&force_reauth=true';
  res.redirect(url);
});

// Chamado por /api/instagram/callback quando state = acct:<key>
async function handleCallback(req, res, key) {
  const { code, error, error_description } = req.query;
  if (error || !code) {
    return res.redirect(`${FRONTEND_URL}?ig_error=${encodeURIComponent(error_description || error || 'Acesso negado')}`);
  }
  try {
    const { accessToken, userId } = await exchangeCodeForToken(code);
    const info = await getIGUserInfo(accessToken);
    const accounts = getAccounts();
    accounts[key] = {
      accessToken,
      igUserId: String(info.user_id || userId),
      username: info.username,
      expiresAt: new Date(Date.now() + 60 * 864e5).toISOString(),
      createdAt: new Date().toISOString(),
    };
    saveAccounts(accounts);
    res.send(`<html><body style="font-family:sans-serif;padding:40px"><h2>✅ @${info.username} conectada como "${key}"</h2><p>Pode fechar esta aba.</p></body></html>`);
  } catch (err) {
    console.error('[igAccounts/callback]', metaErr(err));
    res.status(500).send(`<html><body style="font-family:sans-serif;padding:40px"><h2>❌ Falhou</h2><p>${metaErr(err)}</p></body></html>`);
  }
}

// Renova o token (vale 60 dias) quando faltar menos de 20 dias.
async function ensureFresh(key) {
  const accounts = getAccounts();
  const a = accounts[key];
  if (!a) throw new Error(`Conta "${key}" não conectada.`);
  const left = new Date(a.expiresAt || 0) - Date.now();
  if (left < 20 * 864e5) {
    try {
      const r = await axios.get('https://graph.instagram.com/refresh_access_token', {
        params: { grant_type: 'ig_refresh_token', access_token: a.accessToken }, timeout: 15000,
      });
      if (r.data.access_token) {
        a.accessToken = r.data.access_token;
        a.expiresAt = new Date(Date.now() + (r.data.expires_in || 60 * 86400) * 1000).toISOString();
        accounts[key] = a;
        saveAccounts(accounts);
      }
    } catch (err) {
      console.warn('[igAccounts] refresh falhou:', metaErr(err));
    }
  }
  return a;
}

// ─── Publicação ─────────────────────────────────────────────────────────────

async function waitReady(id, token) {
  for (let i = 0; i < 40; i++) {
    const r = await axios.get(`${IG_GRAPH}/${id}`, { params: { fields: 'status_code', access_token: token }, timeout: 15000 });
    if (r.data.status_code === 'FINISHED') return;
    if (r.data.status_code === 'ERROR') throw new Error(`container ${id} com erro`);
    await new Promise((ok) => setTimeout(ok, 3000));
  }
  throw new Error(`container ${id} não ficou pronto`);
}

async function publish(acc, imageUrls, caption) {
  const t = acc.accessToken;
  const base = `${IG_GRAPH}/${acc.igUserId}`;
  let creationId;
  if (imageUrls.length === 1) {
    const r = await axios.post(`${base}/media`, null, { params: { image_url: imageUrls[0], caption, access_token: t }, timeout: 60000 });
    creationId = r.data.id;
  } else {
    const children = [];
    for (const u of imageUrls) {
      const r = await axios.post(`${base}/media`, null, { params: { image_url: u, is_carousel_item: true, access_token: t }, timeout: 60000 });
      children.push(r.data.id);
    }
    for (const c of children) await waitReady(c, t);
    const r = await axios.post(`${base}/media`, null, {
      params: { media_type: 'CAROUSEL', children: children.join(','), caption, access_token: t }, timeout: 60000,
    });
    creationId = r.data.id;
  }
  await waitReady(creationId, t);
  const r = await axios.post(`${base}/media_publish`, null, { params: { creation_id: creationId, access_token: t }, timeout: 60000 });
  return r.data.id;
}

// ─── Agendamento ────────────────────────────────────────────────────────────

router.post('/:key/schedule', async (req, res) => {
  const key = req.params.key;
  if (!getAccounts()[key]) return res.status(404).json({ error: `Conta "${key}" não conectada.` });
  const { images, caption = '', scheduledFor } = req.body || {};
  if (!Array.isArray(images) || images.length < 1 || images.length > 10) {
    return res.status(400).json({ error: 'images: 1 a 10 imagens em base64.' });
  }
  const when = new Date(scheduledFor);
  if (isNaN(when)) return res.status(400).json({ error: 'scheduledFor inválido (ISO 8601).' });

  const id = uuidv4();
  const dir = path.join(PUB_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const urls = [];
  try {
    for (let i = 0; i < images.length; i++) {
      let buf = Buffer.from(String(images[i]).replace(/^data:[^,]+,/, ''), 'base64');
      // Instagram só aceita JPEG; converte PNG e limita a 1080 de largura.
      if (sharp) buf = await sharp(buf).resize({ width: 1080, withoutEnlargement: true }).flatten({ background: '#000' }).jpeg({ quality: 90 }).toBuffer();
      const name = `${String(i + 1).padStart(2, '0')}.jpg`;
      fs.writeFileSync(path.join(dir, name), buf);
      urls.push(`${SERVER_URL}/output/igpub/${id}/${name}`);
    }
  } catch (err) {
    return res.status(400).json({ error: 'Imagem inválida: ' + err.message });
  }
  const all = getSchedules();
  all[id] = { id, key, imageUrls: urls, caption, scheduledFor: when.toISOString(), status: 'pending', createdAt: new Date().toISOString() };
  saveSchedules(all);
  res.json(all[id]);
});

router.get('/schedules', (req, res) => {
  res.json(Object.values(getSchedules()).sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor)));
});

router.delete('/schedules/:id', (req, res) => {
  const all = getSchedules();
  const s = all[req.params.id];
  if (!s) return res.status(404).json({ error: 'não encontrado' });
  if (s.status !== 'pending') return res.status(400).json({ error: `status ${s.status}, não dá pra cancelar` });
  s.status = 'canceled';
  saveSchedules(all);
  res.json(s);
});

let running = false;
async function runDue() {
  if (running) return [];
  running = true;
  const done = [];
  try {
    const nowIso = new Date().toISOString();
    for (const s of Object.values(getSchedules())) {
      if (s.status !== 'pending' || s.scheduledFor > nowIso) continue;
      const all = getSchedules();
      all[s.id].status = 'posting';
      saveSchedules(all);
      try {
        const acc = await ensureFresh(s.key);
        const mediaId = await publish(acc, s.imageUrls, s.caption);
        Object.assign(all[s.id], { status: 'done', mediaId, postedAt: new Date().toISOString() });
        console.log(`✅ [ig:${s.key}] publicado ${mediaId}`);
      } catch (err) {
        Object.assign(all[s.id], { status: 'failed', error: metaErr(err) });
        console.error(`❌ [ig:${s.key}]`, metaErr(err));
      }
      saveSchedules(all);
      done.push(all[s.id]);
    }
  } finally {
    running = false;
  }
  return done;
}

router.post('/run-due', async (req, res) => {
  res.json({ processed: await runDue() });
});

module.exports = router;
module.exports.handleCallback = handleCallback;
module.exports.runDue = runDue;
