/**
 * Gera screenshots dos slides de um carrossel no próprio browser via html-to-image
 * e faz upload slide-a-slide para o servidor.
 *
 * Arquitetura:
 * - Zero dependência de Playwright/Chromium no servidor.
 * - Upload individual por slide (evita 413 no body parser).
 * - Timeout em fonts.ready (evita travar no Safari iOS).
 * - Pré-embute todas as imagens como data URLs antes do toPng, pra eliminar
 *   fetches internos do html-to-image (que falham silenciosamente e abortam
 *   o SVG foreignObject inteiro).
 */

// PNG 1x1 transparente — fallback quando uma imagem falha ao carregar.
const TRANSPARENT_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('FileReader falhou'));
    reader.readAsDataURL(blob);
  });
}

/** Substitui todas as url(https://...) em um texto CSS por data URLs. */
async function inlineUrlsInCss(cssText: string, cache: Map<string, string>): Promise<string> {
  const urlRegex = /url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/g;
  const urls = [...cssText.matchAll(urlRegex)].map((m) => m[1]);
  const unique = [...new Set(urls)];
  await Promise.all(
    unique.map(async (u) => {
      if (cache.has(u)) return;
      try {
        cache.set(u, await urlToDataUrl(u));
      } catch {
        cache.set(u, TRANSPARENT_PIXEL);
      }
    }),
  );
  return cssText.replace(urlRegex, (_, u) => `url("${cache.get(u) || TRANSPARENT_PIXEL}")`);
}

/** Pré-embute `<img src=...>` como data URL, com cache e fallback transparente. */
async function preEmbedImages(root: HTMLElement, cache: Map<string, string>) {
  const imgs = Array.from(root.querySelectorAll('img'));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute('src') || '';
      if (!src || src.startsWith('data:')) return;
      if (cache.has(src)) {
        img.setAttribute('src', cache.get(src)!);
        return;
      }
      try {
        const dataUrl = await urlToDataUrl(src);
        cache.set(src, dataUrl);
        img.setAttribute('src', dataUrl);
      } catch {
        cache.set(src, TRANSPARENT_PIXEL);
        img.setAttribute('src', TRANSPARENT_PIXEL);
      }
    }),
  );
}

/** Pré-embute `background-image: url(...)` inline, usando o mesmo cache. */
async function preEmbedBackgrounds(root: HTMLElement, cache: Map<string, string>) {
  const elements = Array.from(root.querySelectorAll<HTMLElement>('[style*="url("]'));
  await Promise.all(
    elements.map(async (el) => {
      const style = el.getAttribute('style') || '';
      const matches = [...style.matchAll(/url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/g)];
      if (matches.length === 0) return;
      let newStyle = style;
      for (const m of matches) {
        const url = m[1];
        let dataUrl = cache.get(url);
        if (!dataUrl) {
          try {
            dataUrl = await urlToDataUrl(url);
            cache.set(url, dataUrl);
          } catch {
            dataUrl = TRANSPARENT_PIXEL;
            cache.set(url, dataUrl);
          }
        }
        newStyle = newStyle.replace(m[0], `url("${dataUrl}")`);
      }
      el.setAttribute('style', newStyle);
    }),
  );
}

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

  const container = document.createElement('div');
  container.style.cssText =
    'position:fixed;top:-9999px;left:-9999px;width:1080px;height:1350px;overflow:hidden;z-index:-1;';
  document.body.appendChild(container);

  const savedFiles: string[] = [];
  const imageCache = new Map<string, string>(); // url → dataUrl (compartilhado entre slides)
  const injected: HTMLElement[] = [];

  try {
    // Injeta <style> inline após pré-embutir todas as url(...) como data URL.
    // Externos (Google Fonts) NÃO são injetados — causam cross-origin.
    const styles = Array.from(doc.querySelectorAll('style'));
    for (const s of styles) {
      let text = (s.textContent || '').replace(
        /@import\s+url\(['"]?https?:\/\/[^'")\s]+['"]?\)\s*;?/g,
        '',
      );
      text = await inlineUrlsInCss(text, imageCache);
      const el = document.createElement('style');
      el.textContent = text;
      document.head.appendChild(el);
      injected.push(el);
    }

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

      // Pré-embute imagens e backgrounds como data URLs — elimina fetches
      // internos do html-to-image (principal causa de falha no toPng).
      await preEmbedImages(slide, imageCache);
      await preEmbedBackgrounds(slide, imageCache);

      // Aguarda imagens (agora data URLs) concluírem o decode.
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
            setTimeout(done, 3000);
          });
        }),
      );
      await new Promise((r) => setTimeout(r, 100));

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
        if (err instanceof Error) throw err;
        const target = err?.target;
        const tag = target?.tagName || err?.type || 'desconhecido';
        const rawSrc = target?.src || target?.href?.baseVal || '';
        const srcPreview = String(rawSrc).startsWith('data:')
          ? `data:...(${String(rawSrc).length} bytes)`
          : String(rawSrc).slice(0, 140);
        // Log de diagnóstico: todos os srcs que sobraram como URL remota
        const remoteImgs = Array.from(slide.querySelectorAll('img'))
          .map((im) => im.src)
          .filter((s) => !s.startsWith('data:'));
        const remoteBgs = Array.from(slide.querySelectorAll<HTMLElement>('[style*="url("]'))
          .map((el) => el.getAttribute('style') || '')
          .map((st) => st.match(/url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/)?.[1])
          .filter(Boolean);
        console.error('[Screenshots] toPng failed', {
          slide: i + 1,
          targetTag: tag,
          targetSrc: srcPreview,
          remoteImgs,
          remoteBgs,
        });
        throw new Error(
          `html-to-image falhou no slide ${i + 1} (${tag}${srcPreview ? ': ' + srcPreview : ''})`,
        );
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
