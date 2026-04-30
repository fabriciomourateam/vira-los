import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Download, RefreshCw, Loader2, Image, Edit3, LayoutList, Eye, Save, Trash2,
  BookmarkPlus, GripVertical, Plus, Minus, Upload, MousePointer2, Type,
  Undo2, Redo2, Search, Copy, Sparkles, ChevronDown, Library, Bookmark, X,
} from 'lucide-react';

import { generateAndSaveScreenshots, generateAndSaveScreenshotsHiFi } from '@/lib/clientScreenshots';

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
  softness?: number;     // 0–100: blend entre curva e linear (0=curva pura, 100=linear)
  midLight?: number;     // 0–100: quanto a faixa do MEIO é mais clara (0=escuro igual fim, 100=transparente)
  curveExp?: number;     // 0–100: 0=t³(12% no meio), 50=t²(25%), 100=t¹(50%) — controla intensidade da curva
  halfPage?: boolean;    // true → gradiente só na metade (bottom: 50-100%, top: 0-50%)
  solidFrom?: number;    // 0–100% da página: a partir daqui o gradiente fica flat/escuro; antes = fade suave
}

interface BgImageConfig {
  position: string;    // CSS background-position para sliders (X% Y%), ex: '50% 30%'
  brightness: number;  // 0–200, padrão 100
  scale?: number;      // 1.0 = 100% (cover exato), >1.0 = zoom extra
  dragOffsetX?: number; // px offset do drag (translate horizontal)
  dragOffsetY?: number; // px offset do drag (translate vertical)
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
    case 'to top': {
      // Gradiente suave com 16 stops — espelho do 'to bottom'
      // halfPage=true: cobre só os primeiros 50% (topo), transparente na metade inferior
      const endPct  = cfg.halfPage ? 50 : 100;
      const STPS    = 16;
      const tStops: string[] = [`rgba(${c},${hi}) 0%`];
      for (let i = 1; i <= STPS; i++) {
        const t  = i / STPS;
        const p  = t * endPct;
        const op = opacity * Math.max(0, 1 - t * t);   // ease-out: escuro→transparente
        tStops.push(`rgba(${c},${op.toFixed(3)}) ${p.toFixed(1)}%`);
      }
      if (cfg.halfPage) tStops.push(`rgba(${c},0) 100%`);
      return `linear-gradient(to top, ${tStops.join(', ')})`;
    }
    case 'to right':  return `linear-gradient(to right, rgba(${c},${hi}) 0%, rgba(${c},${lo}) 55%, rgba(${c},0) 100%)`;
    case 'radial':    return `radial-gradient(ellipse at center, rgba(${c},${(opacity*0.1).toFixed(2)}) 0%, rgba(${c},${hi}) 100%)`;
    case 'none':      return 'rgba(0,0,0,0)';
    default: {
      // Gradiente 'to bottom' com curva suave — 16 paradas calculadas matematicamente
      // Elimina as "divisões" visíveis que surgem com poucos stops e transições lineares.
      //
      // softness (0–100): controla a curva de aceleração
      //   0  → ease-in cúbico (t³): começa devagar, escurece rápido no final
      //   100 → quase linear (t): escurecimento uniforme ao longo da faixa
      //
      // midLight (0–95): claridade do ponto médio da transição (efeito "dip")
      //   0  → curva monotônica (sem dip)
      //   95 → ponto médio quase transparente antes de escurecer no rodapé
      const topOp01   = cfg.topOpacity ?? 0;
      const soft01    = (cfg.softness  ?? 0) / 100;
      const midLt01   = (cfg.midLight  ?? 0) / 100;
      // curveExp 0–100 = % de opacidade no ponto médio da faixa de transição
      //   0  → ponto médio transparente (curva muito suave, ex: t^6)
      //  25  → ponto médio com 25% (≈ t², comportamento anterior padrão)
      //  50  → ponto médio com 50% (curva linear)
      //  99  → ponto médio com 99% (escuro desde o início da faixa, mantém gradiente suave)
      // Deriva o expoente via log: 0.5^n = fração → n = log(fração)/log(0.5)
      const midFrac  = Math.max(0.5, Math.min(99.5, cfg.curveExp ?? 25)) / 100;
      const exponent = Math.log(midFrac) / Math.log(0.5);  // ex: 0.25→2, 0.5→1, 0.99→0.015
      // halfPage: gradiente só na metade inferior → força startAt ≥ 50
      const effectiveStart = cfg.halfPage ? Math.max(startAt, 50) : startAt;
      // solidFrom: se definido, delimita onde o gradiente vira escuro sólido.
      // Tudo entre solidFrom e 100% fica no opacity máximo (flat).
      // A zona de transição vai de effectiveStart → solidFrom.
      const transitionEnd = (cfg.solidFrom !== undefined && cfg.solidFrom > effectiveStart && cfg.solidFrom < 100)
        ? cfg.solidFrom
        : 100;

      const STOPS = 16;
      const stops: string[] = [];

      for (let i = 0; i <= STOPS; i++) {
        const pct = (i / STOPS) * 100;

        let op: number;
        if (pct <= effectiveStart) {
          // Faixa plana no topo (antes do gradiente começar)
          op = topOp01;
        } else if (pct >= transitionEnd) {
          // Faixa sólida escura (solidFrom → 100%)
          op = opacity;
        } else {
          // t2 = progresso 0→1 dentro da faixa de transição (effectiveStart → transitionEnd)
          const t2 = (pct - effectiveStart) / (transitionEnd - effectiveStart);

          // Curva potencial controlada por curveExp; blend com linear via softness
          const curve  = Math.pow(t2, exponent);
          const smooth = (1 - soft01) * curve + soft01 * t2;

          // Efeito midLight: curva em sino (4t²(1-t)²) cria "dip" no meio
          const bell    = 4 * t2 * t2 * (1 - t2) * (1 - t2);
          const combined = Math.max(0, smooth * (1 - midLt01 * bell));

          op = topOp01 + (opacity - topOp01) * combined;
        }

        stops.push(`rgba(${c},${op.toFixed(3)}) ${pct.toFixed(2)}%`);
      }

      return `linear-gradient(to bottom, ${stops.join(', ')})`;
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
  // Classic layouts: background-image on bg divs
  const bgEl = el.querySelector('.slide-bg, .bg, .fmt-cover-bg, .fmt-cta-bg, .fmt-img-box');
  if (bgEl) {
    const m = BG_IMAGE_REGEX.exec(bgEl.getAttribute('style') || '');
    if (m) return m[1];
  }
  // fmteam v2: full-bleed dark slides use <img> inside .photo-bg
  const photoBgImg = el.querySelector('.photo-bg img') as HTMLImageElement | null;
  if (photoBgImg) return photoBgImg.getAttribute('src') || null;
  // fmteam v2: light/gradient slides use <img> inside .img-box-top
  const imgBoxImg = el.querySelector('.img-box-top img') as HTMLImageElement | null;
  if (imgBoxImg) return imgBoxImg.getAttribute('src') || null;
  // Fallback: background-image on slide root
  const m = BG_IMAGE_REGEX.exec(el.getAttribute('style') || '');
  return m ? m[1] : null;
}

function detectSlideType(el: Element): 'cover' | 'editorial' | 'cta' {
  const c = el.className || '';
  if (c.includes('fmt-cover')) return 'cover';
  if (c.includes('fmt-cta')) return 'cta';
  if (c.includes('fmt-content')) return 'editorial';
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
  // clean-split (antes/depois)
  { selector: '.split-title', isMain: true },
  { selector: '.split-eyebrow', isMain: false },
  { selector: '.split-stats', isMain: false },
  // ── fmteam v2 ──
  { selector: '.capa-headline', isMain: true },
  { selector: '.capa-sub', isMain: true },
  { selector: '.capa-context', isMain: false },
  { selector: '.dark-h1', isMain: true },
  { selector: '.light-h1', isMain: true },
  { selector: '.dark-body', isMain: true },
  { selector: '.light-body', isMain: true },
  { selector: '.tag', isMain: false },
  { selector: '.badge-name', isMain: false },
  { selector: '.badge-handle', isMain: false },
  { selector: '.cta-bridge', isMain: true },
  { selector: '.cta-kbox-label', isMain: false },
  { selector: '.cta-kbox-keyword', isMain: true },
  { selector: '.cta-kbox-benefit', isMain: false },
  { selector: '.cta-kbox-sub', isMain: false },
  { selector: '.cta-badge-name', isMain: false },
  { selector: '.cta-badge-handle', isMain: false },
  // fmteam v2: stat-rows, arrow-rows e número decorativo
  { selector: '.stat-num', isMain: true },
  { selector: '.stat-title', isMain: false },
  { selector: '.stat-desc', isMain: false },
  { selector: '.arrow-text', isMain: false },
  { selector: '.grad-num', isMain: false },
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
  // Auto-migra carrosseis fmteam antigos: a 3ª linha da capa (texto entre parênteses)
  // era um <div style="..."> inline; agora usa class="capa-context" para ser editável.
  // Detecção via DOM: qualquer div em .capa-headline-area que não seja badge/headline/sub.
  doc.querySelectorAll(
    '.capa-headline-area > div:not(.capa-badge):not(.capa-headline):not(.capa-sub):not(.capa-context)'
  ).forEach(div => {
    div.removeAttribute('style');
    div.classList.add('capa-context');
  });
  const head = doc.head.innerHTML;
  const slideEls = Array.from(doc.querySelectorAll(
    '.slide, .slide-editorial, .clean-cover, .clean-content, .clean-cta, .clean-split, .fmt-slide'
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
  globalFont?: string,
  slideBgColor?: string,
): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${slide.outerHtml}</body>`, 'text/html');
  const el = doc.body.firstElementChild!;

  // Apply slide background color override
  if (slideBgColor) {
    let rootStyle = el.getAttribute('style') || '';
    rootStyle = rootStyle.replace(/background\s*:\s*[^;]+;?/gi, '').replace(/background-color\s*:\s*[^;]+;?/gi, '').trim();
    rootStyle = `${rootStyle}; background-color: ${slideBgColor};`.replace(/^;\s*/, '');
    el.setAttribute('style', rootStyle);
  }

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
      // Apply font-family override (globalFont takes precedence over per-block font)
      const effectiveFont = globalFont || tb.fontFamily;
      if (effectiveFont) {
        newStyle = newStyle.replace(FONT_FAMILY_REGEX, '').replace(/\s{2,}/g, ' ').trim();
        newStyle = `${newStyle}; font-family: '${effectiveFont}', sans-serif;`.replace(/^;\s*/, '');
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
  // fmteam v2: images are <img> elements — apply src / object-position / filter
  const fmteamImg = (el.querySelector('.photo-bg img') ?? el.querySelector('.img-box-top img')) as HTMLElement | null;
  if (fmteamImg && (newBgUrl !== null || bgImageConfig)) {
    if (newBgUrl !== null) {
      fmteamImg.setAttribute('src', newBgUrl);
    }
    if (bgImageConfig) {
      const pos = bgImageConfig.position.trim();
      const posParts = pos.split(/\s+/);
      const posX = parseFloat(posParts[0]) || 50;
      const posY = parseFloat(posParts[1] ?? posParts[0]) || 50;
      const scale = bgImageConfig.scale ?? 1.0;
      const dragX = bgImageConfig.dragOffsetX ?? 0;
      const dragY = bgImageConfig.dragOffsetY ?? 0;
      const hasDrag = dragX !== 0 || dragY !== 0;
      // Só sobrescreve object-position se houve drag ou se o usuário moveu o slider
      // (posição não-default). Isso preserva object-position:top no CTA quando o
      // usuário altera apenas o brilho sem ter mexido na posição.
      const posIsDefault = posX === 50 && posY === 50 && !hasDrag;
      let imgStyle = fmteamImg.getAttribute('style') || '';
      if (!posIsDefault) {
        imgStyle = imgStyle.replace(/object-position\s*:\s*[^;]+;?/gi, '').trim();
      }
      imgStyle = imgStyle.replace(/filter\s*:\s*brightness\([^)]+\)\s*;?/i, '').trim();
      imgStyle = imgStyle.replace(/transform\s*:[^;]+;?/i, '').trim();
      const scaleTransform = scale > 1.005 ? ` transform: scale(${scale.toFixed(3)});` : '';
      if (!posIsDefault) {
        const bpx = hasDrag
          ? (dragX >= 0 ? `calc(50% + ${dragX.toFixed(1)}px)` : `calc(50% - ${(-dragX).toFixed(1)}px)`)
          : `${posX}%`;
        const bpy = hasDrag
          ? (dragY >= 0 ? `calc(50% + ${dragY.toFixed(1)}px)` : `calc(50% - ${(-dragY).toFixed(1)}px)`)
          : `${posY}%`;
        imgStyle += `; object-position: ${bpx} ${bpy};`;
      }
      imgStyle += ` filter: brightness(${bgImageConfig.brightness}%);${scaleTransform}`;
      fmteamImg.setAttribute('style', imgStyle.replace(/^;\s*/, '').replace(/\s{2,}/g, ' '));
    }
  } else if (newBgUrl !== null || bgImageConfig) {
    // Classic layout: background-image on bg divs
    const slideBg = el.querySelector('.slide-bg, .bg, .fmt-cover-bg, .fmt-cta-bg, .fmt-img-box') as HTMLElement | null;
    const target = slideBg || el as HTMLElement;
    let s = target.getAttribute('style') || '';
    if (newBgUrl !== null) {
      s = BG_IMAGE_REGEX.test(s)
        ? s.replace(BG_IMAGE_REGEX, `background-image: url('${newBgUrl}')`)
        : `${s} background-image: url('${newBgUrl}');`;
    }
    if (bgImageConfig) {
      // Parse X/Y position values (slider gives 0-100, 50 = center)
      const pos = bgImageConfig.position.trim();
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

      const dragX = bgImageConfig.dragOffsetX ?? 0;
      const dragY = bgImageConfig.dragOffsetY ?? 0;
      const hasDrag = dragX !== 0 || dragY !== 0;

      if (hasDrag) {
        // Pan via background-position calc() — move image within element, no black bands.
        // For images taller/wider than container: full panning range.
        // For same-aspect images: browser clamps naturally (no movement, but no black either).
        // Zoom (scale) applied separately via transform when active.
        const scaleTransform = scale > 1.005 ? ` transform: scale(${scale.toFixed(3)});` : '';
        // Use explicit sign operators — "calc(50% + -N)" can cause browser normalisation bugs
        const bpx = dragX >= 0 ? `calc(50% + ${dragX.toFixed(1)}px)` : `calc(50% - ${(-dragX).toFixed(1)}px)`;
        const bpy = dragY >= 0 ? `calc(50% + ${dragY.toFixed(1)}px)` : `calc(50% - ${(-dragY).toFixed(1)}px)`;
        s += `; inset: 0; background-size: cover;`
           + ` background-position: ${bpx} ${bpy};`
           + `${scaleTransform}`
           + ` filter: brightness(${bgImageConfig.brightness}%);`;
      } else if (scale > 1.005) {
        // Zoom extra: scale()+translate() para panning livre
        const maxT = ((scale - 1) / (2 * scale)) * 100;
        const tx = ((50 - posX) / 50) * maxT;
        const ty = ((50 - posY) / 50) * maxT;
        s += `; inset: 0; background-size: cover; background-position: center;`
           + ` transform: scale(${scale.toFixed(3)}) translate(${tx.toFixed(2)}%, ${ty.toFixed(2)}%);`
           + ` filter: brightness(${bgImageConfig.brightness}%);`;
      } else {
        // Sem zoom: background-position direto. Funciona quando a imagem tem
        // excesso natural após cover. Pode mostrar fundo se não houver excesso.
        s += `; inset: 0; background-size: cover; background-position: ${posX}% ${posY}%;`
           + ` filter: brightness(${bgImageConfig.brightness}%);`;
      }
    }
    target.setAttribute('style', s);
  } // end else if classic layout

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

  // Overlay gradient — tenta todos os seletores possíveis de overlay, incluindo fmteam
  if (overlayConfig) {
    const overlayEl = (
      el.querySelector('.overlay') ??
      el.querySelector('.slide-overlay') ??
      el.querySelector('.overlay-capa') ??
      el.querySelector('.overlay-shadow-up') ??
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

  // el.outerHTML re-escapa '&' → '&amp;' em valores de atributos (comportamento padrão do
  // serializador HTML5). Isso quebra URLs com query params (ex.: Unsplash ?crop=entropy&cs=...).
  // Decodificamos apenas dentro de style="..." e src="..." para não afetar conteúdo de texto.
  return el.outerHTML.replace(
    /(<[^>]+(?:style|src|href)="[^"]*?)&amp;([^"]*?")/g,
    (_, before, after) => `${before}&${after}`,
  );
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
  '.photo-card', '.top-photo-wrap', '.bg',
  // Footer / header
  '.slide-footer', '.top-header',
  // Texto (editorial + clean)
  '.title', '.subtitle', '.subtitle-accent', '.narrative-text',
  '.content-title', '.content-body', '.cta-title',
  '.follow-pill', '.profile-name', '.profile-handle',
  // ── Layout fmteam v2 — imagens ──
  '.photo-bg', '.img-box-top',
  // ── Layout fmteam v2 — texto ──
  '.capa-headline-area', '.capa-badge', '.capa-headline', '.capa-sub', '.capa-context',
  '.dark-h1', '.light-h1', '.dark-body', '.light-body',
  '.tag', '.content',
  '.cta-bridge', '.cta-kbox', '.cta-footer-badge',
  // ── Layout fmteam v2 — componentes de dados ──
  '.stat-row', '.arrow-row',
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
    // img inside .split-panel — antes/depois panels: drag via object-position
    // Match ANY img inside a .split-panel (don't rely on class="split-img" being present)
    if(t.tagName==='IMG'&&t.closest&&t.closest('.split-panel')){
      return {el:t,sel:'.split-panel img'};
    }
    // If clicking on .overlay / .slide-overlay, redirect to .bg
    if(t.classList&&(t.classList.contains('overlay')||t.classList.contains('slide-overlay'))){
      var parent=t.parentElement;
      var bgEl=null;
      while(parent&&!bgEl){
        bgEl=parent.querySelector('.bg, .slide-bg');
        parent=parent.parentElement;
      }
      if(bgEl) return {el:bgEl,sel:'.bg'};
    }
    // Also redirect if target is .bg itself or .slide-bg
    if(t.classList&&(t.classList.contains('bg')||t.classList.contains('slide-bg'))){
      return {el:t,sel:'.bg'};
    }
    // Prefere o elemento mais específico (mais próximo do clique no DOM)
    // Em vez de retornar o primeiro match da lista, compara profundidade
    var bestMatch=null, bestDepth=Infinity;
    for(var i=0;i<SELS.length;i++){
      var el=t.closest(SELS[i]);
      if(el){
        var depth=0, cur=t;
        while(cur&&cur!==el){depth++;cur=cur.parentElement;}
        if(depth<bestDepth){bestDepth=depth;bestMatch={el:el,sel:SELS[i]};}
      }
    }
    if(bestMatch) return bestMatch;
    // Last resort: if clicked inside a slide but not on any draggable, try to find .bg
    var slideEl=t.closest('.slide,.slide-dark,.slide-light,.slide-grad,.slide-editorial,.clean-cover,.clean-content,.clean-cta,.clean-split');
    if(slideEl){
      var fallbackBg=slideEl.querySelector('.bg, .slide-bg');
      if(fallbackBg) return {el:fallbackBg,sel:'.bg'};
      // No .bg child — use slide container itself if it has background-image
      if(slideEl.style.backgroundImage || window.getComputedStyle(slideEl).backgroundImage!=='none'){
        return {el:slideEl,sel:'.bg'};
      }
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
    if(el.closest&&el.closest('.split-panel')) return; // painel split — só arraste, sem resize
    // NEVER force position:absolute here — it pulls elements out of flex/grid containers
    // and makes them appear zoomed. Elements that are already absolute keep their abs mode;
    // static elements are moved via translate (handled in startDrag via isAbs check).
    // Only ensure the parent is relative so handles position correctly.
    var parent=el.parentElement;
    if(parent&&window.getComputedStyle(parent).position==='static') parent.style.position='relative';
    ['br'].forEach(function(corner){
      var h=document.createElement('div');
      h.className='resize-handle '+corner;
      h.setAttribute('data-corner',corner);
      if(el.tagName==='IMG'){
        // Position handle relative to img's offsetParent (img stays in flow)
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
    if(selected&&selected!==el){ highlight(selected,false); removeHandles(); }
    selected=el; highlight(el,true);
    var allWithSel=Array.from(document.querySelectorAll(found.sel));
    var elemIdx=allWithSel.indexOf(el);
    var isAbs=cs.position==='absolute'||cs.position==='fixed';
    // img inside .split-panel: pan via object-position (antes/depois panels)
    if(el.tagName==='IMG'&&el.closest&&el.closest('.split-panel')){
      el.style.objectFit='cover'; // garante object-fit:cover mesmo sem a classe split-img
      var curObjPos=el.style.objectPosition||'';
      var opRx=/calc\\(50% ([+\\-]) ([\\d.]+)px\\)/g;
      var pm,opVals=[];
      while((pm=opRx.exec(curObjPos))!==null) opVals.push((pm[1]==='-'?-1:1)*parseFloat(pm[2]));
      var origTx=opVals.length>=1?opVals[0]:0;
      var origTy=opVals.length>=2?opVals[1]:0;
      dragging={el:el,sel:found.sel,elemIdx:elemIdx,mode:'imgpan',startX:cx,startY:cy,origTx:origTx,origTy:origTy,_curX:origTx,_curY:origTy};
      dragMoved=false;
      window.parent.postMessage({type:'elementClicked',selector:found.sel},'*');
      return true;
    }
    // fmteam v2: .photo-bg / .img-box-top — pan child <img> via object-position
    if(el.classList.contains('photo-bg')||el.classList.contains('img-box-top')){
      var childImg=el.querySelector('img');
      if(childImg){
        var curObjPos=childImg.style.objectPosition||'';
        var opRx2=/calc\(50% ([+\-]) ([\d.]+)px\)/g;
        var pm2,opVals2=[];
        while((pm2=opRx2.exec(curObjPos))!==null) opVals2.push((pm2[1]==='-'?-1:1)*parseFloat(pm2[2]));
        var origTx=opVals2.length>=1?opVals2[0]:0;
        var origTy=opVals2.length>=2?opVals2[1]:0;
        dragging={el:childImg,sel:found.sel,elemIdx:elemIdx,mode:'photopan',startX:cx,startY:cy,origTx:origTx,origTy:origTy,_curX:origTx,_curY:origTy};
        dragMoved=false;
        window.parent.postMessage({type:'elementClicked',selector:found.sel},'*');
        return true;
      }
    }
    // For .bg elements, pan via background-position — no black bands for taller images
    if(found.sel==='.bg'||el.classList.contains('bg')||el.classList.contains('slide-bg')){
      // Parse current background-position: handles "calc(50% + Npx)" AND "calc(50% - Npx)"
      // (browser normalises calc(50% + -N) → calc(50% - N), so we need the [-] branch)
      var curBgPos=el.style.backgroundPosition||'';
      var bgRx=/calc\(50% ([+\\-]) ([\\d.]+)px\)/g;
      var bm, bgVals=[];
      while((bm=bgRx.exec(curBgPos))!==null) bgVals.push((bm[1]==='-'?-1:1)*parseFloat(bm[2]));
      var origTx=bgVals.length>=1?bgVals[0]:0;
      var origTy=bgVals.length>=2?bgVals[1]:0;
      dragging={el:el,sel:found.sel,elemIdx:elemIdx,mode:'bgpan',startX:cx,startY:cy,origTx:origTx,origTy:origTy,_curX:origTx,_curY:origTy};
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
      // Pan via background-position — moves image within element, no black bands for taller images
      var nx=dragging.origTx+dx, ny=dragging.origTy+dy;
      dragging._curX=nx; dragging._curY=ny;
      // Use explicit sign operator to avoid browser normalising "calc(50% + -N)" → "calc(50% - N)"
      var bpx=nx>=0?'calc(50% + '+nx.toFixed(1)+'px)':'calc(50% - '+(-nx).toFixed(1)+'px)';
      var bpy=ny>=0?'calc(50% + '+ny.toFixed(1)+'px)':'calc(50% - '+(-ny).toFixed(1)+'px)';
      dragging.el.style.backgroundPosition=bpx+' '+bpy;
      return;
    }
    if(dragging.mode==='imgpan'){
      // Pan via object-position — moves image content inside <img> with object-fit:cover
      var nx=dragging.origTx+dx, ny=dragging.origTy+dy;
      dragging._curX=nx; dragging._curY=ny;
      var opx=nx>=0?'calc(50% + '+nx.toFixed(1)+'px)':'calc(50% - '+(-nx).toFixed(1)+'px)';
      var opy=ny>=0?'calc(50% + '+ny.toFixed(1)+'px)':'calc(50% - '+(-ny).toFixed(1)+'px)';
      dragging.el.style.objectPosition=opx+' '+opy;
      return;
    }
    if(dragging.mode==='photopan'){
      // fmteam v2: pan <img> inside .photo-bg / .img-box-top via object-position
      var nx=dragging.origTx+dx, ny=dragging.origTy+dy;
      dragging._curX=nx; dragging._curY=ny;
      var opx=nx>=0?'calc(50% + '+nx.toFixed(1)+'px)':'calc(50% - '+(-nx).toFixed(1)+'px)';
      var opy=ny>=0?'calc(50% + '+ny.toFixed(1)+'px)':'calc(50% - '+(-ny).toFixed(1)+'px)';
      dragging.el.style.objectPosition=opx+' '+opy;
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
      else if(dragging.mode==='bgpan'){
        // Read final offset from dragging object (set during moveDrag) — avoids CSS parsing
        payload.bgTranslateX=dragging._curX!==undefined?dragging._curX:0;
        payload.bgTranslateY=dragging._curY!==undefined?dragging._curY:0;
        payload.mode='bgpan';
      }
      else if(dragging.mode==='imgpan'){
        payload.imgTranslateX=dragging._curX!==undefined?dragging._curX:0;
        payload.imgTranslateY=dragging._curY!==undefined?dragging._curY:0;
        payload.imgElemIdx=dragging.elemIdx;
        payload.mode='imgpan';
      }
      else if(dragging.mode==='photopan'){
        // fmteam v2: save pan as bgTranslateX/Y — rebuildSlideOuterHtml already reads dragOffsetX/Y
        payload.bgTranslateX=dragging._curX!==undefined?dragging._curX:0;
        payload.bgTranslateY=dragging._curY!==undefined?dragging._curY:0;
        payload.mode='photopan';
      }
      else{payload.transform=dragging.el.style.transform;}
      window.parent.postMessage(payload,'*');
    }
    dragging=null;
  }

  var TEXT_EDIT_SELS=[
    '.title','.subtitle','.subtitle-accent','.narrative-text','.content-title','.content-body','.cta-title','.cover-title','.custom-text','.follow-pill','.footer-name-pill',
    // fmteam v2
    '.capa-headline','.capa-sub','.capa-context','.dark-h1','.light-h1','.dark-body','.light-body',
    '.tag','.cta-bridge','.cta-kbox-label','.cta-kbox-keyword','.cta-kbox-benefit','.cta-kbox-sub',
    '.stat-num','.stat-title','.stat-desc','.arrow-text','.grad-num',
    '.badge-name','.badge-handle','.cta-badge-name','.cta-badge-handle'
  ];
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

function InteractiveSlidePreview({ slideHtml, head, onElementMoved, onTextEdited, selectedIndex, globalFont }: {
  slideHtml: string;
  head: string;
  onElementMoved: (data: { selector: string; elemIdx?: number; mode: string; left?: string; top?: string; transform?: string; ctIdx?: string | null; width?: string; height?: string; bgPosition?: string }) => void;
  onTextEdited: (selector: string, innerHTML: string) => void;
  selectedIndex: number;
  globalFont?: string;
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
  const fontOverride = globalFont
    ? `<style>*:not(.verified-badge):not(.verified-badge *){font-family:'${globalFont}',sans-serif!important}</style>`
    : '';
  const srcDoc = `<!DOCTYPE html><html><head>${head}${fontOverride}${dragScript}</head><body style="margin:0;padding:0;overflow:hidden;">${slideHtml}</body></html>`;

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

  // Aplica gradiente dourado fmteam ao texto selecionado
  function applyGoldGradient() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const fragment = range.extractContents();
    const span = document.createElement('span');
    span.style.cssText = 'background:linear-gradient(135deg,#FFC300,#FF8C00);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:inherit;';
    span.appendChild(fragment);
    range.insertNode(span);
    sel.removeAllRanges();
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
        {/* Gradiente dourado fmteam */}
        <button type="button" onMouseDown={e => e.preventDefault()}
          onClick={applyGoldGradient}
          className="px-1.5 py-1 rounded text-[11px] font-bold transition-colors bg-secondary hover:bg-border"
          style={{ background: 'linear-gradient(135deg,#FFC300,#FF8C00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
          title="Dourado gradiente (selecione a palavra primeiro)">✦</button>
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
  const [globalFont, setGlobalFont] = useState<string>('');
  const [slides, setSlides] = useState<EditableSlide[]>([]);
  const [editedTexts, setEditedTexts] = useState<Record<number, TextBlock[]>>({});
  const [editedBgUrls, setEditedBgUrls] = useState<Record<number, string>>({});
  const [elementOverrides, setElementOverrides] = useState<Record<number, Record<string, ElementOverride>>>({});
  const [overlayConfigs, setOverlayConfigs] = useState<Record<number, OverlayConfig>>({});
  const [bgImageConfigs, setBgImageConfigs] = useState<Record<number, BgImageConfig>>({});
  const [slideBgColors, setSlideBgColors] = useState<Record<number, string>>({});
  const [followBannerConfigs, setFollowBannerConfigs] = useState<Record<number, FollowBannerConfig>>({});
  const [badgeVisible, setBadgeVisible] = useState<Record<number, boolean>>({});
  const [badgeSizes, setBadgeSizes] = useState<Record<number, number>>({}); // slide idx → ring size px
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

  // ── Re-aplicar CSS fmteam atual (corrige cores e tamanhos sem regerar texto) ──
  const [reapplyLoading, setReapplyLoading] = useState(false);
  // Foto local opcional (vira data URL via FileReader) — usada se config.profilePhotoUrl não chegou
  const [reapplyPhotoDataUrl, setReapplyPhotoDataUrl] = useState<string>('');
  const reapplyPhotoInputRef = useRef<HTMLInputElement>(null);
  // ── Dropdown de downloads ──────────────────────────────────────────────────
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!downloadMenuOpen) return;
    function onOutside(e: MouseEvent) {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(e.target as Node)) {
        setDownloadMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [downloadMenuOpen]);

  function handleReapplyPhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Selecione um arquivo de imagem');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setReapplyPhotoDataUrl(String(reader.result || ''));
      toast.success('Foto carregada — clique em Atualizar template');
    };
    reader.onerror = () => toast.error('Erro ao ler imagem');
    reader.readAsDataURL(file);
    if (reapplyPhotoInputRef.current) reapplyPhotoInputRef.current.value = '';
  }

  async function reapplyFmteamTemplate() {
    setReapplyLoading(true);
    try {
      const fullHtml = rebuildHtml();
      // Prioridade: foto local subida no editor → config.profilePhotoUrl
      const photo = reapplyPhotoDataUrl || (config as any)?.profilePhotoUrl || '';
      const res = await fetch(`${API}/api/carousel/re-apply-fmteam-css`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: fullHtml,
          profilePhotoUrl: photo,
          creatorName: (config as any)?.creatorName || '',
          instagramHandle: (config as any)?.instagramHandle || '',
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const parsed = parseSlides(data.html);
      setHead(parsed.head);
      setSlides(prev => prev.map((s, i) => {
        const updated = parsed.slides[i];
        if (!updated) return s;
        return { ...s, outerHtml: updated.outerHtml, html: updated.html, texts: updated.texts };
      }));
      const stats = data.stats || {};
      const avatarReplaced = (stats.avatar || 0) + (stats.ctaAvatar || 0);
      if (photo && avatarReplaced === 0) {
        toast.warning('Template atualizado, mas nenhuma badge de avatar foi encontrada no HTML');
      } else if (photo) {
        toast.success(`Template atualizado — ${avatarReplaced} avatar(es) trocado(s)`);
      } else {
        toast.success('Template atualizado (sem foto fornecida)');
      }
    } catch (err: unknown) {
      toast.error('Erro ao atualizar template: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setReapplyLoading(false);
    }
  }

  // ── Blocos e seções colapsáveis ───────────────────────────────────────────────
  const [collapsedBlocks, setCollapsedBlocks] = useState<Record<string, boolean>>({});
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    texts: true, image: true, banner: true, gradient: true, crop: true,
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
    const isFmteamShadowUp = sel.outerHtml.includes('overlay-shadow-up');
    const isFmteamCapa     = sel.outerHtml.includes('overlay-capa');
    const hasOverlay =
      sel.outerHtml.includes('class="overlay"') ||
      sel.outerHtml.includes('class="slide-overlay"') ||
      isFmteamCapa || isFmteamShadowUp;
    if (!hasOverlay) return;
    // Padrão fmteam: cor escura da identidade (15,13,8 ≈ #0F0D08)
    // overlay-shadow-up → sombra sobe de baixo; overlay-capa → escurece de cima pra baixo
    const defaultConfig = isFmteamShadowUp
      ? { opacity: 0.99, direction: 'to top'    as const, color: '15,13,8', startAt: 0 }
      : isFmteamCapa
        ? { opacity: 0.96, direction: 'to bottom' as const, color: '15,13,8', startAt: 38 }
        : { opacity: 0.96, direction: 'to bottom' as const, color: '0,0,0',   startAt: 40 };
    setOverlayConfigs(prev => ({ ...prev, [selectedIndex]: defaultConfig }));
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
      // fmteam v2
      'capa-headline': 'Headline da capa',
      'capa-sub': 'Subtítulo da capa',
      'capa-context': 'Linha 3 da capa (parênteses)',
      'dark-h1': 'Título (dark)',
      'light-h1': 'Título (light)',
      'dark-body': 'Corpo (dark)',
      'light-body': 'Corpo (light)',
      'cta-bridge': 'Texto ponte CTA',
      'cta-kbox-label': 'Label do box CTA',
      'cta-kbox-keyword': 'Palavra-chave CTA',
      'cta-kbox-benefit': 'Benefício CTA',
      'cta-kbox-sub': 'Sublinha CTA',
      'stat-num': 'Número do dado',
      'stat-title': 'Título do dado',
      'stat-desc': 'Descrição do dado',
      'arrow-text': 'Texto de ponto',
      'grad-num': 'Número decorativo',
      'badge-name': 'Nome do perfil',
      'badge-handle': '@Handle',
      'cta-badge-name': 'Nome (badge CTA)',
      'cta-badge-handle': '@Handle (badge CTA)',
    };
    return map[cn] ?? `.${cn}`;
  }

  // ── Unsplash inline search ────────────────────────────────────────────────────
  const [imgSearch, setImgSearch] = useState('');
  const [imgSearchResults, setImgSearchResults] = useState<{id:string;url:string;thumb:string;alt:string}[]>([]);
  const [imgSearchLoading, setImgSearchLoading] = useState(false);
  const [imgSearchPage, setImgSearchPage] = useState(1);
  const [imgTarget, setImgTarget] = useState<'bg' | number>('bg');
  // Posição local dos sliders para img.split-img (objeto = {x,y} em px offset de 50%)
  const [inlineImgPos, setInlineImgPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Sincroniza inlineImgPos ao trocar a imagem alvo (lê object-position do outerHtml)
  useEffect(() => {
    if (typeof imgTarget === 'number' && selectedIndex !== null) {
      setInlineImgPos(getInlineImgOffset(selectedIndex, imgTarget));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgTarget, selectedIndex]);

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
    const count = slides.length;
    setSlides(prev => {
      const next = [...prev]; const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next.map((s, i) => ({ ...s, index: i }));
    });
    function reorder<T>(prev: Record<number, T>): Record<number, T> {
      const arr: (T | undefined)[] = [];
      for (let i = 0; i < count; i++) arr.push(prev[i]);
      const [m] = arr.splice(from, 1); arr.splice(to, 0, m);
      const result: Record<number, T> = {};
      arr.forEach((v, i) => { if (v !== undefined) result[i] = v; });
      return result;
    }
    setEditedTexts(reorder);
    setEditedBgUrls(reorder);
    setElementOverrides(reorder);
    setOverlayConfigs(reorder);
    setBgImageConfigs(reorder);
    setBadgeVisible(reorder);
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
        // Usa o array completo (sem filtro) para garantir que imgIdx coincide com
        // o índice original do querySelector — o seletor de botões usa (img, i) no
        // array completo e guarda esse i como idx, então precisamos do array completo aqui também.
        const imgs = Array.from(el.querySelectorAll('img'));
        if (imgs[imgIdx]) imgs[imgIdx].setAttribute('src', url);
        return { ...s, outerHtml: el.outerHTML };
      }));
    }
    toast.success('Imagem aplicada');
  }

  // ── Posição de img.split-img via object-position ──────────────────────────────

  /** Lê o offset calc(50% ± Npx) atual de uma img dentro de .split-panel no outerHtml */
  function getInlineImgOffset(slideIdx: number, imgIdx: number): { x: number; y: number } {
    const slide = slides[slideIdx];
    if (!slide) return { x: 0, y: 0 };
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<body>${slide.outerHtml}</body>`, 'text/html');
    const el = doc.body.firstElementChild;
    if (!el) return { x: 0, y: 0 };
    // Use .split-panel img to find split images regardless of whether split-img class is present
    const imgs = Array.from(el.querySelectorAll('.split-panel img')) as HTMLElement[];
    const img = imgs[imgIdx];
    if (!img) return { x: 0, y: 0 };
    const style = img.getAttribute('style') || '';
    const m = /object-position\s*:\s*calc\(50%\s*([+-])\s*([\d.]+)px\)\s+calc\(50%\s*([+-])\s*([\d.]+)px\)/i.exec(style);
    if (m) return { x: (m[1] === '-' ? -1 : 1) * parseFloat(m[2]), y: (m[3] === '-' ? -1 : 1) * parseFloat(m[4]) };
    return { x: 0, y: 0 };
  }

  /** Aplica object-position: calc(50% ± Xpx) calc(50% ± Ypx) a img dentro de .split-panel */
  function applyInlineImgObjectPos(slideIdx: number, imgIdx: number, dx: number, dy: number) {
    setSlides(prev => prev.map((s, i) => {
      if (i !== slideIdx) return s;
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<body>${s.outerHtml}</body>`, 'text/html');
      const el = doc.body.firstElementChild!;
      // Match by .split-panel img so it works even when split-img class is absent
      const imgs = Array.from(el.querySelectorAll('.split-panel img')) as HTMLElement[];
      const img = imgs[imgIdx];
      if (img) {
        // Remove existing object-position (and object-fit to re-add it cleanly)
        let style = (img.getAttribute('style') || '')
          .replace(/object-position\s*:[^;]+;?/gi, '')
          .replace(/object-fit\s*:[^;]+;?/gi, '')
          .trim().replace(/;$/, '');
        const opx = dx >= 0 ? `calc(50% + ${dx.toFixed(1)}px)` : `calc(50% - ${(-dx).toFixed(1)}px)`;
        const opy = dy >= 0 ? `calc(50% + ${dy.toFixed(1)}px)` : `calc(50% - ${(-dy).toFixed(1)}px)`;
        // Always write object-fit:cover inline so panning works even without CSS class
        img.setAttribute('style', `${style}${style ? '; ' : ''}object-fit: cover; object-position: ${opx} ${opy};`);
      }
      return { ...s, outerHtml: el.outerHTML };
    }));
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
    const count = slides.length;
    setSlides(prev => {
      const next = prev.filter((_, i) => i !== idx);
      return next.map((s, i) => ({ ...s, index: i }));
    });
    // Helper to re-index a Record<number, T> after removing idx
    function reindex<T>(prev: Record<number, T>): Record<number, T> {
      const arr: T[] = [];
      for (let i = 0; i < count; i++) if (prev[i] !== undefined) arr.push(prev[i]);
      else arr.push(undefined as T);
      arr.splice(idx, 1);
      const result: Record<number, T> = {};
      arr.forEach((v, i) => { if (v !== undefined) result[i] = v; });
      return result;
    }
    setEditedTexts(reindex);
    setEditedBgUrls(reindex);
    setElementOverrides(reindex);
    setOverlayConfigs(reindex);
    setBgImageConfigs(reindex);
    setBadgeVisible(reindex);
    setSelectedIndex(prev => {
      if (prev === null) return null;
      if (prev >= count - 1) return Math.max(0, count - 2);
      if (prev > idx) return prev - 1;
      return prev;
    });
  }

  // ── Edição de texto ──────────────────────────────────────────────────────────

  /**
   * Constrói um array de TextBlocks para o slide `si` mesclando:
   * - editedTexts[si] (edições do usuário, índices que existem)
   * - slides[si].texts (originais) para preencher lacunas / índices novos
   *
   * Isso garante que `b[bi]` NUNCA seja undefined, mesmo quando:
   * - O slide foi regenerado e ganhou mais blocos de texto
   * - editedTexts[si] ainda não existia
   * Sem isso, `{ ...undefined, prop }` cria TextBlocks sem className, quebrando
   * todo o código que chama `.split()` na className.
   */
  function mergeTexts(prev: Record<number, TextBlock[]>, si: number): TextBlock[] {
    const orig = slides[si]?.texts ?? [];
    const edited = prev[si];
    if (!edited) return [...orig];
    // Para cada índice original, use a versão editada se existir; caso contrário o original.
    // Isso também preserva eventuais blocos adicionados pelo usuário (custom-text) além do range original.
    const merged = orig.map((o, i) => edited[i] ?? o);
    // Mantém blocos extras adicionados pelo usuário que não existem no original
    if (edited.length > orig.length) merged.push(...edited.slice(orig.length));
    return merged;
  }

  function updateText(si: number, bi: number, val: string) {
    setEditedTexts(prev => {
      const b = mergeTexts(prev, si);
      if (!b[bi]) return prev;
      b[bi] = { ...b[bi], text: val };
      return { ...prev, [si]: b };
    });
  }

  function updateRichHtml(si: number, bi: number, html: string) {
    setEditedTexts(prev => {
      const b = mergeTexts(prev, si);
      if (!b[bi]) return prev;
      b[bi] = { ...b[bi], richHtml: html };
      return { ...prev, [si]: b };
    });
  }

  function updateTextAlign(si: number, bi: number, align: TextBlock['textAlign']) {
    setEditedTexts(prev => {
      const b = mergeTexts(prev, si);
      if (!b[bi]) return prev;
      b[bi] = { ...b[bi], textAlign: align };
      return { ...prev, [si]: b };
    });
  }

  function toggleTextTransform(si: number, bi: number) {
    setEditedTexts(prev => {
      const b = mergeTexts(prev, si);
      if (!b[bi]) return prev;
      const current = b[bi].textTransform;
      // Cycle: undefined (original) → none → uppercase → none
      b[bi] = { ...b[bi], textTransform: current === 'none' ? 'uppercase' : 'none' };
      return { ...prev, [si]: b };
    });
  }

  function updateFontSize(si: number, bi: number, delta: number) {
    setEditedTexts(prev => {
      const b = mergeTexts(prev, si);
      if (!b[bi]) return prev;
      const curr = b[bi]?.fontSize ?? (b[bi]?.isMain ? 48 : 28);
      b[bi] = { ...b[bi], fontSize: Math.max(8, Math.min(200, curr + delta)) };
      return { ...prev, [si]: b };
    });
  }

  function updateTextColor(si: number, bi: number, color: string) {
    setEditedTexts(prev => {
      const b = mergeTexts(prev, si);
      if (!b[bi]) return prev;
      b[bi] = { ...b[bi], color };
      return { ...prev, [si]: b };
    });
  }

  function updateFontFamily(si: number, bi: number, fontFamily: string) {
    setEditedTexts(prev => {
      const b = mergeTexts(prev, si);
      if (!b[bi]) return prev;
      b[bi] = { ...b[bi], fontFamily: fontFamily || undefined };
      return { ...prev, [si]: b };
    });
  }

  function updateFontWeight(si: number, bi: number, fontWeight: number | undefined) {
    setEditedTexts(prev => {
      const b = mergeTexts(prev, si);
      if (!b[bi]) return prev;
      b[bi] = { ...b[bi], fontWeight };
      return { ...prev, [si]: b };
    });
  }

  function addWordHighlight(si: number, bi: number, word: string, color: string) {
    setEditedTexts(prev => {
      const b = mergeTexts(prev, si);
      if (!b[bi]) return prev;
      b[bi] = { ...b[bi], highlights: [...(b[bi].highlights ?? []), { word, color }] };
      return { ...prev, [si]: b };
    });
  }

  function removeWordHighlight(si: number, bi: number, hi: number) {
    setEditedTexts(prev => {
      const b = mergeTexts(prev, si);
      if (!b[bi]) return prev;
      b[bi] = { ...b[bi], highlights: (b[bi].highlights ?? []).filter((_, i) => i !== hi) };
      return { ...prev, [si]: b };
    });
  }

  function updateWordHighlightColor(si: number, bi: number, hi: number, color: string) {
    setEditedTexts(prev => {
      const b = mergeTexts(prev, si);
      if (!b[bi]) return prev;
      const hls = [...(b[bi].highlights ?? [])];
      hls[hi] = { ...hls[hi], color };
      b[bi] = { ...b[bi], highlights: hls };
      return { ...prev, [si]: b };
    });
  }

  function updateWordHighlightWord(si: number, bi: number, hi: number, word: string) {
    setEditedTexts(prev => {
      const b = mergeTexts(prev, si);
      if (!b[bi]) return prev;
      const hls = [...(b[bi].highlights ?? [])];
      hls[hi] = { ...hls[hi], word };
      b[bi] = { ...b[bi], highlights: hls };
      return { ...prev, [si]: b };
    });
  }

  function updateBadgeSize(si: number, size: number) {
    setBadgeSizes(prev => ({ ...prev, [si]: size }));
    setSlides(prev => prev.map((s, i) => {
      if (i !== si) return s;
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<body>${s.outerHtml}</body>`, 'text/html');
      const el = doc.body.firstElementChild!;
      const ring = el.querySelector('.badge-ring') as HTMLElement;
      const avatar = el.querySelector('.badge-avatar') as HTMLElement;
      if (ring) { ring.style.width = `${size}px`; ring.style.height = `${size}px`; }
      if (avatar) { const av = size - 6; avatar.style.width = `${av}px`; avatar.style.height = `${av}px`; }
      return { ...s, outerHtml: el.outerHTML, html: el.innerHTML };
    }));
  }

  function addTextBlock(si: number) {
    setEditedTexts(prev => {
      const b = mergeTexts(prev, si);
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

  function addImageBlock(si: number) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const dataUrl = ev.target?.result as string;
        setSlides(prev => prev.map((s, i) => {
          if (i !== si) return s;
          const parser = new DOMParser();
          const doc = parser.parseFromString(`<body>${s.outerHtml}</body>`, 'text/html');
          const el = doc.body.firstElementChild!;
          const img = doc.createElement('img');
          img.setAttribute('src', dataUrl);
          img.setAttribute('style', 'position:absolute; z-index:5; top:200px; left:100px; width:400px; height:auto; border-radius:16px; object-fit:cover;');
          img.className = 'photo-card';
          el.appendChild(img);
          return { ...s, outerHtml: el.outerHTML, html: el.innerHTML };
        }));
        toast.success('Imagem adicionada — arraste no modo Visual para posicionar');
      };
      reader.readAsDataURL(file);
    };
    fileInput.click();
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
      const b = [...(prev[si] ?? slides[si]?.texts ?? [])];
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

  const handleElementMoved = useCallback((data: { selector: string; elemIdx?: number; mode: string; left?: string; top?: string; transform?: string; ctIdx?: string | null; width?: string; height?: string; bgPosition?: string; bgTranslateX?: number; bgTranslateY?: number; imgTranslateX?: number; imgTranslateY?: number; imgElemIdx?: number }) => {
    if (selectedIndex === null) return;

    // Background pan: salva translate offset do drag
    if (data.mode === 'bgpan') {
      const dx = data.bgTranslateX ?? 0;
      const dy = data.bgTranslateY ?? 0;
      setBgImageConfigs(prev => {
        const cur = prev[selectedIndex] ?? { position: '50% 50%', brightness: 100 };
        return { ...prev, [selectedIndex]: { ...cur, dragOffsetX: dx, dragOffsetY: dy } };
      });
      return;
    }

    // Inline img.split-img pan: salva object-position no outerHtml
    if (data.mode === 'imgpan') {
      const dx = data.imgTranslateX ?? 0;
      const dy = data.imgTranslateY ?? 0;
      const idx = data.imgElemIdx ?? 0;
      applyInlineImgObjectPos(selectedIndex, idx, dx, dy);
      setInlineImgPos({ x: dx, y: dy });
      return;
    }

    // fmteam v2 photo pan: .photo-bg / .img-box-top — salva como dragOffsetX/Y em bgImageConfigs
    // rebuildSlideOuterHtml já lê dragOffsetX/Y e aplica como object-position no <img>
    if (data.mode === 'photopan') {
      const dx = data.bgTranslateX ?? 0;
      const dy = data.bgTranslateY ?? 0;
      setBgImageConfigs(prev => {
        const cur = prev[selectedIndex] ?? { position: '50% 50%', brightness: 100 };
        return { ...prev, [selectedIndex]: { ...cur, dragOffsetX: dx, dragOffsetY: dy } };
      });
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
      globalFont || undefined,
      slideBgColors[s.index],
    ));
    const fontOverrideCss = globalFont
      ? `<style>*:not(.verified-badge):not(.verified-badge *){font-family:'${globalFont}',sans-serif!important}</style>`
      : '';
    return `<!DOCTYPE html><html><head>${head}${fontOverrideCss}</head><body>\n${built.join('\n')}\n</body></html>`;
  }, [slides, head, editedTexts, editedBgUrls, elementOverrides, overlayConfigs, badgeVisible, bgImageConfigs, followBannerConfigs, globalFont, slideBgColors]);

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
      globalFont || undefined,
      slideBgColors[idx],
    );
  }

  // ── JPEG download ─────────────────────────────────────────────────────────────

  async function handleDownloadJpegs() {
    toast.info('Gerando screenshots antes de baixar…');
    setScreenshotLoading(true);
    try {
      const modifiedHtml = rebuildHtml();
      // Salva HTML atualizado no servidor (endpoint não gera screenshots mais)
      await fetch(`${API}/api/carousel/screenshots`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: modifiedHtml, folderName }),
      });
      // Gera screenshots no cliente e faz upload slide-a-slide
      const screenshots = await generateAndSaveScreenshots(API, modifiedHtml, folderName);
      onScreenshotsUpdated(screenshots);
      for (let i = 0; i < screenshots.length; i++) {
        const url = `${API}/output/${folderName}/${screenshots[i]}`;
        await downloadAsJpeg(url, `slide_${String(i + 1).padStart(2, '0')}.jpg`);
        await new Promise(r => setTimeout(r, 150));
      }
      toast.success(`${screenshots.length} JPEGs baixados!`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setScreenshotLoading(false);
    }
  }

  // ── PNG download (exatamente como está no editor) ───────────────────────────

  /**
   * Baixa um arquivo do servidor usando blob URL + <a download>.
   * Funciona em mobile e desktop sem cair no popup blocker.
   */
  async function downloadFileFromServer(filename: string) {
    const url = `${API}/output/${folderName}/${filename}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Falha ao baixar ${filename} (HTTP ${res.status})`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }

  // ── Extrair e baixar SÓ as fotos do Pexels/externas dos slides ──────────────
  // Pra usar como B-roll em reels (sem o overlay do slide).
  function extractPhotoUrlsFromSlides(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of slides) {
      const html = s.outerHtml || '';
      // <img src="https://...">
      for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
        const u = m[1];
        if (!u.startsWith('http')) continue; // pula data: e relativos
        if (seen.has(u)) continue;
        seen.add(u); out.push(u);
      }
      // background-image: url(https://...)
      for (const m of html.matchAll(/background-image\s*:\s*url\(\s*['"]?(https?:\/\/[^'")\s]+)/gi)) {
        const u = m[1];
        if (seen.has(u)) continue;
        seen.add(u); out.push(u);
      }
    }
    return out;
  }

  function pexelsFilenameFor(url: string, index: number): string {
    // Tenta extrair o ID numérico da URL Pexels (https://images.pexels.com/photos/12345/...)
    const m = url.match(/\/photos\/(\d+)\//);
    const num = String(index + 1).padStart(2, '0');
    if (m) return `foto_${num}_pexels_${m[1]}.jpg`;
    // Não-Pexels: usa o último segmento do path como base
    try {
      const u = new URL(url);
      const last = (u.pathname.split('/').pop() || 'foto').split('?')[0];
      const ext = last.includes('.') ? '' : '.jpg';
      return `foto_${num}_${last}${ext}`;
    } catch {
      return `foto_${num}.jpg`;
    }
  }

  async function handleDownloadPexelsPhotos() {
    const urls = extractPhotoUrlsFromSlides();
    if (urls.length === 0) {
      toast.info('Nenhuma foto externa encontrada nos slides');
      return;
    }
    toast.info(`Baixando ${urls.length} foto(s)…`);
    setScreenshotLoading(true);
    let ok = 0;
    try {
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const filename = pexelsFilenameFor(url, i);
        try {
          // Usa o proxy do servidor pra contornar CORS do Pexels
          const proxied = `${API}/api/carousel/proxy-image?url=${encodeURIComponent(url)}`;
          const res = await fetch(proxied);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
          ok++;
          await new Promise(r => setTimeout(r, 300));
        } catch (e: any) {
          console.warn('[DownloadPexels] falha em', url, e);
        }
      }
      toast.success(`${ok}/${urls.length} fotos baixadas`);
    } finally {
      setScreenshotLoading(false);
    }
  }

  /** Gera screenshots de todos os slides (a partir do estado atual do editor).
   *  Usa a versão HiFi: renderiza cada slide em iframe isolado 1080×1350,
   *  sem contaminação de CSS da app (Tailwind). Dispensa os hacks de
   *  word-spacing, scale→width, calc→percentual do fluxo legado, porque
   *  o iframe usa render nativo do browser. */
  async function regenerateAllToDisk(): Promise<string[]> {
    const modifiedHtml = rebuildHtml();
    await fetch(`${API}/api/carousel/screenshots`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: modifiedHtml, folderName }),
    });
    const screenshots = await generateAndSaveScreenshotsHiFi(API, modifiedHtml, folderName);
    if (!screenshots.length) {
      throw new Error('Nenhum screenshot foi gerado — verifique o console para erros do html2canvas');
    }
    onScreenshotsUpdated(screenshots);
    return screenshots;
  }

  async function handleDownloadPngs() {
    toast.info('Gerando PNGs com o que está no editor…');
    setScreenshotLoading(true);
    try {
      const screenshots = await regenerateAllToDisk();
      toast.info(`${screenshots.length} PNGs gerados. Iniciando downloads…`);
      for (const filename of screenshots) {
        await downloadFileFromServer(filename);
        await new Promise(r => setTimeout(r, 300));
      }
      toast.success(`${screenshots.length} PNGs baixados!`);
    } catch (err: any) {
      console.error('[DownloadPngs]', err);
      toast.error(`Falha: ${err.message || err}`);
    } finally {
      setScreenshotLoading(false);
    }
  }

  // Versão alta-fidelidade: server-side via Playwright. Pixel-perfect, lida com
  // Pexels/gradient text/filter:brightness/calc() nativamente.
  async function handleDownloadPngsHD() {
    toast.info('Gerando PNGs HD via navegador real… (pode levar alguns segundos)');
    setScreenshotLoading(true);
    try {
      const html = rebuildHtml();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 90_000); // 90s hard cap
      const res = await fetch(`${API}/api/carousel/screenshots-pp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html, folderName }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      const screenshots: string[] = data.screenshots || [];
      if (!screenshots.length) throw new Error('Nenhum screenshot gerado');
      const ms = data.ms ? ` em ${Math.round(data.ms/1000)}s` : '';
      onScreenshotsUpdated(screenshots);
      toast.info(`${screenshots.length} PNGs HD prontos${ms}. Baixando…`);
      for (const filename of screenshots) {
        await downloadFileFromServer(filename);
        await new Promise(r => setTimeout(r, 300));
      }
      toast.success(`${screenshots.length} PNGs HD baixados!`);
    } catch (err: any) {
      console.error('[DownloadPngsHD]', err);
      toast.error(`Falha HD: ${err.message || err}`);
    } finally {
      setScreenshotLoading(false);
    }
  }

  async function handleDownloadCurrentPng() {
    if (selectedIndex === null) {
      toast.error('Selecione um slide primeiro');
      return;
    }
    toast.info(`Gerando PNG do slide ${selectedIndex + 1}…`);
    setScreenshotLoading(true);
    try {
      const screenshots = await regenerateAllToDisk();
      const filename = screenshots[selectedIndex];
      if (!filename) throw new Error(`PNG do slide ${selectedIndex + 1} não encontrado na lista gerada`);
      await downloadFileFromServer(filename);
      toast.success(`Slide ${selectedIndex + 1} baixado!`);
    } catch (err: any) {
      console.error('[DownloadCurrentPng]', err);
      toast.error(`Falha: ${err.message || err}`);
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
      const modifiedHtml = rebuildHtml();
      await fetch(`${API}/api/carousel/screenshots`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: modifiedHtml, folderName }),
      });
      const screenshots = await generateAndSaveScreenshots(API, modifiedHtml, folderName);
      onScreenshotsUpdated(screenshots);
      toast.success(`${screenshots.length} screenshots atualizados!`);
    } catch (err: any) { toast.error(err.message); }
    finally { setScreenshotLoading(false); }
  }

  // ── Salvar como modelo ────────────────────────────────────────────────────────

  async function handleSaveTemplate() {
    const name = templateName.trim() || topic;
    setTemplateLoading(true);
    try {
      const modifiedHtml = rebuildHtml();
      const res = await fetch(`${API}/api/carousel/save-template`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: modifiedHtml, name,
          numSlides: numSlides ?? slides.length,
          legenda: legenda ?? '', config: config ?? {},
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro');
      toast.success(`Modelo "${name}" salvo! Gerando capa…`);

      try {
        const screenshots = await generateAndSaveScreenshots(API, modifiedHtml, data.folderName);
        await fetch(`${API}/api/carousel/saved/${data.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ screenshots }),
        });
        toast.success('Capa do modelo gerada!');
      } catch (e: any) {
        console.error('[SaveTemplate/Screenshots]', e);
        toast.error(`Modelo salvo, capa falhou: ${e.message || e}`);
      }
      onTemplateSaved?.();
    } catch (err: any) { toast.error(err.message); }
    finally { setTemplateLoading(false); }
  }

  // ── Salvar edições ────────────────────────────────────────────────────────────
  // Estratégia: salva o HTML imediatamente (< 200 ms) e libera o botão.
  // Screenshots são regenerados em segundo plano para não bloquear o fluxo.

  const [saveLoading, setSaveLoading] = useState(false);
  const [thumbLoading, setThumbLoading] = useState(false);

  async function handleSaveEdits() {
    setSaveLoading(true);
    try {
      const modifiedHtml = rebuildHtml();

      // 1. Persiste HTML no servidor (rápido — apenas escrita de arquivo)
      const res = await fetch(`${API}/api/carousel/save-html`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: modifiedHtml, folderName }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erro ao salvar HTML');
      }

      toast.success('Salvo! Atualizando miniaturas…');

      // 2. Screenshots em segundo plano — não bloqueia o botão
      setThumbLoading(true);
      generateAndSaveScreenshots(API, modifiedHtml, folderName)
        .then(screenshots => {
          if (screenshots.length) onScreenshotsUpdated(screenshots);
          toast.success('Miniaturas atualizadas!');
        })
        .catch(err => {
          console.warn('[SaveEdits/thumbs]', err);
          // falha nas miniaturas não é crítica — o HTML já foi salvo
          toast.info('Edições salvas. Miniaturas não puderam ser atualizadas.');
        })
        .finally(() => setThumbLoading(false));

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
      <div className="px-3 sm:px-4 py-2.5 border-b border-border">
        {/* Linha 1: Título + Undo/Redo + Salvar */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Edit3 className="w-4 h-4 text-purple-500 shrink-0" />
            <span className="text-sm font-bold truncate">{slides.length} slides</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => { if(canUndo){const e=new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true});window.dispatchEvent(e);}}} disabled={!canUndo}
              title="Desfazer" className="p-1.5 rounded-lg bg-secondary hover:bg-border disabled:opacity-30 transition-colors">
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => { if(canRedo){const e=new KeyboardEvent('keydown',{key:'y',ctrlKey:true,bubbles:true});window.dispatchEvent(e);}}} disabled={!canRedo}
              title="Refazer" className="p-1.5 rounded-lg bg-secondary hover:bg-border disabled:opacity-30 transition-colors">
              <Redo2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={handleSaveEdits} disabled={saveLoading}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-semibold transition-colors">
              {saveLoading
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : thumbLoading
                  ? <Loader2 className="w-3 h-3 animate-spin opacity-60" />
                  : <Save className="w-3 h-3" />}
              {thumbLoading && !saveLoading ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
        {/* Linha 2: Fonte global */}
        <div className="flex items-center gap-1.5 mt-2">
          <select
            value={globalFont}
            onChange={e => setGlobalFont(e.target.value)}
            className="rounded-lg border border-border bg-background px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-purple-500/50 flex-1 min-w-0"
            style={globalFont ? { fontFamily: `'${globalFont}', sans-serif` } : {}}
          >
            <option value="">Fonte original</option>
            {FONT_OPTIONS.map(f => (
              <option key={f} value={f} style={{ fontFamily: `'${f}', sans-serif` }}>{f}</option>
            ))}
          </select>
          {globalFont && (
            <button onClick={() => setGlobalFont('')} className="text-muted-foreground hover:text-foreground transition-colors shrink-0" title="Restaurar fonte">
              <X className="w-3 h-3" />
            </button>
          )}
          {/* Ações secundárias */}
          <div className="flex items-center gap-1 shrink-0">
            <input
              ref={reapplyPhotoInputRef}
              type="file"
              accept="image/*"
              onChange={handleReapplyPhotoSelect}
              style={{ display: 'none' }}
            />
            <button
              onClick={() => reapplyPhotoInputRef.current?.click()}
              title={reapplyPhotoDataUrl ? 'Foto carregada — clique para trocar' : 'Subir foto para usar nas badges (capa + CTA)'}
              className={`p-1.5 rounded-lg transition-colors ${
                reapplyPhotoDataUrl
                  ? 'bg-green-600 hover:bg-green-500 text-white'
                  : 'bg-secondary hover:bg-border text-foreground'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={reapplyFmteamTemplate}
              disabled={reapplyLoading}
              title="Atualizar template fmteam (cores, tamanhos, nome, foto) sem mexer nos textos"
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-black transition-colors"
            >
              {reapplyLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Atualizar
            </button>
            <button
              onClick={handleRegenerateScreenshots}
              disabled={screenshotLoading}
              title="Regerar miniaturas"
              className="p-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white transition-colors">
              {screenshotLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </button>
            {/* ── Dropdown de downloads ── */}
            <div ref={downloadMenuRef} className="relative">
              <button
                onClick={() => setDownloadMenuOpen(v => !v)}
                disabled={screenshotLoading}
                title="Baixar"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-[11px] font-semibold transition-colors">
                <Download className="w-3 h-3" /> Baixar
                <ChevronDown className={`w-3 h-3 transition-transform ${downloadMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              <AnimatePresence>
                {downloadMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute right-0 mt-1 w-56 z-50 rounded-xl border border-border bg-card shadow-xl overflow-hidden"
                  >
                    <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Imagens</div>
                    <button
                      onClick={() => { setDownloadMenuOpen(false); handleDownloadPngsHD(); }}
                      disabled={screenshotLoading}
                      title="PNGs HD (pixel-perfect via navegador real — idêntico ao preview, mais lento)"
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-violet-500/10 transition-colors disabled:opacity-50">
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" />
                      <span className="flex-1">PNGs HD <span className="text-muted-foreground">(pixel-perfect)</span></span>
                    </button>
                    <button
                      onClick={() => { setDownloadMenuOpen(false); handleDownloadPngs(); }}
                      disabled={screenshotLoading}
                      title="PNGs rápidos (html2canvas — instantâneo)"
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-emerald-500/10 transition-colors disabled:opacity-50">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span className="flex-1">PNGs rápidos <span className="text-muted-foreground">(html2canvas)</span></span>
                    </button>
                    <button
                      onClick={() => { setDownloadMenuOpen(false); handleDownloadCurrentPng(); }}
                      disabled={screenshotLoading || selectedIndex === null}
                      title="PNG só do slide atual"
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-emerald-500/10 transition-colors disabled:opacity-50">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0" />
                      <span className="flex-1">PNG do slide atual</span>
                    </button>
                    <button
                      onClick={() => { setDownloadMenuOpen(false); handleDownloadJpegs(); }}
                      disabled={screenshotLoading}
                      title="JPEGs (menor tamanho)"
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-orange-500/10 transition-colors disabled:opacity-50">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
                      <span className="flex-1">JPEGs <span className="text-muted-foreground">(menor)</span></span>
                    </button>
                    <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold border-t border-border mt-1">Outros</div>
                    <button
                      onClick={() => { setDownloadMenuOpen(false); handleDownloadPexelsPhotos(); }}
                      disabled={screenshotLoading}
                      title="Só as fotos do Pexels — pra usar como B-roll em reels"
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-cyan-500/10 transition-colors disabled:opacity-50">
                      <Image className="w-3 h-3 text-cyan-500 shrink-0" />
                      <span className="flex-1">Fotos do Pexels <span className="text-muted-foreground">(B-roll)</span></span>
                    </button>
                    <button
                      onClick={() => { setDownloadMenuOpen(false); handleDownloadHtml(); }}
                      title="Baixar HTML do carrossel"
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-secondary transition-colors">
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground shrink-0" />
                      <span className="flex-1">Arquivo HTML</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
        {/* Linha 3: Salvar modelo */}
        <div className="flex items-center gap-1.5 mt-1.5">
          <input type="text" value={templateName} onChange={e => setTemplateName(e.target.value)}
            placeholder="Nome do modelo…"
            className="rounded-lg border border-border bg-background px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-purple-500/50 flex-1 min-w-0" />
          <button onClick={handleSaveTemplate} disabled={templateLoading}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-[11px] font-semibold transition-colors shrink-0">
            {templateLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <BookmarkPlus className="w-3 h-3" />}
            Modelo
          </button>
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
                    <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 space-y-3">

                      {/* ── Selo Verificado ── */}
                      {sel.outerHtml.includes('profile-name') && (
                        <div className="flex items-center justify-between rounded-lg bg-secondary/30 px-3 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width={14} height={14}>
                              <circle cx="12" cy="12" r="12" fill="#0095f6"/>
                              <path d="M6.5 12.5l3.5 3.5 7.5-8" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            <span className="text-[11px] font-medium text-foreground">Verificado</span>
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
                            className="w-full flex items-center gap-1.5 text-left py-0.5"
                            onClick={() => toggleSection('texts')}
                          >
                            <ChevronDown className={`w-3 h-3 text-muted-foreground shrink-0 transition-transform duration-200 ${collapsedSections['texts'] ? '-rotate-90' : 'rotate-0'}`} />
                            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Textos</span>
                            <span className="ml-auto text-[10px] text-muted-foreground/50">{selTexts.filter(b => !b.deleted).length}</span>
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
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => addTextBlock(selectedIndex)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-purple-500/40 hover:border-purple-500 bg-purple-500/5 hover:bg-purple-500/10 text-purple-400 text-xs font-semibold transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" /> Texto
                        </button>
                        <button
                          onClick={() => addImageBlock(selectedIndex)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-emerald-500/40 hover:border-emerald-500 bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-400 text-xs font-semibold transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" /> Imagem
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

                      {/* Cor de fundo do slide */}
                      {selectedIndex !== null && (
                        <div className="pt-2 border-t border-border">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cor de fundo</span>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={slideBgColors[selectedIndex] || '#1a1a1a'}
                                onChange={e => setSlideBgColors(prev => ({ ...prev, [selectedIndex]: e.target.value }))}
                                className="w-7 h-7 rounded cursor-pointer border border-border"
                              />
                              {slideBgColors[selectedIndex] && (
                                <button
                                  onClick={() => setSlideBgColors(prev => { const n = { ...prev }; delete n[selectedIndex]; return n; })}
                                  className="text-[10px] text-red-400 hover:text-red-300"
                                >Reset</button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ── Badge fmteam (só aparece na capa) ── */}
                      {sel?.outerHtml.includes('capa-badge') && (
                        <div className="pt-2 border-t border-border space-y-1.5">
                          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Badge (círculo do perfil)</p>
                          <div className="flex items-center justify-between">
                            <label className="text-[11px] text-muted-foreground">Tamanho</label>
                            <span className="text-[11px] font-mono text-muted-foreground">{badgeSizes[selectedIndex] ?? 80}px</span>
                          </div>
                          <input
                            type="range" min={48} max={160} step={4}
                            value={badgeSizes[selectedIndex] ?? 80}
                            onChange={e => updateBadgeSize(selectedIndex, Number(e.target.value))}
                            className="w-full accent-purple-500"
                          />
                          <div className="flex justify-between text-[10px] text-muted-foreground/50">
                            <span>Pequeno</span><span>Normal</span><span>Grande</span>
                          </div>
                        </div>
                      )}

                      {/* Imagem de fundo */}
                      <div className="pt-2 border-t border-border">
                        <button
                          type="button"
                          className="w-full flex items-center gap-1.5 py-0.5 text-left"
                          onClick={() => toggleSection('image')}
                        >
                          <ChevronDown className={`w-3 h-3 text-muted-foreground shrink-0 transition-transform duration-200 ${collapsedSections['image'] ? '-rotate-90' : 'rotate-0'}`} />
                          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Imagem</span>
                        </button>
                      {!collapsedSections['image'] && <div className="space-y-2">

                        {/* Selector de alvo (fundo vs img inline) */}
                        {(() => {
                          const parser = new DOMParser();
                          const doc = parser.parseFromString(`<body>${sel?.outerHtml ?? ''}</body>`, 'text/html');
                          const el = doc.body.firstElementChild;
                          const inlineImgs = el ? Array.from(el.querySelectorAll('img'))
                            .map((img, i) => {
                              let label = `Img ${i+1}`;
                              if (img.closest('.photo-card')) label = `Card ${i+1}`;
                              else if (img.closest('.top-photo-wrap')) label = `Topo ${i+1}`;
                              else if (img.closest('.split-panel')) {
                                const panels = Array.from(el.querySelectorAll('.split-panel'));
                                const panelIdx = panels.indexOf(img.closest('.split-panel') as Element);
                                label = panelIdx === 0 ? '📷 Antes' : '📷 Depois';
                              }
                              // fmteam v2: labels específicos por container
                              else if (img.closest('.photo-bg')) label = '📸 Foto principal';
                              else if (img.closest('.img-box-top')) label = '📸 Foto topo';
                              return { idx: i, src: img.getAttribute('src') || '', label, el: img };
                            })
                            .filter(img =>
                              img.src &&
                              !img.src.includes('data:image/svg') &&
                              !img.src.includes('badge') &&
                              // fmteam: exclui avatares de badge (não são fotos de conteúdo)
                              !img.el.closest('.badge-avatar') &&
                              !img.el.closest('.cta-badge-avatar') &&
                              !img.el.closest('.badge-ring') &&
                              !(img.el.closest('.badge-verified'))
                            )
                            .map(({ el: _el, ...rest }) => rest) : [];
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

                        {/* Corte da imagem (clip-path) — inline images e fundo — colapsável */}
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
                            <div className="pt-2 border-t border-border">
                              <button
                                type="button"
                                className="w-full flex items-center gap-1.5 mb-2 text-left"
                                onClick={() => toggleSection('crop')}
                              >
                                <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${collapsedSections['crop'] ? '-rotate-90' : 'rotate-0'}`} />
                                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                                  Corte da imagem {imgTarget === 'bg' ? '(fundo)' : ''}
                                  {hasClip && <span className="ml-1 px-1 py-0.5 rounded bg-purple-500/20 text-purple-400 text-[10px] font-bold">ativo</span>}
                                </span>
                              </button>
                              {!collapsedSections['crop'] && (
                                <div className="space-y-2">
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
                              )}
                            </div>
                          );
                        })()}

                        {/* Posicionamento da imagem */}
                        {selBg && (() => {
                          const bgCfg: BgImageConfig = bgImageConfigs[selectedIndex] ?? { position: 'center center', brightness: 100 };
                          const setBg = (patch: Partial<BgImageConfig>) =>
                            setBgImageConfigs(prev => ({
                              ...prev,
                              [selectedIndex]: { ...bgCfg, ...patch },
                            }));

                          // Max pan em px para os sliders (mapeia 0–100% → -MAX…+MAX px)
                          const MAX_PAN_PX = 400;

                          // Deriva posX/posY a partir dos dragOffsets (se existirem) ou da string position
                          const keywordToNum = (k: string) =>
                            k === 'left' || k === 'top' ? 0 : k === 'right' || k === 'bottom' ? 100 : 50;
                          const parsePosNum = (v: string): number => {
                            if (v.endsWith('%')) return parseInt(v);
                            return keywordToNum(v);
                          };
                          const hasDragOffset = bgCfg.dragOffsetX !== undefined || bgCfg.dragOffsetY !== undefined;
                          const parts = bgCfg.position.trim().split(/\s+/);
                          const posX = hasDragOffset
                            ? Math.round(((bgCfg.dragOffsetX ?? 0) / MAX_PAN_PX) * 50 + 50)
                            : parsePosNum(parts[0] ?? 'center');
                          const posY = hasDragOffset
                            ? Math.round(((bgCfg.dragOffsetY ?? 0) / MAX_PAN_PX) * 50 + 50)
                            : parsePosNum(parts[1] ?? 'center');

                          // Sliders agora usam translate (dragOffset) — funciona para qualquer aspect ratio
                          const setPosXY = (x: number, y: number) => {
                            const dx = ((x - 50) / 50) * MAX_PAN_PX;
                            const dy = ((y - 50) / 50) * MAX_PAN_PX;
                            setBgImageConfigs(prev => ({
                              ...prev,
                              [selectedIndex]: { ...bgCfg, position: `${x}% ${y}%`, dragOffsetX: dx, dragOffsetY: dy },
                            }));
                          };
                          const scaleVal = bgCfg.scale ?? 1.0;
                          const scalePct = Math.round(scaleVal * 100);

                          return (
                            <div className="space-y-2 pt-2 border-t border-border">
                              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Posição da imagem</p>

                              {/* Zoom da imagem */}
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <label className="text-[11px] text-muted-foreground">🔍 Zoom extra</label>
                                  <span className="text-[11px] font-mono text-muted-foreground">{scalePct}%</span>
                                </div>
                                <input type="range" min={100} max={200} step={5} value={scalePct}
                                  onChange={e => setBg({ scale: Number(e.target.value) / 100 })}
                                  className="w-full accent-purple-500"
                                />
                                <div className="flex justify-between text-[10px] text-muted-foreground/50">
                                  <span>Normal</span><span>200%</span>
                                </div>
                              </div>

                              {/* Slider X — horizontal */}
                              <div className="space-y-1">
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
                              <div className="space-y-1">
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

                        {/* Posição de img.split-img (Antes/Depois) */}
                        {typeof imgTarget === 'number' && selectedIndex !== null && (() => {
                          // Verifica se o imgTarget aponta para um img.split-img
                          const parser = new DOMParser();
                          const doc = parser.parseFromString(`<body>${sel?.outerHtml ?? ''}</body>`, 'text/html');
                          const elDoc = doc.body.firstElementChild;
                          const allImgs = elDoc ? Array.from(elDoc.querySelectorAll('img')) : [];
                          const targetImg = allImgs[imgTarget] as HTMLElement | undefined;
                          if (!targetImg || !targetImg.closest('.split-panel')) return null;

                          const splitImgs = elDoc ? Array.from(elDoc.querySelectorAll('.split-panel img')) : [];
                          const splitIdx = splitImgs.indexOf(targetImg as Element);
                          const MAX_PAN = 300;
                          const toSlider = (v: number) => Math.round((v / MAX_PAN) * 50 + 50);
                          const fromSlider = (s: number) => ((s - 50) / 50) * MAX_PAN;

                          return (
                            <div className="space-y-2 pt-2 border-t border-border">
                              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                                Posição — {splitIdx === 0 ? 'Antes' : 'Depois'}
                              </p>

                              {/* Slider X */}
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <label className="text-[11px] text-muted-foreground">← Horizontal →</label>
                                  <span className="text-[11px] font-mono text-muted-foreground">{toSlider(inlineImgPos.x)}%</span>
                                </div>
                                <input type="range" min={0} max={100} value={toSlider(inlineImgPos.x)}
                                  onChange={e => {
                                    const nx = fromSlider(Number(e.target.value));
                                    setInlineImgPos(p => ({ ...p, x: nx }));
                                    applyInlineImgObjectPos(selectedIndex, splitIdx, nx, inlineImgPos.y);
                                  }}
                                  className="w-full accent-purple-500"
                                />
                                <div className="flex justify-between text-[10px] text-muted-foreground/50">
                                  <span>Esquerda</span><span>Centro</span><span>Direita</span>
                                </div>
                              </div>

                              {/* Slider Y */}
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <label className="text-[11px] text-muted-foreground">↑ Vertical ↓</label>
                                  <span className="text-[11px] font-mono text-muted-foreground">{toSlider(inlineImgPos.y)}%</span>
                                </div>
                                <input type="range" min={0} max={100} value={toSlider(inlineImgPos.y)}
                                  onChange={e => {
                                    const ny = fromSlider(Number(e.target.value));
                                    setInlineImgPos(p => ({ ...p, y: ny }));
                                    applyInlineImgObjectPos(selectedIndex, splitIdx, inlineImgPos.x, ny);
                                  }}
                                  className="w-full accent-purple-500"
                                />
                                <div className="flex justify-between text-[10px] text-muted-foreground/50">
                                  <span>Topo</span><span>Centro</span><span>Base</span>
                                </div>
                              </div>

                              {(inlineImgPos.x !== 0 || inlineImgPos.y !== 0) && (
                                <button
                                  onClick={() => {
                                    setInlineImgPos({ x: 0, y: 0 });
                                    applyInlineImgObjectPos(selectedIndex, splitIdx, 0, 0);
                                  }}
                                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                                >
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
                            <button type="button"
                              className="w-full flex items-center gap-1.5 py-0.5 text-left"
                              onClick={() => toggleSection('banner')}
                            >
                              <ChevronDown className={`w-3 h-3 text-muted-foreground shrink-0 transition-transform duration-200 ${collapsedSections['banner'] ? '-rotate-90' : 'rotate-0'}`} />
                              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Banner</span>
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
                      {(sel.outerHtml.includes('class="overlay"') || sel.outerHtml.includes('class="slide-overlay"') || sel.outerHtml.includes('overlay-capa') || sel.outerHtml.includes('overlay-shadow-up')) && (() => {
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
                          <div className="pt-2 border-t border-border">
                            <div className="flex items-center gap-2 mb-1.5">
                              <button
                                type="button"
                                className="flex-1 flex items-center gap-1.5 py-0.5 text-left"
                                onClick={() => toggleSection('gradient')}
                              >
                                <ChevronDown className={`w-3 h-3 text-muted-foreground shrink-0 transition-transform duration-200 ${collapsedSections['gradient'] ? '-rotate-90' : 'rotate-0'}`} />
                                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                                  Gradiente
                                </span>
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

                            {/* Toggle Meia tela — só para to bottom / to top */}
                            {(ov.direction === 'to bottom' || ov.direction === 'to top') && (
                              <button
                                type="button"
                                onClick={() => setOv({ halfPage: !ov.halfPage })}
                                className={`w-full px-3 py-1.5 rounded-md text-[11px] font-semibold border transition-colors ${
                                  ov.halfPage
                                    ? 'bg-purple-600 border-purple-500 text-white'
                                    : 'bg-muted border-border text-muted-foreground hover:text-foreground'
                                }`}
                              >
                                {ov.halfPage ? '½ Tela ✓ — sombra só na metade' : '½ Tela — restringir à metade da página'}
                              </button>
                            )}

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

                            {/* Escuro a partir de (solidFrom) — só para 'to bottom' */}
                            {ov.direction === 'to bottom' && (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <label className="text-[11px] text-muted-foreground">Escuro a partir de</label>
                                  <span className="text-[11px] font-mono text-muted-foreground">
                                    {ov.solidFrom !== undefined && ov.solidFrom < 100 ? `${ov.solidFrom}%` : '–'}
                                  </span>
                                </div>
                                <input type="range" min={55} max={100} step={1}
                                  value={ov.solidFrom !== undefined ? ov.solidFrom : 100}
                                  onChange={e => {
                                    const v = Number(e.target.value);
                                    setOv({ solidFrom: v >= 100 ? undefined : v });
                                  }}
                                  className="w-full accent-purple-500"
                                />
                                <div className="flex justify-between text-[10px] text-muted-foreground/50">
                                  <span>55% (sobe mais)</span><span>— (gradiente total)</span>
                                </div>
                              </div>
                            )}

                            {/* Escurecimento da faixa (curveExp) — só para 'to bottom' */}
                            {ov.direction === 'to bottom' && (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <label className="text-[11px] text-muted-foreground">Escurecimento da faixa</label>
                                  <span className="text-[11px] font-mono text-muted-foreground">{ov.curveExp ?? 25}%</span>
                                </div>
                                <input type="range" min={0} max={99} step={1} value={ov.curveExp ?? 25}
                                  onChange={e => setOv({ curveExp: Number(e.target.value) })}
                                  className="w-full accent-purple-500"
                                />
                                <div className="flex justify-between text-[10px] text-muted-foreground/50">
                                  <span>Claro (0%)</span><span>Escuro (99%)</span>
                                </div>
                              </div>
                            )}

                            {/* Suavidade da transição (só para 'to bottom') */}
                            {ov.direction === 'to bottom' && (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <label className="text-[11px] text-muted-foreground">Suavidade da transição</label>
                                  <span className="text-[11px] font-mono text-muted-foreground">{ov.softness ?? 0}%</span>
                                </div>
                                <input type="range" min={0} max={100} step={5} value={ov.softness ?? 0}
                                  onChange={e => setOv({ softness: Number(e.target.value) })}
                                  className="w-full accent-purple-500"
                                />
                                <div className="flex justify-between text-[10px] text-muted-foreground/50">
                                  <span>Abrupto</span><span>Contínuo</span>
                                </div>
                              </div>
                            )}

                            {/* Claridade do meio (só para 'to bottom') */}
                            {ov.direction === 'to bottom' && (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <label className="text-[11px] text-muted-foreground">Claridade do meio</label>
                                  <span className="text-[11px] font-mono text-muted-foreground">{ov.midLight ?? 0}%</span>
                                </div>
                                <input type="range" min={0} max={95} step={5} value={ov.midLight ?? 0}
                                  onChange={e => setOv({ midLight: Number(e.target.value) })}
                                  className="w-full accent-purple-500"
                                />
                                <div className="flex justify-between text-[10px] text-muted-foreground/50">
                                  <span>Escuro</span><span>Claro</span>
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
                      globalFont={globalFont || undefined}
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
