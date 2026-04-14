import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  ChevronUp, ChevronDown, Download, RefreshCw, Loader2,
  Image, Edit3, LayoutList, Eye, BookmarkPlus,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface TextBlock {
  className: string;  // ex: 'title', 'narrative-text', 'subtitle'
  text: string;
  isMain: boolean;    // true para title/narrative-text principal
}

interface EditableSlide {
  index: number;
  html: string;         // innerHTML do elemento slide
  outerHtml: string;    // outerHTML completo (com atributos do slide)
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

function extractBgImageUrl(el: Element): string | null {
  // Try .slide-bg (editorial) or .bg (clean) child first
  const bgEl = el.querySelector('.slide-bg, .bg');
  if (bgEl) {
    const styleAttr = bgEl.getAttribute('style') || '';
    const match = BG_IMAGE_REGEX.exec(styleAttr);
    if (match) return match[1];
  }
  // Fallback: check inline style of the slide itself
  const style = el.getAttribute('style') || '';
  const match = BG_IMAGE_REGEX.exec(style);
  return match ? match[1] : null;
}

function detectSlideType(el: Element): 'cover' | 'editorial' | 'cta' {
  const classes = el.className || '';
  // Clean layout
  if (classes.includes('clean-cover')) return 'cover';
  if (classes.includes('clean-cta')) return 'cta';
  if (classes.includes('clean-content')) return 'editorial';
  // Editorial layout
  if (classes.includes('slide-editorial')) return 'editorial';
  if (el.querySelector('.cta') || classes.includes('cta')) return 'cta';
  if (el.querySelector('.title') && !classes.includes('slide-editorial')) return 'cover';
  return 'editorial';
}

const TEXT_SELECTORS = [
  // Editorial layout
  { selector: '.title', isMain: true },
  { selector: '.subtitle', isMain: false },
  { selector: '.subtitle-accent', isMain: false },
  { selector: '.narrative-text', isMain: true },
  // Clean layout
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
      // Skip non-editable containers
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
      });
    }
  }

  return blocks;
}

function parseSlides(html: string): { slides: EditableSlide[]; head: string } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const head = doc.head.innerHTML;
  // Supports both editorial (.slide, .slide-editorial) and clean (.clean-cover, .clean-content, .clean-cta)
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
  // Rebuild from the stored outerHtml so we preserve all attributes/classes
  const doc = parser.parseFromString(`<body>${slide.outerHtml}</body>`, 'text/html');
  const el = doc.body.firstElementChild!;

  // Apply text edits — we match by className+index among same className nodes
  const classGroups: Record<string, Element[]> = {};
  for (const { selector } of TEXT_SELECTORS) {
    const nodes = Array.from(el.querySelectorAll(selector)).filter(n => !n.closest('.top-header'));
    const key = selector.slice(1);
    classGroups[key] = nodes;
  }

  // Map editedTexts back to DOM nodes — same order as extractTextBlocks
  let groupCounters: Record<string, number> = {};
  for (const { selector } of TEXT_SELECTORS) {
    groupCounters[selector.slice(1)] = 0;
  }

  for (const tb of editedTexts) {
    // Derive base class name (first token of className)
    const baseClass = tb.className.split(' ')[0];
    const nodes = classGroups[baseClass];
    if (!nodes) continue;
    const idx = groupCounters[baseClass] ?? 0;
    if (nodes[idx]) {
      nodes[idx].textContent = tb.text;
    }
    groupCounters[baseClass] = idx + 1;
  }

  // Apply background image if changed
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
      // Apply directly to slide element
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

// ─── Componente: miniatura de slide via iframe ────────────────────────────────

function SlideThumbnail({
  slideHtml,
  head,
  index,
  selected,
  onClick,
}: {
  slideHtml: string;
  head: string;
  index: number;
  selected: boolean;
  onClick: () => void;
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
          width: SLIDE_W,
          height: SLIDE_H,
          border: 'none',
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
        }}
        title={`Miniatura slide ${index + 1}`}
      />
      <div
        className={`absolute bottom-0 inset-x-0 text-center text-xs font-bold py-0.5 ${
          selected ? 'bg-purple-600 text-white' : 'bg-black/60 text-white/80'
        }`}
      >
        {index + 1}
      </div>
    </button>
  );
}

// ─── Componente: preview do slide selecionado ─────────────────────────────────

function SlidePreview({ slideHtml, head }: { slideHtml: string; head: string }) {
  const SLIDE_W = 1080;
  const SLIDE_H = 1350;
  const PREVIEW_W = 280;
  const scale = PREVIEW_W / SLIDE_W;
  const previewH = Math.round(SLIDE_H * scale);

  const srcDoc = `<!DOCTYPE html><html><head>${head}</head><body style="margin:0;padding:0;overflow:hidden;">${slideHtml}</body></html>`;

  return (
    <div
      className="rounded-xl overflow-hidden border border-border shadow-lg mx-auto"
      style={{ width: PREVIEW_W, height: previewH }}
    >
      <iframe
        srcDoc={srcDoc}
        sandbox="allow-scripts allow-same-origin"
        style={{
          width: SLIDE_W,
          height: SLIDE_H,
          border: 'none',
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
        }}
        title="Preview do slide"
      />
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function CarouselEditor({
  html,
  folderName,
  topic,
  numSlides,
  legenda,
  config,
  onScreenshotsUpdated,
  onTemplateSaved,
}: CarouselEditorProps) {
  // Estado parseado
  const [head, setHead] = useState('');
  const [slides, setSlides] = useState<EditableSlide[]>([]);

  // Estado de edição por slide (textos e bg temporários)
  const [editedTexts, setEditedTexts] = useState<Record<number, TextBlock[]>>({});
  const [editedBgUrls, setEditedBgUrls] = useState<Record<number, string>>({});

  // Slide selecionado
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Loading para screenshots e salvar template
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateName, setTemplateName] = useState(topic);

  // ── Parse inicial ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!html) return;
    const { slides: parsed, head: parsedHead } = parseSlides(html);
    setHead(parsedHead);
    setSlides(parsed);
    // Inicializa estados de edição com os valores originais
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

  // ── Reordenar slides ────────────────────────────────────────────────────────

  function moveSlide(from: number, to: number) {
    if (to < 0 || to >= slides.length) return;

    setSlides(prev => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      // Re-index
      return next.map((s, i) => ({ ...s, index: i }));
    });

    // Keep editedTexts/Bg consistent with new order
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

  // ── Atualizar texto de um bloco ─────────────────────────────────────────────

  function updateText(slideIndex: number, blockIndex: number, newText: string) {
    setEditedTexts(prev => {
      const blocks = [...(prev[slideIndex] ?? [])];
      blocks[blockIndex] = { ...blocks[blockIndex], text: newText };
      return { ...prev, [slideIndex]: blocks };
    });
  }

  function updateBgUrl(slideIndex: number, url: string) {
    setEditedBgUrls(prev => ({ ...prev, [slideIndex]: url }));
  }

  // ── Reconstrução completa do HTML ───────────────────────────────────────────

  const rebuildHtml = useCallback((): string => {
    const rebuiltSlides = slides.map(slide => {
      const texts = editedTexts[slide.index] ?? slide.texts;
      const bgUrl = editedBgUrls[slide.index] ?? null;
      return rebuildSlideOuterHtml(slide, texts, bgUrl !== '' ? bgUrl : null);
    });
    return `<!DOCTYPE html><html><head>${head}</head><body>\n${rebuiltSlides.join('\n')}\n</body></html>`;
  }, [slides, head, editedTexts, editedBgUrls]);

  // ── Preview ao vivo: outerHTML do slide selecionado ─────────────────────────

  function liveSlideHtml(index: number): string {
    const slide = slides[index];
    if (!slide) return '';
    const texts = editedTexts[index] ?? slide.texts;
    const bgUrl = editedBgUrls[index] ?? null;
    return rebuildSlideOuterHtml(slide, texts, bgUrl !== '' ? bgUrl : null);
  }

  // ── Regenerar screenshots ───────────────────────────────────────────────────

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

  // ── Salvar como modelo ──────────────────────────────────────────────────────

  async function handleSaveTemplate() {
    const name = templateName.trim() || topic;
    setTemplateLoading(true);
    try {
      const modifiedHtml = rebuildHtml();
      const res = await fetch(`${API}/api/carousel/save-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: modifiedHtml,
          folderName,
          name,
          numSlides: numSlides ?? slides.length,
          legenda: legenda ?? '',
          config: config ?? {},
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar modelo');
      toast.success(`Modelo "${name}" salvo com sucesso!`);
      onTemplateSaved?.();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setTemplateLoading(false);
    }
  }

  // ── Download HTML editado ───────────────────────────────────────────────────

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

  // ── Guard: sem slides ───────────────────────────────────────────────────────

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

        {/* ── Coluna esquerda: lista de miniaturas ── */}
        <div className="w-1/3 border-r border-border flex flex-col">
          <div className="px-3 py-2.5 border-b border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Slides</p>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {slides.map((slide, listIdx) => (
              <div key={`${slide.index}-${listIdx}`} className="flex items-center gap-2">
                {/* Setas de reordenação */}
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveSlide(listIdx, listIdx - 1)}
                    disabled={listIdx === 0}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-25 transition-colors"
                    title="Mover para cima"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSlide(listIdx, listIdx + 1)}
                    disabled={listIdx === slides.length - 1}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-25 transition-colors"
                    title="Mover para baixo"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
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

                {/* Campos de texto ── */}
                <div className="px-5 py-4 space-y-4 flex-1">
                  {selTexts.length > 0 ? (
                    <>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                        <Edit3 className="w-3.5 h-3.5" /> Textos do slide
                      </p>
                      {selTexts.map((block, bi) => (
                        <div key={`${block.className}-${bi}`}>
                          <label className="text-xs font-medium text-muted-foreground capitalize block mb-1">
                            .{block.className.split(' ')[0]}
                          </label>
                          {block.isMain && block.text.length > 80 ? (
                            <textarea
                              value={block.text}
                              onChange={e => updateText(selectedIndex, bi, e.target.value)}
                              rows={4}
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-none"
                            />
                          ) : (
                            <input
                              type="text"
                              value={block.text}
                              onChange={e => updateText(selectedIndex, bi, e.target.value)}
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                            />
                          )}
                        </div>
                      ))}
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      Nenhum texto editável detectado neste slide.
                    </p>
                  )}

                  {/* Campo de imagem de fundo */}
                  {(sel.bgImageUrl || selBg) && (
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
                      <input
                        type="url"
                        value={selBg}
                        onChange={e => updateBgUrl(selectedIndex, e.target.value)}
                        placeholder="Cole uma nova URL de imagem…"
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                      />
                      <p className="text-xs text-muted-foreground">
                        Cole a URL de qualquer imagem (Unsplash, etc.) para substituir o fundo.
                      </p>
                    </div>
                  )}
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
