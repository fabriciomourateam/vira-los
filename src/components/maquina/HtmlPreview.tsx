/**
 * HtmlPreview.tsx — Etapa 5 (preview, edit, export).
 * Replica todas as features eficientes do CarrosselInstagram (Básico) na Máquina:
 *   - Preview em iframe isolado (mesmo padrão de renderização fiel)
 *   - Editar texto inline (contenteditable nos elementos do iframe)
 *   - Trocar imagem por busca Pexels inline
 *   - Baixar PNG por slide ou ZIP
 *   - Salvar no histórico
 */

import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft, Loader2, Download, Save, RefreshCw, Image as ImageIcon, Search, Edit3, Eye,
} from 'lucide-react';
import { generateAndSaveScreenshots } from '@/lib/clientScreenshots';
import { pexelsApi } from '@/lib/maquinaApi';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState({ done: 0, total: 0 });
  const [pexelsOpen, setPexelsOpen] = useState(false);
  const [pexelsQuery, setPexelsQuery] = useState('');
  const [pexelsResults, setPexelsResults] = useState<{ url: string; thumb: string }[]>([]);
  const [pexelsLoading, setPexelsLoading] = useState(false);
  const [targetSlide, setTargetSlide] = useState<number | null>(null);

  // ── Atualiza o iframe quando o HTML muda
  useEffect(() => {
    if (!iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();

    // Habilita contenteditable no modo edit
    if (mode === 'edit') {
      const win = iframeRef.current.contentWindow;
      const enableEdit = () => {
        const els = doc.querySelectorAll('h1, h2, h3, h4, p, span, .tag, .body, .headline, [class*="text"]');
        els.forEach((el) => {
          (el as HTMLElement).contentEditable = 'true';
          (el as HTMLElement).style.outline = '1px dashed rgba(249,115,22,0.5)';
          (el as HTMLElement).style.outlineOffset = '2px';
        });
        // Quando algum elemento perder foco, sincroniza o HTML de volta
        doc.addEventListener('blur', syncBack, true);
      };
      const syncBack = () => {
        const updated = '<!DOCTYPE html>' + doc.documentElement.outerHTML;
        onHtmlChange(updated);
      };
      // Espera o iframe carregar antes de habilitar
      if (doc.readyState === 'complete') enableEdit();
      else win?.addEventListener('load', enableEdit);
    }
  }, [html, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportProgress({ done: 0, total: 0 });
    try {
      const folderName = `maquina-${briefingTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${Date.now()}`;
      const screenshots = await generateAndSaveScreenshots(API, html, folderName, (done, total) => {
        setExportProgress({ done, total });
      });
      toast.success(`${screenshots.length} PNGs gerados`);

      // Disparar download de cada PNG
      const SERVER = API;
      screenshots.forEach((path) => {
        const a = document.createElement('a');
        a.href = `${SERVER}${path}`;
        a.download = path.split('/').pop() || 'slide.png';
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        a.remove();
      });
    } catch (e) {
      toast.error(`Erro no export: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const handlePexelsSearch = async () => {
    if (!pexelsQuery.trim()) return;
    setPexelsLoading(true);
    try {
      const data = await pexelsApi.search(pexelsQuery, 'portrait', 8);
      setPexelsResults(data.photos.map(p => ({ url: p.url, thumb: p.thumb })));
    } catch (e) {
      toast.error(`Pexels: ${(e as Error).message}`);
    } finally {
      setPexelsLoading(false);
    }
  };

  // Substitui a primeira ocorrência de img-box no slide alvo (ou em qualquer slide se targetSlide=null)
  const handlePexelsPick = (url: string) => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const slides = doc.querySelectorAll('.slide');
    const targets = targetSlide !== null && slides[targetSlide] ? [slides[targetSlide]] : Array.from(slides);
    let replaced = false;
    for (const slide of targets) {
      const imgBox = slide.querySelector('.img-box, [class*="bg"], .slide-bg') as HTMLElement | null;
      if (imgBox) {
        imgBox.style.backgroundImage = `url('${url}')`;
        replaced = true;
        break;
      }
      const img = slide.querySelector('img') as HTMLImageElement | null;
      if (img) {
        img.src = url;
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      toast.info('Não encontrei imagem nesse slide para substituir.');
      return;
    }
    const updated = '<!DOCTYPE html>' + doc.documentElement.outerHTML;
    onHtmlChange(updated);
    setPexelsOpen(false);
    setPexelsResults([]);
    setPexelsQuery('');
    toast.success('Imagem trocada');
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card p-3 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg bg-secondary hover:bg-border transition-colors"
            title="Voltar"
          >
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
            Trocar imagem (Pexels)
          </button>
          <button
            onClick={() => onSave(html)}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:bg-border disabled:opacity-50 text-xs font-bold transition-colors"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Salvar no histórico
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-bold transition-colors ml-auto"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {exporting
              ? `Exportando ${exportProgress.done}/${exportProgress.total || '...'}`
              : 'Exportar PNGs'}
          </button>
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
              <input
                type="number"
                min={1}
                max={12}
                placeholder="slide"
                value={targetSlide !== null ? targetSlide + 1 : ''}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setTargetSlide(Number.isNaN(v) ? null : v - 1);
                }}
                className="w-16 p-1.5 rounded bg-card border border-border text-xs focus:outline-none"
                title="Aplicar no slide N (vazio = primeiro com imagem)"
              />
              <button
                onClick={handlePexelsSearch}
                disabled={pexelsLoading}
                className="px-3 py-1.5 rounded bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-bold transition-colors"
              >
                {pexelsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Buscar'}
              </button>
            </div>
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

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <iframe
          ref={iframeRef}
          title="preview"
          className="w-full"
          style={{ height: '70vh', minHeight: 480, background: '#000' }}
        />
      </div>
    </div>
  );
}

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
