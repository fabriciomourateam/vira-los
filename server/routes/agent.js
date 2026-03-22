/**
 * agent.js — Rotas do Agente Autônomo
 *
 * POST /api/agent/start          → inicia a pesquisa
 * GET  /api/agent/stream         → SSE com updates em tempo real
 * GET  /api/agent/status         → status atual (polling fallback)
 * POST /api/agent/schedule       → agenda execução diária (cron)
 * DELETE /api/agent/schedule     → remove agendamento
 * GET  /api/agent/schedule       → retorna horário agendado
 */

const express = require('express');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { runAgent, getState, sseClients, getCredentials, saveCredentials } = require('../services/agentService');

const router = express.Router();
const SCHEDULE_FILE = path.join(__dirname, '../db/agent-schedule.json');

let scheduledTask = null;

// ─── SSE: stream de eventos em tempo real ─────────────────────────────────────

router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Envia estado atual imediatamente para quem se conecta no meio do processo
  const state = getState();
  res.write(`data: ${JSON.stringify({ type: 'state', state })}\n\n`);

  sseClients.add(res);

  // Heartbeat a cada 20s para manter a conexão viva
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// ─── Inicia pesquisa ──────────────────────────────────────────────────────────

router.post('/start', async (req, res) => {
  const { keyword, platforms } = req.body;

  if (!keyword || !keyword.trim()) {
    return res.status(400).json({ error: 'Palavra-chave obrigatória' });
  }

  const state = getState();
  if (state.running) {
    return res.status(409).json({ error: 'Agente já está em execução' });
  }

  // Inicia de forma assíncrona — a resposta vem pelo SSE
  runAgent({
    keyword: keyword.trim(),
    platforms: platforms || ['tiktok', 'instagram', 'youtube'],
  }).catch(err => console.error('[Agent Route] Erro não capturado:', err));

  res.json({ ok: true, message: 'Agente iniciado. Acompanhe pelo stream SSE.' });
});

// ─── Status (polling fallback) ────────────────────────────────────────────────

router.get('/status', (req, res) => {
  res.json(getState());
});

// ─── Agendamento diário ───────────────────────────────────────────────────────

function loadSchedule() {
  if (!fs.existsSync(SCHEDULE_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8')); }
  catch (_) { return null; }
}

function saveSchedule(data) {
  fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(data, null, 2));
}

function applySchedule(scheduleData) {
  if (scheduledTask) { scheduledTask.stop(); scheduledTask = null; }
  if (!scheduleData || !scheduleData.active) return;

  const { hour, minute, keyword, platforms } = scheduleData;
  const cronExpr = `${minute} ${hour} * * *`;

  if (!cron.validate(cronExpr)) return;

  scheduledTask = cron.schedule(cronExpr, () => {
    const state = getState();
    if (!state.running) {
      console.log(`[Agent Schedule] Executando pesquisa agendada: "${keyword}"`);
      runAgent({ keyword, platforms }).catch(console.error);
    }
  }, { timezone: 'America/Sao_Paulo' });

  console.log(`[Agent Schedule] Agendado: ${cronExpr} BRT — "${keyword}"`);
}

// Restaura agendamento ao iniciar
const savedSchedule = loadSchedule();
if (savedSchedule?.active) applySchedule(savedSchedule);

router.get('/schedule', (req, res) => {
  res.json(loadSchedule() || { active: false });
});

router.post('/schedule', (req, res) => {
  const { hour, minute, keyword, platforms } = req.body;

  if (hour === undefined || minute === undefined || !keyword) {
    return res.status(400).json({ error: 'hour, minute e keyword são obrigatórios' });
  }

  const data = {
    active: true,
    hour: Number(hour),
    minute: Number(minute),
    keyword: keyword.trim(),
    platforms: platforms || ['tiktok', 'instagram', 'youtube'],
  };

  saveSchedule(data);
  applySchedule(data);
  res.json({ ok: true, schedule: data });
});

router.delete('/schedule', (req, res) => {
  if (scheduledTask) { scheduledTask.stop(); scheduledTask = null; }
  saveSchedule({ active: false });
  res.json({ ok: true });
});

module.exports = router;
