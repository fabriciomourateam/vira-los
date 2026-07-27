/**
 * reelOverlayService.js — Renderiza o texto do reel como PNG transparente (HTML
 * + Chromium), no mesmo visual dos carrosséis fmteam: fonte condensada, gancho
 * branco MAIÚSCULO com palavra DOURADA (marcada com **asteriscos**), sombra
 * embaixo e "Leia a legenda". O reelRenderService sobrepõe esse PNG no vídeo.
 *
 * Por que imagem (e não drawtext do ffmpeg): o browser dá fonte real, quebra
 * e centralização perfeitas, e — o principal — permite pintar UMA palavra de
 * dourado no meio do texto branco (o que engaja nos posts campeões do Fabricio).
 */

const path = require('path');
const fs = require('fs');
let FABRICIO_AVATAR_DATA_URL = '';
try { ({ FABRICIO_AVATAR_DATA_URL } = require('./fmteamAssets')); } catch { /* sem avatar */ }

let _browser = null;
let _launching = null;

async function getBrowser() {
  if (_browser) { try { await _browser.version(); return _browser; } catch { _browser = null; } }
  if (_launching) return _launching;
  let chromium;
  try { ({ chromium } = require('playwright')); } catch { return null; }
  _launching = chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  }).then((b) => { _browser = b; _launching = null; return b; })
    .catch((e) => { _launching = null; throw e; });
  return _launching;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// "Você e a **vontade de doce**" → "Você e a <em>vontade de doce</em>" (dourado).
function markup(text) {
  return esc(String(text || '')).split(/(\*\*[^*]+\*\*)/g).map((seg) => {
    const m = seg.match(/^\*\*([^*]+)\*\*$/);
    return m ? `<em>${m[1]}</em>` : seg;
  }).join('');
}

// HTML 1080×1920 transparente: sombra embaixo + selo + gancho (dourado no **) + CTA.
function buildHtml({ hookText, ctaText = '', fontSize = 96, textY = 0.62, gradient = true, selo = true, displayName = 'Fabricio Moura', handle = '@fabriciomourateam' }) {
  // Dourado SÓLIDO brilhante (o gradiente com background-clip ficava muddy no
  // Chromium — "preto amarelado"). Igual ao carrossel.
  const GOLD = '#F7B500';
  // Sombra FORTE (como no carrossel): escurece bem a metade de baixo pro texto
  // saltar. Quase preto na base.
  const scrim = gradient
    ? 'background:linear-gradient(to bottom, rgba(0,0,0,0) 24%, rgba(0,0,0,0.55) 44%, rgba(0,0,0,0.85) 66%, rgba(0,0,0,0.97) 100%);'
    : '';
  const topPx = Math.round(Math.max(0.2, Math.min(0.9, textY)) * 1920);
  const ctaSize = Math.round(fontSize * 0.5);
  const avaSize = Math.round(fontSize * 0.62);
  const nameSize = Math.round(fontSize * 0.36);
  const badge = Math.round(nameSize * 0.9);
  const showSelo = selo && FABRICIO_AVATAR_DATA_URL;
  const seloHtml = showSelo ? `<div class="selo">
      <span class="ring"><img class="ava" src="${FABRICIO_AVATAR_DATA_URL}" /></span>
      <div class="who">
        <div class="l1"><span class="nm">${esc(displayName)}</span>
          <svg class="vf" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#3897F0"/><path d="M6.8 12.4l3.1 3.1 7-7" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <div class="hd">${esc(handle)}</div>
      </div>
    </div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800;900&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;padding:0;width:1080px;height:1920px;background:transparent;overflow:hidden;}
  .stage{position:relative;width:1080px;height:1920px;}
  .scrim{position:absolute;inset:0;${scrim}}
  .block{position:absolute;left:52px;right:52px;top:${topPx}px;transform:translateY(-50%);text-align:center;}
  .selo{display:flex;align-items:center;justify-content:center;gap:${Math.round(avaSize*0.30)}px;margin-bottom:${Math.round(fontSize*0.24)}px;}
  .ring{display:inline-flex;padding:${Math.round(avaSize*0.06)}px;border-radius:50%;
    background:linear-gradient(45deg,#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5);box-shadow:0 2px 10px rgba(0,0,0,0.5);}
  .ava{width:${avaSize}px;height:${avaSize}px;border-radius:50%;object-fit:cover;border:${Math.round(avaSize*0.04)}px solid #0a0a0b;display:block;}
  .who{display:flex;flex-direction:column;align-items:flex-start;gap:${Math.round(nameSize*0.06)}px;}
  .l1{display:flex;align-items:center;gap:${Math.round(nameSize*0.24)}px;}
  .nm{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:${nameSize}px;line-height:1;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,0.7);}
  .vf{width:${badge}px;height:${badge}px;}
  .hd{font-family:'Barlow Condensed',sans-serif;font-weight:500;font-size:${Math.round(nameSize*0.78)}px;line-height:1;color:rgba(255,255,255,0.82);text-shadow:0 2px 8px rgba(0,0,0,0.7);}
  .hook{font-family:'Barlow Condensed',sans-serif;font-weight:900;text-transform:uppercase;
    font-size:${fontSize}px;line-height:0.92;letter-spacing:-1.5px;color:#fff;
    text-shadow:0 3px 16px rgba(0,0,0,0.6),0 1px 2px rgba(0,0,0,0.7);}
  .hook em{font-style:normal;color:${GOLD};-webkit-text-fill-color:${GOLD};}
  .cta{margin-top:${Math.round(fontSize*0.26)}px;font-family:'Barlow Condensed',sans-serif;font-weight:800;text-transform:uppercase;
    font-size:${ctaSize}px;letter-spacing:0.5px;color:${GOLD};-webkit-text-fill-color:${GOLD};
    text-shadow:0 2px 8px rgba(0,0,0,0.6);}
</style></head><body>
<div class="stage"><div class="scrim"></div>
  <div class="block">${seloHtml}<div class="hook">${markup(hookText)}</div>${ctaText ? `<div class="cta">${esc(ctaText)}</div>` : ''}</div>
</div></body></html>`;
}

/**
 * Renderiza os overlays do reel em PNGs transparentes 1080×1920 (em 2x internos).
 * Gera DOIS: o do gancho (selo + gancho, vídeo todo) e o do "Leia a legenda"
 * (na mesma posição, pra entrar só no meio→fim). Usa visibility:hidden pra os
 * dois ficarem na posição idêntica (o layout não desloca).
 * @returns {Promise<{hookPng: string, ctaPng: string|null}>}
 */
async function renderOverlays({ hookText, ctaText = '', hookPng, ctaPng = null, fontSize = 96, textY = 0.62, gradient = true, selo = true }) {
  const browser = await getBrowser();
  if (!browser) throw new Error('Playwright/Chromium indisponível — não dá pra renderizar o estilo Dourado (fmteam).');
  // 2x (deviceScaleFactor) → PNG 2160×3840 = texto bem nítido; o ffmpeg reduz
  // pra 1080 (supersampling) e as letras ficam limpas.
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const wantCta = !!(ctaPng && String(ctaText).trim());
  try {
    await page.setContent(buildHtml({ hookText, ctaText, fontSize, textY, gradient, selo }), { waitUntil: 'load', timeout: 15000 });
    try {
      await Promise.race([
        page.evaluate(() => (document.fonts && document.fonts.ready) ? document.fonts.ready : null),
        page.waitForTimeout(4000),
      ]);
    } catch { /* ignora */ }
    await page.waitForTimeout(150);
    fs.mkdirSync(path.dirname(hookPng), { recursive: true });
    if (wantCta) {
      // Passo 1: esconde a CTA (mantém o espaço) → só selo + gancho.
      await page.addStyleTag({ content: '.cta{visibility:hidden!important}' });
      await page.screenshot({ path: hookPng, omitBackground: true });
      // Passo 2: mostra só a CTA (esconde selo + gancho) → posição idêntica.
      await page.addStyleTag({ content: '.cta{visibility:visible!important}.selo,.hook{visibility:hidden!important}' });
      await page.screenshot({ path: ctaPng, omitBackground: true });
    } else {
      await page.screenshot({ path: hookPng, omitBackground: true });
    }
  } finally {
    try { await ctx.close(); } catch { /* ignora */ }
  }
  return { hookPng, ctaPng: wantCta ? ctaPng : null };
}

module.exports = { renderOverlays, buildHtml, markup };
