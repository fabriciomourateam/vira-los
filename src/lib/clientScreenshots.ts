/**
 * Gera screenshots dos slides de um carrossel no próprio browser via html-to-image
 * e faz upload slide-a-slide para o servidor.
 *
 * Arquitetura:
 * - Zero dependência de Playwright/Chromium no servidor.
 * - Upload individual por slide (evita 413 no body parser).
 * - Timeout em fonts.ready (evita travar no Safari iOS).
 * - Timeout por imagem (evita travar por CORS/imagem lenta).
 */

// PNG 1x1 transparente — fallback quando uma imagem falha ao carregar,
// evita que html-to-image aborte o slide inteiro.
const TRANSPARENT_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export async function generateAndSaveScreenshots(
  api: string,
  html: string,
  folderName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const { toPng } = await import('html-to-image');

  const proxyUrl = (url: string) => `${api}/api/carousel/proxy-image?url=${encodeURIComponent(url)}`;
  const proxied = html
    .replace(/src="(https?:\/\/[^"]+)"/g, (_, u) => `src="${proxyUrl(u)}"`)
    .replace(/src='(https?:\/\/[^']+)'/g, (_, u) => `src="${proxyUrl(u)}"`)
    .replace(/url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/g, (_, u) => `url("${proxyUrl(u)}")`);

  const parser = new DOMParser();
  const doc = parser.parseFromString(proxied, 'text/html');

  // Injeta só os <style> inline — NÃO injeta <link rel="stylesheet"> externos
  // (ex: Google Fonts). Externos geram cross-origin no html-to-image quando ele
  // tenta ler cssRules. Fontes já estão disponíveis no document principal.
  const injected: HTMLElement[] = [];
  doc.querySelectorAll('style').forEach(s => {
    // Remove @import de fontes remotas do próprio CSS inline (mesmo motivo).
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
  container.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1080px;height:1350px;overflow:hidden;z-index:-1;';
  document.body.appendChild(container);

  const savedFiles: string[] = [];

  try {
    await Promise.race([
      document.fonts.ready,
      new Promise(r => setTimeout(r, 3000)),
    ]);
    const slides = Array.from(doc.body.children) as HTMLElement[];

    for (let i = 0; i < slides.length; i++) {
      container.innerHTML = '';
      container.appendChild(slides[i].cloneNode(true));
      const slide = container.firstElementChild as HTMLElement;
      slide.style.width = '1080px';
      slide.style.height = '1350px';
      slide.style.overflow = 'hidden';

      // Remove qualquer <link rel="stylesheet"> que tenha ficado DENTRO do slide.
      slide.querySelectorAll('link[rel="stylesheet"]').forEach(el => el.remove());

      // Aguarda imagens carregarem; se falhar, substitui por pixel transparente
      // antes de chamar toPng (evita que o canvas fique tainted).
      await Promise.all(
        Array.from(container.querySelectorAll('img')).map(img => {
          if (img.complete && img.naturalWidth > 0) return Promise.resolve();
          return new Promise<void>(r => {
            const done = () => r();
            img.onload = done;
            img.onerror = () => {
              img.src = TRANSPARENT_PIXEL;
              done();
            };
            setTimeout(() => {
              if (!img.complete || img.naturalWidth === 0) {
                img.src = TRANSPARENT_PIXEL;
              }
              done();
            }, 5000);
          });
        })
      );
      await new Promise(r => setTimeout(r, 200));

      let dataUrl: string;
      try {
        dataUrl = await toPng(slide, {
          width: 1080,
          height: 1350,
          pixelRatio: 1,
          skipFonts: true,
          imagePlaceholder: TRANSPARENT_PIXEL,
        });
      } catch (err: any) {
        // html-to-image às vezes lança um Event nativo em vez de Error;
        // converte pra Error com message legível.
        if (err instanceof Error) throw err;
        const detail = err?.message || err?.target?.src || err?.type || 'erro desconhecido';
        throw new Error(`html-to-image falhou no slide ${i + 1}: ${detail}`);
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
