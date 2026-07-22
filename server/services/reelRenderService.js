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

// Emojis, símbolos e seletores de variação (a sans do sistema não tem glifo).
const EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{2190}-\u{21FF}]/gu;

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

// Cor do drawtext: só nome (white/yellow), hex (#RRGGBB), 0xRRGGBB ou com @alpha.
function assertSafeColor(c, label) {
  if (!/^(#?[0-9a-fA-F]{3,8}|0x[0-9a-fA-F]{3,8}|[a-zA-Z]+)(@[0-9.]+)?$/.test(String(c))) {
    throw new Error(`Cor inválida para ${label}: ${c}`);
  }
  return c;
}

// Mede a duração do vídeo (segundos) via ffprobe. Retorna null se falhar — o
// render então cai pros timings do texto (comportamento antigo).
function probeDuration(videoPath) {
  return new Promise((resolve) => {
    let out = '';
    let proc;
    try {
      proc = spawn(process.env.FFPROBE_PATH || 'ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', videoPath,
      ]);
    } catch { return resolve(null); }
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      const n = parseFloat(String(out).trim());
      resolve(isFinite(n) && n > 0 ? n : null);
    });
  });
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
    // Estilo calibrado pelos reels reais do Fabricio: gancho branco centralizado
    // (levemente acima do meio) e "Leia a legenda" DOURADO logo abaixo.
    fraseColor = 'white',
    ctaColor = '#F5B301',
    fraseY = '(h-text_h)/2-h*0.03',
    ctaY = 'h*0.60',
  } = opts;

  assertSafeColor(fraseColor, 'fraseColor');
  assertSafeColor(ctaColor, 'ctaColor');
  assertSafePath(fraseFile, 'fraseFile');
  assertSafePath(fontFile, 'fontFile');
  if (ctaFile) assertSafePath(ctaFile, 'ctaFile');

  const border = Math.max(4, Math.round(fontSize * 0.06));
  const lineSpacing = Math.max(4, Math.round(fontSize * 0.12));
  const ctaSize = Math.max(28, Math.round(fontSize * 0.62));
  const ctaBorder = Math.max(3, Math.round(ctaSize * 0.06));

  const common = (file, color, size, bw, y, timing, extra = '') =>
    `drawtext=textfile='${file}':fontfile='${fontFile}':` +
    `fontcolor=${color}:fontsize=${size}:borderw=${bw}:bordercolor=black:` +
    `shadowcolor=black@0.6:shadowx=2:shadowy=2:${extra}` +
    `x=(w-text_w)/2:y=${y}:enable='between(t,${timing.start},${timing.end})'`;

  const parts = [
    // Normaliza pra 1080 de largura mantendo o 9:16 (altura par).
    `scale=${targetWidth}:-2`,
    common(fraseFile, fraseColor, fontSize, border, fraseY, frase, `line_spacing=${lineSpacing}:`),
  ];
  if (ctaFile) {
    parts.push(common(ctaFile, ctaColor, ctaSize, ctaBorder, ctaY, cta));
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
  fraseColor,
  ctaColor,
  ctaAtMiddle = true,   // "Leia a legenda" entra na METADE do vídeo → fim
  textY = 0.6,          // altura do gancho (fração da altura; cta fica ~0.13 abaixo)
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

  // Timings calibrados pelos reels reais: o GANCHO fica o vídeo todo e o
  // "Leia a legenda" entra na METADE do tempo até o fim. Pra isso medimos a
  // duração com ffprobe. Se falhar, cai pros timings do texto (0-4s / 4-5s).
  const dur = await probeDuration(rawVideoPath);
  const fraseStart = parseTiming(fraseTelaTiming, 0, 4).start;
  let frase, cta;
  if (dur && dur > 0) {
    frase = { start: fraseStart, end: Math.round(dur * 100) / 100 };
    cta = ctaAtMiddle
      ? { start: Math.round((dur / 2) * 100) / 100, end: Math.round(dur * 100) / 100 }
      : parseTiming(ctaTelaTiming, dur / 2, dur);
  } else {
    frase = parseTiming(fraseTelaTiming, 0, 4);
    cta = parseTiming(ctaTelaTiming, frase.end, frase.end + 1.5);
  }

  // Emojis não têm glifo na fonte do sistema → viram quadradinho. Remove antes
  // de queimar (ex.: "👇 LEIA A LEGENDA" → "LEIA A LEGENDA").
  const sanitize = (s) => String(s || '').replace(EMOJI_RE, '').replace(/\s+/g, ' ').trim();
  // Largura segura: quebra o texto pra caber DENTRO do quadro (com margem),
  // em quantas linhas precisar — sem forçar 2 linhas e estourar a largura.
  const wrapChars = Math.max(10, Math.floor(900 / (fontSize * 0.55)));
  const fraseWrapped = wrapText(sanitize(fraseTela), wrapChars, 5).join('\n');

  const stamp = `${Date.now()}_${Math.round(process.hrtime()[1] / 1000)}`;
  const fraseFile = path.join(work, `.frase_${stamp}.txt`);
  fs.writeFileSync(fraseFile, fraseWrapped, 'utf8');

  let ctaFile = null;
  if (ctaTela && sanitize(ctaTela)) {
    ctaFile = path.join(work, `.cta_${stamp}.txt`);
    fs.writeFileSync(ctaFile, wrapText(sanitize(ctaTela), wrapChars + 4, 2).join('\n'), 'utf8');
  }

  // Altura: gancho centralizado na fração textY; "Leia a legenda" ~0.13 abaixo.
  const F = Math.max(0.2, Math.min(0.9, Number(textY) || 0.6));
  const ctaF = Math.min(0.92, F + 0.13);
  const fraseY = `h*${F}-text_h/2`;
  const ctaY = `h*${ctaF.toFixed(3)}-text_h/2`;

  const filter = buildDrawtextFilter({
    fraseFile, ctaFile, fontFile: font, frase, cta, fontSize, fraseY, ctaY,
    ...(fraseColor ? { fraseColor } : {}),
    ...(ctaColor ? { ctaColor } : {}),
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
