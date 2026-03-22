const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

async function processSchedule(schedule) {
  db.updateScheduleStatus(schedule.id, 'posting');

  const platforms = JSON.parse(schedule.platforms || '[]');
  const results = [];

  for (const platform of platforms) {
    try {
      let externalId;

      if (platform === 'instagram') {
        const ig = require('./instagram');
        externalId = await ig.post(schedule, schedule);
      } else if (platform === 'tiktok') {
        const tt = require('./tiktok');
        externalId = await tt.post(schedule, schedule);
      } else if (platform === 'youtube') {
        const yt = require('./youtube');
        externalId = await yt.post(schedule, schedule);
      }

      db.logPostResult({ id: uuidv4(), scheduled_post_id: schedule.id, platform, platform_post_id: externalId || null, status: 'success' });

      console.log(`✅ [${platform}] Publicado: "${schedule.content_title}" → ${externalId}`);
      results.push({ platform, success: true });
    } catch (err) {
      console.error(`❌ [${platform}] Falha em "${schedule.content_title}": ${err.message}`);
      db.logPostResult({ id: uuidv4(), scheduled_post_id: schedule.id, platform, status: 'failed', error_message: err.message });
      results.push({ platform, success: false, error: err.message });
    }
  }

  const allSuccess = results.every((r) => r.success);
  const anySuccess = results.some((r) => r.success);
  const errors = results
    .filter((r) => !r.success)
    .map((r) => `${r.platform}: ${r.error}`)
    .join('; ');

  const finalStatus = allSuccess ? 'done' : anySuccess ? 'partial' : 'failed';
  db.updateScheduleStatus(
    schedule.id,
    finalStatus,
    errors || null,
    anySuccess ? new Date().toISOString() : null
  );

  // Agenda próxima repetição se tudo funcionou
  if (allSuccess && schedule.repeat_rule && schedule.repeat_rule !== 'none') {
    scheduleNextRepeat(schedule);
  }
}

function scheduleNextRepeat(schedule) {
  try {
    const rule = JSON.parse(schedule.repeat_rule);
    if (!rule || rule.type === 'none') return;

    const current = new Date(schedule.scheduled_for);
    let next;

    if (rule.type === 'daily') {
      next = new Date(current.getTime() + rule.interval * 24 * 3600 * 1000);
    } else if (rule.type === 'weekly') {
      next = new Date(current.getTime() + rule.interval * 7 * 24 * 3600 * 1000);
    } else if (rule.type === 'monthly') {
      next = new Date(current);
      next.setMonth(next.getMonth() + rule.interval);
    }

    if (!next) return;
    if (rule.end_date && next > new Date(rule.end_date)) {
      console.log(`🔁 Série finalizada: ${schedule.content_title}`);
      return;
    }

    db.createSchedule({
      id: uuidv4(),
      content_item_id: schedule.content_item_id,
      platforms: schedule.platforms,
      caption: schedule.caption,
      hashtags: schedule.hashtags,
      scheduled_for: next.toISOString(),
      repeat_rule: schedule.repeat_rule,
    });

    console.log(`🔁 Próxima repetição de "${schedule.content_title}" → ${next.toLocaleDateString('pt-BR')}`);
  } catch (e) {
    console.error('Erro ao agendar repetição:', e.message);
  }
}

function start() {
  let running = false;

  // Roda a cada minuto
  cron.schedule('* * * * *', async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date().toISOString();
      const pending = db.getPendingSchedules(now);
      if (pending.length > 0) {
        console.log(`⏰ Processando ${pending.length} post(s) agendado(s)...`);
        for (const s of pending) {
          await processSchedule(s);
        }
      }
    } catch (e) {
      console.error('Scheduler error:', e.message);
    } finally {
      running = false;
    }
  });

  console.log('⏰ Scheduler iniciado — verificando a cada minuto');
}

module.exports = { start, processSchedule };
