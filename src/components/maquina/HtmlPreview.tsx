/**
 * HtmlPreview.tsx — Etapa 4 (preview, edit, export) da Máquina.
 *
 * Padrão herdado do Básico (CarrosselInstagram + CarouselEditor):
 *   - HTML completo é fragmentado em slides individuais (1 por filho de <body>)
 *   - Cada slide é renderizado num iframe ESCALADO (1080×1350 → containerW)
 *     mantendo proporção 4:5 (Instagram). Sem scroll, sem corte.
 *   - Navegação por setas, dots, teclado (← →) e swipe touch
 *   - Modo Editar: contenteditable nos textos + toolbar inline (font-size, bold)
 *   - Trocar imagem do slide atual via busca Pexels
 *   - Download direto via blob (fetch + URL.createObjectURL) — não window.open
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft, Loader2, Download, Save, Image as ImageIcon, Search,
  Edit3, Eye, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { generateAndSaveScreenshots } from '@/lib/clientScreenshots';
import { pexelsApi } from '@/lib/maquinaApi';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const SLIDE_W = 1080;
const SLIDE_H = 1350;

interface HtmlPreviewProps {
  html: string;
  onHtmlChange: (html: string) => void;
  onBack: () => void;
  onSave: (html: string) => Promise<void>;
  saving: boolean;
  briefingTitle: string;
}

type Mode = 'view' | 'edit';

export default function HtmlPreview({
  html, onHtmlChange, onBack, onSave, saving, briefingTitle,
}: HtmlPreviewProps) {
  const [mode, setMode] = useState<Mode>('view');
  const [currentSlide, setCurrentSlide] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState({ done: 0, total: 0 });
  const [pexelsOpen, setPexelsOpen] = useState(false);
  const [pexelsQuery, setPexelsQuery] = useState('');
  const [pexelsResults, setPexelsResults] = useState<{ url: string; thumb: string }[]>([]);
  const [pexelsLoading, setPexelsLoading] = useState(false);

  // ── Parse HTML completo em slides individuais + extrai <head> ──────────────
  const { head, slidesHtml } = useMemo(() => parseSlides(html), [html]);
  const total = slidesHtml.length;

  // Resetar slide quando o HTML muda drasticamente (ex: gerar novo carrossel)
  useEffect(() => {
    if (currentSlide >= total) setCurrentSlide(0);
  }, [total, currentSlide]);

  // ── Container responsivo: mede largura disponível pra escalar 1080×1350 ────
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(360);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        setContainerW(Math.min(w, 480));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = containerW / SLIDE_W;
  const previewH = Math.round(SLIDE_H * scale);

  // ── Touch swipe entre slides ───────────────────────────────────────────────
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0 && currentSlide < total - 1) setCurrentSlide((s) => s + 1);
      if (dx > 0 && currentSlide > 0) setCurrentSlide((s) => s - 1);
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  // ── Teclado: setas ←/→ ─────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode === 'edit') return; // não navega se está editando texto
      if (e.key === 'ArrowLeft' && currentSlide > 0) setCurrentSlide((s) => s - 1);
      if (e.key === 'ArrowRight' && currentSlide < total - 1) setCurrentSlide((s) => s + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentSlide, total, mode]);

  // ── srcDoc do iframe (UM slide isolado + fontes do <head> + edit script se mode=edit) ──
  const srcDoc = useMemo(() => {
    const slideHtml = slidesHtml[currentSlide] || '';
    const editScript = mode === 'edit' ? EDIT_SCRIPT : '';
    return `<!DOCTYPE html><html><head>${head}${editScript}</head><body style="margin:0;padding:0;overflow:hidden;background:#000;">${slideHtml}</body></html>`;
  }, [head, slidesHtml, currentSlide, mode]);

  // ── Edição: capta mudanças do iframe e devolve HTML completo atualizado ────
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const handleEditCommit = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const editedSlide = doc.body.firstElementChild as HTMLElement | null;
    if (!editedSlide) return;
    // Remove a toolbar antes de salvar
    const toolbar = editedSlide.parentElement?.querySelector('[data-no-edit="1"]');
    if (toolbar) toolbar.remove();
    onHtmlChange(replaceSlideInHtml(html, currentSlide, editedSlide.outerHTML));
  };

  // Quando sai do modo Editar, salva o slide atual no HTML
  useEffect(() => {
    if (mode === 'view') return;
    // No mode=edit, intercepta blur dentro do iframe pra commit
    const iframe = iframeRef.current;
    if (!iframe) return;
    const handler = () => handleEditCommit();
    iframe.contentDocument?.addEventListener('blur', handler, true);
    return () => iframe.contentDocument?.removeEventListener('blur', handler, true);
  }, [mode, currentSlide, srcDoc]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pexels: trocar imagem do slide atual ───────────────────────────────────
  const handlePexelsSearch = async () => {
    if (!pexelsQuery.trim()) return;
    setPexelsLoading(true);
    try {
      const data = await pexelsApi.search(pexelsQuery, 'portrait', 8);
      setPexelsResults(data.photos.map((p) => ({ url: p.url, thumb: p.thumb })));
    } catch (e) {
      toast.error(`Pexels: ${(e as Error).message}`);
    } finally {
      setPexelsLoading(false);
    }
  };

  const handlePexelsPick = (url: string) => {
    const updated = swapImageInSlide(html, currentSlide, url);
    if (!updated) {
      toast.info('Não encontrei imagem nesse slide para substituir.');
      return;
    }
    onHtmlChange(updated);
    setPexelsOpen(false);
    setPexelsResults([]);
    setPexelsQuery('');
    toast.success('Imagem trocada');
  };

  // ── Export PNGs (download via blob, não abrir aba) ─────────────────────────
  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportProgress({ done: 0, total });
    try {
      const folderName = `maquina-${slugify(briefingTitle)}-${Date.now()}`;
      const paths = await generateAndSaveScreenshots(API, html, folderName, (done, t) => {
        setExportProgress({ done, total: t });
      });
      toast.success(`${paths.length} PNGs gerados — iniciando downloads`);
      // Download sequencial com pequeno delay (evita bloqueio do browser)
      for (let i = 0; i < paths.length; i++) {
        await downloadAsBlob(`${API}${paths[i]}`, `slide-${String(i + 1).padStart(2, '0')}.png`);
        await sleep(120);
      }
    } catch (e) {
      toast.error(`Erro no export: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleExportSingle = async () => {
    if (exporting) return;
    setExporting(true);
    setExportProgress({ done: 0, total: 1 });
    try {
      const folderName = `maquina-${slugify(briefingTitle)}-${Date.now()}`;
      const paths = await generateAndSaveScreenshots(API, html, folderName);
      const target = paths[currentSlide];
      if (!target) throw new Error('Slide não encontrado no export');
      await downloadAsBlob(`${API}${target}`, `slide-${String(currentSlide + 1).padStart(2, '0')}.png`);
      toast.success(`Slide ${currentSlide + 1} baixado`);
    } catch (e) {
      toast.error(`Erro no export: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Toolbar superior */}
      <div className="rounded-xl border border-border bg-card p-3 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={onBack} className="p-1.5 rounded-lg bg-secondary hover:bg-border transition-colors" title="Voltar">
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <h3 className="text-sm font-bold flex-1">Preview do carrossel</h3>
          <span className="text-[11px] text-muted-foreground">Etapa 4/4</span>
          <ToggleMode mode={mode} setMode={setMode} />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setPexelsOpen((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:bg-border text-xs font-bold transition-colors"
          >
            <ImageIcon className="w-3.5 h-3.5" />
            Trocar imagem (slide {currentSlide + 1})
          </button>
          <button
            onClick={() => onSave(html)}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:bg-border disabled:opacity-50 text-xs font-bold transition-colors"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Salvar no histórico
          </button>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={handleExportSingle}
              disabled={exporting}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-secondary hover:bg-border disabled:opacity-50 text-xs font-bold transition-colors"
              title="Baixar PNG só do slide atual"
            >
              <Download className="w-3.5 h-3.5" />
              Slide {currentSlide + 1}
            </button>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-bold transition-colors"
            >
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              {exporting ? `${exportProgress.done}/${exportProgress.total || total}` : `Todos (${total})`}
            </button>
          </div>
        </div>

        {pexelsOpen && (
          <div className="rounded-lg border border-border bg-secondary/50 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={pexelsQuery}
                onChange={(e) => setPexelsQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePexelsSearch()}
                placeholder="busca em inglês: woman running, gym deadlift..."
                className="flex-1 p-1.5 rounded bg-card border border-border text-xs focus:outline-none"
              />
              <button
                onClick={handlePexelsSearch}
                disabled={pexelsLoading}
                className="px-3 py-1.5 rounded bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-bold transition-colors"
              >
                {pexelsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Buscar'}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">A imagem será aplicada no slide {currentSlide + 1}.</p>
            {pexelsResults.length > 0 && (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                {pexelsResults.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => handlePexelsPick(p.url)}
                    className="aspect-[3/4] rounded overflow-hidden border border-border hover:border-orange-500/50 transition-colors"
                  >
                    <img src={p.thumb} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Preview com scale + navegação ─────────────────────────────────────── */}
      <div className="space-y-2" ref={containerRef}>
        <div
          className="relative mx-auto rounded-xl overflow-hidden border border-border shadow-lg bg-black"
          style={{ width: containerW, height: previewH }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <iframe
            ref={iframeRef}
            srcDoc={srcDoc}
            sandbox="allow-scripts allow-same-origin"
            title="preview"
            style={{
              width: SLIDE_W,
              height: SLIDE_H,
              border: 'none',
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              pointerEvents: mode === 'edit' ? 'auto' : 'none',
            }}
          />
          {/* Setas de navegação flutuantes */}
          {currentSlide > 0 && (
            <button
              onClick={() => setCurrentSlide((s) => s - 1)}
              className="absolute left-1 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors"
              title="Slide anterior (←)"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
          {currentSlide < total - 1 && (
            <button
              onClick={() => setCurrentSlide((s) => s + 1)}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors"
              title="Próximo slide (→)"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Dots de navegação ───────────────────────────────────────────────── */}
        {total > 1 && (
          <div className="flex items-center justify-center gap-1.5">
            {Array.from({ length: total }).map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentSlide(i)}
                className={`transition-all ${
                  i === currentSlide
                    ? 'w-6 h-1.5 bg-orange-500 rounded-full'
                    : 'w-1.5 h-1.5 bg-muted-foreground/40 hover:bg-muted-foreground/70 rounded-full'
                }`}
                title={`Slide ${i + 1}`}
              />
            ))}
          </div>
        )}
        <p className="text-center text-[10px] text-muted-foreground">
          Slide {currentSlide + 1} de {total} · ← → ou swipe pra navegar
          {mode === 'edit' && ' · clique no texto pra editar'}
        </p>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ToggleMode({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  return (
    <div className="flex gap-0.5 bg-secondary rounded-lg p-0.5">
      <button
        onClick={() => setMode('view')}
        className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold transition-colors ${
          mode === 'view' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
        }`}
      >
        <Eye className="w-3 h-3" /> Ver
      </button>
      <button
        onClick={() => setMode('edit')}
        className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold transition-colors ${
          mode === 'edit' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
        }`}
      >
        <Edit3 className="w-3 h-3" /> Editar texto
      </button>
    </div>
  );
}

function parseSlides(html: string): { head: string; slidesHtml: string[] } {
  if (!html) return { head: '', slidesHtml: [] };
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const head = doc.head.innerHTML;
    const slides = Array.from(doc.body.children) as HTMLElement[];
    return { head, slidesHtml: slides.map((s) => s.outerHTML) };
  } catch {
    return { head: '', slidesHtml: [html] };
  }
}

function replaceSlideInHtml(fullHtml: string, slideIndex: number, newSlideHtml: string): string {
  try {
    const doc = new DOMParser().parseFromString(fullHtml, 'text/html');
    const slides = Array.from(doc.body.children);
    if (!slides[slideIndex]) return fullHtml;
    const wrapper = doc.createElement('div');
    wrapper.innerHTML = newSlideHtml;
    const replacement = wrapper.firstElementChild;
    if (!replacement) return fullHtml;
    slides[slideIndex].replaceWith(replacement);
    return '<!DOCTYPE html>' + doc.documentElement.outerHTML;
  } catch {
    return fullHtml;
  }
}

function swapImageInSlide(fullHtml: string, slideIndex: number, url: string): string | null {
  try {
    const doc = new DOMParser().parseFromString(fullHtml, 'text/html');
    const slides = Array.from(doc.body.children) as HTMLElement[];
    const slide = slides[slideIndex];
    if (!slide) return null;
    // Tenta primeiro img-box / .bg / .slide-bg (background-image)
    const bg = slide.querySelector('.img-box, .bg, .slide-bg, [class*="bg"]') as HTMLElement | null;
    if (bg) {
      bg.style.backgroundImage = `url('${url}')`;
      return '<!DOCTYPE html>' + doc.documentElement.outerHTML;
    }
    // Fallback: <img>
    const img = slide.querySelector('img') as HTMLImageElement | null;
    if (img) {
      img.src = url;
      return '<!DOCTYPE html>' + doc.documentElement.outerHTML;
    }
    return null;
  } catch {
    return null;
  }
}

async function downloadAsBlob(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar ${url}: ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoga depois de 1s pra dar tempo do browser disparar o download
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function slugify(s: string) {
  return (s || 'maquina').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
}

// ─── Edit script injetado no iframe (modo Editar) ────────────────────────────
const EDIT_SCRIPT = `
<script>
document.addEventListener('DOMContentLoaded', function() {
  var SELS = [
    'h1','h2','h3','h4','p','span','.title','.subtitle','.headline',
    '.body','.tag','.cover-title','.cta-title','.content-title','.content-body',
    '.profile-name','.profile-handle','.swipe-hint',
    '.footer-left span','.footer-right','.footer-name-pill','.footer-handle-pill'
  ];
  var els = document.querySelectorAll(SELS.join(','));
  els.forEach(function(el){
    if (el.closest('[data-no-edit="1"]')) return;
    el.contentEditable = 'true';
    el.style.outline = '1px dashed rgba(249,115,22,0.5)';
    el.style.outlineOffset = '2px';
    el.style.cursor = 'text';
  });

  // Toolbar flutuante: font-size + bold
  var tb = document.createElement('div');
  tb.setAttribute('data-no-edit','1');
  tb.style.cssText = 'display:none;position:fixed;z-index:99999;background:#1e1e2e;border:1px solid rgba(249,115,22,0.6);border-radius:10px;padding:6px 10px;gap:6px;align-items:center;box-shadow:0 4px 20px rgba(0,0,0,0.6);';
  tb.innerHTML =
    '<span style="color:rgba(255,255,255,0.5);font-size:11px;font-family:sans-serif;">Fonte</span>'
    +'<button data-no-edit="1" id="tb-minus" style="background:#333;color:white;border:none;border-radius:6px;width:26px;height:26px;font-size:14px;cursor:pointer;">−</button>'
    +'<span id="tb-size" style="color:white;font-size:12px;font-family:monospace;min-width:40px;text-align:center;">–</span>'
    +'<button data-no-edit="1" id="tb-plus" style="background:#333;color:white;border:none;border-radius:6px;width:26px;height:26px;font-size:14px;cursor:pointer;">+</button>'
    +'<div style="width:1px;height:18px;background:rgba(255,255,255,0.15);"></div>'
    +'<button data-no-edit="1" id="tb-bold" style="background:#333;color:white;border:none;border-radius:6px;width:26px;height:26px;font-size:13px;font-weight:900;cursor:pointer;">B</button>';
  document.body.appendChild(tb);
  var active = null;

  function getFs(el){ return parseInt(el.style.fontSize || window.getComputedStyle(el).fontSize) || 30; }
  function show(el){
    active = el;
    var r = el.getBoundingClientRect();
    tb.style.display = 'flex';
    var top = r.top - 40; if (top < 4) top = r.bottom + 4;
    tb.style.top = Math.max(4, top) + 'px';
    tb.style.left = Math.max(4, r.left) + 'px';
    document.getElementById('tb-size').textContent = getFs(el) + 'px';
    var fw = parseInt(el.style.fontWeight || window.getComputedStyle(el).fontWeight) || 400;
    document.getElementById('tb-bold').style.background = fw >= 700 ? 'rgba(249,115,22,0.7)' : '#333';
  }
  function hide(){ tb.style.display='none'; active=null; }

  document.getElementById('tb-minus').onclick = function(e){
    e.stopPropagation(); if (!active) return;
    var s = Math.max(10, getFs(active)-2); active.style.fontSize = s+'px';
    document.getElementById('tb-size').textContent = s+'px';
  };
  document.getElementById('tb-plus').onclick = function(e){
    e.stopPropagation(); if (!active) return;
    var s = getFs(active)+2; active.style.fontSize = s+'px';
    document.getElementById('tb-size').textContent = s+'px';
  };
  document.getElementById('tb-bold').onclick = function(e){
    e.stopPropagation(); if (!active) return;
    var fw = parseInt(active.style.fontWeight || window.getComputedStyle(active).fontWeight) || 400;
    active.style.fontWeight = fw >= 700 ? '400' : '900';
    document.getElementById('tb-bold').style.background = fw >= 700 ? '#333' : 'rgba(249,115,22,0.7)';
  };

  document.addEventListener('focusin', function(e){
    if (e.target && e.target.contentEditable === 'true') show(e.target);
  });
  document.addEventListener('click', function(e){
    if (e.target.closest('[data-no-edit="1"]')) return;
    if (!e.target.contentEditable || e.target.contentEditable !== 'true') hide();
  });
});
</script>
`;
