// Google Search Console — reusa o MESMO cliente OAuth do YouTube
// (YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET), só com escopo de leitura do GSC.
const { google } = require('googleapis');
const db = require('../db/database');

const REDIRECT_URI =
  process.env.GSC_REDIRECT_URI ||
  `${(process.env.SERVER_URL || 'https://vira-los.fly.dev').replace(/\/+$/, '')}/api/platforms/gsc/callback`;

const SCOPE = ['https://www.googleapis.com/auth/webmasters.readonly'];

function createOAuth2() {
  return new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    REDIRECT_URI
  );
}

function getAuthUrl() {
  return createOAuth2().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPE });
}

async function getAuthenticatedClient() {
  const token = db.getPlatformToken('gsc');
  if (!token) throw new Error('Search Console não conectado. Conecte na página de SEO.');
  const oauth2 = createOAuth2();
  oauth2.setCredentials({
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expiry_date: token.token_expires_at ? new Date(token.token_expires_at).getTime() : undefined,
  });
  oauth2.on('tokens', (t) => {
    db.setPlatformToken('gsc', {
      ...token,
      access_token: t.access_token || token.access_token,
      refresh_token: t.refresh_token || token.refresh_token,
      token_expires_at: t.expiry_date ? new Date(t.expiry_date).toISOString() : token.token_expires_at,
    });
  });
  return oauth2;
}

async function exchangeCode(code) {
  const oauth2 = createOAuth2();
  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);

  // Descobre as propriedades verificadas e escolhe a do fabriciomoura
  const wm = google.webmasters({ version: 'v3', auth: oauth2 });
  const sitesRes = await wm.sites.list();
  const sites = (sitesRes.data.siteEntry || []).map((s) => s.siteUrl);
  const site = sites.find((s) => /fabriciomoura/i.test(s)) || sites[0] || 'https://fabriciomoura.com/';

  db.setPlatformToken('gsc', {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    site_url: site,
    sites,
    username: site,
  });
  return { site, sites };
}

const ymd = (d) => d.toISOString().slice(0, 10);

async function runQuery(auth, siteUrl, body) {
  const wm = google.webmasters({ version: 'v3', auth });
  const res = await wm.searchanalytics.query({ siteUrl, requestBody: body });
  return res.data.rows || [];
}

// Painel: totais + série diária (tendência) + top queries + top páginas
async function getDashboard({ days = 28 } = {}) {
  const token = db.getPlatformToken('gsc');
  if (!token) throw new Error('Search Console não conectado.');
  const auth = await getAuthenticatedClient();
  const siteUrl = token.site_url;

  const end = new Date();
  end.setDate(end.getDate() - 2); // dados do GSC atrasam ~2-3 dias
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  const range = { startDate: ymd(start), endDate: ymd(end) };

  const [byDate, byQuery, byPage] = await Promise.all([
    runQuery(auth, siteUrl, { ...range, dimensions: ['date'], rowLimit: 1000 }),
    runQuery(auth, siteUrl, { ...range, dimensions: ['query'], rowLimit: 25 }),
    runQuery(auth, siteUrl, { ...range, dimensions: ['page'], rowLimit: 25 }),
  ]);

  const sum = byDate.reduce(
    (a, r) => ({ clicks: a.clicks + r.clicks, impressions: a.impressions + r.impressions }),
    { clicks: 0, impressions: 0 }
  );
  const posWeighted = byDate.reduce((a, r) => a + r.position * r.impressions, 0);

  return {
    siteUrl,
    range,
    totals: {
      clicks: sum.clicks,
      impressions: sum.impressions,
      ctr: sum.impressions ? sum.clicks / sum.impressions : 0,
      position: sum.impressions ? posWeighted / sum.impressions : 0,
    },
    byDate: byDate.map((r) => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: r.position })),
    topQueries: byQuery.map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
    topPages: byPage.map((r) => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
  };
}

module.exports = { getAuthUrl, exchangeCode, getDashboard, getAuthenticatedClient };
