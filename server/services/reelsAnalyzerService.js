/**
 * reelsAnalyzerService.js
 * Analisa um Reel do Instagram: scraping via Apify, extração de frames com ffmpeg,
 * transcrição de áudio com OpenAI Whisper (opcional), análise visual via Claude Vision,
 * e geração de script de carrossel + roteiro de Reels com Claude.
 */

const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Estado global ─────────────────────────────────────────────────────────────

let analyzerState = {
  running: false,
  steps: [],
  result: null,
  error: null,
};

const sseClients = new Set();

function getState() { return analyzerState; }

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch (_) { sseClients.delete(res); }
  }
}

function stepUpdate(id, status, detail = '') {
  const step = analyzerState.steps.find(s => s.id === id);
  if (step) {
    step.status = status;
    if (detail) step.detail = detail;
  }
  broadcast({ type: 'step', step: analyzerState.steps.find(s => s.id === id) });
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function ffmpegAvailable() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch { return false; }
}

async function downloadBuffer(url, timeoutMs = 30000) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: timeoutMs,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ViralOS/1.0)' },
  });
  return Buffer.from(response.data);
}

// ─── Passo 1: Scraping do Reel via Apify ──────────────────────────────────────

async function fetchReelData(url) {
  const apiKey = process.env.APIFY_API_KEY;
  if (!apiKey) {
    throw new Error('APIFY_API_KEY não configurada. Adicione no .env do servidor para usar o Analisador de Reels.');
  }

  const actorId = 'apify~instagram-scraper';
  const runUrl = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${apiKey}&timeout=120`;

  const response = await axios.post(runUrl, {
    directUrls: [url],
    resultsType: 'posts',
    resultsLimit: 1,
    addParentData: false,
  }, { timeout: 135000 });

  const items = Array.isArray(response.data) ? response.data : [];
  if (!items.length) {
    throw new Error('Nenhum dado encontrado. Verifique se o Reel é público e a URL está correta.');
  }

  return items[0];
}

// ─── Passo 2: Download de thumbnail ───────────────────────────────────────────

async function downloadThumbnail(reelData) {
  const candidates = [
    reelData.thumbnailUrl,
    reelData.displayUrl,
    reelData.coverUrl,
    reelData.imageUrl,
  ].filter(Boolean);

  for (const url of candidates) {
    try {
      const buf = await downloadBuffer(url, 20000);
      return buf.toString('base64');
    } catch { /* tenta próximo */ }
  }
  return null;
}

// ─── Passo 3: Extração de frames via ffmpeg ────────────────────────────────────

async function extractFrames(videoUrl, tempDir) {
  // Download do vídeo
  const videoPath = path.join(tempDir, 'reel.mp4');
  let buf;
  try {
    buf = await downloadBuffer(videoUrl, 90000);
  } catch (e) {
    throw new Error(`Falha ao baixar vídeo: ${e.message}`);
  }
  fs.writeFileSync(videoPath, buf);

  // Extrair 3 frames em momentos diferentes (início, meio, quase-fim)
  const framesPattern = path.join(tempDir, 'frame%03d.jpg');
  const cmd = `ffmpeg -i "${videoPath}" -vf "select=eq(n\\,0)+eq(n\\,25)+eq(n\\,55)" -vsync vfr "${framesPattern}" -y 2>/dev/null`;

  try {
    execSync(cmd, { timeout: 30000 });
  } catch {
    // Fallback: extrai 1 frame por segundo, pega os 3 primeiros
    try {
      execSync(
        `ffmpeg -i "${videoPath}" -r 0.3 -frames:v 3 "${framesPattern}" -y 2>/dev/null`,
        { timeout: 30000 }
      );
    } catch { /* segue sem frames */ }
  }

  const frames = [];
  for (let i = 1; i <= 5; i++) {
    const framePath = path.join(tempDir, `frame${String(i).padStart(3, '0')}.jpg`);
    if (fs.existsSync(framePath)) {
      frames.push(fs.readFileSync(framePath).toString('base64'));
    }
  }

  return { videoPath, frames };
}

// ─── Passo 4: Transcrição de áudio via OpenAI Whisper ─────────────────────────

async function transcribeAudio(videoPath) {
  if (!process.env.OPENAI_API_KEY) return null;

  const audioPath = videoPath.replace('.mp4', '.mp3');
  try {
    execSync(
      `ffmpeg -i "${videoPath}" -vn -ar 16000 -ac 1 -b:a 96k "${audioPath}" -y 2>/dev/null`,
      { timeout: 30000 }
    );
  } catch { return null; }

  if (!fs.existsSync(audioPath)) return null;

  const FormData = require('form-data');
  const form = new FormData();
  form.append('file', fs.createReadStream(audioPath), {
    filename: 'audio.mp3',
    contentType: 'audio/mpeg',
  });
  form.append('model', 'whisper-1');
  // Tenta português como idioma principal
  form.append('language', 'pt');

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        timeout: 60000,
      }
    );
    return response.data?.text?.trim() || null;
  } catch (e) {
    console.warn('[ReelsAnalyzer] Whisper error:', e.response?.data || e.message);
    return null;
  }
}

// ─── Passo 5: Análise visual com Claude Vision ────────────────────────────────

async function analyzeVisuals(frames, thumbnailBase64, caption) {
  const imageContents = [];

  if (thumbnailBase64) {
    imageContents.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: thumbnailBase64 },
    });
  }

  for (const frame of frames.slice(0, 3)) {
    imageContents.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: frame },
    });
  }

  if (imageContents.length === 0) {
    if (caption) return `Análise contextual baseada na legenda do post:\n${caption}`;
    return 'Sem dados visuais disponíveis para análise.';
  }

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: [
        ...imageContents,
        {
          type: 'text',
          text: `Analise estas imagens de um Instagram Reel.${caption ? `\n\nLegenda do post: "${caption.substring(0, 300)}"` : ''}

Descreva de forma objetiva e detalhada:
1. O que está acontecendo (ambiente, pessoas, ações, demonstrações visuais)
2. Tema/assunto principal do conteúdo
3. Estilo de apresentação (pessoa falando na câmera, tutorial, b-roll, animação, etc.)
4. Textos visíveis na tela (legendas, títulos, dados, frases)
5. Tom emocional (urgência, humor, didático, motivacional, revelação, etc.)
6. Nicho/área do conteúdo (saúde, fitness, finanças, lifestyle, etc.)
7. Elementos visuais que contribuem para o engajamento

Seja específico e direto. Máximo 350 palavras.`,
        },
      ],
    }],
  });

  return response.content[0].text;
}

// ─── Passo 6: Geração do script de carrossel ──────────────────────────────────

async function generateCarouselScript(transcription, visualAnalysis, caption, reelInfo) {
  const context = [
    transcription ? `TRANSCRIÇÃO DO ÁUDIO:\n${transcription}` : '',
    `ANÁLISE VISUAL DO REEL:\n${visualAnalysis}`,
    caption ? `LEGENDA ORIGINAL DO POST:\n${caption.substring(0, 400)}` : '',
    reelInfo.likes ? `ENGAJAMENTO: ${Number(reelInfo.likes).toLocaleString('pt-BR')} curtidas${reelInfo.views ? `, ${Number(reelInfo.views).toLocaleString('pt-BR')} visualizações` : ''}` : '',
  ].filter(Boolean).join('\n\n---\n\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Você é um especialista em conteúdo viral para Instagram, focado em MEIO DE FUNIL.

CONTEÚDO DO REEL ANALISADO:
${context}

DIRETRIZES OBRIGATÓRIAS DO ROTEIRO (Método ViralOS):
- OBJETIVO: +50k seguidores orgânicos/mês
- FÓRMULA: ENTRETENIMENTO + TÉCNICA = VIRALIZAÇÃO
- REGRA DE OURO: 80% da performance vem do GANCHO
- RETENÇÃO: >70% em 3 segundos = potencial viral
- EMOÇÕES QUE VIRALIZAM: Curiosidade, surpresa, medo, urgência
- POSICIONAMENTO: MEIO DE FUNIL — inspire ação orgânica, não venda direta

Baseado no tema e conteúdo do Reel acima, crie um SCRIPT COMPLETO DE CARROSSEL PARA INSTAGRAM com 6 slides.
Adapte o tema original para o formato carrossel, mantendo a essência viral.

---

SLIDE 1 - CAPA (gancho que para o scroll):
Título: [3-6 palavras impactantes em caixa alta]
Subtítulo: [1 linha complementar que gera curiosidade]

SLIDE 2 - CONTEXTO / PROBLEMA:
Título: [título que cria identificação]
Texto: [2-3 frases curtas que tocam na dor ou curiosidade]

SLIDE 3 - REVELAÇÃO 1:
Título: [título direto ao ponto]
Texto: [informação técnica + entretenimento, 2-3 frases]

SLIDE 4 - REVELAÇÃO 2:
Título: [título direto ao ponto]
Texto: [aprofundamento, dado surpreendente ou contraponto, 2-3 frases]

SLIDE 5 - INSIGHT PRINCIPAL:
Título: [a sacada central do carrossel]
Texto: [a informação mais valiosa do carrossel, 2-3 frases]

SLIDE 6 - CTA:
Título: [chamada de ação que gera comentários ou salvamentos]
Texto: [instrução clara: comentar, salvar, seguir, compartilhar]

---

LEGENDA SUGERIDA PARA O POST:
[1-3 parágrafos + até 3 hashtags estratégicos]`,
    }],
  });

  return response.content[0].text;
}

// ─── Passo 7: Geração do roteiro de Reels ─────────────────────────────────────

async function generateReelsScript(transcription, visualAnalysis, caption, reelInfo) {
  const context = [
    transcription ? `TRANSCRIÇÃO DO ÁUDIO:\n${transcription}` : '',
    `ANÁLISE VISUAL DO REEL:\n${visualAnalysis}`,
    caption ? `LEGENDA ORIGINAL DO POST:\n${caption.substring(0, 400)}` : '',
  ].filter(Boolean).join('\n\n---\n\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Você é um especialista em roteiros virais para Instagram Reels, focado em MEIO DE FUNIL.

CONTEÚDO DO REEL REFERÊNCIA:
${context}

ANATOMIA OBRIGATÓRIA DO VÍDEO (Método ViralOS):
- DURAÇÃO ALVO: 50 segundos a 1min20
- OBJETIVO: +50k seguidores orgânicos/mês
- FÓRMULA: ENTRETENIMENTO + TÉCNICA = VIRALIZAÇÃO
- REGRA DE OURO: 80% da performance vem do GANCHO
- RETENÇÃO: >70% em 3 segundos = potencial viral
- POSICIONAMENTO: MEIO DE FUNIL (não é venda, não é básico demais)

ESTRUTURA OBRIGATÓRIA:
✅ GANCHO (0-4s): Visual + auditivo + textual + verbal — prender em 3 segundos
✅ DESENVOLVIMENTO (4-60s): Dinamismo + quebras de padrão a cada 10-15s
✅ CTA (começo/meio/final): Comentar, seguir, compartilhar
✅ EMOÇÃO CENTRAL: Curiosidade, surpresa, medo OU urgência
✅ ENTRETENIMENTO + TÉCNICA: Abstrair da realidade E entregar valor real

Baseado no tema do Reel referência, crie um ROTEIRO COMPLETO E ORIGINAL pronto para gravar:

---

GANCHO VISUAL (0-2s) — o que a câmera mostra:
[descreva exatamente a cena de abertura, enquadramento, ação]

TEXTO NA TELA (0-3s):
[texto em caixa alta que aparece sobreposto — deve parar o scroll]

GANCHO VERBAL (0-4s) — primeiras palavras faladas:
[frase exata, direta, sem "oi, tudo bem?" — vai direto ao ponto]

DESENVOLVIMENTO:
[Frase 1 — 4 a 12s]: [o que falar]
[Frase 2 — 12 a 22s]: [o que falar]
[Frase 3 — 22 a 35s]: [o que falar]
[Quebra de padrão — ~35s]: [mudança de ritmo: zoom in, corte rápido, pergunta, dado chocante]
[Conclusão — 40 a 55s]: [fechamento do argumento principal]

CTA FINAL (últimos 5s):
[frase exata para falar — gera comentário, salvamento ou seguida]

TOM / EMOÇÃO CENTRAL:
[qual emoção domina e por que esse conteúdo vai reter e viralizar]

DICAS DE GRAVAÇÃO:
1. [dica específica de performance para este roteiro]
2. [dica de edição ou visual]
3. [dica de entrega/energia]`,
    }],
  });

  return response.content[0].text;
}

// ─── Função principal ──────────────────────────────────────────────────────────

async function analyzeReel(url) {
  if (analyzerState.running) {
    throw new Error('Análise já em andamento. Aguarde o processo terminar.');
  }

  const tempDir = path.join(os.tmpdir(), `viralostmp-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  analyzerState = {
    running: true,
    steps: [
      { id: 'fetch',     label: 'Buscando dados do Reel via Apify',      status: 'pending', detail: '' },
      { id: 'download',  label: 'Baixando thumbnail e frames do vídeo',   status: 'pending', detail: '' },
      { id: 'transcribe',label: 'Transcrevendo áudio (Whisper)',           status: 'pending', detail: '' },
      { id: 'vision',    label: 'Analisando conteúdo visual (Claude AI)',  status: 'pending', detail: '' },
      { id: 'carousel',  label: 'Gerando script de carrossel',             status: 'pending', detail: '' },
      { id: 'reels',     label: 'Gerando roteiro de Reels',               status: 'pending', detail: '' },
    ],
    result: null,
    error: null,
  };

  broadcast({ type: 'state', state: analyzerState });

  try {
    // ── Passo 1: Scraping ─────────────────────────────────────────────────────
    stepUpdate('fetch', 'running');
    const reelData = await fetchReelData(url);

    const caption   = reelData.caption || reelData.text || '';
    const videoUrl  = reelData.videoUrl || reelData.videoVersions?.[0]?.url || reelData.video_url || null;
    const owner     = reelData.ownerUsername || reelData.ownerId || '';
    const likes     = reelData.likesCount   || reelData.diggCount || 0;
    const views     = reelData.videoViewCount || reelData.playCount || 0;
    const shortCode = reelData.shortCode || reelData.id || '';
    const thumbnailUrlRaw = reelData.thumbnailUrl || reelData.displayUrl || reelData.coverUrl || reelData.imageUrl || null;

    stepUpdate('fetch', 'done', `@${owner || 'desconhecido'} · ${Number(likes).toLocaleString('pt-BR')} curtidas · ${Number(views).toLocaleString('pt-BR')} views`);

    // ── Passo 2: Download de mídia ────────────────────────────────────────────
    stepUpdate('download', 'running');
    const hasFfmpeg = ffmpegAvailable();
    let thumbnailBase64 = null;
    let frames = [];
    let videoPath = null;

    thumbnailBase64 = await downloadThumbnail(reelData);

    if (hasFfmpeg && videoUrl) {
      try {
        const extracted = await extractFrames(videoUrl, tempDir);
        frames    = extracted.frames;
        videoPath = extracted.videoPath;
        stepUpdate('download', 'done', `${frames.length} frame(s) extraído(s)${thumbnailBase64 ? ' + thumbnail' : ''}`);
      } catch (e) {
        console.warn('[ReelsAnalyzer] Extração de frames falhou:', e.message);
        stepUpdate('download', 'done', thumbnailBase64 ? 'Thumbnail obtida (frames falharam)' : 'Sem imagens obtidas');
      }
    } else {
      const reason = !videoUrl ? 'sem URL de vídeo' : 'ffmpeg não disponível';
      stepUpdate('download', 'done', thumbnailBase64 ? `Thumbnail obtida (${reason})` : `Sem imagens (${reason})`);
    }

    // ── Passo 3: Transcrição ──────────────────────────────────────────────────
    let transcription = null;
    if (hasFfmpeg && videoPath && process.env.OPENAI_API_KEY) {
      stepUpdate('transcribe', 'running', 'Enviando áudio para OpenAI Whisper...');
      try {
        transcription = await transcribeAudio(videoPath);
        stepUpdate('transcribe', 'done', transcription ? 'Áudio transcrito com sucesso' : 'Sem fala detectada no áudio');
      } catch (e) {
        console.warn('[ReelsAnalyzer] Transcrição falhou:', e.message);
        stepUpdate('transcribe', 'done', 'Falha na transcrição — análise visual usada');
      }
    } else {
      const reason = !process.env.OPENAI_API_KEY
        ? 'OPENAI_API_KEY não configurada'
        : !hasFfmpeg
          ? 'ffmpeg não disponível'
          : 'Vídeo não acessível';
      stepUpdate('transcribe', 'done', `Pulado — ${reason} (análise visual continua)`);
    }

    // ── Passo 4: Análise visual ───────────────────────────────────────────────
    if (!thumbnailBase64 && frames.length === 0 && !caption) {
      throw new Error('Não foi possível obter nenhuma imagem ou texto do Reel. Verifique se é público.');
    }

    stepUpdate('vision', 'running');
    const visualAnalysis = await analyzeVisuals(frames, thumbnailBase64, caption);
    stepUpdate('vision', 'done', 'Análise concluída');

    // ── Passo 5: Script de carrossel ──────────────────────────────────────────
    stepUpdate('carousel', 'running');
    const reelInfo = { likes, views, owner, shortCode };
    const carouselScript = await generateCarouselScript(transcription, visualAnalysis, caption, reelInfo);
    stepUpdate('carousel', 'done', 'Script gerado com sucesso');

    // ── Passo 6: Roteiro de Reels ─────────────────────────────────────────────
    stepUpdate('reels', 'running');
    const reelsScript = await generateReelsScript(transcription, visualAnalysis, caption, reelInfo);
    stepUpdate('reels', 'done', 'Roteiro gerado com sucesso');

    // ── Finaliza ──────────────────────────────────────────────────────────────
    analyzerState.result = {
      reelInfo: {
        caption: caption.substring(0, 400),
        owner,
        likes,
        views,
        thumbnailUrl: thumbnailUrlRaw,
        url: reelData.url || `https://www.instagram.com/reel/${shortCode}/`,
      },
      transcription,
      visualAnalysis,
      carouselScript,
      reelsScript,
      hasAudio: Boolean(transcription),
      hasFrames: frames.length > 0,
    };
    analyzerState.running = false;

    broadcast({ type: 'done', result: analyzerState.result });

  } catch (error) {
    console.error('[ReelsAnalyzer] Erro:', error.message);
    analyzerState.error = error.message;
    analyzerState.running = false;

    const runningStep = analyzerState.steps.find(s => s.status === 'running');
    if (runningStep) stepUpdate(runningStep.id, 'error', error.message);

    broadcast({ type: 'error', message: error.message });
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

module.exports = { analyzeReel, getState, sseClients };
