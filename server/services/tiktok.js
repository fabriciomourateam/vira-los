const axios = require('axios');
const fs = require('fs');
const path = require('path');
const db = require('../db/database');

const API_BASE = 'https://open.tiktokapis.com/v2';
const UPLOAD_DIR = path.join(__dirname, '../uploads');

async function getValidToken() {
  const token = db.getPlatformToken('tiktok');
  if (!token) throw new Error('TikTok não conectado. Configure nas Plataformas.');

  // Refresh se vai expirar em menos de 1 hora
  if (token.token_expires_at) {
    const exp = new Date(token.token_expires_at);
    if (exp.getTime() - Date.now() < 3600000) {
      return refreshToken(token);
    }
  }
  return token;
}

async function refreshToken(token) {
  const res = await axios.post(
    'https://open.tiktokapis.com/v2/oauth/token/',
    new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const d = res.data.data;
  db.setPlatformToken('tiktok', {
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    token_expires_at: new Date(Date.now() + d.expires_in * 1000).toISOString(),
    user_id: token.user_id,
    username: token.username,
  });
  return db.getPlatformToken('tiktok');
}

async function post(_schedule, postData) {
  const token = await getValidToken();
  const filePath = path.join(UPLOAD_DIR, postData.file_path);
  const stats = fs.statSync(filePath);
  const fileSize = stats.size;
  const chunkSize = 10 * 1024 * 1024; // 10 MB
  const totalChunks = Math.ceil(fileSize / chunkSize);

  const caption = (postData.caption || postData.content_caption || postData.content_title || '').substring(0, 150);

  // Inicializa upload
  const initRes = await axios.post(
    `${API_BASE}/post/publish/video/init/`,
    {
      post_info: {
        title: caption,
        privacy_level: 'PUBLIC_TO_EVERYONE',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: fileSize,
        chunk_size: chunkSize,
        total_chunk_count: totalChunks,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
    }
  );

  const { publish_id, upload_url } = initRes.data.data;

  // Upload em chunks
  const fd = fs.openSync(filePath, 'r');
  let offset = 0;
  for (let i = 0; i < totalChunks; i++) {
    const remaining = fileSize - offset;
    const size = Math.min(chunkSize, remaining);
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, offset);
    await axios.put(upload_url, buf, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes ${offset}-${offset + size - 1}/${fileSize}`,
        'Content-Length': size,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    offset += size;
  }
  fs.closeSync(fd);

  return publish_id;
}

function getAuthUrl() {
  const params = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    scope: 'user.info.basic,video.upload,video.publish',
    response_type: 'code',
    redirect_uri: process.env.TIKTOK_REDIRECT_URI,
    state: Math.random().toString(36).substring(2),
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params}`;
}

async function exchangeCode(code) {
  const res = await axios.post(
    'https://open.tiktokapis.com/v2/oauth/token/',
    new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: process.env.TIKTOK_REDIRECT_URI,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const d = res.data.data;

  // Busca nome do usuário
  let username = d.open_id;
  try {
    const userRes = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
      headers: { Authorization: `Bearer ${d.access_token}` },
      params: { fields: 'display_name' },
    });
    username = userRes.data.data.user.display_name || username;
  } catch (_) {}

  db.setPlatformToken('tiktok', {
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    token_expires_at: new Date(Date.now() + d.expires_in * 1000).toISOString(),
    user_id: d.open_id,
    username,
  });

  return { username };
}

module.exports = { post, getAuthUrl, exchangeCode };
