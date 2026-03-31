require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
// Em produção aceita qualquer origem (Vercel gera URLs dinâmicas)
// Em dev restringe ao localhost
const allowedOrigin = process.env.NODE_ENV === 'production'
  ? '*'
  : [process.env.FRONTEND_URL || 'http://localhost:8080', 'http://localhost:5173'];

app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: '10mb' }));

// Serve arquivos de upload estaticamente (para Instagram consumir a URL pública)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Rotas API ─────────────────────────────────────────────────────────────────
app.use('/api/content',    require('./routes/posts'));
app.use('/api/schedule',   require('./routes/schedule'));
app.use('/api/platforms',  require('./routes/platforms'));
app.use('/api/research',   require('./routes/research'));
app.use('/api/agent',      require('./routes/agent'));
app.use('/api/carousel',   require('./routes/carousel'));

// Health check
app.get('/api/health', (_req, res) =>
  res.json({ ok: true, time: new Date().toISOString() })
);

// ── Inicia Scheduler ──────────────────────────────────────────────────────────
require('./services/schedulerService').start();

// ── Inicia Servidor ───────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 ViralOS Server rodando em http://localhost:${PORT}`);
  console.log(`   → API:     http://localhost:${PORT}/api/health`);
  console.log(`   → Uploads: http://localhost:${PORT}/uploads/\n`);
});
