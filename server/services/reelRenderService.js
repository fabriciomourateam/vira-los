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

// Scrim: gradiente escuro (transparente em cima → preto embaixo) sobreposto no
// vídeo pro texto ficar legível na metade de baixo. PNG bundlado (1080×1920).
const SCRIM_PATH = path.join(__dirname, '../assets/reel-scrim.png');

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
// drawbox/drawtext aceitam melhor 0xRRGGBB — normaliza "#RRGGBB" → "0xRRGGBB".
function ffColor(c) {
  const m = String(c).match(/^#([0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?)$/);
  return m ? `0x${m[1]}` : String(c);
}

// Cada "layer" é UMA linha de texto, centralizada horizontalmente por conta
// própria (x=(w-text_w)/2). Renderizar linha a linha centraliza cada linha —
// o drawtext com \n só centraliza o BLOCO, deixando as linhas à esquerda.
// Layer: { file, color, size, y, timing } + estilo:
//   box=true → caixa preenchida atrás do texto (boxColor, boxBorderW = padding)
//   stroke=true → contorno + sombra preta (border)
// Só a cadeia de drawtexts (sem o scale) — reaproveitada no modo gradiente.
function textChain(layers, fontFile) {
  assertSafePath(fontFile, 'fontFile');
  const draw = (L) => {
    assertSafePath(L.file, 'textfile');
    assertSafeColor(L.color, 'color');
    const boxPart = L.box
      ? `box=1:boxcolor=${ffColor(assertSafeColor(L.boxColor, 'boxColor'))}:boxborderw=${Math.round(L.boxBorderW || 0)}:`
      : '';
    const strokePart = L.stroke
      ? `borderw=${L.border}:bordercolor=black:shadowcolor=black@0.6:shadowx=2:shadowy=2:`
      : '';
    return `drawtext=textfile='${L.file}':fontfile='${fontFile}':` +
      `fontcolor=${ffColor(L.color)}:fontsize=${L.size}:${strokePart}${boxPart}` +
      `x=(w-text_w)/2:y=${L.y}:enable='between(t,${L.timing.start},${L.timing.end})'`;
  };
  return layers.map(draw).join(',');
}

function buildDrawtextFilter(opts) {
  const { layers = [], fontFile, targetWidth = 1080 } = opts;
  // Normaliza pra 1080 de largura mantendo o 9:16 (altura par), depois as linhas.
  return [`scale=${targetWidth}:-2`, textChain(layers, fontFile)].join(',');
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
  textStyle = 'contorno', // 'contorno' (texto + contorno) | 'caixa' (texto em retângulo)
  boxColor = '#F5C518',   // cor da caixa (amarelo) — modo caixa
  boxTextColor = '#111111', // cor do texto dentro da caixa (escuro) — modo caixa
  ctaAtMiddle = true,   // "Leia a legenda" entra na METADE do vídeo → fim
  textY = 0.6,          // altura do gancho (fração da altura da imagem)
  ctaGap,               // espaço (px) entre o gancho e o "Leia a legenda"
  musicPath,            // trilha (se definida: corta o áudio do treino e usa ela)
  musicVolume = 0.9,    // volume da trilha (0–1)
  background = 'nenhum', // 'nenhum' | 'gradiente' (sombra escura embaixo)
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

  // Duração do clipe (ffprobe). Serve pros timings do texto E como CAP de
  // segurança (-t): com música em loop ou overlay, garante que o ffmpeg
  // termina no tamanho do vídeo em vez de rodar sem fim.
  const dur = await probeDuration(rawVideoPath);

  const fmteam = textStyle === 'fmteam';
  const F = Math.max(0.2, Math.min(0.9, Number(textY) || 0.6));
  const stamp = `${Date.now()}_${Math.round(process.hrtime()[1] / 1000)}`;
  const files = [];
  const layers = [];

  let fmteamPng = null;
  if (fmteam) {
    // Estilo Dourado (fmteam): o texto é renderizado como PNG transparente
    // (fonte condensada + palavra dourada em **) e sobreposto no vídeo.
    fmteamPng = path.join(work, `.fmteam_${stamp}.png`);
    const { renderHookOverlay } = require('./reelOverlayService');
    await renderHookOverlay({
      hookText: String(fraseTela).replace(EMOJI_RE, '').trim(),
      ctaText: ctaTela ? String(ctaTela).replace(EMOJI_RE, '').replace(/\*\*/g, '').trim() : '',
      outPng: fmteamPng, fontSize, textY: F, gradient: true,
    });
    files.push(fmteamPng);
  } else {
    // Estilos drawtext (contorno / caixa): uma linha centralizada por layer.
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

    // Remove emojis e os marcadores ** (o drawtext pinta a linha inteira de uma
    // cor — o destaque de palavra em dourado é só no estilo fmteam).
    const sanitize = (s) => String(s || '').replace(EMOJI_RE, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    const wrapChars = Math.max(10, Math.floor(900 / (fontSize * 0.55)));
    const fraseLines = wrapText(sanitize(fraseTela), wrapChars, 5);
    const ctaSize = Math.max(28, Math.round(fontSize * 0.62));
    const ctaLines = (ctaTela && sanitize(ctaTela)) ? wrapText(sanitize(ctaTela), wrapChars + 6, 2) : [];

    const boxMode = textStyle === 'caixa';
    const border = Math.max(4, Math.round(fontSize * 0.06));
    const ctaBorder = Math.max(3, Math.round(ctaSize * 0.06));
    const boxPad = Math.round(fontSize * 0.16);
    const ctaBoxPad = Math.round(ctaSize * 0.18);
    const lineH = Math.round(fontSize * (boxMode ? 1.34 : 1.16));
    const ctaLineH = Math.round(ctaSize * (boxMode ? 1.34 : 1.16));
    const gap = Number.isFinite(ctaGap) ? Math.max(0, ctaGap) : Math.round(fontSize * 0.8);
    const hookColor = boxMode ? boxTextColor : (fraseColor || 'white');
    const ctaTextColor = boxMode ? boxColor : (ctaColor || '#F5B301');
    const hookH = fraseLines.length * lineH;
    const yExpr = (px) => { const p = Math.round(px); return p >= 0 ? `h*${F}+${p}` : `h*${F}-${-p}`; };
    const writeLine = (prefix, i, text) => {
      const f = path.join(work, `.${prefix}_${stamp}_${i}.txt`);
      fs.writeFileSync(f, text, 'utf8');
      files.push(f);
      return f;
    };

    fraseLines.forEach((line, i) => {
      layers.push({
        file: writeLine('frase', i, line), color: hookColor, size: fontSize,
        stroke: !boxMode, border,
        box: boxMode, boxColor, boxBorderW: boxPad,
        y: yExpr(-hookH / 2 + i * lineH), timing: frase,
      });
    });
    const ctaBase = hookH / 2 + gap;
    ctaLines.forEach((line, j) => {
      layers.push({
        file: writeLine('cta', j, line), color: ctaTextColor, size: ctaSize,
        stroke: !boxMode, border: ctaBorder,
        box: boxMode, boxColor: boxTextColor, boxBorderW: ctaBoxPad,
        y: yExpr(ctaBase + j * ctaLineH), timing: cta,
      });
    });
  }

  const hasMusic = musicPath && fs.existsSync(musicPath);
  const vol = Math.max(0, Math.min(1, Number(musicVolume)));
  const gradient = !fmteam && background === 'gradiente' && fs.existsSync(SCRIM_PATH);
  // Encode leve pra CPU fraca do Fly: 30fps (o clipe pode vir a 60 → metade do
  // trabalho), preset ultrafast e crf 23. Reel não precisa de 60fps nem H.264
  // pesado — o Instagram recomprime de qualquer jeito.
  const VENC = ['-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p'];
  const AENC = ['-c:a', 'aac', '-b:a', '128k'];
  // CAP de duração: no máx 20s (reel de "leia a legenda" não precisa mais), o que
  // também evita encode longo demais. Usa a duração do clipe se for menor.
  const capSecs = Math.min(20, (dur && dur > 0) ? dur : 20);
  const capT = ['-t', capSecs.toFixed(2)];

  let args;
  if (fmteam) {
    // Sobrepõe o PNG fmteam (já tem sombra + gancho dourado + cta). Sem drawtext.
    const inputs = ['-i', rawVideoPath, '-i', fmteamPng];
    const chain = [
      '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[v]',
      '[v][1:v]overlay=0:0[out]',
    ];
    const audio = [];
    if (hasMusic) {
      inputs.push('-i', musicPath);
      chain.push(`[2:a]volume=${vol.toFixed(2)}[aout]`);
      audio.push('-map', '[aout]', '-shortest');
    } else {
      audio.push('-map', '0:a:0?');
    }
    args = ['-y', ...inputs, '-filter_complex', chain.join(';'), '-map', '[out]', ...audio, ...capT, ...VENC, ...AENC, '-movflags', '+faststart', outPath];
  } else if (gradient) {
    // Modo gradiente: corta o vídeo pra 1080×1920 exato, sobrepõe o scrim (2º
    // input) e escreve o texto por cima — via filter_complex. Música = 3º input.
    const inputs = ['-i', rawVideoPath, '-i', SCRIM_PATH];
    const chain = [
      '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[v]',
      '[v][1:v]overlay=0:0[bg]',
      `[bg]${textChain(layers, font)}[out]`,
    ];
    const audio = [];
    if (hasMusic) {
      inputs.push('-i', musicPath);
      chain.push(`[2:a]volume=${vol.toFixed(2)}[aout]`);
      audio.push('-map', '[aout]', '-shortest');
    } else {
      audio.push('-map', '0:a:0?');
    }
    args = ['-y', ...inputs, '-filter_complex', chain.join(';'), '-map', '[out]', ...audio, ...capT, ...VENC, ...AENC, '-movflags', '+faststart', outPath];
  } else {
    // Sem gradiente: caminho simples com -vf. Com trilha, loopa a música, mapeia
    // o áudio dela (corta o do treino) e corta no tamanho do vídeo (-t + -shortest).
    const filter = buildDrawtextFilter({ layers, fontFile: font });
    args = hasMusic
      ? ['-y', '-i', rawVideoPath, '-i', musicPath, '-vf', filter, '-af', `volume=${vol.toFixed(2)}`, '-map', '0:v:0', '-map', '1:a:0', '-shortest', ...capT, ...VENC, ...AENC, '-movflags', '+faststart', outPath]
      : ['-y', '-i', rawVideoPath, '-vf', filter, '-map', '0:v:0', '-map', '0:a:0?', ...capT, ...VENC, ...AENC, '-movflags', '+faststart', outPath];
  }

  const cleanup = () => {
    for (const f of files) {
      try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignora */ }
    }
  };

  await new Promise((resolve, reject) => {
    let stderr = '';
    let done = false;
    let proc;
    try {
      proc = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args);
    } catch (e) {
      cleanup();
      return reject(new Error(`Falha ao iniciar o ffmpeg: ${e.message}`));
    }
    // Timeout de segurança: mata o ffmpeg se travar e DEVOLVE o log (o ffmpeg
    // imprime o progresso: frame=/time= subindo = lento; parado = travado mesmo).
    const killer = setTimeout(() => {
      if (done) return;
      done = true;
      try { proc.kill('SIGKILL'); } catch { /* ignora */ }
      cleanup();
      const tail = stderr.slice(-1400).trim();
      reject(new Error(`Render interrompido em 120s. Comando: ffmpeg ${args.join(' ')}\n\nÚltimo log do ffmpeg:\n${tail || '(nada — o ffmpeg não imprimiu nada, pode nem ter começado)'}`));
    }, 120000);
    proc.stderr.on('data', (d) => { stderr += d.toString(); if (stderr.length > 20000) stderr = stderr.slice(-20000); });
    proc.on('error', (e) => {
      if (done) return; done = true; clearTimeout(killer); cleanup();
      reject(new Error(e.code === 'ENOENT'
        ? 'ffmpeg não encontrado no ambiente. (Existe na imagem Docker de produção.)'
        : `Erro no ffmpeg: ${e.message}`));
    });
    proc.on('close', (code) => {
      if (done) return; done = true; clearTimeout(killer); cleanup();
      if (code === 0 && fs.existsSync(outPath)) return resolve();
      reject(new Error(`ffmpeg saiu com código ${code}. Trecho do log:\n${stderr.slice(-1200)}`));
    });
  });

  return { outPath };
}

module.exports = {
  renderReel,
  buildDrawtextFilter,
  parseTiming,
  wrapText,
  resolveFont,
  FONT_CANDIDATES,
};
