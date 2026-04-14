import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Download, RefreshCw, Loader2, Image, Edit3, LayoutList, Eye,
  BookmarkPlus, GripVertical, Plus, Minus, Upload, MousePointer2, Type,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface TextBlock {
  className: string;
  text: string;
  isMain: boolean;
  fontSize?: number;
  color?: string;       // override de cor (user-set)
}

interface ElementOverride {
  top?: string;
  left?: string;
  right?: string;
  bottom?: string;
}

interface EditableSlide {
  index: number;
  html: string;
  outerHtml: string;
  type: 'cover' | 'editorial' | 'cta';
  bgImageUrl: string | null;
  texts: TextBlock[];
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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BG_IMAGE_REGEX = /background-image\s*:\s*url\(["']?([^"')]+)["']?\)/i;
const FONT_SIZE_REGEX = /font-size\s*:\s*([\d.]+)\s*px/i;
const COLOR_REGEX = /(?:^|;)\s*color\s*:\s*([^;]+)/i;

function extractFontSize(el: Element): number | undefined {
  const m = FONT_SIZE_REGEX.exec(el.getAttribute('style') || '');
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
];

function extractTextBlocks(el: Element): TextBlock[] {
  const blocks: TextBlock[] = [];
  const seen = new Set<Element>();
  for (const { selector, isMain } of TEXT_SELECTORS) {
    for (const node of Array.from(el.querySelectorAll(selector))) {
      if (node.closest('.top-header') || node.closest('.footer-name-pill') ||
          node.closest('.footer-handle-pill') || node.closest('.follow-banner') ||
          seen.has(node)) continue;
      seen.add(node);
      const className = node.className || selector.slice(1);
      blocks.push({
        className: typeof className === 'string' ? className : selector.slice(1),
        text: node.textContent?.trim() ?? '',
        isMain,
        fontSize: extractFontSize(node),
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
  }));
  return { slides, head };
}

function rebuildSlideOuterHtml(
  slide: EditableSlide,
  editedTexts: TextBlock[],
  newBgUrl: string | null,
  overrides?: Record<string, ElementOverride>,
): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${slide.outerHtml}</body>`, 'text/html');
  const el = doc.body.firstElementChild!;

  const classGroups: Record<string, Element[]> = {};
  for (const { selector } of TEXT_SELECTORS) {
    classGroups[selector.slice(1)] = Array.from(el.querySelectorAll(selector))
      .filter(n => !n.closest('.top-header'));
  }
  const groupCounters: Record<string, number> = {};
  for (const { selector } of TEXT_SELECTORS) groupCounters[selector.slice(1)] = 0;

  for (const tb of editedTexts) {
    const baseClass = tb.className.split(' ')[0];
    const nodes = classGroups[baseClass];
    if (!nodes) continue;
    const idx = groupCounters[baseClass] ?? 0;
    if (nodes[idx]) {
      nodes[idx].textContent = tb.text;
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

  // Element position overrides from drag
  if (overrides) {
    for (const [sel, styles] of Object.entries(overrides)) {
      for (const node of Array.from(el.querySelectorAll(sel)) as HTMLElement[]) {
        if (styles.top !== undefined) node.style.top = styles.top;
        if (styles.left !== undefined) node.style.left = styles.left;
        if (styles.right !== undefined) node.style.right = styles.right;
        if (styles.bottom !== undefined) node.style.bottom = styles.bottom;
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

function SlideThumbnail({ slideHtml, head, index, selected, onClick }: {
  slideHtml: string; head: string; index: number; selected: boolean; onClick: () => void;
}) {
  const THUMB_W = 120;
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
  const PREVIEW_W = 280;
  const scale = PREVIEW_W / 1080;
  const previewH = Math.round(1350 * scale);
  const srcDoc = `<!DOCTYPE html><html><head>${head}</head><body style="margin:0;padding:0;overflow:hidden;">${slideHtml}</body></html>`;
  return (
    <div className="rounded-xl overflow-hidden border border-border shadow-lg mx-auto"
      style={{ width: PREVIEW_W, height: previewH }}>
      <iframe srcDoc={srcDoc} sandbox="allow-scripts allow-same-origin"
        style={{ width: 1080, height: 1350, border: 'none',
          transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none' }}
        title="Preview"
      />
    </div>
  );
}

// ─── Preview interativo (modo visual/drag) ────────────────────────────────────

// Selectors dos elementos arrastáveis (tipicamente position:absolute nas slides)
const DRAGGABLE_SELECTORS = [
  '.profile-badge', '.cover-title', '.swipe-hint',
  '.photo-card', '.top-photo-wrap',
  '.cta-title', '.follow-pill', '.cta-footer',
  '.slide-footer', '.top-header',
  '.title', '.subtitle', '.narrative-text',
];

function buildDragScript(displayScale: number): string {
  const sels = JSON.stringify(DRAGGABLE_SELECTORS);
  return `<script>
(function(){
  var SCALE=${displayScale.toFixed(6)};
  var SELS=${sels};
  var dragging=null, selected=null;

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

  document.addEventListener('mousedown',function(e){
    var found=findEl(e.target);
    if(!found) return;
    var el=found.el;
    var cs=window.getComputedStyle(el);
    // Only drag absolutely positioned elements
    if(cs.position!=='absolute'&&cs.position!=='fixed') return;
    if(selected) highlight(selected,false);
    selected=el; highlight(el,true);
    dragging={
      el:el, sel:found.sel,
      startX:e.clientX, startY:e.clientY,
      origLeft:parseFloat(el.style.left||cs.left)||0,
      origTop:parseFloat(el.style.top||cs.top)||0,
    };
    window.parent.postMessage({type:'elementClicked',selector:found.sel},'*');
    e.preventDefault();
  });

  document.addEventListener('mousemove',function(e){
    if(!dragging) return;
    var dx=(e.clientX-dragging.startX)*SCALE;
    var dy=(e.clientY-dragging.startY)*SCALE;
    dragging.el.style.left=(dragging.origLeft+dx)+'px';
    dragging.el.style.top=(dragging.origTop+dy)+'px';
    e.preventDefault();
  });

  document.addEventListener('mouseup',function(e){
    if(!dragging) return;
    window.parent.postMessage({
      type:'elementMoved',
      selector:dragging.sel,
      left:dragging.el.style.left,
      top:dragging.el.style.top,
    },'*');
    dragging=null;
  });

  document.addEventListener('click',function(e){
    var found=findEl(e.target);
    if(!found&&selected){
      highlight(selected,false); selected=null;
      window.parent.postMessage({type:'elementDeselected'},'*');
    }
  });
})();
</script>`;
}

function InteractiveSlidePreview({ slideHtml, head, onElementMoved, selectedIndex }: {
  slideHtml: string;
  head: string;
  onElementMoved: (selector: string, left: string, top: string) => void;
  selectedIndex: number;
}) {
  const DISPLAY_W = 460;
  const scale = DISPLAY_W / 1080;
  const DISPLAY_H = Math.round(1350 * scale);
  const dragScript = buildDragScript(scale);
  const srcDoc = `<!DOCTYPE html><html><head>${head}${dragScript}</head><body style="margin:0;padding:0;overflow:hidden;">${slideHtml}</body></html>`;

  useEffect(() => {
    function handleMsg(e: MessageEvent) {
      if (!e.data) return;
      if (e.data.type === 'elementMoved') {
        onElementMoved(e.data.selector, e.data.left, e.data.top);
      }
    }
    window.addEventListener('message', handleMsg);
    return () => window.removeEventListener('message', handleMsg);
  }, [onElementMoved, selectedIndex]);

  return (
    <div>
      <div className="rounded-xl overflow-hidden border-2 border-purple-500/40 shadow-xl mx-auto relative"
        style={{ width: DISPLAY_W, height: DISPLAY_H }}>
        <iframe
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
        Clique e arraste elementos com <strong className="text-purple-400">position: absolute</strong> para mover
      </p>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function CarouselEditor({
  html, folderName, topic, numSlides, legenda, config,
  onScreenshotsUpdated, onTemplateSaved,
}: CarouselEditorProps) {
  const [head, setHead] = useState('');
  const [slides, setSlides] = useState<EditableSlide[]>([]);
  const [editedTexts, setEditedTexts] = useState<Record<number, TextBlock[]>>({});
  const [editedBgUrls, setEditedBgUrls] = useState<Record<number, string>>({});
  const [elementOverrides, setElementOverrides] = useState<Record<number, Record<string, ElementOverride>>>({});
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [editMode, setEditMode] = useState<'text' | 'visual'>('text');
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateName, setTemplateName] = useState(topic);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const bgFileRef = useRef<HTMLInputElement>(null);

  // ── Parse inicial ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!html) return;
    const { slides: parsed, head: parsedHead } = parseSlides(html);
    setHead(parsedHead);
    setSlides(parsed);
    const textsInit: Record<number, TextBlock[]> = {};
    const bgInit: Record<number, string> = {};
    for (const s of parsed) {
      textsInit[s.index] = s.texts.map(t => ({ ...t }));
      if (s.bgImageUrl) bgInit[s.index] = s.bgImageUrl;
    }
    setEditedTexts(textsInit);
    setEditedBgUrls(bgInit);
    setSelectedIndex(parsed.length > 0 ? 0 : null);
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

  // ── Edição de texto ──────────────────────────────────────────────────────────

  function updateText(si: number, bi: number, val: string) {
    setEditedTexts(prev => {
      const b = [...(prev[si] ?? [])];
      b[bi] = { ...b[bi], text: val };
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

  function updateBgUrl(si: number, url: string) {
    setEditedBgUrls(prev => ({ ...prev, [si]: url }));
  }

  // ── Element position overrides (drag no visual editor) ───────────────────────

  const handleElementMoved = useCallback((selector: string, left: string, top: string) => {
    setElementOverrides(prev => {
      if (selectedIndex === null) return prev;
      return {
        ...prev,
        [selectedIndex]: { ...(prev[selectedIndex] ?? {}), [selector]: { left, top } },
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
    ));
    return `<!DOCTYPE html><html><head>${head}</head><body>\n${built.join('\n')}\n</body></html>`;
  }, [slides, head, editedTexts, editedBgUrls, elementOverrides]);

  function liveSlideHtml(idx: number): string {
    const s = slides[idx]; if (!s) return '';
    return rebuildSlideOuterHtml(
      s,
      editedTexts[idx] ?? s.texts,
      editedBgUrls[idx] !== '' ? (editedBgUrls[idx] ?? null) : null,
      elementOverrides[idx],
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
      <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Edit3 className="w-4 h-4 text-purple-500" />
          <span className="text-sm font-bold">Editor de Carrossel</span>
          <span className="text-xs text-muted-foreground">{slides.length} slides</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={handleDownloadHtml}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-secondary hover:bg-border text-foreground text-xs font-semibold transition-colors">
            <Download className="w-3 h-3" /> HTML
          </button>
          <button onClick={handleRegenerateScreenshots} disabled={screenshotLoading}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white text-xs font-semibold transition-colors">
            {screenshotLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            PNGs
          </button>
          <button onClick={handleDownloadJpegs} disabled={screenshotLoading}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-60 text-white text-xs font-semibold transition-colors"
            title="Gera screenshots e baixa como JPEG">
            <Download className="w-3 h-3" /> JPEGs
          </button>
          <input type="text" value={templateName} onChange={e => setTemplateName(e.target.value)}
            placeholder="Nome do modelo…"
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/50 w-32" />
          <button onClick={handleSaveTemplate} disabled={templateLoading}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-semibold transition-colors">
            {templateLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <BookmarkPlus className="w-3 h-3" />}
            Salvar Modelo
          </button>
        </div>
      </div>

      {/* ── Corpo ── */}
      <div className="flex min-h-[480px]">

        {/* ── Esquerda: miniaturas ── */}
        <div className="w-[148px] shrink-0 border-r border-border flex flex-col">
          <div className="px-3 py-2 border-b border-border">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Slides</p>
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

        {/* ── Direita: editor ── */}
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
                    <div className="px-5 pt-4 pb-3 border-b border-border bg-secondary/20">
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
                    <div className="px-5 py-4 space-y-4 flex-1">
                      {selTexts.length > 0 ? (
                        <>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                            <Edit3 className="w-3.5 h-3.5" /> Textos do slide
                          </p>
                          {selTexts.map((block, bi) => {
                            const currentSize = block.fontSize ?? (block.isMain ? 48 : 28);
                            return (
                              <div key={`${block.className}-${bi}`} className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <label className="text-xs font-medium text-muted-foreground capitalize">
                                    .{block.className.split(' ')[0]}
                                  </label>
                                  <div className="flex items-center gap-1.5">
                                    {/* Color picker */}
                                    <div className="relative flex items-center gap-1" title="Cor do texto">
                                      <label className="text-[10px] text-muted-foreground">Cor</label>
                                      <input
                                        type="color"
                                        value={block.color || '#ffffff'}
                                        onChange={e => updateTextColor(selectedIndex, bi, e.target.value)}
                                        className="w-6 h-6 rounded cursor-pointer border border-border bg-transparent"
                                        title="Cor do texto"
                                      />
                                    </div>
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
                                </div>
                                <textarea
                                  value={block.text}
                                  onChange={e => updateText(selectedIndex, bi, e.target.value)}
                                  rows={block.isMain && block.text.length > 60 ? 4 : 2}
                                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-y"
                                  style={{ color: block.color }}
                                />
                              </div>
                            );
                          })}
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">Nenhum texto editável detectado neste slide.</p>
                      )}

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
                    </div>
                  </>
                )}

                {/* ── MODO VISUAL ── */}
                {editMode === 'visual' && (
                  <div className="px-4 py-5 space-y-4 flex-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <MousePointer2 className="w-3.5 h-3.5 text-purple-400" />
                      <span>Arraste logos, fotos e textos com <strong>position: absolute</strong> para reposicionar</span>
                    </div>

                    <InteractiveSlidePreview
                      key={selectedIndex}
                      slideHtml={liveSlideHtml(selectedIndex)}
                      head={head}
                      onElementMoved={handleElementMoved}
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
