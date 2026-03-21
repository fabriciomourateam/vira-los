const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const db = require('../db/database');

const UPLOAD_DIR = path.join(__dirname, '../uploads');

function createOAuth2() {
  return new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI
  );
}

async function getAuthenticatedClient() {
  const token = db.getPlatformToken('youtube');
  if (!token) throw new Error('YouTube não conectado. Configure nas Plataformas.');

  const oauth2 = createOAuth2();
  oauth2.setCredentials({
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expiry_date: token.token_expires_at ? new Date(token.token_expires_at).getTime() : undefined,
  });

  // Salva tokens renovados automaticamente
  oauth2.on('tokens', (tokens) => {
    db.setPlatformToken('youtube', {
      access_token: tokens.access_token || token.access_token,
      refresh_token: tokens.refresh_token || token.refresh_token,
      token_expires_at: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : token.token_expires_at,
      user_id: token.user_id,
      username: token.username,
    });
  });

  return oauth2;
}

async function post(_schedule, postData) {
  const auth = await getAuthenticatedClient();
  const youtube = google.youtube({ version: 'v3', auth });

  const caption = postData.caption || postData.content_caption || '';
  const hashtags = postData.hashtags || postData.content_hashtags || '';
  const rawTitle = (caption || postData.content_title || 'Video').substring(0, 97);
  const title = rawTitle.endsWith('#Shorts') ? rawTitle : `${rawTitle} #Shorts`;

  const description = [caption, hashtags, '#Shorts'].filter(Boolean).join('\n\n');

  const tags = hashtags
    .split(/\s+/)
    .filter((t) => t.startsWith('#'))
    .map((t) => t.slice(1))
    .concat(['Shorts']);

  const filePath = path.join(UPLOAD_DIR, postData.file_path);

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title,
        description,
        tags,
        categoryId: '22', // People & Blogs
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      mimeType: 'video/mp4',
      body: fs.createReadStream(filePath),
    },
  });

  return res.data.id;
}

function getAuthUrl() {
  const oauth2 = createOAuth2();
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
    ],
  });
}

async function exchangeCode(code) {
  const oauth2 = createOAuth2();
  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);

  // Busca nome do canal
  const youtube = google.youtube({ version: 'v3', auth: oauth2 });
  const channelRes = await youtube.channels.list({ part: ['snippet'], mine: true });
  const channel = channelRes.data.items?.[0];

  db.setPlatformToken('youtube', {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    user_id: channel?.id || null,
    username: channel?.snippet?.title || 'Canal YouTube',
  });

  return { username: channel?.snippet?.title || 'Canal YouTube' };
}

module.exports = { post, getAuthUrl, exchangeCode, getAuthenticatedClient };
