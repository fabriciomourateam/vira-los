import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Download, RefreshCw, Loader2, Image, Edit3, LayoutList, Eye, Save, Trash2,
  BookmarkPlus, GripVertical, Plus, Minus, Upload, MousePointer2, Type,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface WordHighlight {
  word: string;
  color: string;
}

interface TextBlock {
  className: string;
  text: string;
  isMain: boolean;
  fontSize?: number;
  color?: string;                   // cor de todo o bloco
  fontFamily?: string;              // família de fonte
  highlights?: WordHighlight[];     // palavras específicas com cor própria
  textTransform?: 'none' | 'uppercase' | '';  // controle de caixa (uppercase/normal)
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  richHtml?: string;               // HTML formatado do editor rich text
  deleted?: boolean;               // esconde o elemento no HTML final
  posTop?: number;                 // posição Y para custom-text (salva pelo drag)
  posLeft?: number;                // posição X para custom-text (salva pelo drag)
}

interface ElementOverride {
  top?: string;
  left?: string;
  right?: string;
  bottom?: string;
  transform?: string;  // para elementos em flow (translate)
}

interface OverlayConfig {
  opacity: number;       // 0–1
  direction: 'to bottom' | 'to top' | 'to right' | 'radial' | 'none';
  color: string;         // ex: '0,0,0' ou '80,0,120'
}

const OVERLAY_PRESETS: { label: string; value: OverlayConfig['direction'] }[] = [
  { label: 'Escurecer baixo ↓', value: 'to bottom' },
  { label: 'Escurecer cima ↑', value: 'to top' },
  { label: 'Escurecer lateral →', value: 'to right' },
  { label: 'Escurecer centro', value: 'radial' },
  { label: 'Sem gradiente', value: 'none' },
];

// Color input que só propaga ao soltar (evita lag por re-renders em cada pixel)
function LazyColorInput({ value, onChange, className, title }: {
  value: string; onChange: (v: string) => void; className?: string; title?: string;
}) {
  const [local, setLocal] = React.useState(value);
  React.useEffect(() => { setLocal(value); }, [value]);
  return (
    <input
      type="color"
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={e => onChange(e.target.value)}
      className={className}
      title={title}
    />
  );
}

function buildOverlayStyle(cfg: OverlayConfig): string {
  const { opacity, direction, color } = cfg;
  const c = color || '0,0,0';
  const hi = opacity.toFixed(2);
  const lo = (opacity * 0.15).toFixed(2);
  switch (direction) {
    case 'to top':    return `linear-gradient(to top, rgba(${c},${hi}) 0%, rgba(${c},${lo}) 60%, rgba(${c},0) 100%)`;
    case 'to right':  return `linear-gradient(to right, rgba(${c},${hi}) 0%, rgba(${c},${lo}) 60%, rgba(${c},0) 100%)`;
    case 'radial':    return `radial-gradient(ellipse at center, rgba(${c},${(opacity*0.1).toFixed(2)}) 0%, rgba(${c},${hi}) 100%)`;
    case 'none':      return 'rgba(0,0,0,0)';
    default:          return `linear-gradient(to bottom, rgba(${c},${lo}) 0%, rgba(${c},${hi}) 55%, rgba(${c},${Math.min(1,opacity*1.1).toFixed(2)}) 100%)`;
  }
}

interface EditableSlide {
  index: number;
  html: string;
  outerHtml: string;
  type: 'cover' | 'editorial' | 'cta';
  bgImageUrl: string | null;
  texts: TextBlock[];
  hasBadge: boolean;
}

export interface CarouselEditorProps {
  html: string;
  folderName: string;
  topic: string;
  numSlides?: number;
  legenda?: string;
  config?: Record<string, unknown>;
  onScreenshotsUpdated: (screenshots: string[]) => void;
  onTemplateSaved?: () => void;
  onHtmlUpdated?: (html: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BG_IMAGE_REGEX = /background-image\s*:\s*url\(["']?([^"')]+)["']?\)/i;
const FONT_SIZE_REGEX = /font-size\s*:\s*([\d.]+)\s*px/i;
const COLOR_REGEX = /(?:^|;)\s*color\s*:\s*([^;]+)/i;
const TEXT_TRANSFORM_REGEX = /text-transform\s*:\s*([^;]+)/i;
const TEXT_ALIGN_REGEX = /text-align\s*:\s*([^;]+)/i;
const FONT_FAMILY_REGEX = /(?:^|;)\s*font-family\s*:\s*([^;]+)/i;
const POS_TOP_REGEX = /(?:^|;)\s*top\s*:\s*([\d.]+)\s*px/i;
const POS_LEFT_REGEX = /(?:^|;)\s*left\s*:\s*([\d.]+)\s*px/i;

const FONT_OPTIONS = [
  'Inter', 'Poppins', 'Montserrat', 'Raleway', 'Oswald',
  'Playfair Display', 'Bebas Neue', 'Roboto', 'Lato', 'Open Sans',
  'Ubuntu', 'Nunito', 'DM Sans', 'Space Grotesk', 'Syne',
];

function extractFontSize(el: Element): number | undefined {
  const m = FONT_SIZE_REGEX.exec(el.getAttribute('style') || '');
  return m ? parseFloat(m[1]) : undefined;
}

function extractFontFamily(el: Element): string | undefined {
  const m = FONT_FAMILY_REGEX.exec(el.getAttribute('style') || '');
  return m ? m[1].trim().replace(/['"]/g, '') : undefined;
}

function extractPosTop(el: Element): number | undefined {
  const m = POS_TOP_REGEX.exec(el.getAttribute('style') || '');
  return m ? parseFloat(m[1]) : undefined;
}

function extractPosLeft(el: Element): number | undefined {
  const m = POS_LEFT_REGEX.exec(el.getAttribute('style') || '');
  return m ? parseFloat(m[1]) : undefined;
}

function extractBgImageUrl(el: Element): string | null {
  const bgEl = el.querySelector('.slide-bg, .bg');
  if (bgEl) {
    const m = BG_IMAGE_REGEX.exec(bgEl.getAttribute('style') || '');
    if (m) return m[1];
  }
  const m = BG_IMAGE_REGEX.exec(el.getAttribute('style') || '');
  return m ? m[1] : null;
}

function detectSlideType(el: Element): 'cover' | 'editorial' | 'cta' {
  const c = el.className || '';
  if (c.includes('clean-cover')) return 'cover';
  if (c.includes('clean-cta')) return 'cta';
  if (c.includes('clean-content') || c.includes('slide-editorial')) return 'editorial';
  if (el.querySelector('.cta') || c.includes('cta')) return 'cta';
  return 'editorial';
}

const TEXT_SELECTORS = [
  { selector: '.title', isMain: true },
  { selector: '.subtitle', isMain: false },
  { selector: '.subtitle-accent', isMain: false },
  { selector: '.narrative-text', isMain: true },
  { selector: '.cover-title', isMain: true },
  { selector: '.content-title', isMain: true },
  { selector: '.content-body', isMain: true },
  { selector: '.cta-title', isMain: true },
  { selector: '.profile-name', isMain: false },
  { selector: '.profile-handle', isMain: false },
  { selector: '.follow-pill', isMain: false },
  { selector: '.swipe-hint', isMain: false },
  { selector: '.footer-name-pill', isMain: false },
  { selector: '.footer-handle-pill', isMain: false },
  { selector: '.header-name', isMain: false },
  { selector: '.header-handle', isMain: false },
  { selector: '.slide-number', isMain: false },
  { selector: '.custom-text', isMain: true },
];

// Converte <br> → \n para exibir corretamente no textarea
function getTextWithLineBreaks(node: Element): string {
  let result = '';
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      result += child.textContent ?? '';
    } else if ((child as Element).tagName === 'BR') {
      result += '\n';
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      result += getTextWithLineBreaks(child as Element);
    }
  }
  return result.trim();
}

// Escapa HTML e converte \n → <br>; aplica destaques por palavra
function textToHtml(text: string, highlights?: WordHighlight[]): string {
  const activeHl = (highlights ?? []).filter(h => h.word.trim());

  if (!activeHl.length) {
    return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
  }

  // Substitui palavras por marcadores únicos, depois escapa e restaura como <span>
  const markers: Record<string, string> = {};
  let processed = text;
  for (const { word, color } of activeHl) {
    const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    processed = processed.replace(re, match => {
      const key = `\xAB${Object.keys(markers).length}\xBB`;
      markers[key] = `<span style="color:${color}">${match.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>`;
      return key;
    });
  }

  let result = processed.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
  for (const [key, html] of Object.entries(markers)) {
    result = result.replaceAll(key, html);
  }
  return result;
}

// Extrai destaques de palavras a partir de <span style="color:..."> já presentes no HTML
function extractWordHighlights(el: Element): WordHighlight[] {
  const seen = new Map<string, string>(); // word → color
  for (const span of Array.from(el.querySelectorAll('span[style]'))) {
    const style = span.getAttribute('style') || '';
    const m = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style);
    if (!m) continue;
    const color = m[1].trim();
    const word = span.textContent?.trim() || '';
    if (word && !seen.has(word)) seen.set(word, color);
  }
  return Array.from(seen.entries()).map(([word, color]) => ({ word, color }));
}

// Extrai cor inline do próprio elemento (não de filhos)
function extractBlockColor(el: Element): string | undefined {
  const style = el.getAttribute('style') || '';
  const m = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style);
  return m ? m[1].trim() : undefined;
}

function extractTextTransform(el: Element): TextBlock['textTransform'] {
  const style = el.getAttribute('style') || '';
  const m = TEXT_TRANSFORM_REGEX.exec(style);
  return m ? m[1].trim() as TextBlock['textTransform'] : undefined;
}

function extractTextAlign(el: Element): TextBlock['textAlign'] {
  const style = el.getAttribute('style') || '';
  const m = TEXT_ALIGN_REGEX.exec(style);
  return m ? m[1].trim() as TextBlock['textAlign'] : undefined;
}

function extractTextBlocks(el: Element): TextBlock[] {
  const blocks: TextBlock[] = [];
  const seen = new Set<Element>();
  for (const { selector, isMain } of TEXT_SELECTORS) {
    for (const node of Array.from(el.querySelectorAll(selector))) {
      if (seen.has(node)) continue;
      seen.add(node);
      const className = node.className || selector.slice(1);
      const highlights = extractWordHighlights(node);
      // Para elementos com position:absolute (como custom-text), extrai top/left
      // Isso garante que re-parse do HTML reconstruído preserve as posições do drag
      const posTop = extractPosTop(node);
      const posLeft = extractPosLeft(node);
      blocks.push({
        className: typeof className === 'string' ? className : selector.slice(1),
        text: getTextWithLineBreaks(node),
        isMain,
        fontSize: extractFontSize(node),
        color: extractBlockColor(node),
        fontFamily: extractFontFamily(node),
        highlights: highlights.length > 0 ? highlights : undefined,
        textTransform: extractTextTransform(node),
        textAlign: extractTextAlign(node),
        richHtml: node.innerHTML,
        posTop: posTop,
        posLeft: posLeft,
      });
    }
  }
  return blocks;
}

function parseSlides(html: string): { slides: EditableSlide[]; head: string } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const head = doc.head.innerHTML;
  const slideEls = Array.from(doc.querySelectorAll(
    '.slide, .slide-editorial, .clean-cover, .clean-content, .clean-cta'
  ));
  const slides: EditableSlide[] = slideEls.map((el, index) => ({
    index,
    html: el.innerHTML,
    outerHtml: el.outerHTML,
    type: detectSlideType(el),
    bgImageUrl: extractBgImageUrl(el),
    texts: extractTextBlocks(el),
    hasBadge: !!el.querySelector('.profile-name .verified-badge, .footer-name-pill .verified-badge, .follow-pill .verified-badge'),
  }));
  return { slides, head };
}

const VERIFIED_BADGE_HTML = `<span class="verified-badge"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="12" fill="#0095f6"/><path d="M6.5 12.5l3.5 3.5 7.5-8" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;

function rebuildSlideOuterHtml(
  slide: EditableSlide,
  editedTexts: TextBlock[],
  newBgUrl: string | null,
  overrides?: Record<string, ElementOverride>,
  overlayConfig?: OverlayConfig,
  showBadge?: boolean,
): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${slide.outerHtml}</body>`, 'text/html');
  const el = doc.body.firstElementChild!;

  const classGroups: Record<string, Element[]> = {};
  for (const { selector } of TEXT_SELECTORS) {
    classGroups[selector.slice(1)] = Array.from(el.querySelectorAll(selector));
  }
  const groupCounters: Record<string, number> = {};
  for (const { selector } of TEXT_SELECTORS) groupCounters[selector.slice(1)] = 0;

  for (const tb of editedTexts) {
    const baseClass = tb.className.split(' ')[0];
    const nodes = classGroups[baseClass];
    if (!nodes) continue;
    const idx = groupCounters[baseClass] ?? 0;
    if (nodes[idx]) {
      // Se deletado, esconde o elemento e pula demais overrides
      if (tb.deleted) {
        (nodes[idx] as HTMLElement).style.display = 'none';
        groupCounters[baseClass] = idx + 1;
        continue;
      }
      nodes[idx].innerHTML = tb.richHtml || textToHtml(tb.text, tb.highlights);
      const existingStyle = nodes[idx].getAttribute('style') || '';
      let newStyle = existingStyle;
      // Apply font size
      if (tb.fontSize !== undefined) {
        newStyle = newStyle.replace(FONT_SIZE_REGEX, '').replace(/\s{2,}/g, ' ').trim();
        newStyle = `${newStyle}; font-size: ${tb.fontSize}px;`.replace(/^;\s*/, '');
      }
      // Apply color override
      if (tb.color) {
        newStyle = newStyle.replace(COLOR_REGEX, '').replace(/\s{2,}/g, ' ').trim();
        newStyle = `${newStyle}; color: ${tb.color};`.replace(/^;\s*/, '');
      }
      // Apply text-transform override
      if (tb.textTransform !== undefined) {
        newStyle = newStyle.replace(TEXT_TRANSFORM_REGEX, '').replace(/\s{2,}/g, ' ').trim();
        newStyle = `${newStyle}; text-transform: ${tb.textTransform || 'none'};`.replace(/^;\s*/, '');
      }
      // Apply text-align override
      if (tb.textAlign) {
        newStyle = newStyle.replace(TEXT_ALIGN_REGEX, '').replace(/\s{2,}/g, ' ').trim();
        newStyle = `${newStyle}; text-align: ${tb.textAlign};`.replace(/^;\s*/, '');
      }
      // Apply font-family override
      if (tb.fontFamily) {
        newStyle = newStyle.replace(FONT_FAMILY_REGEX, '').replace(/\s{2,}/g, ' ').trim();
        newStyle = `${newStyle}; font-family: '${tb.fontFamily}', sans-serif;`.replace(/^;\s*/, '');
      }
      // Apply position override for custom-text blocks (posTop/posLeft from drag)
      if (baseClass === 'custom-text' && tb.posTop !== undefined) {
        newStyle = newStyle.replace(POS_TOP_REGEX, '').replace(/\s{2,}/g, ' ').trim();
        newStyle = `${newStyle}; top: ${tb.posTop}px;`.replace(/^;\s*/, '');
        // Remove bottom to avoid CSS conflict
        newStyle = newStyle.replace(/(?:^|;)\s*bottom\s*:\s*[^;]+/i, '').replace(/\s{2,}/g, ' ').trim();
      }
      if (baseClass === 'custom-text' && tb.posLeft !== undefined) {
        newStyle = newStyle.replace(POS_LEFT_REGEX, '').replace(/\s{2,}/g, ' ').trim();
        newStyle = `${newStyle}; left: ${tb.posLeft}px;`.replace(/^;\s*/, '');
      }
      if (newStyle !== existingStyle) nodes[idx].setAttribute('style', newStyle);
    }
    groupCounters[baseClass] = idx + 1;
  }

  // Background
  if (newBgUrl !== null) {
    const slideBg = el.querySelector('.slide-bg, .bg') as HTMLElement | null;
    const target = slideBg || el as HTMLElement;
    const s = target.getAttribute('style') || '';
    target.setAttribute('style', BG_IMAGE_REGEX.test(s)
      ? s.replace(BG_IMAGE_REGEX, `background-image: url('${newBgUrl}')`)
      : `${s} background-image: url('${newBgUrl}');`
    );
  }

  // Overlay gradient
  if (overlayConfig) {
    const overlayEl = el.querySelector('.overlay') as HTMLElement | null;
    if (overlayEl) {
      overlayEl.setAttribute('style',
        `position:absolute;inset:0;z-index:1;background:${buildOverlayStyle(overlayConfig)};`
      );
    }
  }

  // Element position overrides from drag
  // Chave pode ser ".selector@N" (índice específico) ou ".selector" (todos os matches)
  if (overrides) {
    for (const [key, styles] of Object.entries(overrides)) {
      const atSign = key.lastIndexOf('@');
      let targetNodes: HTMLElement[];
      if (atSign > 0 && /^\d+$/.test(key.slice(atSign + 1))) {
        // Override indexado: aplica somente ao N-ésimo elemento com esse seletor
        const baseSel = key.slice(0, atSign);
        const idx = parseInt(key.slice(atSign + 1), 10);
        const all = Array.from(el.querySelectorAll(baseSel)) as HTMLElement[];
        targetNodes = all[idx] !== undefined ? [all[idx]] : [];
      } else {
        targetNodes = Array.from(el.querySelectorAll(key)) as HTMLElement[];
      }
      for (const node of targetNodes) {
        if (styles.left  !== undefined) { node.style.left  = styles.left;  if (node.style.right)  node.style.right  = ''; }
        if (styles.top   !== undefined) { node.style.top   = styles.top;   if (node.style.bottom) node.style.bottom = ''; }
        if (styles.right  !== undefined) node.style.right  = styles.right;
        if (styles.bottom !== undefined) node.style.bottom = styles.bottom;
        if (styles.transform !== undefined) node.style.transform = styles.transform;
      }
    }
  }

  // Inject new custom-text blocks that don't exist in original HTML
  const existingCustomTexts = el.querySelectorAll('.custom-text').length;
  const customTextsInEdited = editedTexts.filter(tb => tb.className.startsWith('custom-text'));
  for (let i = existingCustomTexts; i < customTextsInEdited.length; i++) {
    const ct = customTextsInEdited[i];
    if (ct.deleted) continue;
    const div = doc.createElement('div');
    div.className = 'custom-text';
    // data-ct-idx identifica este bloco para o drag (índice dentro de customTextsInEdited)
    div.setAttribute('data-ct-idx', String(i));
    // Usa posTop/posLeft salvos pelo drag; fallback: posição default escalonada
    const defaultTop = 80 + (i - existingCustomTexts) * 80;
    div.setAttribute('style',
      `position:absolute; z-index:10;` +
      ` top:${ct.posTop !== undefined ? ct.posTop : defaultTop}px;` +
      ` left:${ct.posLeft !== undefined ? ct.posLeft : 60}px;` +
      ` width:960px;` +
      (ct.fontFamily ? ` font-family:'${ct.fontFamily}',sans-serif;` : '') +
      (ct.fontSize ? ` font-size:${ct.fontSize}px;` : ' font-size:24px;') +
      (ct.color ? ` color:${ct.color};` : ' color:#ffffff;') +
      (ct.textAlign ? ` text-align:${ct.textAlign};` : ' text-align:center;') +
      (ct.textTransform ? ` text-transform:${ct.textTransform};` : '')
    );
    div.innerHTML = ct.richHtml || textToHtml(ct.text, ct.highlights);
    el.appendChild(div);
  }

  // Verified badge toggle — aplica em todos os elementos de nome do slide
  if (showBadge !== undefined) {
    const BADGE_TARGETS = [
      '.profile-name',
      '.footer-name-pill',
      '.follow-pill',
      '.profile-badge .name',
    ];
    for (const sel of BADGE_TARGETS) {
      const nameEl = el.querySelector(sel) as HTMLElement | null;
      if (!nameEl) continue;
      const existing = nameEl.querySelector('.verified-badge');
      if (showBadge && !existing) {
        // Garante flexbox para o badge ficar alinhado inline
        const s = nameEl.getAttribute('style') || '';
        if (!s.includes('display')) {
          nameEl.setAttribute('style', `${s}; display:inline-flex; align-items:center; gap:6px;`.replace(/^;\s*/, ''));
        }
        nameEl.insertAdjacentHTML('beforeend', VERIFIED_BADGE_HTML);
      } else if (!showBadge && existing) {
        existing.remove();
      }
    }
  }

  return el.outerHTML;
}

// ─── JPEG download (client-side canvas conversion) ────────────────────────────

export async function downloadAsJpeg(imageUrl: string, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas not supported')); return; }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('Conversion failed')); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        resolve();
      }, 'image/jpeg', 0.93);
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageUrl;
  });
}

// ─── Miniatura de slide ───────────────────────────────────────────────────────

function SlideThumbnail({ slideHtml, head, index, selected, onClick, horizontal }: {
  slideHtml: string; head: string; index: number; selected: boolean; onClick: () => void; horizontal?: boolean;
}) {
  const THUMB_W = horizontal ? 80 : 120;
  const scale = THUMB_W / 1080;
  const thumbH = Math.round(1350 * scale);
  const srcDoc = `<!DOCTYPE html><html><head>${head}</head><body style="margin:0;padding:0;overflow:hidden;">${slideHtml}</body></html>`;
  return (
    <button type="button" onClick={onClick}
      className={`relative rounded-xl overflow-hidden border-2 transition-all shrink-0 ${
        selected ? 'border-purple-500 shadow-lg shadow-purple-500/20' : 'border-border hover:border-purple-300'
      }`}
      style={{ width: THUMB_W, height: thumbH }}
    >
      <iframe srcDoc={srcDoc} sandbox="allow-scripts allow-same-origin"
        style={{ width: 1080, height: 1350, border: 'none',
          transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none' }}
        title={`Slide ${index + 1}`}
      />
      <div className={`absolute bottom-0 inset-x-0 text-center text-xs font-bold py-0.5 ${
        selected ? 'bg-purple-600 text-white' : 'bg-black/60 text-white/80'
      }`}>{index + 1}</div>
    </button>
  );
}

// ─── Preview estático ─────────────────────────────────────────────────────────

function SlidePreview({ slideHtml, head }: { slideHtml: string; head: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(280);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        setContainerW(Math.min(w, 320));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const PREVIEW_W = containerW;
  const scale = PREVIEW_W / 1080;
  const previewH = Math.round(1350 * scale);
  const srcDoc = `<!DOCTYPE html><html><head>${head}</head><body style="margin:0;padding:0;overflow:hidden;">${slideHtml}</body></html>`;
  return (
    <div ref={containerRef} className="w-full">
    <div className="rounded-xl overflow-hidden border border-border shadow-lg mx-auto"
      style={{ width: PREVIEW_W, height: previewH }}>
      <iframe srcDoc={srcDoc} sandbox="allow-scripts allow-same-origin"
        style={{ width: 1080, height: 1350, border: 'none',
          transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none' }}
        title="Preview"
      />
    </div>
    </div>
  );
}

// ─── Preview interativo (modo visual/drag) ────────────────────────────────────

// Todos os elementos arrastáveis — tanto absolutos quanto em flow (via transform)
const DRAGGABLE_SELECTORS = [
  // Absolutos (clean layout)
  '.profile-badge', '.cover-title', '.swipe-hint', '.cta-footer',
  // Imagens
  '.photo-card', '.top-photo-wrap', '.bg',
  // Footer / header
  '.slide-footer', '.top-header',
  // Texto (editorial + clean)
  '.title', '.subtitle', '.subtitle-accent', '.narrative-text',
  '.content-title', '.content-body', '.cta-title',
  '.follow-pill', '.profile-name', '.profile-handle',
  // Custom text blocks
  '.custom-text',
];

function buildDragScript(displayScale: number): string {
  const sels = JSON.stringify(DRAGGABLE_SELECTORS);
  return `<style>
  * { -webkit-user-select:none!important; user-select:none!important; }
  </style>
  <script>
(function(){
  var SCALE=${displayScale.toFixed(6)};
  var SELS=${sels};
  var dragging=null, selected=null;

  // Bloqueia completamente qualquer seleção de texto/área
  document.addEventListener('selectstart', function(e){ e.preventDefault(); });
  document.addEventListener('dragstart',   function(e){ e.preventDefault(); });

  function findEl(t){
    for(var i=0;i<SELS.length;i++){
      var el=t.closest(SELS[i]);
      if(el) return {el:el,sel:SELS[i]};
    }
    return null;
  }

  function highlight(el,on){
    el.style.outline = on ? '3px solid #B078FF' : '';
    el.style.cursor = on ? 'grab' : '';
  }

  function getTranslate(el){
    var t = el.style.transform || '';
    var m = t.match(/translate\\(([\\d.-]+)px,\\s*([\\d.-]+)px\\)/);
    return m ? {x:parseFloat(m[1]),y:parseFloat(m[2])} : {x:0,y:0};
  }

  var dragMoved=false;

  function startDrag(cx,cy,target){
    if(target&&target.isContentEditable) return false;
    var found=findEl(target);
    if(!found) return false;
    document.body.style.userSelect='none';
    document.body.style.webkitUserSelect='none';
    var el=found.el;
    var cs=window.getComputedStyle(el);
    if(selected) highlight(selected,false);
    selected=el; highlight(el,true);
    // Índice do elemento entre todos os que têm o mesmo seletor (para override único)
    var allWithSel=Array.from(document.querySelectorAll(found.sel));
    var elemIdx=allWithSel.indexOf(el);
    var isAbs=cs.position==='absolute'||cs.position==='fixed';
    if(isAbs){
      // Se o elemento usa bottom/right, converte para top/left antes de arrastar
      var origTop, origLeft;
      if(el.style.top && el.style.top!=='auto'){
        origTop=parseFloat(el.style.top)||0;
      } else {
        origTop=el.offsetTop;
        el.style.top=origTop+'px';
      }
      if(el.style.left && el.style.left!=='auto'){
        origLeft=parseFloat(el.style.left)||0;
      } else {
        origLeft=el.offsetLeft;
        el.style.left=origLeft+'px';
      }
      el.style.right=''; el.style.bottom='';
      dragging={el:el,sel:found.sel,elemIdx:elemIdx,mode:'abs',startX:cx,startY:cy,origLeft:origLeft,origTop:origTop};
    } else {
      var tr=getTranslate(el);
      dragging={el:el,sel:found.sel,elemIdx:elemIdx,mode:'translate',startX:cx,startY:cy,origTx:tr.x,origTy:tr.y};
    }
    dragMoved=false;
    window.parent.postMessage({type:'elementClicked',selector:found.sel},'*');
    return true;
  }

  function moveDrag(cx,cy){
    if(!dragging) return;
    var dx=cx-dragging.startX;
    var dy=cy-dragging.startY;
    if(Math.abs(dx)>2||Math.abs(dy)>2) dragMoved=true;
    if(dragging.mode==='abs'){
      dragging.el.style.left=(dragging.origLeft+dx)+'px';
      dragging.el.style.top=(dragging.origTop+dy)+'px';
    } else {
      var nx=dragging.origTx+dx,ny=dragging.origTy+dy;
      var existing=(dragging.el.style.transform||'').replace(/translate\\([^)]+\\)/g,'').trim();
      dragging.el.style.transform=(existing+' translate('+nx+'px,'+ny+'px)').trim();
    }
  }

  function endDrag(){
    document.body.style.userSelect='';
    document.body.style.webkitUserSelect='';
    if(!dragging) return;
    // Só notifica o pai se o elemento realmente foi movido (não apenas clicado)
    if(dragMoved){
      var ctIdx=dragging.el.getAttribute('data-ct-idx');
      var payload={type:'elementMoved',selector:dragging.sel,elemIdx:dragging.elemIdx,mode:dragging.mode,ctIdx:ctIdx};
      if(dragging.mode==='abs'){payload.left=dragging.el.style.left;payload.top=dragging.el.style.top;}
      else{payload.transform=dragging.el.style.transform;}
      window.parent.postMessage(payload,'*');
    }
    dragging=null;
  }

  // Edição inline: duplo clique → contentEditable
  var TEXT_EDIT_SELS=['.title','.subtitle','.subtitle-accent','.narrative-text','.content-title','.content-body','.cta-title','.cover-title','.custom-text','.follow-pill','.footer-name-pill'];
  document.addEventListener('dblclick',function(e){
    var textEl=null;
    for(var i=0;i<TEXT_EDIT_SELS.length;i++){var t=e.target.closest(TEXT_EDIT_SELS[i]);if(t){textEl=t;break;}}
    if(!textEl) return;
    e.preventDefault();
    if(dragging) return;
    textEl.contentEditable='true';
    textEl.style.outline='2px dashed #f97316';
    textEl.style.cursor='text';
    textEl.focus();
    var matchedSel=TEXT_EDIT_SELS[TEXT_EDIT_SELS.findIndex(function(s){return textEl.closest(s)===textEl;})];
    function onBlur(){
      textEl.contentEditable='false';
      textEl.style.outline=selected===textEl?'3px solid #B078FF':'';
      textEl.style.cursor=selected===textEl?'grab':'';
      window.parent.postMessage({type:'textEdited',selector:matchedSel||('.'+textEl.className.trim().split(/\\s+/)[0]),innerHTML:textEl.innerHTML},'*');
      textEl.removeEventListener('blur',onBlur);
    }
    textEl.addEventListener('blur',onBlur);
  });

  // Recebe comandos do pai
  window.addEventListener('message',function(e){
    if(e.data&&e.data.type==='forceEndDrag') endDrag();
    if(e.data&&e.data.type==='forceMoveDrag') moveDrag(e.data.cx,e.data.cy);
  });

  // Mouse/touch events
  document.addEventListener('mousedown',function(e){if(startDrag(e.clientX,e.clientY,e.target))e.preventDefault();});
  document.addEventListener('mousemove',function(e){if(dragging){moveDrag(e.clientX,e.clientY);e.preventDefault();}});
  document.addEventListener('mouseup',function(){endDrag();});
  document.addEventListener('touchstart',function(e){var t=e.touches[0];startDrag(t.clientX,t.clientY,e.target);},{passive:false});
  document.addEventListener('touchmove',function(e){if(dragging){e.preventDefault();var t=e.touches[0];moveDrag(t.clientX,t.clientY);}},{passive:false});
  document.addEventListener('touchend',function(){endDrag();});

  document.addEventListener('click',function(e){
    var found=findEl(e.target);
    if(!found&&selected){highlight(selected,false);selected=null;window.parent.postMessage({type:'elementDeselected'},'*');}
  });
})();
</script>`;
}

function InteractiveSlidePreview({ slideHtml, head, onElementMoved, onTextEdited, selectedIndex }: {
  slideHtml: string;
  head: string;
  onElementMoved: (data: { selector: string; elemIdx?: number; mode: string; left?: string; top?: string; transform?: string; ctIdx?: string | null }) => void;
  onTextEdited: (selector: string, innerHTML: string) => void;
  selectedIndex: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [displayW, setDisplayW] = useState(460);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        setDisplayW(Math.min(w, 460));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = displayW / 1080;
  const displayH = Math.round(1350 * scale);
  const dragScript = buildDragScript(scale);
  const srcDoc = `<!DOCTYPE html><html><head>${head}${dragScript}</head><body style="margin:0;padding:0;overflow:hidden;">${slideHtml}</body></html>`;

  // Encaminha mouseup/mousemove do pai para o iframe (fix: drag sai do iframe)
  // Lê iframeRef.current DENTRO das funções para sempre usar o iframe atual
  // (o iframe remonta quando slideHtml muda, então iw capturado na montagem fica stale)
  useEffect(() => {
    function sendEnd() {
      iframeRef.current?.contentWindow?.postMessage({ type: 'forceEndDrag' }, '*');
    }
    function sendMove(e: MouseEvent) {
      const iw = iframeRef.current?.contentWindow;
      if (!iw || !iframeRef.current) return;
      const rect = iframeRef.current.getBoundingClientRect();
      const cx = (e.clientX - rect.left) / scale;
      const cy = (e.clientY - rect.top) / scale;
      iw.postMessage({ type: 'forceMoveDrag', cx, cy }, '*');
    }
    window.addEventListener('mouseup', sendEnd);
    window.addEventListener('mousemove', sendMove);
    return () => {
      window.removeEventListener('mouseup', sendEnd);
      window.removeEventListener('mousemove', sendMove);
    };
  }, [scale]);

  useEffect(() => {
    function handleMsg(e: MessageEvent) {
      if (!e.data) return;
      if (e.data.type === 'elementMoved') onElementMoved(e.data);
      if (e.data.type === 'textEdited') onTextEdited(e.data.selector, e.data.innerHTML);
    }
    window.addEventListener('message', handleMsg);
    return () => window.removeEventListener('message', handleMsg);
  }, [onElementMoved, selectedIndex]);

  return (
    <div ref={containerRef} className="w-full">
      <div className="rounded-xl overflow-hidden border-2 border-purple-500/40 shadow-xl mx-auto relative"
        style={{ width: displayW, height: displayH }}>
        <iframe
          ref={iframeRef}
          key={`${selectedIndex}-${slideHtml.length}`}
          srcDoc={srcDoc}
          sandbox="allow-scripts allow-same-origin"
          style={{ width: 1080, height: 1350, border: 'none',
            transform: `scale(${scale})`, transformOrigin: 'top left',
            pointerEvents: 'auto', cursor: 'default' }}
          title="Editor visual"
        />
      </div>
      <p className="text-center text-[11px] text-muted-foreground/70 mt-2">
        Toque e arraste elementos para mover
      </p>
    </div>
  );
}

// ─── Editor de texto rico (contentEditable) ──────────────────────────────────

function RichTextEditor({
  html,
  onChange,
  textAlign,
  blockColor,
}: {
  html: string;
  onChange: (html: string) => void;
  textAlign?: string;
  blockColor?: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalChange = useRef(false);

  // Inicializa o conteúdo apenas na montagem
  useEffect(() => {
    if (editorRef.current && !isInternalChange.current) {
      editorRef.current.innerHTML = html;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Atualiza se o HTML mudar de fora (ex: trocar de slide)
  const prevHtml = useRef(html);
  useEffect(() => {
    if (html !== prevHtml.current && !isInternalChange.current && editorRef.current) {
      editorRef.current.innerHTML = html;
    }
    prevHtml.current = html;
  }, [html]);

  function handleInput() {
    if (editorRef.current) {
      isInternalChange.current = true;
      onChange(editorRef.current.innerHTML);
      requestAnimationFrame(() => { isInternalChange.current = false; });
    }
  }

  function exec(cmd: string, value?: string) {
    document.execCommand(cmd, false, value);
    handleInput();
    editorRef.current?.focus();
  }

  // Aplica tamanho de fonte (em px) ao texto selecionado usando mark-then-replace
  function applyFontSize(px: number) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    // Marca com font size=7 para identificar os nós afetados
    document.execCommand('fontSize', false, '7');
    if (editorRef.current) {
      // Substitui todas as <font size="7"> por <span style="font-size:Xpx">
      editorRef.current.querySelectorAll('font[size="7"]').forEach(el => {
        const span = document.createElement('span');
        span.style.fontSize = `${px}px`;
        span.innerHTML = (el as HTMLElement).innerHTML;
        el.parentNode?.replaceChild(span, el);
      });
    }
    handleInput();
    editorRef.current?.focus();
  }

  const btnCls = (active?: boolean) =>
    `px-1.5 py-1 rounded text-[11px] font-bold transition-colors ${
      active ? 'bg-purple-600 text-white' : 'bg-secondary text-muted-foreground hover:bg-border active:bg-border'
    }`;

  return (
    <div className="space-y-1">
      {/* Toolbar */}
      <div className="flex items-center gap-1 flex-wrap">
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => exec('bold')}
          className={btnCls()} title="Negrito"><strong>B</strong></button>
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => exec('italic')}
          className={btnCls()} title="Itálico"><em>I</em></button>
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => exec('underline')}
          className={btnCls()} title="Sublinhado"><span className="underline">U</span></button>
        {/* Tamanho de fonte inline (por seleção) */}
        <select
          title="Tamanho de fonte da seleção"
          defaultValue=""
          onMouseDown={e => e.stopPropagation()}
          onChange={e => {
            const v = parseInt(e.target.value, 10);
            if (v) applyFontSize(v);
            e.target.value = '';
          }}
          className="h-[26px] rounded text-[11px] bg-secondary text-muted-foreground border border-border px-1 cursor-pointer hover:bg-border"
        >
          <option value="" disabled>px</option>
          {[12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 96].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {/* Cor do texto (seleção) */}
        <label className="relative cursor-pointer shrink-0" title="Cor do texto selecionado">
          <span className="px-1.5 py-1 rounded text-[11px] font-bold bg-secondary text-muted-foreground hover:bg-border flex items-center gap-1">
            A<span className="w-3 h-1.5 rounded-sm" style={{ background: blockColor || '#fff' }} />
          </span>
          <input type="color" defaultValue={blockColor || '#ffffff'}
            onChange={e => exec('foreColor', e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
        </label>
        {/* Marca-texto (highlight) */}
        <label className="relative cursor-pointer shrink-0" title="Marca-texto (fundo da seleção)">
          <span className="px-1.5 py-1 rounded text-[11px] font-bold bg-secondary text-muted-foreground hover:bg-border flex items-center gap-1">
            <span className="px-1 rounded" style={{ background: '#fde047', color: '#000' }}>ab</span>
          </span>
          <input type="color" defaultValue="#fde047"
            onChange={e => exec('hiliteColor', e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
        </label>
        {/* Remover formatação */}
        <button type="button" onMouseDown={e => e.preventDefault()}
          onClick={() => exec('removeFormat')}
          className={btnCls()} title="Limpar formatação">✕</button>
      </div>
      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 min-h-[44px] break-words"
        style={{ textAlign: textAlign as any }}
      />
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function CarouselEditor({
  html, folderName, topic, numSlides, legenda, config,
  onScreenshotsUpdated, onTemplateSaved, onHtmlUpdated,
}: CarouselEditorProps) {
  const [head, setHead] = useState('');
  const [slides, setSlides] = useState<EditableSlide[]>([]);
  const [editedTexts, setEditedTexts] = useState<Record<number, TextBlock[]>>({});
  const [editedBgUrls, setEditedBgUrls] = useState<Record<number, string>>({});
  const [elementOverrides, setElementOverrides] = useState<Record<number, Record<string, ElementOverride>>>({});
  const [overlayConfigs, setOverlayConfigs] = useState<Record<number, OverlayConfig>>({});
  const [badgeVisible, setBadgeVisible] = useState<Record<number, boolean>>({});
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [editMode, setEditMode] = useState<'text' | 'visual'>('text');
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateName, setTemplateName] = useState(topic);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const bgFileRef = useRef<HTMLInputElement>(null);
  // Campos temporários para novo destaque de palavra (por bloco)
  const [newHl, setNewHl] = useState<Record<string, {word: string, color: string}>>({});
  const [focusedBlockIdx, setFocusedBlockIdx] = useState<number | null>(null);
  // Ref para evitar loop: ignora html prop quando ele veio de onHtmlUpdated
  const lastEmittedHtml = useRef<string>('');

  // Tecla Delete/Backspace deleta o bloco de texto focado
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === 'Delete' || e.key === 'Backspace') &&
          focusedBlockIdx !== null && selectedIndex !== null &&
          !(e.target instanceof HTMLInputElement) &&
          !(e.target instanceof HTMLTextAreaElement) &&
          !(e.target as HTMLElement).isContentEditable) {
        e.preventDefault();
        removeTextBlock(selectedIndex, focusedBlockIdx);
        setFocusedBlockIdx(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusedBlockIdx, selectedIndex]);

  // ── Parse inicial ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!html) return;
    // Se o html prop é o que acabamos de emitir, não reinicializa (evita loop)
    if (html === lastEmittedHtml.current) return;

    const { slides: parsed, head: parsedHead } = parseSlides(html);
    setHead(parsedHead);
    setSlides(parsed);

    const bgInit: Record<number, string> = {};
    for (const s of parsed) {
      if (s.bgImageUrl) bgInit[s.index] = s.bgImageUrl;
    }
    const badgeInit: Record<number, boolean> = {};
    for (const s of parsed) badgeInit[s.index] = s.hasBadge;
    setBadgeVisible(badgeInit);
    setEditedBgUrls(bgInit);

    // Mescla textos parseados com estado anterior para preservar:
    //  - posTop / posLeft salvos pelo drag
    //  - blocos extras adicionados via addTextBlock (custom-text que não estão no HTML original)
    setEditedTexts(prev => {
      const merged: Record<number, TextBlock[]> = {};
      for (const s of parsed) {
        const newTexts = s.texts.map(t => ({ ...t }));
        const oldTexts = prev[s.index] ?? [];

        // Índice de todos os custom-text no estado anterior (para match por posição relativa)
        const oldCustomTexts = oldTexts.filter(b => b.className.startsWith('custom-text') && !b.deleted);
        let customTextMatchIdx = 0;

        const mergedBlocks: TextBlock[] = newTexts.map((nt, j) => {
          // Para custom-text: tenta match pelo contador de custom-texts (mais robusto que índice absoluto)
          if (nt.className.startsWith('custom-text')) {
            const ot = oldCustomTexts[customTextMatchIdx++] ?? oldTexts[j];
            if (!ot) return nt;
            return {
              ...nt,
              posTop:  ot.posTop  !== undefined ? ot.posTop  : nt.posTop,
              posLeft: ot.posLeft !== undefined ? ot.posLeft : nt.posLeft,
            };
          }
          // Para outros blocos: match por índice
          const ot = oldTexts[j];
          if (!ot) return nt;
          return {
            ...nt,
            posTop:  ot.posTop  !== undefined ? ot.posTop  : nt.posTop,
            posLeft: ot.posLeft !== undefined ? ot.posLeft : nt.posLeft,
          };
        });
        // Mantém blocos extras do estado anterior (e.g. addTextBlock não presentes no HTML)
        const newCustomTextCount = newTexts.filter(b => b.className.startsWith('custom-text')).length;
        const oldCustomTextCount = oldCustomTexts.length;
        if (oldCustomTextCount > newCustomTextCount) {
          // Blocos custom-text do estado que não apareceram no novo parse → preserva
          for (let k = newCustomTextCount; k < oldCustomTextCount; k++) {
            mergedBlocks.push(oldCustomTexts[k]);
          }
        }
        // Outros blocos extras (não custom-text) do estado anterior
        for (let j = newTexts.length; j < oldTexts.length; j++) {
          if (!oldTexts[j].className.startsWith('custom-text')) {
            mergedBlocks.push(oldTexts[j]);
          }
        }
        merged[s.index] = mergedBlocks;
      }
      return merged;
    });

    setSelectedIndex(prev => prev !== null && prev < parsed.length ? prev : (parsed.length > 0 ? 0 : null));
  }, [html]);

  // ── Drag-and-drop de slides ──────────────────────────────────────────────────

  function moveSlide(from: number, to: number) {
    if (to < 0 || to >= slides.length) return;
    setSlides(prev => {
      const next = [...prev]; const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next.map((s, i) => ({ ...s, index: i }));
    });
    setEditedTexts(prev => {
      const arr = slides.map((_, i) => prev[i] ?? []);
      const [m] = arr.splice(from, 1); arr.splice(to, 0, m);
      return Object.fromEntries(arr.map((v, i) => [i, v]));
    });
    setEditedBgUrls(prev => {
      const arr = slides.map((_, i) => prev[i] ?? '');
      const [m] = arr.splice(from, 1); arr.splice(to, 0, m);
      return Object.fromEntries(arr.map((v, i) => [i, v]).filter(([, v]) => v !== ''));
    });
    setSelectedIndex(to);
  }

  function handleDragStart(e: React.DragEvent, idx: number) {
    setDraggedIdx(idx); e.dataTransfer.effectAllowed = 'move';
  }
  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    if (idx !== dragOverIdx) setDragOverIdx(idx);
  }
  function handleDrop(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (draggedIdx !== null && draggedIdx !== idx) moveSlide(draggedIdx, idx);
    setDraggedIdx(null); setDragOverIdx(null);
  }
  function handleDragEnd() { setDraggedIdx(null); setDragOverIdx(null); }

  // ── Adicionar / remover slides ──────────────────────────────────────────────

  function addNewSlide() {
    const bgColor = (config as any)?.bgColor || '#1a1a1a';
    const primaryColor = (config as any)?.primaryColor || '#B078FF';
    const newOuterHtml = `<div class="slide-editorial" style="position:relative;width:1080px;height:1350px;background:${bgColor};overflow:hidden;font-family:'Raleway',sans-serif;">
  <div class="overlay" style="position:absolute;inset:0;z-index:1;background:linear-gradient(to bottom,rgba(0,0,0,0.05) 0%,rgba(0,0,0,0.6) 100%);"></div>
  <div class="custom-text" style="position:absolute;z-index:10;top:100px;left:60px;right:60px;font-size:36px;color:#ffffff;text-align:center;">Novo slide — edite o texto</div>
  <div class="slide-footer" style="position:absolute;bottom:30px;left:0;right:0;z-index:10;display:flex;align-items:center;justify-content:center;gap:8px;">
    <span class="footer-name-pill" style="font-size:12px;color:rgba(255,255,255,0.5);">${(config as any)?.creatorName || ''}</span>
    <span class="footer-handle-pill" style="font-size:12px;color:${primaryColor};">${(config as any)?.instagramHandle || ''}</span>
  </div>
</div>`;

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<body>${newOuterHtml}</body>`, 'text/html');
    const el = doc.body.firstElementChild!;

    const newSlide: EditableSlide = {
      index: slides.length,
      html: el.innerHTML,
      outerHtml: newOuterHtml,
      type: 'editorial',
      bgImageUrl: null,
      texts: extractTextBlocks(el),
      hasBadge: false,
    };

    setSlides(prev => [...prev, newSlide]);
    setEditedTexts(prev => ({ ...prev, [newSlide.index]: newSlide.texts.map(t => ({ ...t })) }));
    setSelectedIndex(newSlide.index);
  }

  function removeSlide(idx: number) {
    if (slides.length <= 1) return;
    setSlides(prev => {
      const next = prev.filter((_, i) => i !== idx);
      return next.map((s, i) => ({ ...s, index: i }));
    });
    // Rebuild editedTexts and editedBgUrls with new indices
    setEditedTexts(prev => {
      const arr = slides.map((_, i) => prev[i] ?? []);
      arr.splice(idx, 1);
      return Object.fromEntries(arr.map((v, i) => [i, v]));
    });
    setEditedBgUrls(prev => {
      const arr = slides.map((_, i) => prev[i] ?? '');
      arr.splice(idx, 1);
      return Object.fromEntries(arr.map((v, i) => [i, v]).filter(([, v]) => v !== ''));
    });
    setSelectedIndex(prev => {
      if (prev === null) return null;
      if (prev >= slides.length - 1) return Math.max(0, slides.length - 2);
      if (prev > idx) return prev - 1;
      return prev;
    });
  }

  // ── Edição de texto ──────────────────────────────────────────────────────────

  function updateText(si: number, bi: number, val: string) {
    setEditedTexts(prev => {
      const b = [...(prev[si] ?? [])];
      b[bi] = { ...b[bi], text: val };
      return { ...prev, [si]: b };
    });
  }

  function updateRichHtml(si: number, bi: number, html: string) {
    setEditedTexts(prev => {
      const b = [...(prev[si] ?? [])];
      b[bi] = { ...b[bi], richHtml: html };
      return { ...prev, [si]: b };
    });
  }

  function updateTextAlign(si: number, bi: number, align: TextBlock['textAlign']) {
    setEditedTexts(prev => {
      const b = [...(prev[si] ?? [])];
      b[bi] = { ...b[bi], textAlign: align };
      return { ...prev, [si]: b };
    });
  }

  function toggleTextTransform(si: number, bi: number) {
    setEditedTexts(prev => {
      const b = [...(prev[si] ?? [])];
      const current = b[bi].textTransform;
      // Cycle: undefined (original) → none → uppercase → none
      b[bi] = { ...b[bi], textTransform: current === 'none' ? 'uppercase' : 'none' };
      return { ...prev, [si]: b };
    });
  }

  function updateFontSize(si: number, bi: number, delta: number) {
    setEditedTexts(prev => {
      const b = [...(prev[si] ?? [])];
      const curr = b[bi]?.fontSize ?? (b[bi]?.isMain ? 48 : 28);
      b[bi] = { ...b[bi], fontSize: Math.max(8, Math.min(200, curr + delta)) };
      return { ...prev, [si]: b };
    });
  }

  function updateTextColor(si: number, bi: number, color: string) {
    setEditedTexts(prev => {
      const b = [...(prev[si] ?? [])];
      b[bi] = { ...b[bi], color };
      return { ...prev, [si]: b };
    });
  }

  function updateFontFamily(si: number, bi: number, fontFamily: string) {
    setEditedTexts(prev => {
      const b = [...(prev[si] ?? [])];
      b[bi] = { ...b[bi], fontFamily: fontFamily || undefined };
      return { ...prev, [si]: b };
    });
  }

  function addWordHighlight(si: number, bi: number, word: string, color: string) {
    setEditedTexts(prev => {
      const b = [...(prev[si] ?? [])];
      b[bi] = { ...b[bi], highlights: [...(b[bi].highlights ?? []), { word, color }] };
      return { ...prev, [si]: b };
    });
  }

  function removeWordHighlight(si: number, bi: number, hi: number) {
    setEditedTexts(prev => {
      const b = [...(prev[si] ?? [])];
      b[bi] = { ...b[bi], highlights: (b[bi].highlights ?? []).filter((_, i) => i !== hi) };
      return { ...prev, [si]: b };
    });
  }

  function updateWordHighlightColor(si: number, bi: number, hi: number, color: string) {
    setEditedTexts(prev => {
      const b = [...(prev[si] ?? [])];
      const hls = [...(b[bi].highlights ?? [])];
      hls[hi] = { ...hls[hi], color };
      b[bi] = { ...b[bi], highlights: hls };
      return { ...prev, [si]: b };
    });
  }

  function updateWordHighlightWord(si: number, bi: number, hi: number, word: string) {
    setEditedTexts(prev => {
      const b = [...(prev[si] ?? [])];
      const hls = [...(b[bi].highlights ?? [])];
      hls[hi] = { ...hls[hi], word };
      b[bi] = { ...b[bi], highlights: hls };
      return { ...prev, [si]: b };
    });
  }

  function addTextBlock(si: number) {
    setEditedTexts(prev => {
      const b = [...(prev[si] ?? [])];
      b.push({
        className: 'custom-text',
        text: 'Novo texto',
        isMain: true,
        fontSize: 24,
        color: '#ffffff',
      });
      return { ...prev, [si]: b };
    });
  }

  // Insere rodapé de perfil (nome + handle + badge) diretamente no outerHtml do slide
  function insertProfileFooter(si: number) {
    const creatorName = (config as any)?.creatorName || 'Fabricio Moura';
    const rawHandle = ((config as any)?.instagramHandle || 'fabriciomourateam').replace(/^@/, '');
    const handle = `@${rawHandle}`;
    const footerHtml = `<div class="slide-footer" style="position:absolute;bottom:30px;left:0;right:0;z-index:10;display:flex;align-items:center;justify-content:center;gap:12px;padding:0 40px;">
  <span class="footer-name-pill" style="background:linear-gradient(90deg,#f58529,#dd2a7b 50%,#8134af);border-radius:60px;padding:12px 28px;font-size:22px;font-weight:700;color:white;display:inline-flex;align-items:center;gap:6px;">
    ${creatorName}<span class="verified-badge"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:18px;height:18px;display:block;flex-shrink:0"><circle cx="12" cy="12" r="12" fill="#0095f6"/><path d="M6.5 12.5l3.5 3.5 7.5-8" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
  </span>
  <span class="footer-handle-pill" style="border:2px solid rgba(255,255,255,0.3);border-radius:60px;padding:12px 28px;font-size:22px;font-weight:500;color:rgba(255,255,255,0.88);background:rgba(255,255,255,0.04);">${handle}</span>
</div>`;
    setSlides(prev => prev.map((s, i) => {
      if (i !== si) return s;
      // evita duplicar se já existe .slide-footer
      if (s.outerHtml.includes('slide-footer')) return s;
      const newOuter = s.outerHtml.replace(/<\/div>\s*$/, `\n${footerHtml}\n</div>`);
      return { ...s, outerHtml: newOuter };
    }));
  }

  function removeTextBlock(si: number, bi: number) {
    setEditedTexts(prev => {
      const b = [...(prev[si] ?? [])];
      b[bi] = { ...b[bi], deleted: true };
      return { ...prev, [si]: b };
    });
  }

  function updateBgUrl(si: number, url: string) {
    setEditedBgUrls(prev => ({ ...prev, [si]: url }));
  }

  // ── Element position overrides (drag no visual editor) ───────────────────────

  // Edição inline no iframe → atualiza richHtml do bloco correspondente
  const handleInlineTextEdit = useCallback((selector: string, innerHTML: string) => {
    if (selectedIndex === null) return;
    setEditedTexts(prev => {
      const blocks = [...(prev[selectedIndex] ?? [])];
      const idx = blocks.findIndex(b => {
        const base = '.'+b.className.split(' ')[0];
        return base === selector || b.className.includes(selector.slice(1));
      });
      if (idx === -1) return prev;
      blocks[idx] = { ...blocks[idx], richHtml: innerHTML, text: innerHTML.replace(/<[^>]+>/g, '') };
      return { ...prev, [selectedIndex]: blocks };
    });
  }, [selectedIndex]);

  const handleElementMoved = useCallback((data: { selector: string; elemIdx?: number; mode: string; left?: string; top?: string; transform?: string; ctIdx?: string | null }) => {
    if (selectedIndex === null) return;

    // Blocos custom-text NOVOS (injetados) identificam-se por data-ct-idx
    // Salva posição em DOIS lugares para máxima resiliência:
    //   1) posTop/posLeft no TextBlock → usado na injeção (caminho primário)
    //   2) elementOverrides com selector [data-ct-idx="N"] → usado quando o bloco
    //      já está no outerHtml base (caminho de backup — nunca é apagado por re-parse)
    if (data.ctIdx !== null && data.ctIdx !== undefined && data.mode === 'abs') {
      const ctIdxNum = parseInt(data.ctIdx, 10);

      // Caminho primário: salva posTop/posLeft no TextBlock
      setEditedTexts(prev => {
        const blocks = [...(prev[selectedIndex] ?? [])];
        let ctCount = 0;
        for (let j = 0; j < blocks.length; j++) {
          if (blocks[j].className.startsWith('custom-text') && !blocks[j].deleted) {
            if (ctCount === ctIdxNum) {
              blocks[j] = {
                ...blocks[j],
                posTop: parseFloat(data.top ?? String(blocks[j].posTop ?? 80)),
                posLeft: parseFloat(data.left ?? String(blocks[j].posLeft ?? 60)),
              };
              break;
            }
            ctCount++;
          }
        }
        return { ...prev, [selectedIndex]: blocks };
      });

      // Caminho de backup: salva em elementOverrides com selector de atributo
      // Isso garante a posição mesmo se o elemento já estiver no outerHtml base
      setElementOverrides(prev => {
        const overrideKey = `[data-ct-idx="${data.ctIdx}"]`;
        return {
          ...prev,
          [selectedIndex]: {
            ...(prev[selectedIndex] ?? {}),
            [overrideKey]: { left: data.left, top: data.top },
          },
        };
      });
      return;
    }

    // Elementos originais do slide: usa elementOverrides com chave "selector@N"
    // para evitar colisão quando múltiplos elementos têm o mesmo seletor CSS
    setElementOverrides(prev => {
      if (selectedIndex === null) return prev;
      const overrideKey = `${data.selector}@${data.elemIdx ?? 0}`;
      const override: ElementOverride = data.mode === 'abs'
        ? { left: data.left, top: data.top }
        : { transform: data.transform };
      return {
        ...prev,
        [selectedIndex]: { ...(prev[selectedIndex] ?? {}), [overrideKey]: override },
      };
    });
  }, [selectedIndex]);

  // ── Reconstrução do HTML ──────────────────────────────────────────────────────

  const rebuildHtml = useCallback((): string => {
    const built = slides.map(s => rebuildSlideOuterHtml(
      s,
      editedTexts[s.index] ?? s.texts,
      editedBgUrls[s.index] !== '' ? (editedBgUrls[s.index] ?? null) : null,
      elementOverrides[s.index],
      overlayConfigs[s.index],
      badgeVisible[s.index],
    ));
    return `<!DOCTYPE html><html><head>${head}</head><body>\n${built.join('\n')}\n</body></html>`;
  }, [slides, head, editedTexts, editedBgUrls, elementOverrides, overlayConfigs, badgeVisible]);

  // ── Persistência: avisa o pai sempre que o HTML reconstruído mudar ───────────

  const onHtmlUpdatedRef = useRef(onHtmlUpdated);
  onHtmlUpdatedRef.current = onHtmlUpdated;

  useEffect(() => {
    if (!onHtmlUpdatedRef.current || slides.length === 0) return;
    const timer = setTimeout(() => {
      const built = rebuildHtml();
      lastEmittedHtml.current = built;
      onHtmlUpdatedRef.current?.(built);
    }, 600);
    return () => clearTimeout(timer);
  }, [editedTexts, editedBgUrls, elementOverrides, overlayConfigs, badgeVisible, slides, rebuildHtml]);

  function liveSlideHtml(idx: number): string {
    const s = slides[idx]; if (!s) return '';
    return rebuildSlideOuterHtml(
      s,
      editedTexts[idx] ?? s.texts,
      editedBgUrls[idx] !== '' ? (editedBgUrls[idx] ?? null) : null,
      elementOverrides[idx],
      overlayConfigs[idx],
      badgeVisible[idx],
    );
  }

  // ── JPEG download ─────────────────────────────────────────────────────────────

  async function handleDownloadJpegs() {
    const SERVER_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    // Se tiver screenshots do servidor, baixa como JPEG
    // Caso contrário, gera screenshot primeiro
    toast.info('Gerando screenshots antes de baixar…');
    setScreenshotLoading(true);
    try {
      const modifiedHtml = rebuildHtml();
      const res = await fetch(`${SERVER_URL}/api/carousel/screenshots`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: modifiedHtml, folderName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onScreenshotsUpdated(data.screenshots ?? []);
      // Download each as JPEG
      for (let i = 0; i < (data.screenshots ?? []).length; i++) {
        const url = `${SERVER_URL}/output/${folderName}/${data.screenshots[i]}`;
        await downloadAsJpeg(url, `slide_${String(i + 1).padStart(2, '0')}.jpg`);
        await new Promise(r => setTimeout(r, 150)); // small delay between downloads
      }
      toast.success(`${data.screenshots.length} JPEGs baixados!`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setScreenshotLoading(false);
    }
  }

  // ── Upload de imagem de fundo ─────────────────────────────────────────────────

  function handleBgFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || selectedIndex === null) return;
    const reader = new FileReader();
    reader.onload = ev => updateBgUrl(selectedIndex, ev.target?.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  // ── Screenshots ───────────────────────────────────────────────────────────────

  async function handleRegenerateScreenshots() {
    setScreenshotLoading(true);
    try {
      const res = await fetch(`${API}/api/carousel/screenshots`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: rebuildHtml(), folderName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro');
      onScreenshotsUpdated(data.screenshots ?? []);
      toast.success(`${data.screenshots?.length ?? 0} screenshots atualizados!`);
    } catch (err: any) { toast.error(err.message); }
    finally { setScreenshotLoading(false); }
  }

  // ── Salvar como modelo ────────────────────────────────────────────────────────

  async function handleSaveTemplate() {
    const name = templateName.trim() || topic;
    setTemplateLoading(true);
    try {
      const res = await fetch(`${API}/api/carousel/save-template`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: rebuildHtml(), folderName, name,
          numSlides: numSlides ?? slides.length,
          legenda: legenda ?? '', config: config ?? {},
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro');
      toast.success(`Modelo "${name}" salvo!`);
      onTemplateSaved?.();
    } catch (err: any) { toast.error(err.message); }
    finally { setTemplateLoading(false); }
  }

  // ── Salvar edições (HTML no servidor, sem regerar screenshots) ────────────────

  const [saveLoading, setSaveLoading] = useState(false);

  async function handleSaveEdits() {
    setSaveLoading(true);
    try {
      const modifiedHtml = rebuildHtml();

      // 1. Salva HTML + regera screenshots de uma vez (o endpoint /screenshots já salva o HTML)
      const res = await fetch(`${API}/api/carousel/screenshots`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: modifiedHtml, folderName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar');

      // 2. Atualiza os screenshots no componente pai (atualiza thumbnails na lista)
      if (data.screenshots?.length) {
        onScreenshotsUpdated(data.screenshots);
      }

      toast.success('Salvo com screenshots atualizados!');
    } catch (err: any) { toast.error(err.message); }
    finally { setSaveLoading(false); }
  }

  // ── Download HTML ─────────────────────────────────────────────────────────────

  function handleDownloadHtml() {
    const blob = new Blob([rebuildHtml()], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `carrossel-${topic.replace(/\s+/g, '-').toLowerCase()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─────────────────────────────────────────────────────────────────────────────

  if (slides.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 rounded-xl border border-border bg-card text-muted-foreground text-sm gap-2">
        <LayoutList className="w-4 h-4" /> Nenhum slide encontrado no HTML.
      </div>
    );
  }

  const sel = selectedIndex !== null ? slides[selectedIndex] : null;
  const selTexts = selectedIndex !== null ? (editedTexts[selectedIndex] ?? []) : [];
  const selBg = selectedIndex !== null ? (editedBgUrls[selectedIndex] ?? '') : '';

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* ── Cabeçalho ── */}
      <div className="px-3 sm:px-5 py-3 border-b border-border space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Edit3 className="w-4 h-4 text-purple-500" />
            <span className="text-sm font-bold">Editor de Carrossel</span>
            <span className="text-xs text-muted-foreground">{slides.length} slides</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={handleSaveEdits} disabled={saveLoading}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-500 disabled:opacity-60 text-white text-xs font-semibold transition-colors"
            title="Salvar edições no servidor">
            {saveLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Salvar
          </button>
          <button onClick={handleDownloadHtml}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-secondary hover:bg-border active:bg-border text-foreground text-xs font-semibold transition-colors">
            <Download className="w-3 h-3" /> HTML
          </button>
          <button onClick={handleRegenerateScreenshots} disabled={screenshotLoading}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 active:bg-purple-500 disabled:opacity-60 text-white text-xs font-semibold transition-colors">
            {screenshotLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            PNGs
          </button>
          <button onClick={handleDownloadJpegs} disabled={screenshotLoading}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 active:bg-orange-500 disabled:opacity-60 text-white text-xs font-semibold transition-colors"
            title="Gera screenshots e baixa como JPEG">
            <Download className="w-3 h-3" /> JPEGs
          </button>
          <div className="flex items-center gap-1.5 w-full sm:w-auto mt-1 sm:mt-0">
            <input type="text" value={templateName} onChange={e => setTemplateName(e.target.value)}
              placeholder="Nome do modelo…"
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/50 flex-1 sm:w-32 sm:flex-none" />
            <button onClick={handleSaveTemplate} disabled={templateLoading}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-500 disabled:opacity-60 text-white text-xs font-semibold transition-colors shrink-0">
              {templateLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <BookmarkPlus className="w-3 h-3" />}
              Salvar Modelo
            </button>
          </div>
        </div>
      </div>

      {/* ── Corpo ── */}
      <div className="flex flex-col md:flex-row md:min-h-[480px]">

        {/* ── Mobile: miniaturas horizontais / Desktop: coluna lateral ── */}
        {/* Mobile: horizontal scroll */}
        <div className="md:hidden border-b border-border">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Slides</p>
            <div className="flex items-center gap-1.5">
              {selectedIndex !== null && slides.length > 1 && (
                <button onClick={() => removeSlide(selectedIndex)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-red-400 bg-red-500/10 active:bg-red-500/20 transition-colors"
                  title="Excluir slide selecionado">
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
              <button onClick={addNewSlide}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-purple-400 bg-purple-500/10 active:bg-purple-500/20 transition-colors">
                <Plus className="w-3 h-3" /> Slide
              </button>
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto p-2 scrollbar-hide">
            {slides.map((slide, listIdx) => (
              <SlideThumbnail
                key={`mob-${slide.index}-${listIdx}`}
                slideHtml={liveSlideHtml(listIdx)} head={head}
                index={listIdx} selected={selectedIndex === listIdx}
                onClick={() => setSelectedIndex(listIdx)}
                horizontal
              />
            ))}
          </div>
        </div>

        {/* Desktop: coluna lateral */}
        <div className="hidden md:flex w-[148px] shrink-0 border-r border-border flex-col">
          <div className="px-3 py-2 border-b border-border space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Slides</p>
            <div className="flex gap-1">
              <button onClick={addNewSlide}
                className="flex-1 flex items-center justify-center gap-1 px-1.5 py-1 rounded-lg text-[10px] font-semibold text-purple-400 bg-purple-500/10 hover:bg-purple-500/20 transition-colors">
                <Plus className="w-3 h-3" /> Novo
              </button>
              {selectedIndex !== null && slides.length > 1 && (
                <button onClick={() => removeSlide(selectedIndex)}
                  className="px-1.5 py-1 rounded-lg text-[10px] font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors"
                  title="Excluir slide selecionado">
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {slides.map((slide, listIdx) => (
              <div key={`${slide.index}-${listIdx}`}
                draggable
                onDragStart={e => handleDragStart(e, listIdx)}
                onDragOver={e => handleDragOver(e, listIdx)}
                onDrop={e => handleDrop(e, listIdx)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-1 rounded-xl transition-all ${
                  dragOverIdx === listIdx && draggedIdx !== listIdx ? 'ring-2 ring-purple-400 bg-purple-500/10' : ''
                } ${draggedIdx === listIdx ? 'opacity-40' : ''}`}
              >
                <div className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0">
                  <GripVertical className="w-3.5 h-3.5" />
                </div>
                <SlideThumbnail
                  slideHtml={liveSlideHtml(listIdx)} head={head}
                  index={listIdx} selected={selectedIndex === listIdx}
                  onClick={() => setSelectedIndex(listIdx)}
                />
              </div>
            ))}
          </div>
        </div>

        {/* ── Editor panel ── */}
        <div className="flex-1 flex flex-col min-w-0">

          {/* Sub-tabs: Texto | Visual */}
          {sel !== null && selectedIndex !== null && (
            <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-secondary/30">
              <button
                onClick={() => setEditMode('text')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  editMode === 'text' ? 'bg-purple-600 text-white' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
              >
                <Type className="w-3.5 h-3.5" /> Texto / Imagem
              </button>
              <button
                onClick={() => setEditMode('visual')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  editMode === 'visual' ? 'bg-purple-600 text-white' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
              >
                <MousePointer2 className="w-3.5 h-3.5" /> Visual (arrastar)
              </button>
            </div>
          )}

          <AnimatePresence mode="wait">
            {sel !== null && selectedIndex !== null ? (
              <motion.div key={`${selectedIndex}-${editMode}`}
                initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.15 }}
                className="flex-1 flex flex-col overflow-y-auto"
              >
                {/* ── MODO TEXTO ── */}
                {editMode === 'text' && (
                  <>
                    {/* Preview estático */}
                    <div className="px-3 sm:px-5 pt-4 pb-3 border-b border-border bg-secondary/20">
                      <div className="flex items-center gap-2 mb-2">
                        <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Preview — Slide {selectedIndex + 1}
                          <span className="ml-2 capitalize font-normal opacity-60">{sel.type}</span>
                        </span>
                      </div>
                      <SlidePreview slideHtml={liveSlideHtml(selectedIndex)} head={head} />
                    </div>

                    {/* Campos */}
                    <div className="px-3 sm:px-5 py-4 space-y-4 flex-1">

                      {/* ── Selo Verificado (só aparece em slides com .profile-name) ── */}
                      {sel.outerHtml.includes('profile-name') && (
                        <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-foreground">Selo verificado</span>
                            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width={16} height={16}>
                                <circle cx="12" cy="12" r="12" fill="#0095f6"/>
                                <path d="M6.5 12.5l3.5 3.5 7.5-8" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setBadgeVisible(prev => ({ ...prev, [selectedIndex]: !(prev[selectedIndex] ?? sel.hasBadge) }))}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                              (badgeVisible[selectedIndex] ?? sel.hasBadge) ? 'bg-blue-500' : 'bg-border'
                            }`}
                            role="switch"
                            aria-checked={badgeVisible[selectedIndex] ?? sel.hasBadge}
                          >
                            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                              (badgeVisible[selectedIndex] ?? sel.hasBadge) ? 'translate-x-4' : 'translate-x-1'
                            }`} />
                          </button>
                        </div>
                      )}

                      {selTexts.length > 0 ? (
                        <>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                            <Edit3 className="w-3.5 h-3.5" /> Textos do slide
                          </p>
                          {selTexts.map((block, bi) => {
                            if (block.deleted) return null;
                            const currentSize = block.fontSize ?? (block.isMain ? 48 : 28);
                            return (
                              <div key={`${block.className}-${bi}`}
                                className={`space-y-1 rounded-lg p-1 cursor-pointer transition-colors ${focusedBlockIdx === bi ? 'ring-1 ring-orange-500/50 bg-orange-500/5' : ''}`}
                                onClick={() => setFocusedBlockIdx(bi)}>
                                <div className="flex items-center justify-between">
                                  <label className="text-xs font-medium text-muted-foreground capitalize flex items-center gap-1">
                                    {block.className.startsWith('custom-text') ? (
                                      <span className="text-purple-400">Texto adicionado</span>
                                    ) : (
                                      <>.{block.className.split(' ')[0]}</>
                                    )}
                                  </label>
                                  <div className="flex items-center gap-1.5">
                                    {/* Remove text block */}
                                    <button onClick={() => removeTextBlock(selectedIndex, bi)}
                                      className="w-5 h-5 rounded flex items-center justify-center bg-red-500/20 hover:bg-red-500/40 text-red-400 transition-colors"
                                      title="Ocultar este bloco de texto">
                                      <Minus className="w-2.5 h-2.5" />
                                    </button>
                                    {/* Color picker */}
                                    <div className="relative flex items-center gap-1" title="Cor do texto">
                                      <label className="text-[10px] text-muted-foreground">Cor</label>
                                      <LazyColorInput
                                        value={block.color || '#ffffff'}
                                        onChange={v => updateTextColor(selectedIndex, bi, v)}
                                        className="w-6 h-6 rounded cursor-pointer border border-border bg-transparent"
                                        title="Cor do texto"
                                      />
                                    </div>
                                    {/* Text transform toggle */}
                                    <button
                                      onClick={() => toggleTextTransform(selectedIndex, bi)}
                                      className={`px-1.5 h-5 rounded text-[9px] font-bold transition-colors ${
                                        block.textTransform === 'uppercase'
                                          ? 'bg-purple-600 text-white'
                                          : block.textTransform === 'none'
                                          ? 'bg-blue-600 text-white'
                                          : 'bg-secondary text-muted-foreground hover:bg-border'
                                      }`}
                                      title={block.textTransform === 'uppercase' ? 'MAIÚSCULA — clique para normal' : block.textTransform === 'none' ? 'normal — clique para MAIÚSCULA' : 'Alternar maiúscula/normal'}
                                    >
                                      {block.textTransform === 'uppercase' ? 'AA' : 'Aa'}
                                    </button>
                                    {/* Font size stepper */}
                                    <button onClick={() => updateFontSize(selectedIndex, bi, -2)}
                                      className="w-5 h-5 rounded flex items-center justify-center bg-secondary hover:bg-border transition-colors">
                                      <Minus className="w-2.5 h-2.5" />
                                    </button>
                                    <span className="text-[10px] font-mono text-muted-foreground w-8 text-center">
                                      {currentSize}px
                                    </span>
                                    <button onClick={() => updateFontSize(selectedIndex, bi, 2)}
                                      className="w-5 h-5 rounded flex items-center justify-center bg-secondary hover:bg-border transition-colors">
                                      <Plus className="w-2.5 h-2.5" />
                                    </button>
                                  </div>
                                  {/* Font family */}
                                  <select
                                    value={block.fontFamily || ''}
                                    onChange={e => updateFontFamily(selectedIndex, bi, e.target.value)}
                                    className="w-full mt-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                                  >
                                    <option value="">— fonte padrão —</option>
                                    {FONT_OPTIONS.map(f => (
                                      <option key={f} value={f}>{f}</option>
                                    ))}
                                  </select>
                                </div>
                                {/* Editor rich text com toolbar */}
                                <RichTextEditor
                                  key={`rt-${selectedIndex}-${bi}`}
                                  html={block.richHtml || textToHtml(block.text, block.highlights)}
                                  onChange={html => updateRichHtml(selectedIndex, bi, html)}
                                  textAlign={block.textAlign}
                                  blockColor={block.color}
                                />

                                {/* Alinhamento do texto */}
                                <div className="flex items-center gap-0.5">
                                  {(['left', 'center', 'right', 'justify'] as const).map(align => (
                                    <button
                                      key={align}
                                      onClick={() => updateTextAlign(selectedIndex, bi, align)}
                                      className={`flex-1 py-1 rounded text-[10px] font-semibold transition-colors ${
                                        (block.textAlign || 'left') === align
                                          ? 'bg-purple-600 text-white'
                                          : 'bg-secondary text-muted-foreground hover:bg-border active:bg-border'
                                      }`}
                                      title={align === 'left' ? 'Esquerda' : align === 'center' ? 'Centralizado' : align === 'right' ? 'Direita' : 'Justificado'}
                                    >
                                      {align === 'left' ? '⫷' : align === 'center' ? '⫿' : align === 'right' ? '⫸' : '⫼'}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">Nenhum texto editável detectado neste slide.</p>
                      )}

                      {/* Botões adicionar */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => addTextBlock(selectedIndex)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-purple-500/40 hover:border-purple-500 bg-purple-500/5 hover:bg-purple-500/10 text-purple-400 text-xs font-semibold transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" /> Caixa de texto
                        </button>
                        {!sel?.outerHtml.includes('slide-footer') && (
                          <button
                            onClick={() => insertProfileFooter(selectedIndex)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-blue-500/40 hover:border-blue-500 bg-blue-500/5 hover:bg-blue-500/10 text-blue-400 text-xs font-semibold transition-colors"
                            title="Insere rodapé com nome, @handle e badge verificado"
                          >
                            <Plus className="w-3.5 h-3.5" /> Rodapé + Badge
                          </button>
                        )}
                      </div>

                      {/* Imagem de fundo */}
                      <div className="space-y-2 pt-2 border-t border-border">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                          <Image className="w-3.5 h-3.5" /> Imagem de fundo
                        </p>
                        {selBg && (
                          <div className="rounded-lg overflow-hidden border border-border" style={{ maxHeight: 72 }}>
                            <img src={selBg} alt="Fundo atual" className="w-full object-cover" style={{ maxHeight: 72 }}
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          </div>
                        )}
                        <input ref={bgFileRef} type="file" accept="image/*" className="hidden" onChange={handleBgFileChange} />
                        <button onClick={() => bgFileRef.current?.click()}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-border hover:border-purple-400 bg-background hover:bg-purple-500/5 text-muted-foreground hover:text-purple-400 text-xs font-medium transition-colors w-full justify-center">
                          <Upload className="w-3.5 h-3.5" />
                          {selBg ? 'Trocar imagem' : 'Upload do computador'}
                        </button>
                        <div className="relative">
                          <span className="absolute inset-y-0 left-3 flex items-center text-[10px] text-muted-foreground/50 pointer-events-none">URL</span>
                          <input type="url"
                            value={selBg.startsWith('data:') ? '' : selBg}
                            onChange={e => updateBgUrl(selectedIndex, e.target.value)}
                            placeholder="Cole uma URL de imagem…"
                            className="w-full rounded-lg border border-border bg-background pl-10 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                          />
                        </div>
                        {selBg && (
                          <button onClick={() => updateBgUrl(selectedIndex, '')}
                            className="text-xs text-red-400 hover:text-red-300 transition-colors">
                            Remover imagem
                          </button>
                        )}
                      </div>

                      {/* ── Gradiente / Overlay ── */}
                      {sel.outerHtml.includes('class="overlay"') && (() => {
                        const ov: OverlayConfig = overlayConfigs[selectedIndex] ?? {
                          opacity: 0.75, direction: 'to bottom', color: '0,0,0'
                        };
                        function setOv(patch: Partial<OverlayConfig>) {
                          setOverlayConfigs(prev => ({ ...prev, [selectedIndex]: { ...ov, ...patch } }));
                        }
                        // Parse current RGB from overlay color
                        const rgbToHex = (rgb: string) => {
                          const parts = rgb.split(',').map(n => parseInt(n.trim()));
                          if (parts.length < 3 || parts.some(isNaN)) return '#000000';
                          return '#' + parts.map(n => n.toString(16).padStart(2, '0')).join('');
                        };
                        const hexToRgb = (hex: string) => {
                          const r = parseInt(hex.slice(1,3),16);
                          const g = parseInt(hex.slice(3,5),16);
                          const b = parseInt(hex.slice(5,7),16);
                          return `${r},${g},${b}`;
                        };
                        return (
                          <div className="space-y-3 pt-3 border-t border-border">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                              Gradiente da capa
                            </p>

                            {/* Direção */}
                            <div className="space-y-1">
                              <label className="text-[11px] text-muted-foreground">Direção</label>
                              <div className="grid grid-cols-2 gap-1">
                                {OVERLAY_PRESETS.map(p => (
                                  <button key={p.value}
                                    onClick={() => setOv({ direction: p.value })}
                                    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors text-left ${
                                      ov.direction === p.value
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-secondary hover:bg-border text-muted-foreground'
                                    }`}
                                  >
                                    {p.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Intensidade */}
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <label className="text-[11px] text-muted-foreground">Intensidade</label>
                                <span className="text-[11px] font-mono text-muted-foreground">{Math.round(ov.opacity * 100)}%</span>
                              </div>
                              <input type="range" min={0} max={100} value={Math.round(ov.opacity * 100)}
                                onChange={e => setOv({ opacity: Number(e.target.value) / 100 })}
                                className="w-full accent-purple-500"
                              />
                            </div>

                            {/* Cor */}
                            <div className="flex items-center gap-2">
                              <label className="text-[11px] text-muted-foreground">Cor</label>
                              <LazyColorInput
                                value={rgbToHex(ov.color)}
                                onChange={v => setOv({ color: hexToRgb(v) })}
                                className="w-7 h-7 rounded cursor-pointer border border-border"
                                title="Cor do gradiente"
                              />
                              <span className="text-[11px] text-muted-foreground">
                                {ov.color === '0,0,0' ? 'Preto' : ov.color}
                              </span>
                            </div>

                            {/* Preview mini do gradiente */}
                            {ov.direction !== 'none' && (
                              <div className="rounded-lg overflow-hidden border border-border h-8"
                                style={{ background: buildOverlayStyle(ov) }} />
                            )}

                            {overlayConfigs[selectedIndex] && (
                              <button
                                onClick={() => setOverlayConfigs(prev => { const n = {...prev}; delete n[selectedIndex]; return n; })}
                                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                              >
                                Restaurar padrão
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </>
                )}

                {/* ── MODO VISUAL ── */}
                {editMode === 'visual' && (
                  <div className="px-3 sm:px-4 py-4 sm:py-5 space-y-4 flex-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <MousePointer2 className="w-3.5 h-3.5 text-purple-400" />
                      <span>Arraste logos, fotos e textos com <strong>position: absolute</strong> para reposicionar</span>
                    </div>

                    <InteractiveSlidePreview
                      key={selectedIndex}
                      slideHtml={liveSlideHtml(selectedIndex)}
                      head={head}
                      onElementMoved={handleElementMoved}
                      onTextEdited={handleInlineTextEdit}
                      selectedIndex={selectedIndex}
                    />

                    {/* Mostrar overrides aplicados */}
                    {elementOverrides[selectedIndex] && Object.keys(elementOverrides[selectedIndex]).length > 0 && (
                      <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-1.5">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                          Posições ajustadas
                        </p>
                        {Object.entries(elementOverrides[selectedIndex]).map(([sel, pos]) => (
                          <div key={sel} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground font-mono">{sel}</span>
                            <div className="flex items-center gap-2 text-muted-foreground/70">
                              {pos.left && <span>L: {pos.left}</span>}
                              {pos.top && <span>T: {pos.top}</span>}
                              {pos.transform && <span className="truncate max-w-[120px]">{pos.transform}</span>}
                              <button
                                onClick={() => setElementOverrides(prev => {
                                  const next = { ...prev[selectedIndex] };
                                  delete next[sel];
                                  return { ...prev, [selectedIndex]: next };
                                })}
                                className="text-red-400 hover:text-red-300 ml-1"
                                title="Resetar posição"
                              >✕</button>
                            </div>
                          </div>
                        ))}
                        <button
                          onClick={() => setElementOverrides(prev => ({ ...prev, [selectedIndex]: {} }))}
                          className="text-[10px] text-red-400 hover:text-red-300 transition-colors"
                        >
                          Resetar todas as posições deste slide
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="flex-1 flex items-center justify-center text-muted-foreground text-sm gap-2">
                <LayoutList className="w-4 h-4" /> Selecione um slide para editar
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
