/**
 * Gera screenshots dos slides de um carrossel no próprio browser via html2canvas-pro
 * e faz upload slide-a-slide para o servidor.
 *
 * Arquitetura:
 * - html2canvas-pro percorre o DOM e desenha direto no canvas (drawImage/fillText),
 *   evitando a armadilha do html-to-image com SVG foreignObject — em que o Chrome
 *   bloqueia recursos internos quando a SVG é carregada como img data-URL.
 * - Zero dependência de Playwright/Chromium no servidor.
 * - Upload individual por slide (evita 413 no body parser).
 * - Proxy CORS de imagens externas via /api/carousel/proxy-image.
 *
 * Notas sobre limitações do html2canvas-pro:
 * - Não suporta CSS `filter: brightness()` — substitui por overlay rgba antes de renderizar.
 * - background-image carregado via CSS é assíncrono — pré-carrega via Image() antes do canvas.
 */

const TRANSPARENT_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/**
 * html2canvas-pro não suporta filter:brightness(). Antes de renderizar cada slide,
 * percorre os elementos .bg/.slide-bg e:
 * 1. Lê o brightness do inline style OU do computed style (CSS class).
 * 2. Insere um overlay div rgba equivalente (html2canvas renderiza divs normalmente).
 * 3. Remove o filter do inline style para evitar interferência.
 */
function applyBrightnessOverlays(container: HTMLElement): void {
  const bgEls = Array.from(container.querySelectorAll('.bg, .slide-bg')) as HTMLElement[];
  for (const el of bgEls) {
    const inlineStyle = el.getAttribute('style') || '';

    // Prioridade: inline style (aplicado pelo editor)
    const inlineMatch = inlineStyle.match(/filter\s*:\s*brightness\(\s*(\d+(?:\.\d+)?)\s*%\s*\)/i);

    // Fallback: computed style (CSS class, ex.: .clean-cta .bg { filter: brightness(0.3) })
    let factor: number;
    if (inlineMatch) {
      factor = parseFloat(inlineMatch[1]) / 100; // "30%" → 0.30
    } else {
      try {
        const computed = window.getComputedStyle(el);
        const cf = computed.getPropertyValue('filter') || '';
        const cm = cf.match(/brightness\(\s*(\d+(?:\.\d+)?)\s*\)/);
        factor = cm ? parseFloat(cm[1]) : 1.0; // computed já é decimal (0.3 = 30%)
      } catch {
        factor = 1.0;
      }
    }

    if (Math.abs(factor - 1.0) < 0.02) continue; // ~100% — sem ajuste necessário

    // Insere overlay imediatamente após o elemento .bg (z-index idêntico = acima por DOM order)
    const alpha = factor < 1.0
      ? Math.min(1, 1 - factor)          // escurecer
      : 0;                                // clarear ainda não implementado (não usado nos templates)
    if (alpha > 0.01) {
      const overlay = document.createElement('div');
      overlay.setAttribute(
        'style',
        `position:absolute;inset:0;z-index:0;background:rgba(0,0,0,${alpha.toFixed(4)});pointer-events:none;`,
      );
      el.insertAdjacentElement('afterend', overlay);
    }

    // Remove o filter do inline style (o overlay assumiu o papel)
    if (inlineMatch) {
      el.setAttribute(
        'style',
        inlineStyle.replace(/filter\s*:\s*brightness\([^)]+\)\s*;?\s*/i, '').trim(),
      );
    }
  }
}

/**
 * Pré-carrega todas as imagens de background-image (CSS inline) do container.
 * html2canvas pede drawImage logo que inicia — sem este pré-load a imagem pode
 * ainda não ter chegado e o fundo fica em branco.
 */
async function preloadBackgroundImages(container: HTMLElement): Promise<void> {
  const BG_URL_RE = /background-image\s*:\s*url\(\s*["']?([^"')]+)["']?\s*\)/i;
  const allEls = Array.from(container.querySelectorAll('[style]')) as HTMLElement[];
  const urls: string[] = [];
  for (const el of allEls) {
    const s = el.getAttribute('style') || '';
    const m = s.match(BG_URL_RE);
    if (m && m[1] && !m[1].startsWith('data:')) urls.push(m[1]);
  }
  if (urls.length === 0) return;

  await Promise.all(
    urls.map(
      url =>
        new Promise<void>(resolve => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve();
          img.onerror = () => resolve(); // não bloqueia em erro; html2canvas tentará de novo
          setTimeout(resolve, 12000);    // timeout generoso para proxies
          img.src = url;
        }),
    ),
  );
}

export async function generateAndSaveScreenshots(
  api: string,
  html: string,
  folderName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const { default: html2canvas } = await import('html2canvas-pro');

  // Proxy: URLs remotas passam pelo nosso backend (que retorna CORS liberado),
  // senão o canvas fica tainted ao baixar.
  const proxyUrl = (url: string) =>
    `${api}/api/carousel/proxy-image?url=${encodeURIComponent(url)}`;
  const proxied = html
    .replace(/src="(https?:\/\/[^"]+)"/g, (_, u) => `src="${proxyUrl(u)}"`)
    .replace(/src='(https?:\/\/[^']+)'/g, (_, u) => `src="${proxyUrl(u)}"`)
    .replace(/url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/g, (_, u) => `url("${proxyUrl(u)}")`);

  const parser = new DOMParser();
  const doc = parser.parseFromString(proxied, 'text/html');

  // Injeta só os <style> inline (sem @import de fontes remotas, que causam CORS).
  const injected: HTMLElement[] = [];
  doc.querySelectorAll('style').forEach((s) => {
    const cleaned = (s.textContent || '').replace(
      /@import\s+url\(['"]?https?:\/\/[^'")\s]+['"]?\)\s*;?/g,
      '',
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
    await Promise.race([
      document.fonts.ready,
      new Promise((r) => setTimeout(r, 3000)),
    ]);

    const slides = Array.from(doc.body.children) as HTMLElement[];

    for (let i = 0; i < slides.length; i++) {
      container.innerHTML = '';
      container.appendChild(slides[i].cloneNode(true));
      const slide = container.firstElementChild as HTMLElement;
      slide.style.width = '1080px';
      slide.style.height = '1350px';
      slide.style.overflow = 'hidden';
      slide.querySelectorAll('link[rel="stylesheet"]').forEach((el) => el.remove());

      // ── Pré-processamento antes do html2canvas ────────────────────────────────

      // 1. Pré-carrega imagens de fundo CSS (background-image) — evita fundo branco
      //    por imagem ainda não carregada quando html2canvas começa a renderizar.
      await preloadBackgroundImages(container);

      // 2. Converte filter:brightness() → overlay div rgba
      //    html2canvas-pro não suporta CSS filter; esta conversão garante que
      //    o escurecimento do fundo apareça corretamente no PNG gerado.
      applyBrightnessOverlays(container);

      // Garante que imagens <img> carregaram (html2canvas usa drawImage e quer imgs prontas).
      await Promise.all(
        Array.from(container.querySelectorAll('img')).map((img) => {
          if (img.complete && img.naturalWidth > 0) return Promise.resolve();
          return new Promise<void>((r) => {
            const done = () => r();
            img.onload = done;
            img.onerror = () => {
              console.warn('[Screenshots] Img failed to load:', img.src);
              img.src = TRANSPARENT_PIXEL;
              done();
            };
            setTimeout(done, 8000);
          });
        }),
      );
      await new Promise((r) => setTimeout(r, 150));

      let dataUrl: string;
      try {
        const canvas = await html2canvas(slide, {
          width: 1080,
          height: 1350,
          useCORS: true,
          allowTaint: false,
          backgroundColor: null,
          logging: false,
          imageTimeout: 15000,
        });
        dataUrl = canvas.toDataURL('image/png');
      } catch (err: any) {
        const msg = err?.message || err?.type || 'erro desconhecido';
        console.error('[Screenshots] html2canvas failed', { slide: i + 1, err });
        throw new Error(`html2canvas falhou no slide ${i + 1}: ${msg}`);
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
    injected.forEach((el) => el.remove());
    container.remove();
  }
  return savedFiles;
}
