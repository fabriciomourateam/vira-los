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
 */

const TRANSPARENT_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

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

      // Garante que imagens carregaram (html2canvas usa drawImage e quer imgs prontas).
      await Promise.all(
        Array.from(container.querySelectorAll('img')).map((img) => {
          if (img.complete && img.naturalWidth > 0) return Promise.resolve();
          return new Promise<void>((r) => {
            const done = () => r();
            img.onload = done;
            img.onerror = () => {
              img.src = TRANSPARENT_PIXEL;
              done();
            };
            setTimeout(done, 5000);
          });
        }),
      );
      await new Promise((r) => setTimeout(r, 100));

      let dataUrl: string;
      try {
        const canvas = await html2canvas(slide, {
          width: 1080,
          height: 1350,
          useCORS: true,
          allowTaint: false,
          backgroundColor: null,
          logging: false,
          imageTimeout: 10000,
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
