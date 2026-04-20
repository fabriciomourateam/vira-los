import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Download, RefreshCw, Loader2, Image, Edit3, LayoutList, Eye, Save, Trash2,
  BookmarkPlus, GripVertical, Plus, Minus, Upload, MousePointer2, Type,
  Undo2, Redo2, Search, Copy, Sparkles, ChevronDown, Library, Bookmark, X,
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
  fontWeight?: number;              // 300 | 400 | 500 | 600 | 700 | 800 | 900
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
  width?: string;
  height?: string;
  transform?: string;
  clipTop?: number;
  clipRight?: number;
  clipBottom?: number;
  clipLeft?: number;
}

interface OverlayConfig {
  opacity: number;       // 0–1
  direction: 'to bottom' | 'to top' | 'to right' | 'radial' | 'none';
  color: string;         // ex: '0,0,0' ou '80,0,120'
  startAt?: number;      // 0–100% — onde o gradiente começa (só para 'to bottom')
  topOpacity?: number;   // 0–1 — opacidade no topo (default 0 = transparente)
}

interface BgImageConfig {
  position: string;   // CSS background-position, ex: 'center top'
  brightness: number; // 0–200, padrão 100
  scale?: number;     // 1.0 = 100% (cover exato), >1.0 = zoom in para panning livre
}

interface FollowBannerConfig {
  visible: boolean;
  color: string;  // hex da cor de fundo do banner
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
  const { opacity, direction, color, startAt = 0 } = cfg;
  const c = color || '0,0,0';
  const hi = opacity.toFixed(2);
  const lo = (opacity * 0.5).toFixed(2);
  switch (direction) {
    case 'to top':    return `linear-gradient(to top, rgba(${c},${hi}) 0%, rgba(${c},${lo}) 55%, rgba(${c},0) 100%)`;
    case 'to right':  return `linear-gradient(to right, rgba(${c},${hi}) 0%, rgba(${c},${lo}) 55%, rgba(${c},0) 100%)`;
    case 'radial':    return `radial-gradient(ellipse at center, rgba(${c},${(opacity*0.1).toFixed(2)}) 0%, rgba(${c},${hi}) 100%)`;
    case 'none':      return 'rgba(0,0,0,0)';
    default: {
      // Gradiente estilo Leo Baltazar: topo levemente escuro, banda de 20%, preto no rodapé
      const topOp = (cfg.topOpacity ?? 0).toFixed(2);
      const transitionEnd = Math.min(97, startAt + 15);
      const midOpacity = (opacity * 0.93).toFixed(2);
      return `linear-gradient(to bottom, rgba(${c},${topOp}) 0%, rgba(${c},${topOp}) ${startAt}%, rgba(${c},${midOpacity}) ${transitionEnd}%, rgba(${c},${hi}) 100%)`;
    }
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
  'Playfair Display', 'Bebas Neue', 'Anton', 'Roboto', 'Lato', 'Open Sans',
  'Ubuntu', 'Nunito', 'DM Sans', 'Space Grotesk', 'Syne',
];

// Injeta todas as fontes nos iframes do editor — funciona para carrosseis antigos e novos
const ALL_FONTS_LINK =
  `<link href="https://fonts.googleapis.com/css2?` +
  `family=Inter:wght@300;400;500;600;700;800;900` +
  `&family=Poppins:wght@300;400;500;600;700;800;900` +
  `&family=Montserrat:wght@300;400;500;600;700;800;900` +
  `&family=Raleway:wght@300;400;500;600;700;800;900` +
  `&family=Oswald:wght@300;400;500;600;700` +
  `&family=Playfair+Display:wght@400;500;600;700;800;900` +
  `&family=Bebas+Neue:wght@400` +
  `&family=Anton:wght@400` +
  `&family=Roboto:wght@300;400;500;700;900` +
  `&family=Lato:wght@300;400;700;900` +
  `&family=Open+Sans:wght@300;400;500;600;700;800` +
  `&family=Ubuntu:wght@300;400;500;700` +
  `&family=Nunito:wght@300;400;500;600;700;800;900` +
  `&family=DM+Sans:wght@300;400;500;600;700` +
  `&family=Space+Grotesk:wght@300;400;500;600;700` +
  `&family=Syne:wght@400;500;600;700;800` +
  `&display=swap" rel="stylesheet">`;

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
  bgImageConfig?: BgImageConfig,
  followBannerConfig?: FollowBannerConfig,
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
      // Apply font-weight override
      if (tb.fontWeight !== undefined) {
        newStyle = newStyle.replace(/(?:^|;)\s*font-weight\s*:\s*[^;]+/gi, '').replace(/\s{2,}/g, ' ').trim();
        newStyle = `${newStyle}; font-weight: ${tb.fontWeight};`.replace(/^;\s*/, '');
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

  // Background image + position + brightness
  if (newBgUrl !== null || bgImageConfig) {
    const slideBg = el.querySelector('.slide-bg, .bg') as HTMLElement | null;
    const target = slideBg || el as HTMLElement;
    let s = target.getAttribute('style') || '';
    if (newBgUrl !== null) {
      s = BG_IMAGE_REGEX.test(s)
        ? s.replace(BG_IMAGE_REGEX, `background-image: url('${newBgUrl}')`)
        : `${s} background-image: url('${newBgUrl}');`;
    }
    if (bgImageConfig) {
      const pos = bgImageConfig.position.trim();
      const isDragPos = pos.includes('calc(');

      // Parse X/Y position values (slider gives 0-100, 50 = center)
      const posParts = pos.split(/\s+/);
      const posX = parseFloat(posParts[0]) || 50;
      const posY = parseFloat(posParts[1] ?? posParts[0]) || 50;
      const scale = bgImageConfig.scale ?? 1.0;

      // Remove conflicting inline properties before setting new ones
      s = s.replace(/inset\s*:\s*[^;]+;?/i, '').trim();
      s = s.replace(/transform\s*:[^;]+;?/i, '').trim();
      s = s.replace(/background-position\s*:\s*[^;]+;?/i, '').trim();
      s = s.replace(/background-size\s*:\s*[^;]+;?/i, '').trim();
      s = s.replace(/filter\s*:\s*brightness\([^)]+\)\s*;?/i, '').trim();

      if (isDragPos) {
        // Drag mode: position uses calc() values — apply directly
        s += `; inset: 0; background-size: cover; background-position: ${pos};`
           + ` filter: brightness(${bgImageConfig.brightness}%);`;
      } else if (scale > 1.005) {
        // Zoom > 100%: scale()+translate() — panning works for ANY image aspect ratio.
        // scale(S) makes the element S× bigger; translate() pans within the (S-1)/2 excess.
        // maxT = (S-1)/(2×S) × 100 ensures slider extreme reaches exactly the clip edge.
        const maxT = ((scale - 1) / (2 * scale)) * 100;
        const tx = ((50 - posX) / 50) * maxT;
        const ty = ((50 - posY) / 50) * maxT;
        s += `; inset: 0; background-size: cover; background-position: center;`
           + ` transform: scale(${scale.toFixed(3)}) translate(${tx.toFixed(2)}%, ${ty.toFixed(2)}%);`
           + ` filter: brightness(${bgImageConfig.brightness}%);`;
      } else {
        // Zoom 100%, slider mode: use background-position directly.
        // Works for images with natural excess (e.g. landscape in portrait container).
        s += `; inset: 0; background-size: cover; background-position: ${posX}% ${posY}%;`
           + ` filter: brightness(${bgImageConfig.brightness}%);`;
      }
    }
    target.setAttribute('style', s);
  }

  // Follow banner visibility + cor
  if (followBannerConfig) {
    const bannerEl = el.querySelector('.follow-banner') as HTMLElement | null;
    if (bannerEl) {
      if (!followBannerConfig.visible) {
        bannerEl.style.display = 'none';
      } else {
        bannerEl.style.display = '';
        let bs = bannerEl.getAttribute('style') || '';
        bs = bs.replace(/background(?:-color)?\s*:\s*[^;]+;?/gi, '').trim();
        bannerEl.setAttribute('style', `${bs}; background-color: ${followBannerConfig.color};`.replace(/^;\s*/, ''));
      }
    }
  }

  // Overlay gradient — tenta todos os seletores possíveis de overlay
  if (overlayConfig) {
    const overlayEl = (
      el.querySelector('.overlay') ??
      el.querySelector('.slide-overlay') ??
      el.querySelector('[class*="overlay"]')
    ) as HTMLElement | null;
    if (overlayEl) {
      const existing = overlayEl.getAttribute('style') || '';
      const cleaned = existing
        .replace(/background\s*:[^;]+;?/gi, '')
        .replace(/\s{2,}/g, ' ').trim().replace(/;$/, '');
      overlayEl.setAttribute('style',
        `${cleaned}${cleaned ? '; ' : ''}background:${buildOverlayStyle(overlayConfig)};`
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
        if (styles.transform !== undefined) {
          const existing = (node.style.transform || '').replace(/translate\([^)]+\)/g, '').trim();
          node.style.transform = (existing + ' ' + styles.transform).trim();
        }
        if (styles.left  !== undefined) { node.style.left  = styles.left;  if (node.style.right)  node.style.right  = ''; }
        if (styles.top   !== undefined) { node.style.top   = styles.top;   if (node.style.bottom) node.style.bottom = ''; }
        if (styles.right  !== undefined) node.style.right  = styles.right;
        if (styles.bottom !== undefined) node.style.bottom = styles.bottom;
        if (styles.width !== undefined) { node.style.width = styles.width; node.style.maxWidth = 'none'; }
        if (styles.height !== undefined) { node.style.height = styles.height; node.style.maxHeight = 'none'; }
        if (styles.clipTop !== undefined || styles.clipRight !== undefined || styles.clipBottom !== undefined || styles.clipLeft !== undefined) {
          node.style.clipPath = `inset(${styles.clipTop || 0}% ${styles.clipRight || 0}% ${styles.clipBottom || 0}% ${styles.clipLeft || 0}%)`;
        }
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
  const srcDoc = `<!DOCTYPE html><html><head>${head}${ALL_FONTS_LINK}</head><body style="margin:0;padding:0;overflow:hidden;">${slideHtml}</body></html>`;
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
        setContainerW(Math.min(w, 440));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const PREVIEW_W = containerW;
  const scale = PREVIEW_W / 1080;
  const previewH = Math.round(1350 * scale);
  const srcDoc = `<!DOCTYPE html><html><head>${head}${ALL_FONTS_LINK}</head><body style="margin:0;padding:0;overflow:hidden;">${slideHtml}</body></html>`;
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
  // Imagens (inline + cards)
  '.photo-card', '.top-photo-wrap', '.bg', 'img',
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
  .resize-handle { position:absolute; width:20px; height:20px; background:#B078FF; border:2px solid #fff; border-radius:3px; z-index:9999; cursor:nwse-resize; touch-action:none; }
  .resize-handle.tl { top:-10px; left:-10px; cursor:nwse-resize; }
  .resize-handle.tr { top:-10px; right:-10px; cursor:nesw-resize; }
  .resize-handle.bl { bottom:-10px; left:-10px; cursor:nesw-resize; }
  .resize-handle.br { bottom:-10px; right:-10px; cursor:nwse-resize; }
  </style>
  <script>
(function(){
  var SELS=${sels};
  var dragging=null, resizing=null, selected=null;

  document.addEventListener('selectstart', function(e){ e.preventDefault(); });
  document.addEventListener('dragstart',   function(e){ e.preventDefault(); });

  function findEl(t){
    // Check resize handle first
    if(t.classList&&t.classList.contains('resize-handle')) return null;
    // If clicking on .overlay, redirect to .bg (overlay sits on top and blocks .bg)
    if(t.classList&&(t.classList.contains('overlay'))){
      var bgEl=t.parentElement&&t.parentElement.querySelector('.bg, .slide-bg');
      if(bgEl) return {el:bgEl,sel:'.bg'};
    }
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

  // Resize handles management
  var currentHandles=[];
  function removeHandles(){
    currentHandles.forEach(function(h){h.remove();});
    currentHandles=[];
  }
  function addHandles(el){
    removeHandles();
    if(el.tagName!=='IMG'&&!el.classList.contains('photo-card')&&!el.classList.contains('top-photo-wrap')) return;
    // Make sure element is positioned
    var cs=window.getComputedStyle(el);
    if(cs.position==='static'){
      el.style.position='absolute';
      el.style.top=el.offsetTop+'px';
      el.style.left=el.offsetLeft+'px';
    }
    var parent=el.parentElement;
    if(parent&&window.getComputedStyle(parent).position==='static') parent.style.position='relative';
    ['br'].forEach(function(corner){
      var h=document.createElement('div');
      h.className='resize-handle '+corner;
      h.setAttribute('data-corner',corner);
      el.style.position=el.style.position||'absolute';
      if(el.tagName==='IMG'){
        // For img, wrap or position handle relative to img
        var rect=el.getBoundingClientRect();
        var pRect=el.offsetParent?el.offsetParent.getBoundingClientRect():{top:0,left:0};
        h.style.position='absolute';
        h.style.top=(el.offsetTop+el.offsetHeight-10)+'px';
        h.style.left=(el.offsetLeft+el.offsetWidth-10)+'px';
        (el.offsetParent||document.body).appendChild(h);
      } else {
        el.appendChild(h);
      }
      currentHandles.push(h);
    });
  }

  var dragMoved=false;

  function startDrag(cx,cy,target){
    if(target&&target.isContentEditable) return false;
    // Resize handle?
    if(target.classList&&target.classList.contains('resize-handle')&&selected){
      var origW=selected.offsetWidth||parseInt(selected.style.width)||200;
      var origH=selected.offsetHeight||parseInt(selected.style.height)||200;
      resizing={el:selected,startX:cx,startY:cy,origW:origW,origH:origH,corner:target.getAttribute('data-corner')};
      return true;
    }
    var found=findEl(target);
    if(!found) return false;
    document.body.style.userSelect='none';
    document.body.style.webkitUserSelect='none';
    var el=found.el;
    var cs=window.getComputedStyle(el);
    if(selected&&selected!==el) highlight(selected,false);
    selected=el; highlight(el,true);
    var allWithSel=Array.from(document.querySelectorAll(found.sel));
    var elemIdx=allWithSel.indexOf(el);
    var isAbs=cs.position==='absolute'||cs.position==='fixed';
    // For .bg elements, pan background-position by dragging
    if(found.sel==='.bg'||el.classList.contains('bg')||el.classList.contains('slide-bg')){
      var bgPos=window.getComputedStyle(el).backgroundPosition||'50% 50%';
      // Convert to px offsets from current computed position
      dragging={el:el,sel:found.sel,elemIdx:elemIdx,mode:'bgpan',startX:cx,startY:cy,
        origBgPos:bgPos,startBgX:0,startBgY:0};
      dragMoved=false;
      window.parent.postMessage({type:'elementClicked',selector:found.sel},'*');
      return true;
    }

    if(isAbs){
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
    if(resizing){
      var dx=cx-resizing.startX;
      var dy=cy-resizing.startY;
      var newW=Math.max(40,resizing.origW+dx);
      var ratio=resizing.origH/resizing.origW;
      var newH=Math.round(newW*ratio);
      resizing.el.style.width=newW+'px';
      resizing.el.style.height=newH+'px';
      resizing.el.style.maxWidth='none';
      resizing.el.style.maxHeight='none';
      // Update handle position
      if(currentHandles.length&&resizing.el.tagName==='IMG'){
        currentHandles[0].style.top=(resizing.el.offsetTop+newH-10)+'px';
        currentHandles[0].style.left=(resizing.el.offsetLeft+newW-10)+'px';
      }
      return;
    }
    if(!dragging) return;
    var dx=cx-dragging.startX;
    var dy=cy-dragging.startY;
    if(Math.abs(dx)>2||Math.abs(dy)>2) dragMoved=true;
    if(dragging.mode==='bgpan'){
      // Pan background-position with calc() offset from original position
      var origPos=dragging.origBgPos||'50% 50%';
      var parts=origPos.trim().split(/\\s+/);
      var origX=parts[0]||'50%', origY=parts[1]||'50%';
      dragging.el.style.backgroundPosition='calc('+origX+' + '+dx+'px) calc('+origY+' + '+dy+'px)';
      return;
    }
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
    if(resizing){
      var payload={type:'elementResized',selector:resizing.el.tagName==='IMG'?'img':('.'+resizing.el.className.trim().split(/\\s+/)[0]),
        width:resizing.el.style.width,height:resizing.el.style.height,
        top:resizing.el.style.top,left:resizing.el.style.left};
      window.parent.postMessage(payload,'*');
      resizing=null;
      return;
    }
    if(!dragging) return;
    if(dragMoved){
      var ctIdx=dragging.el.getAttribute('data-ct-idx');
      var payload={type:'elementMoved',selector:dragging.sel,elemIdx:dragging.elemIdx,mode:dragging.mode,ctIdx:ctIdx};
      if(dragging.mode==='abs'){payload.left=dragging.el.style.left;payload.top=dragging.el.style.top;}
      else if(dragging.mode==='bgpan'){payload.bgPosition=dragging.el.style.backgroundPosition;payload.mode='bgpan';}
      else{payload.transform=dragging.el.style.transform;}
      window.parent.postMessage(payload,'*');
    }
    dragging=null;
  }

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
      if (e.data.type === 'elementResized') onElementMoved({ ...e.data, type: 'elementMoved', mode: 'abs' });
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
  const [bgImageConfigs, setBgImageConfigs] = useState<Record<number, BgImageConfig>>({});
  const [followBannerConfigs, setFollowBannerConfigs] = useState<Record<number, FollowBannerConfig>>({});
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

  // ── Undo / Redo ───────────────────────────────────────────────────────────────
  type Snapshot = {
    editedTexts: Record<number, TextBlock[]>;
    editedBgUrls: Record<number, string>;
    elementOverrides: Record<number, Record<string, ElementOverride>>;
    overlayConfigs: Record<number, OverlayConfig>;
    bgImageConfigs: Record<number, BgImageConfig>;
    followBannerConfigs: Record<number, FollowBannerConfig>;
    badgeVisible: Record<number, boolean>;
    slides: EditableSlide[];
  };
  const historyRef = useRef<Snapshot[]>([]);
  const historyIndexRef = useRef(-1);
  const isRestoringRef = useRef(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // ── Biblioteca de slides salvos ───────────────────────────────────────────────
  interface SavedSlide { id: string; label: string; html: string; created_at: string; }
  const [savedSlides, setSavedSlides] = useState<SavedSlide[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [saveSlideLoading, setSaveSlideLoading] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/carousel/saved-slides`).then(r => r.ok ? r.json() : []).then(setSavedSlides).catch(() => {});
  }, []);

  async function saveCurrentSlide() {
    if (selectedIndex === null) return;
    const slideHtml = liveSlideHtml(selectedIndex);
    const texts = (editedTexts[selectedIndex] ?? slides[selectedIndex]?.texts ?? []);
    const mainText = texts.find(t => t.isMain)?.text || '';
    const label = mainText.substring(0, 60) || `Slide ${selectedIndex + 1} — ${topic}`;
    setSaveSlideLoading(true);
    try {
      const r = await fetch(`${API}/api/carousel/saved-slides`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: slideHtml, label }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      const saved: SavedSlide = await r.json();
      setSavedSlides(prev => [saved, ...prev]);
      toast.success('Slide salvo na biblioteca!');
    } catch (err: any) { toast.error(err.message); }
    finally { setSaveSlideLoading(false); }
  }

  function insertSavedSlide(saved: SavedSlide) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<body>${saved.html}</body>`, 'text/html');
    const el = doc.body.firstElementChild as HTMLElement;
    if (!el) { toast.error('HTML inválido'); return; }
    const insertAt = selectedIndex !== null ? selectedIndex + 1 : slides.length;
    const newSlide: EditableSlide = {
      index: insertAt,
      html: el.innerHTML,
      outerHtml: el.outerHTML,
      type: detectSlideType(el),
      bgImageUrl: extractBgImageUrl(el),
      texts: extractTextBlocks(el),
      hasBadge: !!el.querySelector('.verified-badge'),
    };
    setSlides(prev => {
      const next = [...prev];
      next.splice(insertAt, 0, newSlide);
      return next.map((s, i) => ({ ...s, index: i }));
    });
    setEditedTexts(prev => {
      const shifted: Record<number, TextBlock[]> = {};
      for (const [k, v] of Object.entries(prev)) {
        const ki = parseInt(k);
        shifted[ki < insertAt ? ki : ki + 1] = v;
      }
      // Popula o índice do novo slide com os blocos extraídos do HTML salvo
      shifted[insertAt] = newSlide.texts.map(t => ({ ...t }));
      return shifted;
    });
    setSelectedIndex(insertAt);
    setLibraryOpen(false);
    toast.success(`"${saved.label.substring(0, 40)}" inserido!`);
  }

  async function deleteSavedSlide(id: string) {
    await fetch(`${API}/api/carousel/saved-slides/${id}`, { method: 'DELETE' });
    setSavedSlides(prev => prev.filter(s => s.id !== id));
  }

  // ── Auto-save / draft restore ─────────────────────────────────────────────────
  const hasRestoredDraftRef = useRef(false);

  // ── Regenerar slide individual ────────────────────────────────────────────────
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenHint, setRegenHint] = useState('');
  const [showRegenInput, setShowRegenInput] = useState(false);

  // ── Blocos e seções colapsáveis ───────────────────────────────────────────────
  const [collapsedBlocks, setCollapsedBlocks] = useState<Record<string, boolean>>({});
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    texts: true, image: true, banner: true, gradient: true,
  });
  function toggleSection(key: string) {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }

  // Quando a seção de gradiente é aberta para um slide que ainda não tem overlayConfig,
  // inicializa com o padrão Leo Baltazar para que o preview já mostre o efeito
  useEffect(() => {
    if (collapsedSections['gradient']) return; // seção fechada → nada a fazer
    if (overlayConfigs[selectedIndex]) return;  // já tem config → não sobrescreve
    const sel = slides[selectedIndex];
    if (!sel) return;
    const hasOverlay = sel.outerHtml.includes('class="overlay"') || sel.outerHtml.includes('class="slide-overlay"');
    if (!hasOverlay) return;
    setOverlayConfigs(prev => ({
      ...prev,
      [selectedIndex]: { opacity: 0.96, direction: 'to bottom', color: '0,0,0', startAt: 40 },
    }));
  }, [collapsedSections['gradient'], selectedIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleBlock(key: string) {
    setCollapsedBlocks(prev => ({ ...prev, [key]: !prev[key] }));
  }
  // Ao trocar de slide, colapsa todos os blocos
  const prevSelectedRef = useRef<number | null>(null);
  if (prevSelectedRef.current !== selectedIndex) {
    prevSelectedRef.current = selectedIndex;
    // Reset acontece via key do componente; não precisamos resetar aqui
  }

  function blockLabel(className: string): string {
    if (className.startsWith('custom-text')) return 'Texto adicionado';
    const cn = className.split(' ')[0];
    const map: Record<string, string> = {
      title: 'Título principal',
      'slide-title': 'Título do slide',
      subtitle: 'Subtítulo',
      'slide-subtitle': 'Subtítulo',
      'narrative-text': 'Texto narrativo',
      'body-text': 'Corpo do texto',
      'hook-text': 'Gancho (Hook)',
      'cta-text': 'Call to Action',
      cta: 'Call to Action',
      'profile-name': 'Nome do perfil',
      'profile-handle': '@Handle do perfil',
      handle: '@Handle',
      caption: 'Legenda',
      'slide-caption': 'Legenda',
      label: 'Rótulo',
      'card-title': 'Título do card',
      'card-text': 'Texto do card',
      'list-item': 'Item de lista',
      tag: 'Tag',
      badge: 'Badge',
      number: 'Número',
      quote: 'Citação',
      'author-name': 'Autor',
      highlight: 'Destaque',
      'step-title': 'Título do passo',
      'step-text': 'Texto do passo',
      'footer-text': 'Rodapé',
      'slide-footer': 'Rodapé',
    };
    return map[cn] ?? `.${cn}`;
  }

  // ── Unsplash inline search ────────────────────────────────────────────────────
  const [imgSearch, setImgSearch] = useState('');
  const [imgSearchResults, setImgSearchResults] = useState<{id:string;url:string;thumb:string;alt:string}[]>([]);
  const [imgSearchLoading, setImgSearchLoading] = useState(false);
  const [imgSearchPage, setImgSearchPage] = useState(1);
  const [imgTarget, setImgTarget] = useState<'bg' | number>('bg');

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

  // ── Histórico: snapshot a cada mudança (debounce 400ms) ──────────────────────

  useEffect(() => {
    if (isRestoringRef.current || slides.length === 0) return;
    const timer = setTimeout(() => {
      const snap: Snapshot = { editedTexts, editedBgUrls, elementOverrides, overlayConfigs, bgImageConfigs, followBannerConfigs, badgeVisible, slides };
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
      historyRef.current.push(snap);
      if (historyRef.current.length > 20) historyRef.current.shift();
      else historyIndexRef.current++;
      setCanUndo(historyIndexRef.current > 0);
      setCanRedo(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [editedTexts, editedBgUrls, elementOverrides, overlayConfigs, bgImageConfigs, followBannerConfigs, badgeVisible, slides]); // eslint-disable-line

  // ── Undo / Redo: Ctrl+Z / Ctrl+Y ─────────────────────────────────────────────

  useEffect(() => {
    function onUndoRedo(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement).isContentEditable) return;
      const undo = (e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey;
      const redo = (e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey));
      if (!undo && !redo) return;
      e.preventDefault();
      if (undo && historyIndexRef.current <= 0) return;
      if (redo && historyIndexRef.current >= historyRef.current.length - 1) return;
      historyIndexRef.current += undo ? -1 : 1;
      const snap = historyRef.current[historyIndexRef.current];
      if (!snap) return;
      isRestoringRef.current = true;
      setEditedTexts(snap.editedTexts);
      setEditedBgUrls(snap.editedBgUrls);
      setElementOverrides(snap.elementOverrides);
      setOverlayConfigs(snap.overlayConfigs);
      setBgImageConfigs(snap.bgImageConfigs);
      setFollowBannerConfigs(snap.followBannerConfigs);
      setBadgeVisible(snap.badgeVisible);
      setSlides(snap.slides);
      setCanUndo(historyIndexRef.current > 0);
      setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
      requestAnimationFrame(() => { isRestoringRef.current = false; });
      toast.success(undo ? 'Desfeito' : 'Refeito', { duration: 1000 });
    }
    window.addEventListener('keydown', onUndoRedo);
    return () => window.removeEventListener('keydown', onUndoRedo);
  }, []); // eslint-disable-line

  // ── Auto-save para localStorage ───────────────────────────────────────────────

  const DRAFT_KEY = `carousel-editor-draft-${folderName}`;

  useEffect(() => {
    if (slides.length === 0) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          editedTexts, editedBgUrls, elementOverrides, overlayConfigs,
          bgImageConfigs, followBannerConfigs, badgeVisible, savedAt: Date.now(),
        }));
      } catch (_) { /* quota exceeded — ignora */ }
    }, 1000);
    return () => clearTimeout(timer);
  }, [editedTexts, editedBgUrls, elementOverrides, overlayConfigs, bgImageConfigs, followBannerConfigs, badgeVisible, slides]); // eslint-disable-line

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

    // Restaura rascunho do localStorage (somente no primeiro mount)
    if (!hasRestoredDraftRef.current) {
      hasRestoredDraftRef.current = true;
      try {
        const saved = localStorage.getItem(`carousel-editor-draft-${folderName}`);
        if (saved) {
          const draft = JSON.parse(saved);
          const ageMs = Date.now() - (draft.savedAt || 0);
          if (ageMs < 7 * 24 * 60 * 60 * 1000) { // 7 dias
            setTimeout(() => {
              isRestoringRef.current = true;
              if (draft.editedTexts)       setEditedTexts(draft.editedTexts);
              if (draft.editedBgUrls)      setEditedBgUrls(draft.editedBgUrls);
              if (draft.elementOverrides)  setElementOverrides(draft.elementOverrides);
              if (draft.overlayConfigs)    setOverlayConfigs(draft.overlayConfigs);
              if (draft.bgImageConfigs)    setBgImageConfigs(draft.bgImageConfigs);
              if (draft.followBannerConfigs) setFollowBannerConfigs(draft.followBannerConfigs);
              if (draft.badgeVisible)      setBadgeVisible(draft.badgeVisible);
              requestAnimationFrame(() => { isRestoringRef.current = false; });
              toast.success('Rascunho restaurado', { duration: 3000 });
            }, 150);
          }
        }
      } catch (_) { /* ignore */ }
    }
  }, [html]); // eslint-disable-line

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

  // ── Duplicar slide ────────────────────────────────────────────────────────────

  function duplicateSlide(idx: number) {
    function shiftUp<T>(rec: Record<number, T>): Record<number, T> {
      const out: Record<number, T> = {};
      for (const [k, v] of Object.entries(rec)) {
        const ki = parseInt(k);
        out[ki <= idx ? ki : ki + 1] = v as T;
      }
      if (rec[idx] !== undefined) out[idx + 1] = rec[idx];
      return out;
    }
    setSlides(prev => {
      const next = [...prev];
      next.splice(idx + 1, 0, { ...prev[idx] });
      return next.map((s, i) => ({ ...s, index: i }));
    });
    setEditedTexts(prev => shiftUp(prev));
    setEditedBgUrls(prev => shiftUp(prev));
    setElementOverrides(prev => shiftUp(prev));
    setOverlayConfigs(prev => shiftUp(prev));
    setBgImageConfigs(prev => shiftUp(prev));
    setFollowBannerConfigs(prev => shiftUp(prev));
    setBadgeVisible(prev => shiftUp(prev));
    setSelectedIndex(idx + 1);
    toast.success('Slide duplicado');
  }

  // ── Unsplash inline search ────────────────────────────────────────────────────

  async function searchUnsplash(q: string, page = 1) {
    if (!q.trim()) return;
    setImgSearchLoading(true);
    try {
      const r = await fetch(`${API}/api/carousel/unsplash-search?q=${encodeURIComponent(q)}&page=${page}`);
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      if (page === 1) setImgSearchResults(data.results ?? []);
      else setImgSearchResults(prev => [...prev, ...(data.results ?? [])]);
      setImgSearchPage(page);
    } catch (err: unknown) {
      toast.error('Busca falhou: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setImgSearchLoading(false);
    }
  }

  function applyImageUrl(url: string) {
    if (selectedIndex === null) return;
    if (imgTarget === 'bg') {
      updateBgUrl(selectedIndex, url);
    } else {
      const imgIdx = imgTarget as number;
      setSlides(prev => prev.map((s, i) => {
        if (i !== selectedIndex) return s;
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<body>${s.outerHtml}</body>`, 'text/html');
        const el = doc.body.firstElementChild!;
        const imgs = Array.from(el.querySelectorAll('img')).filter(img => {
          const src = img.getAttribute('src') || '';
          return src && !src.includes('svg') && !src.includes('badge');
        });
        if (imgs[imgIdx]) imgs[imgIdx].setAttribute('src', url);
        return { ...s, outerHtml: el.outerHTML };
      }));
    }
    toast.success('Imagem aplicada');
  }

  // ── Regenerar slide individual ────────────────────────────────────────────────

  async function regenerateCurrentSlide() {
    if (selectedIndex === null) return;
    setRegenLoading(true);
    setShowRegenInput(false);
    try {
      const slideHtml = liveSlideHtml(selectedIndex);
      const res = await fetch(`${API}/api/carousel/regenerate-slide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slideIndex: selectedIndex,
          numSlides: slides.length,
          slideHtml,
          topic: (config as any)?.topic || topic,
          instructions: (config as any)?.instructions || '',
          niche: (config as any)?.niche || 'Geral',
          contentTone: (config as any)?.contentTone || 'investigativo',
          dominantEmotion: (config as any)?.dominantEmotion || 'medo de perder',
          instagramHandle: (config as any)?.instagramHandle || '',
          userHint: regenHint.trim(),
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<body>${data.slideHtml}</body>`, 'text/html');
      const el = doc.body.firstElementChild as HTMLElement;
      if (!el) throw new Error('HTML inválido');
      const newSlide: EditableSlide = {
        index: selectedIndex,
        html: el.innerHTML,
        outerHtml: el.outerHTML,
        type: detectSlideType(el),
        bgImageUrl: extractBgImageUrl(el),
        texts: extractTextBlocks(el),
        hasBadge: !!el.querySelector('.verified-badge'),
      };
      setSlides(prev => prev.map((s, i) => i === selectedIndex ? newSlide : s));
      setEditedTexts(prev => { const n = { ...prev }; delete n[selectedIndex]; return n; });
      setRegenHint('');
      toast.success(`Slide ${selectedIndex + 1} regenerado`);
    } catch (err: unknown) {
      toast.error('Erro: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setRegenLoading(false);
    }
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

  function updateFontWeight(si: number, bi: number, fontWeight: number | undefined) {
    setEditedTexts(prev => {
      const b = [...(prev[si] ?? [])];
      b[bi] = { ...b[bi], fontWeight };
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

  const handleElementMoved = useCallback((data: { selector: string; elemIdx?: number; mode: string; left?: string; top?: string; transform?: string; ctIdx?: string | null; width?: string; height?: string; bgPosition?: string }) => {
    if (selectedIndex === null) return;

    // Background pan: salva background-position no bgImageConfigs
    if (data.mode === 'bgpan' && data.bgPosition) {
      setBgImageConfigs(prev => ({
        ...prev,
        [selectedIndex]: { ...(prev[selectedIndex] ?? { position: '50% 50%', brightness: 100 }), position: data.bgPosition! },
      }));
      return;
    }

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
        ? { left: data.left, top: data.top, ...(data.width ? { width: data.width, height: data.height } : {}) }
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
      bgImageConfigs[s.index],
      followBannerConfigs[s.index],
    ));
    return `<!DOCTYPE html><html><head>${head}</head><body>\n${built.join('\n')}\n</body></html>`;
  }, [slides, head, editedTexts, editedBgUrls, elementOverrides, overlayConfigs, badgeVisible, bgImageConfigs, followBannerConfigs]);

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
  }, [editedTexts, editedBgUrls, elementOverrides, overlayConfigs, badgeVisible, bgImageConfigs, followBannerConfigs, slides, rebuildHtml]);

  function liveSlideHtml(idx: number): string {
    const s = slides[idx]; if (!s) return '';
    return rebuildSlideOuterHtml(
      s,
      editedTexts[idx] ?? s.texts,
      editedBgUrls[idx] !== '' ? (editedBgUrls[idx] ?? null) : null,
      elementOverrides[idx],
      overlayConfigs[idx],
      badgeVisible[idx],
      bgImageConfigs[idx],
      followBannerConfigs[idx],
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
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      if (imgTarget === 'bg') {
        updateBgUrl(selectedIndex, dataUrl);
      } else {
        // aplica na imagem inline correspondente ao imgTarget
        applyImageUrl(dataUrl);
      }
    };
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
  const selTexts = selectedIndex !== null ? (editedTexts[selectedIndex] ?? sel?.texts ?? []) : [];
  // selBg: prefer the user-edited URL; if not set, extract from the original slide HTML
  const selBg = selectedIndex !== null
    ? (editedBgUrls[selectedIndex] !== undefined
        ? editedBgUrls[selectedIndex]
        : (() => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(sel?.outerHtml ?? '', 'text/html');
            return extractBgImageUrl(doc.body.firstElementChild ?? doc.body) ?? '';
          })())
    : '';

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
          <button onClick={() => { if(canUndo){const e=new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true});window.dispatchEvent(e);}}} disabled={!canUndo}
            title="Desfazer (Ctrl+Z)"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-secondary hover:bg-border disabled:opacity-40 text-foreground text-xs font-semibold transition-colors">
            <Undo2 className="w-3 h-3" />
          </button>
          <button onClick={() => { if(canRedo){const e=new KeyboardEvent('keydown',{key:'y',ctrlKey:true,bubbles:true});window.dispatchEvent(e);}}} disabled={!canRedo}
            title="Refazer (Ctrl+Y)"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-secondary hover:bg-border disabled:opacity-40 text-foreground text-xs font-semibold transition-colors">
            <Redo2 className="w-3 h-3" />
          </button>
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
              {selectedIndex !== null && (
                <button onClick={saveCurrentSlide} disabled={saveSlideLoading}
                  title="Salvar slide na biblioteca"
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-amber-400 bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-50 transition-colors">
                  {saveSlideLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bookmark className="w-3 h-3" />}
                </button>
              )}
              <button onClick={() => setLibraryOpen(v => !v)}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors ${libraryOpen ? 'bg-amber-500/20 text-amber-400' : 'text-muted-foreground bg-secondary'}`}>
                <Library className="w-3 h-3" />
              </button>
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
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Slides</p>
              <button onClick={() => setLibraryOpen(v => !v)}
                title="Biblioteca de slides salvos"
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${libraryOpen ? 'bg-amber-500/20 text-amber-400' : 'text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10'}`}>
                <Library className="w-3 h-3" /> Biblioteca
              </button>
            </div>
            <div className="flex gap-1">
              <button onClick={addNewSlide}
                className="flex-1 flex items-center justify-center gap-1 px-1.5 py-1 rounded-lg text-[10px] font-semibold text-purple-400 bg-purple-500/10 hover:bg-purple-500/20 transition-colors">
                <Plus className="w-3 h-3" /> Novo
              </button>
              {selectedIndex !== null && (
                <button onClick={saveCurrentSlide} disabled={saveSlideLoading}
                  title="Salvar slide na biblioteca"
                  className="px-1.5 py-1 rounded-lg text-[10px] font-semibold text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-50 transition-colors">
                  {saveSlideLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bookmark className="w-3 h-3" />}
                </button>
              )}
              {selectedIndex !== null && (
                <button onClick={() => duplicateSlide(selectedIndex)}
                  className="px-1.5 py-1 rounded-lg text-[10px] font-semibold text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 transition-colors"
                  title="Duplicar slide selecionado">
                  <Copy className="w-3 h-3" />
                </button>
              )}
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

        {/* ── Biblioteca de slides salvos ── */}
        {libraryOpen && (
          <div className="w-full md:w-64 border-r border-border flex flex-col bg-secondary/20">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Library className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs font-bold">Biblioteca</span>
                <span className="text-[10px] text-muted-foreground">({savedSlides.length})</span>
              </div>
              <button onClick={() => setLibraryOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {savedSlides.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-4 text-center gap-2">
                <Bookmark className="w-8 h-8 text-muted-foreground/20" />
                <p className="text-xs text-muted-foreground">Nenhum slide salvo ainda.</p>
                <p className="text-[11px] text-muted-foreground/60">Selecione um slide e clique em 🔖 para salvar.</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {savedSlides.map(saved => (
                  <div key={saved.id} className="rounded-lg border border-border bg-card hover:border-amber-500/40 transition-colors overflow-hidden group">
                    {/* Mini preview */}
                    <div className="w-full h-20 overflow-hidden bg-zinc-900 relative">
                      <iframe
                        srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8">${head}</head><body style="margin:0;padding:0;overflow:hidden">${saved.html}</body></html>`}
                        className="absolute top-0 left-0 origin-top-left pointer-events-none"
                        style={{ width: 1080, height: 1350, transform: 'scale(0.074)', transformOrigin: '0 0' }}
                        scrolling="no"
                        title={saved.label}
                      />
                    </div>
                    <div className="p-2 space-y-1.5">
                      <p className="text-[11px] text-foreground font-medium leading-tight line-clamp-2">{saved.label}</p>
                      <p className="text-[10px] text-muted-foreground/60">{new Date(saved.created_at).toLocaleDateString('pt-BR')}</p>
                      <div className="flex gap-1">
                        <button
                          onClick={() => insertSavedSlide(saved)}
                          className="flex-1 py-1 rounded text-[10px] font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 transition-colors"
                        >
                          + Inserir
                        </button>
                        <button
                          onClick={() => deleteSavedSlide(saved.id)}
                          className="py-1 px-1.5 rounded text-[10px] text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Remover da biblioteca"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Editor panel ── */}
        <div className="flex-1 flex flex-col min-w-0">

          {/* Sub-tabs: Texto | Visual */}
          {sel !== null && selectedIndex !== null && (
            <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-secondary/30 flex-wrap">
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
              {/* Regenerar slide */}
              <div className="ml-auto flex items-center gap-1">
                {showRegenInput && (
                  <input
                    value={regenHint}
                    onChange={e => setRegenHint(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && regenerateCurrentSlide()}
                    placeholder="O que mudar? (opcional)"
                    className="w-40 rounded-lg border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-orange-500/50"
                    autoFocus
                  />
                )}
                <button
                  onClick={() => setShowRegenInput(v => !v)}
                  title="Definir instrução antes de regenerar"
                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors ${showRegenInput ? 'bg-orange-600 text-white' : 'bg-secondary text-muted-foreground hover:bg-border'}`}
                >
                  <Sparkles className="w-3 h-3" />
                </button>
                <button
                  onClick={regenerateCurrentSlide}
                  disabled={regenLoading}
                  title={`Regenerar slide ${(selectedIndex ?? 0) + 1}`}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-orange-600 hover:bg-orange-500 disabled:opacity-60 text-white transition-colors"
                >
                  {regenLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  Regen
                </button>
              </div>
            </div>
          )}

          <AnimatePresence mode="wait">
            {sel !== null && selectedIndex !== null ? (
              <motion.div key={`${selectedIndex}-${editMode}`}
                initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.15 }}
                className="flex-1 flex flex-col overflow-hidden min-h-0"
              >
                {/* ── MODO TEXTO ── */}
                {editMode === 'text' && (
                  <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">

                    {/* Preview — coluna esquerda fixa */}
                    <div className="md:w-[44%] shrink-0 border-b md:border-b-0 md:border-r border-border bg-secondary/10 overflow-hidden flex flex-col">
                      <div className="px-3 pt-3 pb-2 border-b border-border/50">
                        <div className="flex items-center gap-2">
                          <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Preview — Slide {selectedIndex + 1}
                            <span className="ml-2 capitalize font-normal opacity-60">{sel.type}</span>
                          </span>
                        </div>
                      </div>
                      <div className="flex-1 flex items-start justify-center px-3 py-4 overflow-hidden">
                        <SlidePreview slideHtml={liveSlideHtml(selectedIndex)} head={head} />
                      </div>
                    </div>

                    {/* Controles — coluna direita rolável */}
                    <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-4">

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
                          <button
                            type="button"
                            className="w-full flex items-center gap-1.5 text-left"
                            onClick={() => toggleSection('texts')}
                          >
                            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${collapsedSections['texts'] ? '-rotate-90' : 'rotate-0'}`} />
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                              <Edit3 className="w-3.5 h-3.5" /> Textos do slide
                            </span>
                            <span className="ml-auto text-[10px] text-muted-foreground/60">{selTexts.filter(b => !b.deleted).length} bloco{selTexts.filter(b => !b.deleted).length !== 1 ? 's' : ''}</span>
                          </button>
                          {!collapsedSections['texts'] && selTexts.map((block, bi) => {
                            if (block.deleted) return null;
                            const currentSize = block.fontSize ?? (block.isMain ? 48 : 28);
                            const blockKey = `${selectedIndex}-${bi}`;
                            // Por padrão collapsed=true (se a chave não existe, começa fechado)
                            const isCollapsed = collapsedBlocks[blockKey] !== false;
                            const label = blockLabel(block.className);
                            // Preview de texto simples (sem tags HTML) para o header colapsado
                            const textPreview = (block.richHtml
                              ? block.richHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
                              : block.text || '').slice(0, 40) + ((block.richHtml?.replace(/<[^>]+>/g, '') || block.text || '').length > 40 ? '…' : '');

                            return (
                              <div key={`${block.className}-${bi}`}
                                className={`rounded-lg border transition-colors ${
                                  focusedBlockIdx === bi
                                    ? 'border-orange-500/40 bg-orange-500/5'
                                    : 'border-border bg-secondary/20 hover:bg-secondary/40'
                                }`}
                                onClick={() => setFocusedBlockIdx(bi)}>

                                {/* ── Header (sempre visível) ── */}
                                <button
                                  type="button"
                                  className="w-full flex items-center gap-2 px-2.5 py-2 text-left"
                                  onClick={e => { e.stopPropagation(); toggleBlock(blockKey); setFocusedBlockIdx(bi); }}
                                >
                                  {/* Chevron */}
                                  <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : 'rotate-0'}`} />

                                  {/* Label + preview */}
                                  <div className="flex-1 min-w-0">
                                    <span className={`text-[11px] font-semibold ${block.className.startsWith('custom-text') ? 'text-purple-400' : 'text-foreground'}`}>
                                      {label}
                                    </span>
                                    {isCollapsed && textPreview && (
                                      <span className="ml-1.5 text-[10px] text-muted-foreground truncate">{textPreview}</span>
                                    )}
                                  </div>

                                  {/* Cor + tamanho no header (quick-view) */}
                                  <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                                    <div
                                      className="w-3.5 h-3.5 rounded-full border border-white/20 shrink-0"
                                      style={{ background: block.color || '#ffffff' }}
                                      title={block.color || '#ffffff'}
                                    />
                                    <span className="text-[10px] font-mono text-muted-foreground">{currentSize}px</span>
                                  </div>
                                </button>

                                {/* ── Corpo expandido ── */}
                                {!isCollapsed && (
                                  <div className="px-2.5 pb-2.5 space-y-1.5 border-t border-border/50">

                                    {/* Linha de controles rápidos */}
                                    <div className="flex items-center flex-wrap gap-1.5 pt-2">
                                      {/* Remove block */}
                                      <button onClick={e => { e.stopPropagation(); removeTextBlock(selectedIndex, bi); }}
                                        className="w-5 h-5 rounded flex items-center justify-center bg-red-500/20 hover:bg-red-500/40 text-red-400 transition-colors"
                                        title="Ocultar este bloco de texto">
                                        <Minus className="w-2.5 h-2.5" />
                                      </button>

                                      {/* Color picker */}
                                      <div className="flex items-center gap-1" title="Cor do texto" onClick={e => e.stopPropagation()}>
                                        <span className="text-[10px] text-muted-foreground">Cor</span>
                                        <LazyColorInput
                                          value={block.color || '#ffffff'}
                                          onChange={v => updateTextColor(selectedIndex, bi, v)}
                                          className="w-6 h-6 rounded cursor-pointer border border-border bg-transparent"
                                          title="Cor do texto"
                                        />
                                      </div>

                                      {/* Text transform */}
                                      <button
                                        onClick={e => { e.stopPropagation(); toggleTextTransform(selectedIndex, bi); }}
                                        className={`px-1.5 h-5 rounded text-[9px] font-bold transition-colors ${
                                          block.textTransform === 'uppercase'
                                            ? 'bg-purple-600 text-white'
                                            : block.textTransform === 'none'
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-secondary text-muted-foreground hover:bg-border'
                                        }`}
                                        title={block.textTransform === 'uppercase' ? 'MAIÚSCULA → normal' : block.textTransform === 'none' ? 'normal → MAIÚSCULA' : 'Alternar maiúscula/normal'}
                                      >
                                        {block.textTransform === 'uppercase' ? 'AA' : 'Aa'}
                                      </button>

                                      {/* Font size stepper */}
                                      <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                                        <button onClick={() => updateFontSize(selectedIndex, bi, -2)}
                                          className="w-5 h-5 rounded flex items-center justify-center bg-secondary hover:bg-border transition-colors">
                                          <Minus className="w-2.5 h-2.5" />
                                        </button>
                                        <span className="text-[10px] font-mono text-muted-foreground w-8 text-center">{currentSize}px</span>
                                        <button onClick={() => updateFontSize(selectedIndex, bi, 2)}
                                          className="w-5 h-5 rounded flex items-center justify-center bg-secondary hover:bg-border transition-colors">
                                          <Plus className="w-2.5 h-2.5" />
                                        </button>
                                      </div>
                                    </div>

                                    {/* Font family + weight */}
                                    <div className="flex gap-1.5">
                                      <select
                                        value={block.fontFamily || ''}
                                        onChange={e => { e.stopPropagation(); updateFontFamily(selectedIndex, bi, e.target.value); }}
                                        onClick={e => e.stopPropagation()}
                                        className="flex-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                                      >
                                        <option value="">— fonte padrão —</option>
                                        {FONT_OPTIONS.map(f => (
                                          <option key={f} value={f}>{f}</option>
                                        ))}
                                      </select>
                                      <select
                                        value={block.fontWeight ?? ''}
                                        onChange={e => { e.stopPropagation(); updateFontWeight(selectedIndex, bi, e.target.value ? Number(e.target.value) : undefined); }}
                                        onClick={e => e.stopPropagation()}
                                        className="w-20 rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                                        title="Peso da fonte"
                                      >
                                        <option value="">— peso —</option>
                                        <option value="300">Light</option>
                                        <option value="400">Regular</option>
                                        <option value="500">Medium</option>
                                        <option value="600">SemiBold</option>
                                        <option value="700">Bold</option>
                                        <option value="800">ExtraBold</option>
                                        <option value="900">Black</option>
                                      </select>
                                    </div>

                                    {/* Rich text editor */}
                                    <RichTextEditor
                                      key={`rt-${selectedIndex}-${bi}`}
                                      html={block.richHtml || textToHtml(block.text, block.highlights)}
                                      onChange={html => updateRichHtml(selectedIndex, bi, html)}
                                      textAlign={block.textAlign}
                                      blockColor={block.color}
                                    />

                                    {/* Alinhamento */}
                                    <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                                      {(['left', 'center', 'right', 'justify'] as const).map(align => (
                                        <button
                                          key={align}
                                          onClick={() => updateTextAlign(selectedIndex, bi, align)}
                                          className={`flex-1 py-1 rounded text-[10px] font-semibold transition-colors ${
                                            (block.textAlign || 'left') === align
                                              ? 'bg-purple-600 text-white'
                                              : 'bg-secondary text-muted-foreground hover:bg-border'
                                          }`}
                                          title={align === 'left' ? 'Esquerda' : align === 'center' ? 'Centralizado' : align === 'right' ? 'Direita' : 'Justificado'}
                                        >
                                          {align === 'left' ? '⫷' : align === 'center' ? '⫿' : align === 'right' ? '⫸' : '⫼'}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
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
                      <div className="pt-2 border-t border-border">
                        <button
                          type="button"
                          className="w-full flex items-center gap-1.5 mb-2 text-left"
                          onClick={() => toggleSection('image')}
                        >
                          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${collapsedSections['image'] ? '-rotate-90' : 'rotate-0'}`} />
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                            <Image className="w-3.5 h-3.5" /> Imagem
                          </p>
                        </button>
                      {!collapsedSections['image'] && <div className="space-y-2">

                        {/* Selector de alvo (fundo vs img inline) */}
                        {(() => {
                          const parser = new DOMParser();
                          const doc = parser.parseFromString(`<body>${sel?.outerHtml ?? ''}</body>`, 'text/html');
                          const el = doc.body.firstElementChild;
                          const inlineImgs = el ? Array.from(el.querySelectorAll('img'))
                            .map((img, i) => ({ idx: i, src: img.getAttribute('src') || '', label: img.closest('.photo-card') ? `Card ${i+1}` : img.closest('.top-photo-wrap') ? `Topo ${i+1}` : `Img ${i+1}` }))
                            .filter(img => img.src && !img.src.includes('svg') && !img.src.includes('badge')) : [];
                          if (inlineImgs.length === 0) return null;
                          return (
                            <div className="flex gap-1 flex-wrap">
                              <button onClick={() => setImgTarget('bg')} className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${imgTarget === 'bg' ? 'bg-purple-600 text-white' : 'bg-secondary text-muted-foreground hover:bg-border'}`}>Fundo</button>
                              {inlineImgs.map(img => (
                                <button key={img.idx} onClick={() => setImgTarget(img.idx)} className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${imgTarget === img.idx ? 'bg-purple-600 text-white' : 'bg-secondary text-muted-foreground hover:bg-border'}`}>{img.label}</button>
                              ))}
                            </div>
                          );
                        })()}

                        {/* Busca Unsplash */}
                        <div className="space-y-2">
                          <div className="flex gap-1.5">
                            <input
                              value={imgSearch}
                              onChange={e => setImgSearch(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && searchUnsplash(imgSearch)}
                              placeholder="Buscar no Unsplash…"
                              className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                            />
                            <button onClick={() => searchUnsplash(imgSearch, 1)} disabled={imgSearchLoading || !imgSearch.trim()}
                              className="px-2.5 py-1.5 rounded-lg bg-secondary hover:bg-border disabled:opacity-50 text-foreground transition-colors">
                              {imgSearchLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                          {imgSearchResults.length > 0 && (
                            <div className="space-y-1.5">
                              <div className="grid grid-cols-3 gap-1">
                                {imgSearchResults.map(img => (
                                  <button key={img.id} onClick={() => applyImageUrl(img.url)}
                                    title={img.alt}
                                    className="rounded overflow-hidden border border-border hover:border-purple-400 hover:ring-2 hover:ring-purple-500/40 transition-all">
                                    <img src={img.thumb} alt={img.alt} className="w-full h-16 object-cover" />
                                  </button>
                                ))}
                              </div>
                              <button onClick={() => searchUnsplash(imgSearch, imgSearchPage + 1)} disabled={imgSearchLoading}
                                className="w-full py-1 rounded text-[11px] text-muted-foreground hover:text-foreground bg-secondary hover:bg-border transition-colors disabled:opacity-50">
                                {imgSearchLoading ? 'Carregando…' : 'Ver mais'}
                              </button>
                            </div>
                          )}
                        </div>

                        {selBg && imgTarget === 'bg' && (
                          <div className="rounded-lg overflow-hidden border border-border" style={{ maxHeight: 60 }}>
                            <img src={selBg} alt="Fundo atual" className="w-full object-cover" style={{ maxHeight: 60 }}
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          </div>
                        )}
                        <input ref={bgFileRef} type="file" accept="image/*" className="hidden" onChange={handleBgFileChange} />
                        <button onClick={() => bgFileRef.current?.click()}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-border hover:border-purple-400 bg-background hover:bg-purple-500/5 text-muted-foreground hover:text-purple-400 text-xs font-medium transition-colors w-full justify-center">
                          <Upload className="w-3.5 h-3.5" />
                          {imgTarget === 'bg'
                            ? (selBg ? 'Trocar imagem de fundo' : 'Upload — fundo do slide')
                            : `Upload — Img ${(imgTarget as number) + 1} do slide`}
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

                        {/* Corte da imagem (clip-path) — inline images e fundo */}
                        {selectedIndex !== null && (() => {
                          const overrideKey = typeof imgTarget === 'number' ? `img@${imgTarget}` : '.bg@0';
                          const clip = elementOverrides[selectedIndex]?.[overrideKey] ?? {};
                          const setClip = (side: 'clipTop' | 'clipRight' | 'clipBottom' | 'clipLeft', val: number) => {
                            setElementOverrides(prev => ({
                              ...prev,
                              [selectedIndex]: {
                                ...(prev[selectedIndex] ?? {}),
                                [overrideKey]: { ...(prev[selectedIndex]?.[overrideKey] ?? {}), [side]: val },
                              },
                            }));
                          };
                          const hasClip = (clip.clipTop || 0) + (clip.clipRight || 0) + (clip.clipBottom || 0) + (clip.clipLeft || 0) > 0;
                          return (
                            <div className="space-y-2 pt-2 border-t border-border">
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                Corte da imagem {imgTarget === 'bg' ? '(fundo)' : ''}
                              </p>
                              {[
                                { key: 'clipTop' as const, label: 'Corte topo' },
                                { key: 'clipBottom' as const, label: 'Corte base' },
                                { key: 'clipLeft' as const, label: 'Corte esquerda' },
                                { key: 'clipRight' as const, label: 'Corte direita' },
                              ].map(({ key, label }) => (
                                <div key={key} className="space-y-0.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[11px] text-muted-foreground">{label}</span>
                                    <span className="text-[11px] font-mono text-muted-foreground">{clip[key] || 0}%</span>
                                  </div>
                                  <input
                                    type="range" min={0} max={45} step={1}
                                    value={clip[key] || 0}
                                    onChange={e => setClip(key, Number(e.target.value))}
                                    className="w-full accent-purple-500"
                                  />
                                </div>
                              ))}
                              {hasClip && (
                                <button
                                  onClick={() => setElementOverrides(prev => ({
                                    ...prev,
                                    [selectedIndex]: { ...(prev[selectedIndex] ?? {}), [overrideKey]: { ...(prev[selectedIndex]?.[overrideKey] ?? {}), clipTop: 0, clipRight: 0, clipBottom: 0, clipLeft: 0 } },
                                  }))}
                                  className="text-[11px] text-red-400 hover:text-red-300 transition-colors"
                                >Remover corte</button>
                              )}
                            </div>
                          );
                        })()}

                        {/* Posicionamento da imagem */}
                        {selBg && (() => {
                          const bgCfg: BgImageConfig = bgImageConfigs[selectedIndex] ?? { position: 'center center', brightness: 100 };
                          const setBg = (patch: Partial<BgImageConfig>) =>
                            setBgImageConfigs(prev => ({ ...prev, [selectedIndex]: { ...bgCfg, ...patch } }));

                          // Converte posição CSS para X/Y em %
                          const keywordToNum = (k: string) =>
                            k === 'left' || k === 'top' ? 0 : k === 'right' || k === 'bottom' ? 100 : 50;
                          const parsePosNum = (v: string): number => {
                            if (v.endsWith('%')) return parseInt(v);
                            return keywordToNum(v);
                          };
                          const parts = bgCfg.position.trim().split(/\s+/);
                          const posX = parsePosNum(parts[0] ?? 'center');
                          const posY = parsePosNum(parts[1] ?? 'center');
                          const setPosXY = (x: number, y: number) => setBg({ position: `${x}% ${y}%` });
                          const scaleVal = bgCfg.scale ?? 1.0;
                          const scalePct = Math.round(scaleVal * 100);
                          const panEnabled = scaleVal > 1.005;

                          return (
                            <div className="space-y-2 pt-2 border-t border-border">
                              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Posição da imagem</p>

                              {/* Zoom da imagem */}
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <label className="text-[11px] text-muted-foreground">🔍 Zoom</label>
                                  <span className="text-[11px] font-mono text-muted-foreground">{scalePct}%</span>
                                </div>
                                <input type="range" min={100} max={200} step={5} value={scalePct}
                                  onChange={e => setBg({ scale: Number(e.target.value) / 100 })}
                                  className="w-full accent-purple-500"
                                />
                                <div className="flex justify-between text-[10px] text-muted-foreground/50">
                                  <span>100% (original)</span><span>200%</span>
                                </div>
                                {!panEnabled && (
                                  <p className="text-[10px] text-amber-400/80">
                                    Aumente o zoom para mover a imagem livremente
                                  </p>
                                )}
                              </div>

                              {/* Slider X — horizontal */}
                              <div className={`space-y-1 ${!panEnabled ? 'opacity-40 pointer-events-none' : ''}`}>
                                <div className="flex items-center justify-between">
                                  <label className="text-[11px] text-muted-foreground">← Horizontal →</label>
                                  <span className="text-[11px] font-mono text-muted-foreground">{posX}%</span>
                                </div>
                                <input type="range" min={0} max={100} value={posX}
                                  onChange={e => setPosXY(Number(e.target.value), posY)}
                                  className="w-full accent-purple-500"
                                />
                                <div className="flex justify-between text-[10px] text-muted-foreground/50">
                                  <span>Esquerda</span><span>Centro</span><span>Direita</span>
                                </div>
                              </div>

                              {/* Slider Y — vertical */}
                              <div className={`space-y-1 ${!panEnabled ? 'opacity-40 pointer-events-none' : ''}`}>
                                <div className="flex items-center justify-between">
                                  <label className="text-[11px] text-muted-foreground">↑ Vertical ↓</label>
                                  <span className="text-[11px] font-mono text-muted-foreground">{posY}%</span>
                                </div>
                                <input type="range" min={0} max={100} value={posY}
                                  onChange={e => setPosXY(posX, Number(e.target.value))}
                                  className="w-full accent-purple-500"
                                />
                                <div className="flex justify-between text-[10px] text-muted-foreground/50">
                                  <span>Topo</span><span>Centro</span><span>Base</span>
                                </div>
                              </div>

                              {/* Brilho */}
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <label className="text-[11px] text-muted-foreground">Brilho da imagem</label>
                                  <span className="text-[11px] font-mono text-muted-foreground">{bgCfg.brightness}%</span>
                                </div>
                                <input type="range" min={0} max={200} value={bgCfg.brightness}
                                  onChange={e => setBg({ brightness: Number(e.target.value) })}
                                  className="w-full accent-purple-500"
                                />
                                <div className="flex justify-between text-[10px] text-muted-foreground/50">
                                  <span>Escuro</span><span>Normal</span><span>Claro</span>
                                </div>
                              </div>

                              {bgImageConfigs[selectedIndex] && (
                                <button onClick={() => setBgImageConfigs(prev => { const n = {...prev}; delete n[selectedIndex]; return n; })}
                                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                                  Restaurar padrão
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </div>}
                      </div>

                      {/* ── Banner "Me Siga" ── */}
                      {(() => {
                        const hasBanner = sel?.outerHtml.includes('follow-banner');
                        const bannerCfg: FollowBannerConfig = followBannerConfigs[selectedIndex] ?? { visible: true, color: '#e8778a' };
                        const setBanner = (patch: Partial<FollowBannerConfig>) =>
                          setFollowBannerConfigs(prev => ({ ...prev, [selectedIndex]: { ...bannerCfg, ...patch } }));

                        if (!hasBanner) {
                          return (
                            <div className="pt-2 border-t border-border">
                              <button
                                onClick={() => {
                                  const FOLLOW_BANNER_HTML = `<div class="follow-banner" style="position:absolute;top:0;left:0;right:0;z-index:20;background:#e8778a;padding:10px 20px;display:flex;align-items:center;gap:8px;font-size:18px;font-weight:700;color:#fff;"><svg viewBox="0 0 24 24" fill="white" width="20" height="20"><path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>Me siga para mais conteúdos como esse!</div>`;
                                  setSlides(prev => prev.map((s, i) => {
                                    if (i !== selectedIndex) return s;
                                    const parser = new DOMParser();
                                    const doc = parser.parseFromString(`<body>${s.outerHtml}</body>`, 'text/html');
                                    const el = doc.body.firstElementChild!;
                                    el.insertAdjacentHTML('afterbegin', FOLLOW_BANNER_HTML);
                                    return { ...s, outerHtml: el.outerHTML };
                                  }));
                                }}
                                className="flex items-center gap-1.5 py-2 px-3 rounded-lg border border-dashed border-pink-500/40 hover:border-pink-500 bg-pink-500/5 hover:bg-pink-500/10 text-pink-400 text-xs font-semibold transition-colors w-full justify-center"
                              >
                                <Plus className="w-3.5 h-3.5" /> Inserir banner "Me Siga"
                              </button>
                            </div>
                          );
                        }
                        return (
                          <div className="pt-2 border-t border-border">
                            <button
                              type="button"
                              className="w-full flex items-center gap-1.5 mb-2 text-left"
                              onClick={() => toggleSection('banner')}
                            >
                              <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${collapsedSections['banner'] ? '-rotate-90' : 'rotate-0'}`} />
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Banner "Me Siga"</p>
                              {/* Status badge quick-view */}
                              <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded font-semibold ${bannerCfg.visible ? 'bg-pink-600/30 text-pink-300' : 'bg-secondary text-muted-foreground'}`}>
                                {bannerCfg.visible ? 'Visível' : 'Oculto'}
                              </span>
                            </button>
                            {!collapsedSections['banner'] && (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <button
                                    onClick={() => setBanner({ visible: !bannerCfg.visible })}
                                    className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors ${bannerCfg.visible ? 'bg-pink-600 text-white' : 'bg-secondary text-muted-foreground hover:bg-border'}`}
                                  >
                                    {bannerCfg.visible ? 'Visível' : 'Oculto'}
                                  </button>
                                </div>
                                {bannerCfg.visible && (
                                  <div className="flex items-center gap-2">
                                    <label className="text-[11px] text-muted-foreground">Cor do banner</label>
                                    <LazyColorInput
                                      value={bannerCfg.color}
                                      onChange={v => setBanner({ color: v })}
                                      className="w-7 h-7 rounded cursor-pointer border border-border"
                                      title="Cor do banner"
                                    />
                                    <span className="text-[11px] text-muted-foreground">{bannerCfg.color}</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* ── Gradiente / Overlay ── */}
                      {(sel.outerHtml.includes('class="overlay"') || sel.outerHtml.includes('class="slide-overlay"')) && (() => {
                        const ov: OverlayConfig = overlayConfigs[selectedIndex] ?? {
                          opacity: 0.96, direction: 'to bottom', color: '0,0,0', startAt: 40
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
                          <div className="pt-3 border-t border-border">
                            <div className="flex items-center gap-2 mb-2">
                              <button
                                type="button"
                                className="flex-1 flex items-center gap-1.5 text-left"
                                onClick={() => toggleSection('gradient')}
                              >
                                <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${collapsedSections['gradient'] ? '-rotate-90' : 'rotate-0'}`} />
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                  Gradiente da capa
                                </p>
                                {ov.direction !== 'none' && (
                                  <div className="ml-auto w-10 h-4 rounded border border-border shrink-0"
                                    style={{ background: buildOverlayStyle(ov) }} />
                                )}
                              </button>
                              {/* Preset Leo Baltazar — sempre visível */}
                              <button
                                type="button"
                                onClick={() => setOv({ direction: 'to bottom', startAt: 40, opacity: 0.97, color: '0,0,0', topOpacity: 0.15 })}
                                className="shrink-0 px-2 py-1 rounded-md bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-bold transition-colors"
                                title="Aplica gradiente estilo Leo Baltazar: topo limpo, escuro forte na metade inferior"
                              >
                                ↓
                              </button>
                            </div>
                          {!collapsedSections['gradient'] && <div className="space-y-3">

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

                            {/* Começa em (só para 'to bottom') */}
                            {ov.direction === 'to bottom' && (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <label className="text-[11px] text-muted-foreground">Começa em</label>
                                  <span className="text-[11px] font-mono text-muted-foreground">{ov.startAt ?? 0}%</span>
                                </div>
                                <input type="range" min={0} max={80} value={ov.startAt ?? 0}
                                  onChange={e => setOv({ startAt: Number(e.target.value) })}
                                  className="w-full accent-purple-500"
                                />
                                <div className="flex justify-between text-[10px] text-muted-foreground/50">
                                  <span>Topo</span><span>Meio</span><span>Base</span>
                                </div>
                              </div>
                            )}

                            {/* Escurecimento no topo (só para 'to bottom') */}
                            {ov.direction === 'to bottom' && (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <label className="text-[11px] text-muted-foreground">Escurecimento no topo</label>
                                  <span className="text-[11px] font-mono text-muted-foreground">{Math.round((ov.topOpacity ?? 0) * 100)}%</span>
                                </div>
                                <input type="range" min={0} max={50} value={Math.round((ov.topOpacity ?? 0) * 100)}
                                  onChange={e => setOv({ topOpacity: Number(e.target.value) / 100 })}
                                  className="w-full accent-purple-500"
                                />
                                <div className="flex justify-between text-[10px] text-muted-foreground/50">
                                  <span>Sem</span><span>15% (Leo)</span><span>50%</span>
                                </div>
                              </div>
                            )}

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
                          </div>}

                          {/* ── Aplicar gradiente — sempre visível, injeta direto no HTML ── */}
                          {(() => {
                            const applyGradient = () => {
                              const gradient = buildOverlayStyle(ov);
                              setSlides(prev => prev.map((s, i) => {
                                if (i !== selectedIndex) return s;
                                const parser = new DOMParser();
                                const doc = parser.parseFromString(`<body>${s.outerHtml}</body>`, 'text/html');
                                const root = doc.body.firstElementChild!;
                                const overlayEl = (
                                  root.querySelector('.overlay') ??
                                  root.querySelector('.slide-overlay') ??
                                  root.querySelector('[class*="overlay"]')
                                ) as HTMLElement | null;
                                if (!overlayEl) return s;
                                const existing = overlayEl.getAttribute('style') || '';
                                const cleaned = existing.replace(/background\s*:[^;]+;?/gi, '').replace(/\s{2,}/g, ' ').trim().replace(/;$/, '');
                                overlayEl.setAttribute('style', `${cleaned}${cleaned ? '; ' : ''}background:${gradient};`);
                                return { ...s, outerHtml: root.outerHTML };
                              }));
                            };
                            return (
                              <button
                                onClick={applyGradient}
                                className="mt-2 w-full py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition-colors"
                              >
                                ✓ Aplicar gradiente no slide
                              </button>
                            );
                          })()}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
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
