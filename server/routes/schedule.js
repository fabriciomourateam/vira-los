const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

// GET /api/schedule — lista todos os agendamentos
router.get('/', (_req, res) => {
  res.json(db.getAllSchedules());
});

// POST /api/schedule — cria agendamentos
// Aceita múltiplas datas e plataformas → cria um registro por data
// Body: { content_item_id, platforms: string[], dates: string[], caption, hashtags, repeat_rule }
router.post('/', (req, res) => {
  try {
    const { content_item_id, platforms, dates, caption, hashtags, repeat_rule } = req.body;

    if (!content_item_id) return res.status(400).json({ error: 'content_item_id obrigatório' });
    if (!platforms?.length) return res.status(400).json({ error: 'Selecione ao menos 1 plataforma' });
    if (!dates?.length) return res.status(400).json({ error: 'Adicione ao menos 1 data' });

    const created = [];
    for (const date of dates) {
      const s = {
        id: uuidv4(),
        content_item_id,
        platforms: JSON.stringify(platforms),
        caption: caption || '',
        hashtags: hashtags || '',
        scheduled_for: date,
        repeat_rule: repeat_rule ? JSON.stringify(repeat_rule) : 'none',
      };
      db.createSchedule(s);
      created.push(s);
    }
    res.json(created);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/schedule/:id
router.delete('/:id', (req, res) => {
  try {
    db.deleteSchedule(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/schedule/:id/trigger — força publicação imediata (debug / reprocessamento)
router.post('/:id/trigger', async (req, res) => {
  try {
    const schedule = db.getSchedule(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Agendamento não encontrado' });
    const { processSchedule } = require('../services/schedulerService');
    await processSchedule(schedule);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/schedule/:id/retry — resetar status e retentar publicação
router.post('/:id/retry', async (req, res) => {
  try {
    const schedule = db.getSchedule(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Agendamento não encontrado' });
    db.updateScheduleStatus(schedule.id, 'pending', null, null);
    const fresh = db.getSchedule(req.params.id);
    const { processSchedule } = require('../services/schedulerService');
    await processSchedule(fresh);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/schedule/generate-caption — gera legenda com Claude
router.post('/generate-caption', async (req, res) => {
  try {
    const { title, platform, keywords } = req.body;
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(400).json({ error: 'ANTHROPIC_API_KEY não configurada' });
    }
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Crie uma legenda viral para um post de ${platform || 'Instagram/TikTok'} sobre: "${title || 'conteúdo de saúde e bem-estar'}".
${keywords ? `Palavras-chave: ${keywords}` : ''}

A legenda deve:
- Ter um gancho forte na primeira linha que gere curiosidade
- Ser envolvente e criar urgência ou conexão emocional
- Ter um CTA claro no final (ex: "Salva esse post", "Comenta abaixo", "Segue pra mais")
- Ter no máximo 3-4 linhas
- Ser natural e autêntica, não genérica

Retorne APENAS a legenda, sem explicações ou aspas.`,
      }],
    });

    res.json({ caption: msg.content[0].text.trim() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
