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

module.exports = router;
