const axios = require('axios');
const db = require('../db/database');

const GRAPH_API = 'https://graph.facebook.com/v21.0';

function getCredentials() {
  const token = db.getPlatformToken('instagram');
  if (!token) throw new Error('Instagram não conectado. Configure nas Plataformas.');
  return { accessToken: token.access_token, userId: token.user_id };
}

// Aguarda container ser processado pela Meta (pode levar até 5 min para vídeos)
async function waitForContainer(containerId, accessToken, maxWaitMs = 300000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await axios.get(`${GRAPH_API}/${containerId}`, {
      params: { fields: 'status_code,status', access_token: accessToken },
    });
    const code = res.data.status_code;
    if (code === 'FINISHED') return;
    if (code === 'ERROR') throw new Error(`Erro no container Instagram: ${JSON.stringify(res.data.status)}`);
    await new Promise((r) => setTimeout(r, 8000));
  }
  throw new Error('Timeout aguardando processamento do container Instagram (5 min)');
}

async function publishContainer(userId, containerId, accessToken) {
  const res = await axios.post(`${GRAPH_API}/${userId}/media_publish`, null, {
    params: { creation_id: containerId, access_token: accessToken },
  });
  return res.data.id;
}

async function postReel(postData) {
  const { accessToken, userId } = getCredentials();
  const serverUrl = process.env.SERVER_URL || 'http://localhost:3001';
  const videoUrl = `${serverUrl}/uploads/${postData.file_path}`;

  const containerRes = await axios.post(`${GRAPH_API}/${userId}/media`, null, {
    params: {
      media_type: 'REELS',
      video_url: videoUrl,
      caption: buildCaption(postData),
      share_to_feed: true,
      access_token: accessToken,
    },
  });

  await waitForContainer(containerRes.data.id, accessToken);
  return await publishContainer(userId, containerRes.data.id, accessToken);
}

async function postCarousel(postData) {
  const { accessToken, userId } = getCredentials();
  const serverUrl = process.env.SERVER_URL || 'http://localhost:3001';
  const files = JSON.parse(postData.file_path);

  // Cria container para cada imagem
  const itemIds = [];
  for (const file of files) {
    const res = await axios.post(`${GRAPH_API}/${userId}/media`, null, {
      params: {
        image_url: `${serverUrl}/uploads/${file}`,
        is_carousel_item: true,
        access_token: accessToken,
      },
    });
    itemIds.push(res.data.id);
    await new Promise((r) => setTimeout(r, 1000)); // evita rate limit
  }

  // Cria container do carrossel
  const carouselRes = await axios.post(`${GRAPH_API}/${userId}/media`, null, {
    params: {
      media_type: 'CAROUSEL',
      children: itemIds.join(','),
      caption: buildCaption(postData),
      access_token: accessToken,
    },
  });

  return await publishContainer(userId, carouselRes.data.id, accessToken);
}

function buildCaption(post) {
  const caption = post.caption || post.content_caption || '';
  const hashtags = post.hashtags || post.content_hashtags || '';
  return [caption, hashtags].filter(Boolean).join('\n\n');
}

async function post(_schedule, postData) {
  if (postData.content_type === 'carousel' || postData.type === 'carousel') {
    return postCarousel(postData);
  }
  return postReel(postData);
}

function getAuthUrl() {
  const appId = process.env.INSTAGRAM_APP_ID;
  const redirectUri = encodeURIComponent(process.env.INSTAGRAM_REDIRECT_URI || '');
  const scopes = 'instagram_basic,instagram_content_publish,pages_read_engagement';
  return `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&scope=${scopes}&response_type=code`;
}

async function exchangeCode(code) {
  // Troca code por token de curta duração
  const shortRes = await axios.get(`${GRAPH_API}/oauth/access_token`, {
    params: {
      client_id: process.env.INSTAGRAM_APP_ID,
      client_secret: process.env.INSTAGRAM_APP_SECRET,
      redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
      code,
    },
  });

  // Troca por token de longa duração (60 dias)
  const longRes = await axios.get(`${GRAPH_API}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: process.env.INSTAGRAM_APP_ID,
      client_secret: process.env.INSTAGRAM_APP_SECRET,
      fb_exchange_token: shortRes.data.access_token,
    },
  });

  const accessToken = longRes.data.access_token;
  const expiresAt = new Date(Date.now() + longRes.data.expires_in * 1000).toISOString();

  // Busca o ID da conta Instagram Business vinculada
  const pagesRes = await axios.get(`${GRAPH_API}/me/accounts`, {
    params: { access_token: accessToken },
  });
  const page = pagesRes.data.data[0];
  const pageIgRes = await axios.get(`${GRAPH_API}/${page.id}`, {
    params: { fields: 'instagram_business_account', access_token: accessToken },
  });
  const igUserId = pageIgRes.data.instagram_business_account?.id;
  if (!igUserId) throw new Error('Conta Instagram Business não encontrada. Vincule ao Facebook.');

  const profileRes = await axios.get(`${GRAPH_API}/${igUserId}`, {
    params: { fields: 'username', access_token: accessToken },
  });

  db.setPlatformToken('instagram', {
    access_token: accessToken,
    token_expires_at: expiresAt,
    user_id: igUserId,
    username: profileRes.data.username,
  });

  return { username: profileRes.data.username };
}

module.exports = { post, getAuthUrl, exchangeCode };
