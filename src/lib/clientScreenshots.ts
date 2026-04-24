/**
 * Gera screenshots dos slides de um carrossel no próprio browser via html2canvas-pro
 * e faz upload slide-a-slide para o servidor.
 *
 * Notas sobre limitações do html2canvas-pro e workarounds aplicados:
 * - &amp; em URLs: DOMParser/outerHTML re-escapa '&' → '&amp;' em atributos, quebrando
 *   URLs com query params (ex.: Unsplash). Corrigido decodificando antes do proxying.
 * - filter:brightness() ignorado: convertido para overlay div rgba antes do render.
 * - transform:scale() mal suportado: convertido para width/height/translate equivalente.
 * - background-image async: pré-carregado via Image() antes do html2canvas iniciar.
 */

const TRANSPARENT_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// ─── Pré-processamento dos elementos .bg/.slide-bg ──────────────────────────

/**
 * Corrige background-position: calc(50% ± Xpx) calc(50% ± Ypx).
 * html2canvas-pro não suporta calc() em background-position, resultando em fundo preto.
 * Converte para valores percentuais equivalentes.
 */
function fixCalcBackgroundPosition(container: HTMLElement): void {
  const bgEls = Array.from(container.querySelectorAll('[style]')) as HTMLElement[];
  for (const el of bgEls) {
    let s = el.getAttribute('style') || '';
    if (!s.includes('calc(50%')) continue;

    // Lê dimensões efetivas (podem ter sido alteradas por convertScaleTransforms)
    const wMatch = /width\s*:\s*([\d.]+)%/.exec(s);
    const hMatch = /height\s*:\s*([\d.]+)%/.exec(s);
    const W = wMatch ? (parseFloat(wMatch[1]) / 100) * 1080 : 1080;
    const H = hMatch ? (parseFloat(hMatch[1]) / 100) * 1350 : 1350;

    s = s.replace(
      /background-position\s*:\s*calc\(50%\s*([+-])\s*([\d.]+)px\)\s+calc\(50%\s*([+-])\s*([\d.]+)px\)/gi,
      (_, sx, vx, sy, vy) => {
        const ox = (sx === '-' ? -1 : 1) * parseFloat(vx);
        const oy = (sy === '-' ? -1 : 1) * parseFloat(vy);
        const px = 50 + (ox / W) * 100;
        const py = 50 + (oy / H) * 100;
        return `background-position: ${Math.max(0, Math.min(100, px)).toFixed(1)}% ${Math.max(0, Math.min(100, py)).toFixed(1)}%`;
      },
    );
    el.setAttribute('style', s);
  }
}

/**
 * Corrige renderização de texto no html2canvas-pro:
 * 1. Converte <div> dentro de containers de texto para <br><span> —
 *    html2canvas perde espaços entre palavras ao encontrar divs aninhadas.
 * 2. Adiciona word-spacing explícito para evitar que spans/hl colapsem espaços.
 */
function fixHtml2canvasTextRendering(container: HTMLElement): void {
  const TEXT_SELECTORS = [
    '.cover-title', '.content-title', '.content-body', '.cta-title',
    '.split-title', '.title', '.subtitle', '.narrative-text',
    '.cover-subtitle', '.cta-subtitle', '.step-text', '.tip-text',
  ];
  for (const sel of TEXT_SELECTORS) {
    container.querySelectorAll(sel).forEach(outer => {
      // Converte <div> aninhadas para <br><span> (preserva estilo)
      (outer as HTMLElement).querySelectorAll('div').forEach(inner => {
        const br = document.createElement('br');
        const span = document.createElement('span');
        const inStyle = inner.getAttribute('style');
        if (inStyle) span.setAttribute('style', inStyle);
        span.innerHTML = inner.innerHTML;
        inner.before(br);
        inner.replaceWith(span);
      });
      // word-spacing explícito previne colapso de espaços pelo html2canvas
      (outer as HTMLElement).style.wordSpacing = '0.2em';
    });
  }
}

/**
 * html2canvas-pro não suporta filter:brightness().
 * Converte para overlay div rgba equivalente (que html2canvas renderiza normalmente).
 * Também lida com o valor decimal do computed style (.clean-cta .bg { filter: brightness(0.3) }).
 */
function applyBrightnessOverlays(container: HTMLElement): void {
  const bgEls = Array.from(container.querySelectorAll('.bg, .slide-bg')) as HTMLElement[];
  for (const el of bgEls) {
    const inlineStyle = el.getAttribute('style') || '';

    // Prioridade: inline style (ex.: "filter: brightness(30%)")
    const inlineMatch = inlineStyle.match(/filter\s*:\s*brightness\(\s*(\d+(?:\.\d+)?)\s*%\s*\)/i);

    // Fallback: computed style CSS class (ex.: .clean-cta .bg { filter: brightness(0.3) })
    let factor: number;
    if (inlineMatch) {
      factor = parseFloat(inlineMatch[1]) / 100; // "30%" → 0.30
    } else {
      try {
        const cf = window.getComputedStyle(el).getPropertyValue('filter') || '';
        const cm = cf.match(/brightness\(\s*(\d+(?:\.\d+)?)\s*\)/);
        factor = cm ? parseFloat(cm[1]) : 1.0; // computed já é decimal (0.3 = 30%)
      } catch {
        factor = 1.0;
      }
    }

    if (Math.abs(factor - 1.0) < 0.02) continue; // ~100% — sem ajuste

    // Overlay imediatamente após .bg (mesmo z-index → acima por DOM order, abaixo do .overlay real)
    const alpha = factor < 1.0 ? Math.min(1, 1 - factor) : 0;
    if (alpha > 0.01) {
      const ov = document.createElement('div');
      ov.setAttribute(
        'style',
        `position:absolute;inset:0;z-index:0;background:rgba(0,0,0,${alpha.toFixed(4)});pointer-events:none;`,
      );
      el.insertAdjacentElement('afterend', ov);
    }

    // Remove filter do inline style
    if (inlineMatch) {
      el.setAttribute('style', inlineStyle.replace(/filter\s*:\s*brightness\([^)]+\)\s*;?\s*/i, '').trim());
    }
  }
}

/**
 * html2canvas-pro não renderiza corretamente transform:scale() em elementos com
 * position:absolute;inset:0 (a imagem parece cortada ou deslocada).
 *
 * Converte para width/height percentuais + transform:translate(-50%,-50%) equivalente:
 * - Exemplo: scale(1.5) → width:150%; height:150%; top:50%; left:50%; translate(-50%,-50%)
 * - translate(-50%,-50%) é relativo ao próprio elemento, centrando-o no pai.
 * - html2canvas renderiza translate() corretamente.
 *
 * Também converte scale(S) translate(Tx%, Ty%) (zoom + pan) adicionando o offset.
 */
function convertScaleTransforms(container: HTMLElement): void {
  const bgEls = Array.from(container.querySelectorAll('.bg, .slide-bg')) as HTMLElement[];
  for (const el of bgEls) {
    const style = el.getAttribute('style') || '';

    // Detecta transform: scale(S) ou scale(S) translate(Tx%, Ty%)
    const scaleM = style.match(/transform\s*:\s*scale\(\s*(\d+(?:\.\d+)?)\s*\)(?:\s*translate\(\s*(-?[\d.]+)%\s*,\s*(-?[\d.]+)%\s*\))?/i);
    if (!scaleM) continue;

    const S  = parseFloat(scaleM[1]);
    const tx = parseFloat(scaleM[2] ?? '0'); // % do elemento original
    const ty = parseFloat(scaleM[3] ?? '0');

    if (S < 1.005) continue; // zoom insignificante

    // Remove transform e inset do inline style
    let newStyle = style
      .replace(/transform\s*:[^;]+;?\s*/i, '')
      .replace(/inset\s*:\s*0\s*;?\s*/i, '')
      .trim();

    // Aplica dimensões percentuais + translate para centralizar + offset de pan
    // translate(-50%,-50%) centraliza; o offset adicional (S*tx, S*ty) aplica o pan relativo
    const totalTx = -50 + S * tx;
    const totalTy = -50 + S * ty;
    newStyle +=
      ` position:absolute; width:${(S * 100).toFixed(2)}%; height:${(S * 100).toFixed(2)}%;` +
      ` top:50%; left:50%;` +
      ` transform:translate(${totalTx.toFixed(2)}%,${totalTy.toFixed(2)}%);`;

    el.setAttribute('style', newStyle);
  }
}

/**
 * Pré-carrega imagens de background-image CSS antes do html2canvas.
 * html2canvas inicia drawImage imediatamente; sem pré-load o fundo fica branco.
 */
async function preloadBackgroundImages(container: HTMLElement): Promise<void> {
  const BG_URL_RE = /background-image\s*:\s*url\(\s*["']?([^"')]+)["']?\s*\)/i;
  const urls: string[] = [];
  (Array.from(container.querySelectorAll('[style]')) as HTMLElement[]).forEach(el => {
    const m = (el.getAttribute('style') || '').match(BG_URL_RE);
    if (m && m[1] && !m[1].startsWith('data:')) urls.push(m[1]);
  });
  if (!urls.length) return;

  await Promise.all(urls.map(url =>
    new Promise<void>(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve();
      img.onerror = () => resolve();
      setTimeout(resolve, 12000);
      img.src = url;
    }),
  ));
}

// ─── Exportação principal ────────────────────────────────────────────────────

export async function generateAndSaveScreenshots(
  api: string,
  html: string,
  folderName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const { default: html2canvas } = await import('html2canvas-pro');

  // ── Fix 1: &amp; → & ──────────────────────────────────────────────────────
  // DOMParser/el.outerHTML re-escapa '&' como '&amp;' em valores de atributos.
  // Isso quebra URLs com query params (ex.: Unsplash: ?crop=entropy&cs=tinysrgb...).
  // O proxy tentaria buscar a URL com '&amp;' literal → Unsplash retorna erro → fundo preto.
  const unescaped = html.replace(/&amp;/g, '&');

  // ── Proxy CORS ────────────────────────────────────────────────────────────
  const proxyUrl = (url: string) =>
    `${api}/api/carousel/proxy-image?url=${encodeURIComponent(url)}`;
  const proxied = unescaped
    .replace(/src="(https?:\/\/[^"]+)"/g,   (_, u) => `src="${proxyUrl(u)}"`)
    .replace(/src='(https?:\/\/[^']+)'/g,   (_, u) => `src="${proxyUrl(u)}"`)
    .replace(/url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/g, (_, u) => `url("${proxyUrl(u)}")`);

  const parser = new DOMParser();
  const doc = parser.parseFromString(proxied, 'text/html');

  // Injeta <style> sem @import de fontes remotas (causam CORS)
  const injected: HTMLElement[] = [];
  doc.querySelectorAll('style').forEach(s => {
    const cleaned = (s.textContent || '').replace(
      /@import\s+url\(['"]?https?:\/\/[^'")\s]+['"]?\)\s*;?/g, '',
    );
    const el = document.createElement('style');
    el.textContent = cleaned;
    document.head.appendChild(el);
    injected.push(el);
  });

  const container = document.createElement('div');
  container.style.cssText =
    'position:fixed;top:-9999px;left:-9999px;width:1080px;height:1350px;overflow:hidden;z-index:-1;';
  document.body.appendChild(container);

  const savedFiles: string[] = [];

  try {
    await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 3000))]);

    const slides = Array.from(doc.body.children) as HTMLElement[];

    for (let i = 0; i < slides.length; i++) {
      container.innerHTML = '';
      container.appendChild(slides[i].cloneNode(true));
      const slide = container.firstElementChild as HTMLElement;
      slide.style.width    = '1080px';
      slide.style.height   = '1350px';
      slide.style.overflow = 'hidden';
      slide.querySelectorAll('link[rel="stylesheet"]').forEach(el => el.remove());

      // ── Pré-processamento ─────────────────────────────────────────────────

      // 0. Limpa ;; duplicados nos atributos style (artefato de edições múltiplas)
      container.querySelectorAll('[style]').forEach(el => {
        const s = el.getAttribute('style') || '';
        if (s.includes(';;')) el.setAttribute('style', s.replace(/;{2,}/g, ';'));
      });

      // 1. Pré-carrega background-images CSS (evita fundo branco no render)
      await preloadBackgroundImages(container);

      // 2. filter:brightness() → overlay rgba (html2canvas ignora CSS filter)
      applyBrightnessOverlays(container);

      // 3. transform:scale() → width/height/translate equivalente
      //    (html2canvas não renderiza scale() em elementos position:absolute corretamente)
      convertScaleTransforms(container);

      // 4. background-position: calc(50% ± Xpx) → percentual equivalente
      //    (html2canvas não suporta calc() em background-position → fundo preto)
      fixCalcBackgroundPosition(container);

      // 5. <div> aninhada em container de texto → <br><span> + word-spacing explícito
      //    (html2canvas perde espaços entre palavras com divs aninhadas: "ESTAVAPERDENDO")
      fixHtml2canvasTextRendering(container);

      // Aguarda <img> tags carregarem
      await Promise.all(
        Array.from(container.querySelectorAll('img')).map(img => {
          if ((img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0)
            return Promise.resolve();
          return new Promise<void>(r => {
            (img as HTMLImageElement).onload  = () => r();
            (img as HTMLImageElement).onerror = () => {
              console.warn('[Screenshots] img load failed:', (img as HTMLImageElement).src);
              (img as HTMLImageElement).src = TRANSPARENT_PIXEL;
              r();
            };
            setTimeout(r, 8000);
          });
        }),
      );
      await new Promise(r => setTimeout(r, 150));

      let dataUrl: string;
      try {
        const canvas = await html2canvas(slide, {
          width: 1080, height: 1350,
          useCORS: true, allowTaint: false,
          backgroundColor: null, logging: false,
          imageTimeout: 15000,
        });
        dataUrl = canvas.toDataURL('image/png');
      } catch (err: any) {
        console.error('[Screenshots] html2canvas failed', { slide: i + 1, err });
        throw new Error(`html2canvas falhou no slide ${i + 1}: ${err?.message || 'erro'}`);
      }

      const res = await fetch(`${api}/api/carousel/save-screenshots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderName, screenshots: [{ slideNum: i, dataUrl }] }),
      });
      if (!res.ok) throw new Error(`Falha ao salvar slide ${i + 1} (HTTP ${res.status})`);
      const json = await res.json();
      if (Array.isArray(json.screenshots)) savedFiles.push(...json.screenshots);
      onProgress?.(i + 1, slides.length);
    }
  } finally {
    injected.forEach(el => el.remove());
    container.remove();
  }
  return savedFiles;
}
