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
    .replace(/url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/g, (_, u) => `url("${proxyUrl(u)}")`);

  const parser = new DOMParser();
  const doc = parser.parseFromString(proxied, 'text/html');

  const injected: HTMLElement[] = [];
  doc.querySelectorAll('style').forEach(s => {
    const el = document.createElement('style');
    el.textContent = s.textContent;
    document.head.appendChild(el);
    injected.push(el);
  });
  doc.querySelectorAll('link[rel="stylesheet"]').forEach(l => {
    const el = document.createElement('link');
    el.setAttribute('rel', 'stylesheet');
    el.setAttribute('href', (l as HTMLLinkElement).href);
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

      await Promise.all(
        Array.from(container.querySelectorAll('img')).map(img => {
          if (img.complete) return Promise.resolve();
          return new Promise<void>(r => {
            const done = () => r();
            img.onload = done;
            img.onerror = done;
            setTimeout(done, 5000);
          });
        })
      );
      await new Promise(r => setTimeout(r, 200));

      // skipFonts evita que html-to-image tente ler cssRules de stylesheets
      // cross-origin (Google Fonts) — fontes já estão carregadas no document.
      let dataUrl: string;
      try {
        dataUrl = await toPng(slide, {
          width: 1080,
          height: 1350,
          pixelRatio: 1,
          skipFonts: true,
          cacheBust: true,
        });
      } catch (err: any) {
        // html-to-image às vezes lança um Event nativo em vez de Error;
        // converte pra Error com message legível.
        if (err instanceof Error) throw err;
        const detail = err?.message || err?.type || 'erro desconhecido';
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
