/**
 * reelRenderService.js — Queima o texto-gancho no vídeo cru de treino (ffmpeg).
 *
 * Entrada: um clipe VERTICAL 9:16 gravado pelo Fabricio (sem texto) + a
 * `fraseTela` (e o `ctaTela`) que o reelsGeneratorService já produz. Saída:
 * um .mp4 com o texto queimado no estilo que ele já usa hoje — branco, negrito,
 * contorno + sombra preta, centralizado, no terço inferior do quadro — pronto
 * pra ir pro `videoPath` do reel e reaproveitar 100% o fluxo de agendamento.
 *
 * O ffmpeg só existe na imagem Docker (produção). Por isso a montagem do
 * comando é feita por funções puras e testáveis (buildDrawtextFilter,
 * parseTiming, wrapText) — dá pra validar a lógica sem o binário instalado.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ── Fonte ────────────────────────────────────────────────────────────────────
// Preferimos uma fonte pesada bundlada (o Fabricio pode dropar a dele em
// server/assets/fonts/reel.ttf); senão caímos numa sans bold do sistema que
// o Dockerfile garante (fonts-liberation → LiberationSans-Bold).
const FONT_CANDIDATES = [
  path.join(__dirname, '../assets/fonts/reel.ttf'),
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
];

function resolveFont(preferred) {
  const list = preferred ? [preferred, ...FONT_CANDIDATES] : FONT_CANDIDATES;
  for (const f of list) {
    try { if (f && fs.existsSync(f)) return f; } catch { /* ignora */ }
  }
  // Sem fonte no disco: retorna a primeira do sistema mesmo assim (o ffmpeg
  // dará um erro claro em runtime, capturado por renderReel).
  return FONT_CANDIDATES[1];
}

// ── Timing ("0-4s" → { start, end }) ─────────────────────────────────────────
function parseTiming(str, fallbackStart, fallbackEnd) {
  const m = String(str || '').match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  if (!m) return { start: fallbackStart, end: fallbackEnd };
  const start = parseFloat(m[1]);
  const end = parseFloat(m[2]);
  if (!(end > start)) return { start: fallbackStart, end: fallbackEnd };
  return { start, end };
}

// ── Quebra de linha (mantém o texto GRANDE, no máx `maxLines` linhas) ─────────
function wrapText(text, maxChars, maxLines) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const tentative = cur ? `${cur} ${w}` : w;
    if (tentative.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = tentative;
    }
  }
  if (cur) lines.push(cur);
  if (maxLines && lines.length > maxLines) {
    // Junta o excedente na última linha permitida (não descarta palavra nenhuma).
    const head = lines.slice(0, maxLines - 1);
    const tail = lines.slice(maxLines - 1).join(' ');
    return [...head, tail];
  }
  return lines;
}

// Escapa o conteúdo que vai pro `textfile` do drawtext não é necessário
// (arquivo é lido cru), mas caminhos/paths no filtro precisam de cuidado com
// aspas simples. Nossos paths são controlados (uploads/tmp), então basta
// garantir que não haja aspas simples neles.
function assertSafePath(p, label) {
  if (/['\n]/.test(p)) throw new Error(`Caminho inválido para ${label}: ${p}`);
  return p;
}

/**
 * Monta a string do filtro -vf (função pura, testável sem ffmpeg).
 * @returns {string}
 */
function buildDrawtextFilter(opts) {
  const {
    fraseFile,
    ctaFile,
    fontFile,
    frase = { start: 0, end: 4 },
    cta = { start: 4, end: 5 },
    fontSize = 96,
    targetWidth = 1080,
    fraseY = 'h*0.58',
    ctaY = 'h*0.80',
  } = opts;

  assertSafePath(fraseFile, 'fraseFile');
  assertSafePath(fontFile, 'fontFile');
  if (ctaFile) assertSafePath(ctaFile, 'ctaFile');

  const border = Math.max(4, Math.round(fontSize * 0.06));
  const lineSpacing = Math.max(4, Math.round(fontSize * 0.12));
  const ctaSize = Math.max(28, Math.round(fontSize * 0.62));
  const ctaBorder = Math.max(3, Math.round(ctaSize * 0.06));

  const common = (file, size, bw, y, timing, extra = '') =>
    `drawtext=textfile='${file}':fontfile='${fontFile}':` +
    `fontcolor=white:fontsize=${size}:borderw=${bw}:bordercolor=black:` +
    `shadowcolor=black@0.6:shadowx=2:shadowy=2:${extra}` +
    `x=(w-text_w)/2:y=${y}:enable='between(t,${timing.start},${timing.end})'`;

  const parts = [
    // Normaliza pra 1080 de largura mantendo o 9:16 (altura par).
    `scale=${targetWidth}:-2`,
    common(fraseFile, fontSize, border, fraseY, frase, `line_spacing=${lineSpacing}:`),
  ];
  if (ctaFile) {
    parts.push(common(ctaFile, ctaSize, ctaBorder, ctaY, cta));
  }
  return parts.join(',');
}

/**
 * Renderiza o reel: queima fraseTela (+ ctaTela) no vídeo cru.
 * @returns {Promise<{ outPath: string, filter: string }>}
 */
async function renderReel({
  rawVideoPath,
  outPath,
  fraseTela,
  fraseTelaTiming,
  ctaTela,
  ctaTelaTiming,
  fontFile,
  fontSize = 96,
  tmpDir,
}) {
  if (!rawVideoPath || !fs.existsSync(rawVideoPath)) {
    throw new Error(`Vídeo cru não encontrado: ${rawVideoPath}`);
  }
  if (!fraseTela || !String(fraseTela).trim()) {
    throw new Error('fraseTela vazia — nada pra escrever na tela.');
  }
  if (!outPath) throw new Error('outPath obrigatório.');

  const font = resolveFont(fontFile);
  const work = tmpDir || path.dirname(outPath);
  fs.mkdirSync(work, { recursive: true });

  // Timings: default fraseTela 0-4s, cta logo depois. Se o vídeo for mais
  // curto, o between() simplesmente não dispara — sem quebrar.
  const frase = parseTiming(fraseTelaTiming, 0, 4);
  const cta = parseTiming(ctaTelaTiming, frase.end, frase.end + 1.5);

  // Quebra a frase em no máx 2 linhas (o gerador já limita a ≤12 palavras).
  const wrapChars = Math.max(12, Math.floor(1000 / (fontSize * 0.52)));
  const fraseWrapped = wrapText(fraseTela, wrapChars, 2).join('\n');

  const stamp = `${Date.now()}_${Math.round(process.hrtime()[1] / 1000)}`;
  const fraseFile = path.join(work, `.frase_${stamp}.txt`);
  fs.writeFileSync(fraseFile, fraseWrapped, 'utf8');

  let ctaFile = null;
  if (ctaTela && String(ctaTela).trim()) {
    ctaFile = path.join(work, `.cta_${stamp}.txt`);
    fs.writeFileSync(ctaFile, wrapText(ctaTela, wrapChars + 6, 2).join('\n'), 'utf8');
  }

  const filter = buildDrawtextFilter({
    fraseFile, ctaFile, fontFile: font, frase, cta, fontSize,
  });

  const args = [
    '-y',
    '-i', rawVideoPath,
    '-vf', filter,
    '-map', '0:v:0',
    '-map', '0:a:0?',        // áudio opcional (clipe de treino pode não ter)
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outPath,
  ];

  const cleanup = () => {
    for (const f of [fraseFile, ctaFile]) {
      try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignora */ }
    }
  };

  await new Promise((resolve, reject) => {
    let stderr = '';
    let proc;
    try {
      proc = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args);
    } catch (e) {
      cleanup();
      return reject(new Error(`Falha ao iniciar o ffmpeg: ${e.message}`));
    }
    proc.stderr.on('data', (d) => { stderr += d.toString(); if (stderr.length > 20000) stderr = stderr.slice(-20000); });
    proc.on('error', (e) => {
      cleanup();
      reject(new Error(e.code === 'ENOENT'
        ? 'ffmpeg não encontrado no ambiente. (Existe na imagem Docker de produção.)'
        : `Erro no ffmpeg: ${e.message}`));
    });
    proc.on('close', (code) => {
      cleanup();
      if (code === 0 && fs.existsSync(outPath)) return resolve();
      reject(new Error(`ffmpeg saiu com código ${code}. Trecho do log:\n${stderr.slice(-1200)}`));
    });
  });

  return { outPath, filter };
}

module.exports = {
  renderReel,
  buildDrawtextFilter,
  parseTiming,
  wrapText,
  resolveFont,
  FONT_CANDIDATES,
};
