/**
 * reelPipelineService.js — Orquestra: vídeo cru → render → videoPath → agendar.
 *
 * É o seam compartilhado entre a rota manual (POST /api/reels/saved/:id/render)
 * e a rotina diária (dailyContentService), pra não duplicar a lógica de
 * escolher clipe, queimar texto e agendar no mLabs.
 *
 *   renderReelVideo(reelId, {rawVideoId?})  → queima o texto e grava videoPath
 *   scheduleReelNow(reelId, {...})          → agenda no próximo slot livre
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { renderReel } = require('./reelRenderService');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../uploads');
const RENDERED_DIR = path.join(UPLOADS_DIR, 'reels', 'rendered');

function mlabs() {
  return require('./mlabsService');
}

/**
 * Renderiza o reel: pega um clipe cru (informado ou auto-pick do banco), queima
 * a fraseTela/ctaTela e grava o resultado em reel.videoPath.
 * @returns {Promise<{ outPath, rawVideoId }>}
 */
async function renderReelVideo(reelId, { rawVideoId = null } = {}) {
  const reel = db.getReel(reelId);
  if (!reel) throw new Error('Reel não encontrado.');
  if (!reel.fraseTela || !String(reel.fraseTela).trim()) {
    throw new Error('Esse reel não tem fraseTela (gancho de tela). Gere o reel curto antes de renderizar.');
  }

  const raw = rawVideoId ? db.getRawVideo(rawVideoId) : db.pickUnusedRawVideo();
  if (!raw) throw new Error('Nenhum vídeo cru disponível no banco. Suba um clipe de treino antes.');
  if (!raw.path || !fs.existsSync(raw.path)) {
    throw new Error(`O arquivo do vídeo cru sumiu do disco (${raw.file || raw.id}).`);
  }

  const cfg = db.getMlabsSettings();
  fs.mkdirSync(RENDERED_DIR, { recursive: true });
  const outPath = path.join(RENDERED_DIR, `${reelId}_${Date.now()}.mp4`);

  await renderReel({
    rawVideoPath: raw.path,
    outPath,
    fraseTela: reel.fraseTela,
    fraseTelaTiming: reel.fraseTelaTiming,
    ctaTela: reel.ctaTela,
    ctaTelaTiming: reel.ctaTelaTiming,
    fontFile: cfg.reelFontFile || null,
    fontSize: cfg.reelFontSize || 96,
    ctaColor: cfg.reelCtaColor || undefined,
    ctaAtMiddle: cfg.reelCtaAtMiddle !== false,
  });

  db.updateReel(reelId, {
    videoPath: outPath,
    videoFile: path.basename(outPath),
    rawVideoId: raw.id,
    renderedAt: new Date().toISOString(),
  });
  db.updateRawVideo(raw.id, { used: true, usedByReelId: reelId });

  return { outPath, rawVideoId: raw.id };
}

/**
 * Agenda um reel já renderizado (tem videoPath) no próximo slot livre — ou nas
 * datas passadas. Mesma mecânica da rota /api/mlabs/schedule, registrando o
 * agendamento no histórico do mLabs.
 * @returns {Promise<{ id, dates, mlabsStatus }>}
 */
async function scheduleReelNow(reelId, { dates = null, caption = null, platforms = null } = {}) {
  const reel = db.getReel(reelId);
  if (!reel) throw new Error('Reel não encontrado.');
  if (!reel.videoPath || !fs.existsSync(reel.videoPath)) {
    throw new Error('Reel sem vídeo renderizado — renderize antes de agendar.');
  }

  const cfg = db.getMlabsSettings();
  const finalDates = (dates && dates.length) ? dates : mlabs().computeNextReelSlots(1);
  const cap = caption || reel.legendaPost || reel.legenda || reel.caption || '';
  const youtubeTitle = (reel.title || cap.split('\n')[0] || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const chans = platforms || (cfg.channelSourceIdsReel && cfg.channelSourceIdsReel.length ? cfg.channelSourceIdsReel : undefined);

  const recordId = uuidv4();
  db.createMlabsSchedule({
    id: recordId, contentType: 'reel', contentId: reelId, caption: cap, dates: finalDates,
    platforms: chans || cfg.channelSourceIds, status: 'enviando',
  });

  try {
    const result = await mlabs().scheduleContent({
      type: 'VIDEO',
      mediaPaths: [reel.videoPath],
      caption: cap,
      dates: finalDates,
      channelSourceIds: chans,
      youtubeTitle,
    });
    db.updateMlabsSchedule(recordId, { status: 'agendado', mlabsResponse: result.scheduleResponse || null });
    return { id: recordId, dates: result.dates || finalDates, mlabsStatus: result.mlabsStatus };
  } catch (e) {
    db.updateMlabsSchedule(recordId, { status: 'erro', error: e.message });
    throw e;
  }
}

module.exports = { renderReelVideo, scheduleReelNow, RENDERED_DIR };
