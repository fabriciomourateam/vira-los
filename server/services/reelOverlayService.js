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

// HTML 1080×1920 transparente: sombra embaixo + gancho (dourado no **) + CTA.
function buildHtml({ hookText, ctaText = '', fontSize = 96, textY = 0.62, gradient = true }) {
  const G = 'linear-gradient(165deg, #B8860B 0%, #FFC300 50%, #FFE58A 100%)';
  const scrim = gradient
    ? 'background:linear-gradient(to bottom, rgba(0,0,0,0) 36%, rgba(0,0,0,0.5) 60%, rgba(0,0,0,0.92) 100%);'
    : '';
  const topPx = Math.round(Math.max(0.2, Math.min(0.9, textY)) * 1920);
  const ctaSize = Math.round(fontSize * 0.5);
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800;900&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;padding:0;width:1080px;height:1920px;background:transparent;overflow:hidden;}
  .stage{position:relative;width:1080px;height:1920px;}
  .scrim{position:absolute;inset:0;${scrim}}
  .block{position:absolute;left:56px;right:56px;top:${topPx}px;transform:translateY(-50%);text-align:center;}
  .hook{font-family:'Barlow Condensed',sans-serif;font-weight:800;text-transform:uppercase;
    font-size:${fontSize}px;line-height:0.95;letter-spacing:-1px;color:#fff;
    text-shadow:0 3px 16px rgba(0,0,0,0.55),0 1px 2px rgba(0,0,0,0.6);}
  .hook em{font-style:normal;background:${G};-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;}
  .cta{margin-top:24px;font-family:'Barlow Condensed',sans-serif;font-weight:800;text-transform:uppercase;
    font-size:${ctaSize}px;letter-spacing:0.5px;
    background:${G};-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
    filter:drop-shadow(0 2px 6px rgba(0,0,0,0.5));}
</style></head><body>
<div class="stage"><div class="scrim"></div>
  <div class="block"><div class="hook">${markup(hookText)}</div>${ctaText ? `<div class="cta">${esc(ctaText)}</div>` : ''}</div>
</div></body></html>`;
}

/**
 * Renderiza o overlay do reel num PNG transparente 1080×1920.
 * @returns {Promise<string>} outPng
 */
async function renderHookOverlay({ hookText, ctaText = '', outPng, fontSize = 96, textY = 0.62, gradient = true }) {
  const browser = await getBrowser();
  if (!browser) throw new Error('Playwright/Chromium indisponível — não dá pra renderizar o estilo Dourado (fmteam).');
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  try {
    await page.setContent(buildHtml({ hookText, ctaText, fontSize, textY, gradient }), { waitUntil: 'networkidle', timeout: 30000 });
    try { await page.evaluate(() => (document.fonts && document.fonts.ready) ? document.fonts.ready : null); } catch { /* ignora */ }
    await page.waitForTimeout(250);
    fs.mkdirSync(path.dirname(outPng), { recursive: true });
    await page.screenshot({ path: outPng, omitBackground: true });
  } finally {
    try { await ctx.close(); } catch { /* ignora */ }
  }
  return outPng;
}

module.exports = { renderHookOverlay, buildHtml, markup };
