import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Download, RefreshCw, Loader2,
  Image, Edit3, LayoutList, Eye, BookmarkPlus,
  GripVertical, Plus, Minus, Upload,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface TextBlock {
  className: string;  // ex: 'title', 'narrative-text', 'subtitle'
  text: string;
  isMain: boolean;
  fontSize?: number;  // em px, extraído do style inline
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

function extractFontSize(el: Element): number | undefined {
  const style = el.getAttribute('style') || '';
  const m = FONT_SIZE_REGEX.exec(style);
  return m ? parseFloat(m[1]) : undefined;
}

function extractBgImageUrl(el: Element): string | null {
  const bgEl = el.querySelector('.slide-bg, .bg');
  if (bgEl) {
    const styleAttr = bgEl.getAttribute('style') || '';
    const match = BG_IMAGE_REGEX.exec(styleAttr);
    if (match) return match[1];
  }
  const style = el.getAttribute('style') || '';
  const match = BG_IMAGE_REGEX.exec(style);
  return match ? match[1] : null;
}

function detectSlideType(el: Element): 'cover' | 'editorial' | 'cta' {
  const classes = el.className || '';
  if (classes.includes('clean-cover')) return 'cover';
  if (classes.includes('clean-cta')) return 'cta';
  if (classes.includes('clean-content')) return 'editorial';
  if (classes.includes('slide-editorial')) return 'editorial';
  if (el.querySelector('.cta') || classes.includes('cta')) return 'cta';
  if (el.querySelector('.title') && !classes.includes('slide-editorial')) return 'cover';
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
    const found = Array.from(el.querySelectorAll(selector));
    for (const node of found) {
      if (node.closest('.top-header')) continue;
      if (node.closest('.footer-name-pill')) continue;
      if (node.closest('.footer-handle-pill')) continue;
      if (node.closest('.follow-banner')) continue;
      if (seen.has(node)) continue;
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
  const slideEls = Array.from(doc.querySelectorAll('.slide, .slide-editorial, .clean-cover, .clean-content, .clean-cta'));

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

function rebuildSlideOuterHtml(slide: EditableSlide, editedTexts: TextBlock[], newBgUrl: string | null): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${slide.outerHtml}</body>`, 'text/html');
  const el = doc.body.firstElementChild!;

  const classGroups: Record<string, Element[]> = {};
  for (const { selector } of TEXT_SELECTORS) {
    const nodes = Array.from(el.querySelectorAll(selector)).filter(n => !n.closest('.top-header'));
    classGroups[selector.slice(1)] = nodes;
  }

  const groupCounters: Record<string, number> = {};
  for (const { selector } of TEXT_SELECTORS) {
    groupCounters[selector.slice(1)] = 0;
  }

  for (const tb of editedTexts) {
    const baseClass = tb.className.split(' ')[0];
    const nodes = classGroups[baseClass];
    if (!nodes) continue;
    const idx = groupCounters[baseClass] ?? 0;
    if (nodes[idx]) {
      nodes[idx].textContent = tb.text;
      // Apply font size if set
      if (tb.fontSize !== undefined) {
        const existingStyle = nodes[idx].getAttribute('style') || '';
        const cleaned = existingStyle.replace(FONT_SIZE_REGEX, '').replace(/\s{2,}/g, ' ').trim();
        nodes[idx].setAttribute('style', `${cleaned}; font-size: ${tb.fontSize}px;`.replace(/^;\s*/, ''));
      }
    }
    groupCounters[baseClass] = idx + 1;
  }

  if (newBgUrl !== null) {
    const slideBg = el.querySelector('.slide-bg, .bg') as HTMLElement | null;
    if (slideBg) {
      const existingStyle = slideBg.getAttribute('style') || '';
      if (BG_IMAGE_REGEX.test(existingStyle)) {
        slideBg.setAttribute('style', existingStyle.replace(BG_IMAGE_REGEX, `background-image: url('${newBgUrl}')`));
      } else {
        slideBg.setAttribute('style', `${existingStyle} background-image: url('${newBgUrl}');`);
      }
    } else {
      const existingStyle = el.getAttribute('style') || '';
      if (BG_IMAGE_REGEX.test(existingStyle)) {
        el.setAttribute('style', existingStyle.replace(BG_IMAGE_REGEX, `background-image: url('${newBgUrl}')`));
      } else {
        el.setAttribute('style', `${existingStyle} background-image: url('${newBgUrl}');`);
      }
    }
  }

  return el.outerHTML;
}

// ─── Miniatura de slide ───────────────────────────────────────────────────────

function SlideThumbnail({
  slideHtml, head, index, selected, onClick,
}: {
  slideHtml: string; head: string; index: number; selected: boolean; onClick: () => void;
}) {
  const SLIDE_W = 1080;
  const SLIDE_H = 1350;
  const THUMB_W = 120;
  const scale = THUMB_W / SLIDE_W;
  const thumbH = Math.round(SLIDE_H * scale);
  const srcDoc = `<!DOCTYPE html><html><head>${head}</head><body style="margin:0;padding:0;overflow:hidden;">${slideHtml}</body></html>`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-xl overflow-hidden border-2 transition-all shrink-0 ${
        selected ? 'border-purple-500 shadow-lg shadow-purple-500/20' : 'border-border hover:border-purple-300'
      }`}
      style={{ width: THUMB_W, height: thumbH }}
      title={`Slide ${index + 1}`}
    >
      <iframe
        srcDoc={srcDoc}
        sandbox="allow-scripts allow-same-origin"
        style={{
          width: SLIDE_W, height: SLIDE_H, border: 'none',
          transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none',
        }}
        title={`Miniatura slide ${index + 1}`}
      />
      <div className={`absolute bottom-0 inset-x-0 text-center text-xs font-bold py-0.5 ${
        selected ? 'bg-purple-600 text-white' : 'bg-black/60 text-white/80'
      }`}>
        {index + 1}
      </div>
    </button>
  );
}

// ─── Preview do slide selecionado ─────────────────────────────────────────────

function SlidePreview({ slideHtml, head }: { slideHtml: string; head: string }) {
  const SLIDE_W = 1080;
  const SLIDE_H = 1350;
  const PREVIEW_W = 280;
  const scale = PREVIEW_W / SLIDE_W;
  const previewH = Math.round(SLIDE_H * scale);
  const srcDoc = `<!DOCTYPE html><html><head>${head}</head><body style="margin:0;padding:0;overflow:hidden;">${slideHtml}</body></html>`;

  return (
    <div className="rounded-xl overflow-hidden border border-border shadow-lg mx-auto" style={{ width: PREVIEW_W, height: previewH }}>
      <iframe
        srcDoc={srcDoc}
        sandbox="allow-scripts allow-same-origin"
        style={{
          width: SLIDE_W, height: SLIDE_H, border: 'none',
          transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none',
        }}
        title="Preview do slide"
      />
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
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateName, setTemplateName] = useState(topic);

  // Drag-and-drop state
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Ref para input de arquivo de imagem de fundo
  const bgFileRef = useRef<HTMLInputElement>(null);

  // ── Parse inicial ─────────────────────────────────────────────────────────

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

  // ── Drag-and-drop ────────────────────────────────────────────────────────

  function moveSlide(from: number, to: number) {
    if (to < 0 || to >= slides.length) return;

    setSlides(prev => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next.map((s, i) => ({ ...s, index: i }));
    });

    setEditedTexts(prev => {
      const arr = slides.map((_, i) => prev[i] ?? []);
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      return Object.fromEntries(arr.map((v, i) => [i, v]));
    });
    setEditedBgUrls(prev => {
      const arr = slides.map((_, i) => prev[i] ?? '');
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      return Object.fromEntries(arr.map((v, i) => [i, v]).filter(([, v]) => v !== ''));
    });

    setSelectedIndex(to);
  }

  function handleDragStart(e: React.DragEvent, idx: number) {
    setDraggedIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (idx !== dragOverIdx) setDragOverIdx(idx);
  }

  function handleDrop(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (draggedIdx !== null && draggedIdx !== idx) {
      moveSlide(draggedIdx, idx);
    }
    setDraggedIdx(null);
    setDragOverIdx(null);
  }

  function handleDragEnd() {
    setDraggedIdx(null);
    setDragOverIdx(null);
  }

  // ── Atualizar texto ──────────────────────────────────────────────────────

  function updateText(slideIndex: number, blockIndex: number, newText: string) {
    setEditedTexts(prev => {
      const blocks = [...(prev[slideIndex] ?? [])];
      blocks[blockIndex] = { ...blocks[blockIndex], text: newText };
      return { ...prev, [slideIndex]: blocks };
    });
  }

  function updateFontSize(slideIndex: number, blockIndex: number, delta: number) {
    setEditedTexts(prev => {
      const blocks = [...(prev[slideIndex] ?? [])];
      const block = blocks[blockIndex];
      if (!block) return prev;
      // Default font size if not set: try to guess from class name
      const defaultSize = block.isMain ? 48 : 28;
      const current = block.fontSize ?? defaultSize;
      const next = Math.max(8, Math.min(200, current + delta));
      blocks[blockIndex] = { ...block, fontSize: next };
      return { ...prev, [slideIndex]: blocks };
    });
  }

  function updateBgUrl(slideIndex: number, url: string) {
    setEditedBgUrls(prev => ({ ...prev, [slideIndex]: url }));
  }

  // ── Upload de imagem de fundo ─────────────────────────────────────────────

  function handleBgFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || selectedIndex === null) return;
    const reader = new FileReader();
    reader.onload = ev => {
      updateBgUrl(selectedIndex, ev.target?.result as string);
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be re-selected
    e.target.value = '';
  }

  // ── Reconstrução do HTML ──────────────────────────────────────────────────

  const rebuildHtml = useCallback((): string => {
    const rebuiltSlides = slides.map(slide => {
      const texts = editedTexts[slide.index] ?? slide.texts;
      const bgUrl = editedBgUrls[slide.index] ?? null;
      return rebuildSlideOuterHtml(slide, texts, bgUrl !== '' ? bgUrl : null);
    });
    return `<!DOCTYPE html><html><head>${head}</head><body>\n${rebuiltSlides.join('\n')}\n</body></html>`;
  }, [slides, head, editedTexts, editedBgUrls]);

  function liveSlideHtml(index: number): string {
    const slide = slides[index];
    if (!slide) return '';
    const texts = editedTexts[index] ?? slide.texts;
    const bgUrl = editedBgUrls[index] ?? null;
    return rebuildSlideOuterHtml(slide, texts, bgUrl !== '' ? bgUrl : null);
  }

  // ── Regenerar screenshots ─────────────────────────────────────────────────

  async function handleRegenerateScreenshots() {
    setScreenshotLoading(true);
    try {
      const modifiedHtml = rebuildHtml();
      const res = await fetch(`${API}/api/carousel/screenshots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: modifiedHtml, folderName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao gerar screenshots');
      onScreenshotsUpdated(data.screenshots ?? []);
      toast.success(`${data.screenshots?.length ?? 0} screenshots atualizados!`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setScreenshotLoading(false);
    }
  }

  // ── Salvar como modelo ────────────────────────────────────────────────────

  async function handleSaveTemplate() {
    const name = templateName.trim() || topic;
    setTemplateLoading(true);
    try {
      const modifiedHtml = rebuildHtml();
      const res = await fetch(`${API}/api/carousel/save-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: modifiedHtml, folderName, name,
          numSlides: numSlides ?? slides.length,
          legenda: legenda ?? '',
          config: config ?? {},
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar modelo');
      toast.success(`Modelo "${name}" salvo!`);
      onTemplateSaved?.();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setTemplateLoading(false);
    }
  }

  // ── Download HTML ─────────────────────────────────────────────────────────

  function handleDownloadHtml() {
    const modified = rebuildHtml();
    const blob = new Blob([modified], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `carrossel-editado-${topic.replace(/\s+/g, '-').toLowerCase()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Guard ─────────────────────────────────────────────────────────────────

  if (slides.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 rounded-xl border border-border bg-card text-muted-foreground text-sm gap-2">
        <LayoutList className="w-4 h-4" />
        Nenhum slide encontrado no HTML.
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
          <span className="text-sm font-bold text-foreground">Editor de Carrossel</span>
          <span className="text-xs text-muted-foreground">
            {slides.length} slide{slides.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleDownloadHtml}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:bg-border text-foreground text-xs font-semibold transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Baixar HTML
          </button>
          <button
            onClick={handleRegenerateScreenshots}
            disabled={screenshotLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors"
          >
            {screenshotLoading ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Gerando…</>
            ) : (
              <><RefreshCw className="w-3.5 h-3.5" /> Screenshots</>
            )}
          </button>
          <input
            type="text"
            value={templateName}
            onChange={e => setTemplateName(e.target.value)}
            placeholder="Nome do modelo…"
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/50 w-36"
          />
          <button
            onClick={handleSaveTemplate}
            disabled={templateLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors"
          >
            {templateLoading ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Salvando…</>
            ) : (
              <><BookmarkPlus className="w-3.5 h-3.5" /> Salvar como Modelo</>
            )}
          </button>
        </div>
      </div>

      {/* ── Corpo: lista + editor ── */}
      <div className="flex min-h-[480px]">

        {/* ── Coluna esquerda: miniaturas com drag-and-drop ── */}
        <div className="w-1/3 border-r border-border flex flex-col">
          <div className="px-3 py-2.5 border-b border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Slides <span className="normal-case font-normal opacity-60 ml-1">— arraste para reordenar</span>
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {slides.map((slide, listIdx) => (
              <div
                key={`${slide.index}-${listIdx}`}
                draggable
                onDragStart={e => handleDragStart(e, listIdx)}
                onDragOver={e => handleDragOver(e, listIdx)}
                onDrop={e => handleDrop(e, listIdx)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-2 rounded-xl transition-all ${
                  dragOverIdx === listIdx && draggedIdx !== listIdx
                    ? 'ring-2 ring-purple-400 bg-purple-500/10'
                    : ''
                } ${draggedIdx === listIdx ? 'opacity-40' : ''}`}
              >
                {/* Handle de drag */}
                <div
                  className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1 shrink-0"
                  title="Arrastar para reordenar"
                >
                  <GripVertical className="w-4 h-4" />
                </div>

                {/* Miniatura */}
                <SlideThumbnail
                  slideHtml={liveSlideHtml(listIdx)}
                  head={head}
                  index={listIdx}
                  selected={selectedIndex === listIdx}
                  onClick={() => setSelectedIndex(listIdx)}
                />
              </div>
            ))}
          </div>
        </div>

        {/* ── Coluna direita: editor ── */}
        <div className="w-2/3 flex flex-col">
          <AnimatePresence mode="wait">
            {sel !== null && selectedIndex !== null ? (
              <motion.div
                key={selectedIndex}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.18 }}
                className="flex-1 flex flex-col overflow-y-auto"
              >
                {/* Preview ao vivo */}
                <div className="px-5 pt-5 pb-3 border-b border-border bg-secondary/20">
                  <div className="flex items-center gap-2 mb-3">
                    <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Preview — Slide {selectedIndex + 1}
                      <span className="ml-2 capitalize font-normal text-muted-foreground/70">{sel.type}</span>
                    </span>
                  </div>
                  <SlidePreview slideHtml={liveSlideHtml(selectedIndex)} head={head} />
                </div>

                {/* Campos de texto */}
                <div className="px-5 py-4 space-y-4 flex-1">
                  {selTexts.length > 0 ? (
                    <>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                        <Edit3 className="w-3.5 h-3.5" /> Textos do slide
                      </p>
                      {selTexts.map((block, bi) => {
                        const defaultSize = block.isMain ? 48 : 28;
                        const currentSize = block.fontSize ?? defaultSize;
                        return (
                          <div key={`${block.className}-${bi}`}>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-xs font-medium text-muted-foreground capitalize">
                                .{block.className.split(' ')[0]}
                              </label>
                              {/* Controle de tamanho de fonte */}
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => updateFontSize(selectedIndex, bi, -2)}
                                  className="w-6 h-6 rounded flex items-center justify-center bg-secondary hover:bg-border transition-colors text-foreground"
                                  title="Diminuir fonte"
                                >
                                  <Minus className="w-3 h-3" />
                                </button>
                                <span className="text-xs font-mono text-muted-foreground w-9 text-center">
                                  {currentSize}px
                                </span>
                                <button
                                  type="button"
                                  onClick={() => updateFontSize(selectedIndex, bi, 2)}
                                  className="w-6 h-6 rounded flex items-center justify-center bg-secondary hover:bg-border transition-colors text-foreground"
                                  title="Aumentar fonte"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                            <textarea
                              value={block.text}
                              onChange={e => updateText(selectedIndex, bi, e.target.value)}
                              rows={block.isMain && block.text.length > 60 ? 4 : 2}
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-y"
                              placeholder="Digite o texto…"
                            />
                          </div>
                        );
                      })}
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      Nenhum texto editável detectado neste slide.
                    </p>
                  )}

                  {/* Campo de imagem de fundo */}
                  <div className="space-y-2 pt-2 border-t border-border">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <Image className="w-3.5 h-3.5" /> Imagem de fundo
                    </p>

                    {selBg && (
                      <div className="rounded-lg overflow-hidden border border-border" style={{ maxHeight: 80 }}>
                        <img
                          src={selBg}
                          alt="Imagem de fundo atual"
                          className="w-full object-cover"
                          style={{ maxHeight: 80 }}
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      </div>
                    )}

                    {/* Upload do computador */}
                    <input
                      ref={bgFileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleBgFileChange}
                    />
                    <button
                      type="button"
                      onClick={() => bgFileRef.current?.click()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-border hover:border-purple-400 bg-background hover:bg-purple-500/5 text-muted-foreground hover:text-purple-400 text-xs font-medium transition-colors w-full justify-center"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      {selBg ? 'Trocar imagem do computador' : 'Upload do computador'}
                    </button>

                    {/* OU colar URL */}
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                        <span className="text-xs text-muted-foreground/50">URL</span>
                      </div>
                      <input
                        type="url"
                        value={selBg.startsWith('data:') ? '' : selBg}
                        onChange={e => updateBgUrl(selectedIndex!, e.target.value)}
                        placeholder="Cole uma URL de imagem…"
                        className="w-full rounded-lg border border-border bg-background pl-10 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                      />
                    </div>
                    {selBg && (
                      <button
                        type="button"
                        onClick={() => updateBgUrl(selectedIndex!, '')}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors"
                      >
                        Remover imagem
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex-1 flex items-center justify-center text-muted-foreground text-sm gap-2"
              >
                <LayoutList className="w-4 h-4" />
                Selecione um slide para editar
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
