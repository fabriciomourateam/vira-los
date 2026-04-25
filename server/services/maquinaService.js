/**
 * maquinaService.js
 * Camada de geração da Máquina de Carrosséis (modo BrandsDecoded).
 *
 * Pipeline editorial em etapas:
 *   1. generateHeadlines  → 10 headlines (5 IC + 5 NM) em tabela markdown
 *   2. generateStructure  → espinha dorsal (Hook/Mecanismo/Prova/Aplicação/Direção)
 *   3. generateCarouselHTML → HTML 1080×1350 com fontes embutidas + Pexels resolvido
 *
 * As 3 funções compartilham o mesmo SYSTEM em 4 cache blocks ephemeral (Anthropic
 * Prompt Caching) — a 1ª chamada cria o cache, as seguintes leem (custo ~10%).
 *
 * Modelo: claude-sonnet-4-6 (Sonnet 4.6 — última versão estável a abril/2026).
 */

const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const ASSETS = require('./maquinaAssets');
const { buildSystemForAnthropic } = require('./maquinaPrompt');

const MODEL = 'claude-sonnet-4-6';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Retry para 529 / overloaded_error com backoff exponencial ───────────────
async function anthropicWithRetry(params, maxRetries = 4) {
  let delay = 5000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await anthropic.messages.create(params);
    } catch (err) {
      const isOverload =
        err?.status === 529 ||
        err?.error?.type === 'overloaded_error' ||
        (err?.message || '').includes('overloaded');
      if (isOverload && attempt < maxRetries) {
        console.warn(`[Maquina/Anthropic] Sobrecarga (${attempt + 1}/${maxRetries}), aguardando ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
        delay = Math.min(delay * 2, 30000);
        continue;
      }
      throw err;
    }
  }
}

function logUsage(label, usage) {
  if (!usage) return;
  const ccin = usage.cache_creation_input_tokens || 0;
  const crin = usage.cache_read_input_tokens || 0;
  const inp  = usage.input_tokens || 0;
  const out  = usage.output_tokens || 0;
  console.log(
    `[Maquina/${label}] in=${inp} out=${out} cache_create=${ccin} cache_read=${crin}` +
    (crin > 0 ? ` ✓ cache hit` : ccin > 0 ? ` ✦ cache primed` : '')
  );
}

// ─── Etapa 2 do pipeline v4: 10 headlines ────────────────────────────────────
async function generateHeadlines(tema, nicho = 'Consultoria Esportiva', brandKit = null) {
  const briefingExtra = brandKit
    ? `\n\nBrand kit ativo:\n${JSON.stringify(brandKit, null, 2)}`
    : '';

  const res = await anthropicWithRetry({
    model: MODEL,
    max_tokens: 4000,
    system: buildSystemForAnthropic(),
    messages: [{
      role: 'user',
      content:
        `Gere 10 headlines para o seguinte tema/conteúdo:\n\n${tema}\n\nNicho: ${nicho}` +
        briefingExtra +
        `\n\nSiga exatamente o formato de tabela markdown com colunas #, Headline, Gatilho.\n` +
        `Distribuição obrigatória: opções 1–5 em formato Investigação Cultural, opções 6–10 em formato Narrativa Magnética.`
    }],
  });

  logUsage('Headlines', res.usage);
  return res.content[0].text;
}

// ─── Etapa 3: espinha dorsal ─────────────────────────────────────────────────
async function generateStructure(headline, tema, conversationHistory = []) {
  const res = await anthropicWithRetry({
    model: MODEL,
    max_tokens: 4000,
    system: buildSystemForAnthropic(),
    messages: [
      ...conversationHistory,
      {
        role: 'user',
        content:
          `Headline escolhida: ${headline}\n\nTema original: ${tema}\n\n` +
          `Monte a espinha dorsal do carrossel (Hook / Mecanismo / Prova / Aplicação / Direção).`
      },
    ],
  });

  logUsage('Structure', res.usage);
  return res.content[0].text;
}

// ─── Etapa 5: HTML do carrossel (com placeholders BARLOW/PJS/AVATAR/CTABG) ───
async function generateCarouselHTML(params) {
  const {
    tema,
    headline,
    cta = 'Comenta SHAPE e me segue para mais conteúdos como esse',
    slides = 9,
    nicho = 'Consultoria Esportiva',
    conversationHistory = [],
    brandKit = null,
  } = params;

  const brandKitBlock = brandKit
    ? `\n\nBrand kit (aplicar cor primária e fonte conforme):\n${JSON.stringify(brandKit, null, 2)}`
    : '';

  const res = await anthropicWithRetry({
    model: MODEL,
    max_tokens: 16000,
    system: buildSystemForAnthropic(),
    messages: [
      ...conversationHistory,
      {
        role: 'user',
        content:
`Gere o HTML completo do carrossel com ${slides} slides.

Tema: ${tema}
Headline da capa: ${headline}
CTA: ${cta}
Nicho: ${nicho}${brandKitBlock}

REGRAS OBRIGATÓRIAS DO HTML:
1. Slides 1080×1350px nativos (sem transform/scale).
2. Fontes embutidas via @font-face usando placeholders literais:
   - {{BARLOW_B64}}  → Barlow Condensed 800/900
   - {{PJS400_B64}}  → Plus Jakarta Sans 400
   - {{PJS700_B64}}  → Plus Jakarta Sans 700
   - {{PJS800_B64}}  → Plus Jakarta Sans 800
3. Badge da capa com avatar: src="{{AVATAR_B64}}"
4. Fundo do slide CTA: background-image: url('{{CTABG_B64}}')
5. Fotos dos slides internos: <div class="img-box" style="background-image:url('PEXELS:descrição-da-busca-aqui');"></div>
   - O servidor substitui PEXELS:query por URL real da Pexels (orientation portrait)
   - Use queries específicas e em inglês (ex: PEXELS:woman-running-morning, PEXELS:gym-barbell-deadlift)
6. Brand bar: "Powered by Content Machine    |    @fabriciomourateam    |    2026 ®"
7. Sem swipe arrow.
8. Aplicar template alternado claro/escuro conforme número de slides (5/7/9/12).
9. Retornar APENAS o HTML, sem explicações, sem blocos markdown.`
      },
    ],
  });

  logUsage('CarouselHTML', res.usage);
  let html = res.content[0].text;

  // Remove markdown fences eventualmente adicionadas pelo modelo
  html = html.replace(/^```(?:html)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  // Injeta assets base64 reais nos placeholders
  html = injectAssets(html);

  // Resolve placeholders PEXELS:query → URLs reais (server-side, sem CORS)
  html = await resolvePexels(html);

  return html;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function injectAssets(html) {
  return html
    .replace(/\{\{BARLOW_B64\}\}/g, ASSETS.BARLOW)
    .replace(/\{\{PJS400_B64\}\}/g, ASSETS.PJS400)
    .replace(/\{\{PJS700_B64\}\}/g, ASSETS.PJS700)
    .replace(/\{\{PJS800_B64\}\}/g, ASSETS.PJS800)
    .replace(/\{\{AVATAR_B64\}\}/g, ASSETS.AVATAR)
    .replace(/\{\{CTABG_B64\}\}/g, ASSETS.CTABG);
}

const PEXELS_REGEX = /PEXELS:([^'"<)\s]+)/g;

async function resolvePexels(html) {
  if (!process.env.PEXELS_API_KEY) {
    console.warn('[Maquina/Pexels] PEXELS_API_KEY não configurada — placeholders não serão resolvidos.');
    return html;
  }

  const matches = [...html.matchAll(PEXELS_REGEX)];
  if (matches.length === 0) return html;

  const uniqueQueries = [...new Set(matches.map(m => m[1]))];
  const photoMap = {};

  await Promise.all(uniqueQueries.map(async (query) => {
    try {
      const decoded = decodeURIComponent(query).replace(/-/g, ' ');
      const response = await axios.get('https://api.pexels.com/v1/search', {
        headers: { Authorization: process.env.PEXELS_API_KEY },
        params: { query: decoded, orientation: 'portrait', per_page: 5, page: 1 },
        timeout: 8000,
      });
      const photos = response.data.photos || [];
      if (photos.length > 0) {
        const photo = photos[Math.floor(Math.random() * photos.length)];
        photoMap[query] = photo.src.large2x || photo.src.large;
      }
    } catch (e) {
      console.warn(`[Maquina/Pexels] falha em "${query}":`, e.message);
    }
  }));

  return html.replace(PEXELS_REGEX, (_match, query) => photoMap[query] || '');
}

module.exports = {
  generateHeadlines,
  generateStructure,
  generateCarouselHTML,
  injectAssets,
  resolvePexels,
};
