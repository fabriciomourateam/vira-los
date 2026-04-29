require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

// Tracking de uso do Claude (custo/economia) — patch SDK ANTES de qualquer service ser carregado
const usageTracker = require('./services/usageTracker');
usageTracker.patchAnthropicSDK();

const app = express();
const PORT = process.env.PORT || 3001;

// ── CORS ──────────────────────────────────────────────────────────────────────
// Permite requisições do Vercel (produção) e localhost (dev).
// ALLOWED_ORIGINS pode ser sobrescrito via variável de ambiente no Fly.dev.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const DEFAULT_ORIGINS = [
  'https://vira-los.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:4173',
];

const allowedSet = new Set([...DEFAULT_ORIGINS, ...ALLOWED_ORIGINS]);

app.use(cors({
  origin: (origin, cb) => {
    // Permite chamadas sem origin (curl, Postman, server-to-server)
    if (!origin) return cb(null, true);
    if (allowedSet.has(origin)) return cb(null, true);
    // Permite qualquer subdomínio do Vercel (deploy previews)
    if (/\.vercel\.app$/.test(origin)) return cb(null, true);
    cb(new Error(`CORS bloqueado: ${origin}`));
  },
  credentials: true,
}));

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));

// Sem timeout de socket — geração de carrossel pode levar >5 min (fmteam + Anthropic).
// O controle de timeout fica no cliente (AbortController 6 min em CarrosselInstagram.tsx).
const server = require('http').createServer(app);
server.timeout = 0;           // 0 = desabilitado (sem limite)
server.keepAliveTimeout = 65000;  // 65s — maior que o Fly.dev proxy (60s)
server.headersTimeout = 70000;

// Serve arquivos de upload estaticamente (para Instagram consumir a URL pública)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve slides PNG e HTML dos carrosseis gerados
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
app.use('/output', express.static(path.join(DATA_DIR, 'output')));

// ── Rotas API ─────────────────────────────────────────────────────────────────
// ── Feature tagging para usage tracker ────────────────────────────────────────
// Mapeia URL → label. Middleware roda ANTES dos route handlers; AsyncLocalStorage
// propaga o label até as chamadas Claude dentro dos services.
const FEATURE_PATTERNS = [
  // [pathPrefix, feature] — primeiro match ganha
  ['/api/carousel/regenerate-slide',  'regenerate-slide'],
  ['/api/carousel/generate',          'carousel'],
  ['/api/maquina/headlines',          'maquina-headlines'],
  ['/api/maquina/structure',          'maquina-structure'],
  ['/api/maquina/generate',           'maquina-html'],
  ['/api/maquina/full',               'maquina-full'],
  ['/api/maquina/regenerate-slide',   'regenerate-slide'],
  ['/api/ideas',                      'ideas'],
  ['/api/reels-analyzer',             'reels-analysis'],
  ['/api/viral-score',                'viral-score'],
  ['/api/trend-radar',                'trend-radar'],
  ['/api/story-sequence',             'story-sequence'],
  ['/api/instagram',                  'instagram-analytics'],
  ['/api/agent',                      'agent'],
  ['/api/research',                   'research'],
  ['/api/schedule',                   'schedule'],
];
app.use((req, res, next) => {
  const url = req.path;
  let feature = 'unknown';
  for (const [prefix, label] of FEATURE_PATTERNS) {
    if (url.startsWith(prefix)) { feature = label; break; }
  }
  usageTracker.withFeature(feature, () => next());
});

app.use('/api/usage',           require('./routes/usage'));
app.use('/api/content',         require('./routes/posts'));
app.use('/api/schedule',        require('./routes/schedule'));
app.use('/api/platforms',       require('./routes/platforms'));
app.use('/api/research',        require('./routes/research'));
app.use('/api/agent',           require('./routes/agent'));
app.use('/api/carousel',        require('./routes/carousel'));
app.use('/api/reels-analyzer',  require('./routes/reelsAnalyzer'));
app.use('/api/viral-score',     require('./routes/viralScore'));
app.use('/api/trend-radar',     require('./routes/trendRadar'));
app.use('/api/story-sequence',  require('./routes/storySequence'));
app.use('/api/ideas',           require('./routes/ideas'));
app.use('/api/instagram',       require('./routes/instagram'));
app.use('/api/studio',          require('./routes/studio'));
app.use('/api/brand-kits',      require('./routes/brandKits'));
app.use('/api/maquina',         require('./routes/maquina'));
app.use('/api/pexels',          require('./routes/pexels'));

// Health check
app.get('/api/health', (_req, res) =>
  res.json({ ok: true, time: new Date().toISOString() })
);

// ── Inicia Scheduler ──────────────────────────────────────────────────────────
require('./services/schedulerService').start();

// ── Inicia Servidor ───────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🚀 ViralOS Server rodando em http://localhost:${PORT}`);
  console.log(`   → API:     http://localhost:${PORT}/api/health`);
  console.log(`   → Uploads: http://localhost:${PORT}/uploads/\n`);
});
