/**
 * storyRenderService.js — Render das imagens dos Stories (Phase 2).
 *
 * Pega a sequência gerada pelo storyRotationService e renderiza 1 PNG por story
 * (1080×1920, 9:16) no padrão fmteam dourado. Contrato visual pedido pelo Fabricio:
 *   - Texto em CAIXA NORMAL (1ª maiúscula), alinhado à ESQUERDA, centralizado
 *     verticalmente no story (nada de garrafais de reel).
 *   - 1 palavra entre **asteriscos** vira dourada (destaque sutil).
 *   - Fundo: foto de homem atlético/academia com overlay escuro pra o texto ler bem.
 *
 * Reaproveita o Playwright do carouselService (takeScreenshotsPixelPerfect com o novo
 * formato '9:16') e a busca de imagem (fetchOneImage, com viés masculino).
 */

const path = require('path');
const { fetchOneImage, takeScreenshotsPixelPerfect } = require('./carouselService');

const GOLD = '#FFC300';
const HANDLE = 'fabriciomourateam';

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Converte o texto do story em HTML: escapa, **palavra** vira dourado, \n vira <br>.
function renderText(texto) {
  const esc = escapeHtml(texto);
  const gold = esc.replace(/\*\*(.+?)\*\*/g, '<span class="g">$1</span>');
  return gold.replace(/\r?\n/g, '<br>');
}

function storyCss() {
  return `<style>
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#0f0d08; }
  .story {
    width:1080px; height:1920px; position:relative; overflow:hidden;
    background:#0f0d08; font-family:'Plus Jakarta Sans',system-ui,sans-serif;
  }
  .story .bg { position:absolute; inset:0; z-index:0; }
  /* escurece a PRÓPRIA foto (garante legibilidade mesmo em imagem clara/carregada) */
  .story .bg img { width:100%; height:100%; object-fit:cover; object-position:center 32%;
    display:block; filter:brightness(0.55) saturate(1.05) contrast(1.02); }
  /* overlay por cima: reforça o escuro no geral e mais ainda em cima/embaixo */
  .story .overlay { position:absolute; inset:0; z-index:1; background:
    linear-gradient(to bottom, rgba(8,7,5,0.82) 0%, rgba(8,7,5,0.52) 28%, rgba(8,7,5,0.56) 54%, rgba(8,7,5,0.92) 100%); }
  /* barra de progresso (segmentos) no topo, estilo Instagram */
  .prog { position:absolute; top:40px; left:56px; right:56px; z-index:3; display:flex; gap:8px; }
  .prog .seg { flex:1; height:4px; border-radius:3px; background:rgba(255,255,255,0.3); }
  .prog .seg.on { background:${GOLD}; }
  /* marca no topo */
  .brand { position:absolute; top:70px; left:56px; z-index:3; display:flex; align-items:center; gap:12px; }
  .brand .dot { width:34px; height:34px; border-radius:50%; background:${GOLD}; }
  .brand .h { color:#fff; font-weight:700; font-size:30px; letter-spacing:.2px; }
  .brand .h span { color:${GOLD}; }
  /* conteúdo: alinhado à esquerda, centralizado na vertical */
  .content { position:absolute; left:80px; right:80px; top:50%; transform:translateY(-50%); z-index:2; }
  .content .txt {
    color:#fff; text-align:left; font-weight:700; font-size:66px; line-height:1.24;
    letter-spacing:-0.5px; text-shadow:0 2px 24px rgba(0,0,0,0.45);
  }
  .content .txt .g { color:${GOLD}; }
  /* rodapé sutil */
  .foot { position:absolute; bottom:70px; left:80px; right:80px; z-index:3;
    color:rgba(255,255,255,0.82); font-size:28px; font-weight:600; }
  .foot .acc { width:54px; height:5px; border-radius:3px; background:${GOLD}; margin-bottom:18px; }
  </style>`;
}

function buildStoryHTML(stories, bgUrls, { handle = HANDLE, footer = '' } = {}) {
  const total = stories.length;
  const at = `@${String(handle).replace('@', '')}`;
  const blocks = stories.map((s, i) => {
    const bg = bgUrls[i]
      ? `<div class="bg"><img src="${bgUrls[i]}"></div>`
      : '';
    const prog = Array.from({ length: total }, (_, k) =>
      `<div class="seg${k <= i ? ' on' : ''}"></div>`).join('');
    const foot = (i === total - 1 && footer)
      ? `<div class="foot"><div class="acc"></div>${escapeHtml(footer)}</div>`
      : '';
    return `<div class="story">
      ${bg}<div class="overlay"></div>
      <div class="prog">${prog}</div>
      <div class="brand"><div class="dot"></div><div class="h">Fabricio <span>Moura</span></div></div>
      <div class="content"><div class="txt">${renderText(s.texto)}</div></div>
      ${foot}
    </div>`;
  }).join('\n');

  return `<!doctype html><html><head><meta charset="utf-8">${storyCss()}</head><body>${blocks}</body></html>`;
}

/**
 * Renderiza a sequência de stories em PNGs 1080×1920.
 * @param {Object} seq      saída do generateStorySequence ({ mode, stories, resumo })
 * @param {string} outputDir pasta de saída
 * @param {Object} opts     { topic, handle, fetchImages=true }
 * @returns {Promise<string[]>} nomes dos arquivos (slide_01.png...)
 */
async function renderStorySequence(seq, outputDir, { topic = '', handle = HANDLE, fetchImages = true } = {}) {
  const stories = (seq && seq.stories) || [];
  if (!stories.length) throw new Error('Sequência de stories vazia.');

  // Fundo: foto de homem atlético/academia que combine com o "visual" de cada story.
  const bgUrls = [];
  for (const s of stories) {
    let url = '';
    if (fetchImages) {
      try { url = await fetchOneImage(s.visual || topic, topic || 'man gym', 'muscular athletic man') || ''; }
      catch (_) { url = ''; }
    }
    bgUrls.push(url);
  }

  const footer = seq.mode === 'engajamento' || seq.mode === 'oferta' ? 'Responde aqui 👇🏼' : '';
  const html = buildStoryHTML(stories, bgUrls, { handle, footer });
  return takeScreenshotsPixelPerfect(html, outputDir, '9:16');
}

module.exports = { renderStorySequence, buildStoryHTML };
