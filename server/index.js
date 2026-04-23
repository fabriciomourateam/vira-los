require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Aumenta timeout do servidor para 5 minutos (Playwright + Claude pode demorar)
const server = require('http').createServer(app);
server.timeout = 300000;
server.keepAliveTimeout = 300000;
server.headersTimeout = 310000;

// Serve arquivos de upload estaticamente (para Instagram consumir a URL pública)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve slides PNG e HTML dos carrosseis gerados
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
app.use('/output', express.static(path.join(DATA_DIR, 'output')));

// ── Rotas API ─────────────────────────────────────────────────────────────────
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
