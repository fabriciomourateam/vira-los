/**
 * ReelsGerador.tsx
 * Subtab "Reels" dentro de Criar.
 * Gera roteiro de Reels (formato split-screen) a partir de um carrossel salvo,
 * com teleprompter de scroll automático.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Video, Sparkles, Loader2, Play, Pause, X, Trash2, Copy, Clock,
  ChevronDown, ChevronUp, Image as ImageIcon, FileText, Mic,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

type SavedCarousel = {
  id: string;
  topic: string;
  folderName?: string;
  numSlides?: number;
  screenshots?: string[];
  created_at?: string;
  archived?: boolean;
};

type ReelsSegment = {
  timestamp?: string;
  fala: string;
  legenda: string;
  imagem: string;
};

type SavedReel = {
  id: string;
  carouselId: string;
  carouselTopic: string;
  title: string;
  duration: number;
  hook: ReelsSegment;
  body: ReelsSegment[];
  cta: ReelsSegment;
  teleprompter: string;
  imagensSugeridas?: string[];
  legendaPost?: string;
  niche?: string;
  instagramHandle?: string;
  created_at?: string;
  archived?: boolean;
};

interface Props {
  initialCarouselId?: string | null;
  onConsumeInitialCarouselId?: () => void;
}

export default function ReelsGerador({ initialCarouselId, onConsumeInitialCarouselId }: Props) {
  const [carousels, setCarousels] = useState<SavedCarousel[]>([]);
  const [reels, setReels] = useState<SavedReel[]>([]);
  const [selectedCarouselId, setSelectedCarouselId] = useState<string>('');
  const [duration, setDuration] = useState(30);
  const [generating, setGenerating] = useState(false);
  const [generateStep, setGenerateStep] = useState('');
  const [activeReel, setActiveReel] = useState<SavedReel | null>(null);
  const [teleprompterOpen, setTeleprompterOpen] = useState(false);

  // ── Carrega listas ──────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    try {
      const [carRes, reelRes] = await Promise.all([
        fetch(`${API}/api/carousel/saved`).then(r => r.json()),
        fetch(`${API}/api/reels/saved`).then(r => r.json()),
      ]);
      setCarousels(Array.isArray(carRes) ? carRes.filter((c: SavedCarousel) => !c.archived) : []);
      setReels(Array.isArray(reelRes) ? reelRes.filter((r: SavedReel) => !r.archived) : []);
    } catch (err) {
      console.error('[Reels] fetch error', err);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── initialCarouselId: pré-seleciona quando vem do botão "Gerar Reels" do Básico ──
  useEffect(() => {
    if (initialCarouselId) {
      setSelectedCarouselId(initialCarouselId);
      onConsumeInitialCarouselId?.();
    }
  }, [initialCarouselId, onConsumeInitialCarouselId]);

  // ── Geração ─────────────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!selectedCarouselId) {
      toast.error('Selecione um carrossel base');
      return;
    }
    setGenerating(true);
    setGenerateStep('Iniciando...');
    try {
      const startRes = await fetch(`${API}/api/reels/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carouselId: selectedCarouselId, duration }),
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error || 'Erro ao iniciar geração');
      const { jobId } = startData;

      // Polling
      const POLL_MS = 3000;
      const MAX_TIME = 5 * 60_000;
      const t0 = Date.now();
      while (Date.now() - t0 < MAX_TIME) {
        await new Promise(r => setTimeout(r, POLL_MS));
        const jobRes = await fetch(`${API}/api/reels/jobs/${jobId}`);
        const job = await jobRes.json();
        if (job.status === 'error') throw new Error(job.error || 'Erro durante geração');
        if (job.status === 'done') {
          toast.success('Roteiro de Reels gerado!');
          await fetchAll();
          setActiveReel(job.result);
          setTeleprompterOpen(false);
          return;
        }
        if (job.step) setGenerateStep(job.step);
      }
      throw new Error('Timeout — geração demorou mais de 5min');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
      setGenerateStep('');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Excluir este reels?')) return;
    try {
      await fetch(`${API}/api/reels/saved/${id}`, { method: 'DELETE' });
      setReels(prev => prev.filter(r => r.id !== id));
      if (activeReel?.id === id) setActiveReel(null);
      toast.success('Reels excluído');
    } catch {
      toast.error('Erro ao excluir');
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <div className="text-center mb-2">
        <h2 className="text-xl sm:text-2xl font-extrabold flex items-center justify-center gap-2">
          <Video className="w-5 h-5 sm:w-6 sm:h-6 text-rose-500" />
          Gerador de Reels
        </h2>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Converte um carrossel salvo em roteiro de Reels split-screen + teleprompter.
        </p>
      </div>

      {/* Formulário */}
      <div className="rounded-2xl bg-card p-4 sm:p-5 space-y-4" style={{ boxShadow: 'var(--shadow-card)' }}>
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
            <FileText className="w-3.5 h-3.5" /> Carrossel base
          </label>
          <select
            value={selectedCarouselId}
            onChange={e => setSelectedCarouselId(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/50"
          >
            <option value="">— Selecione um carrossel —</option>
            {carousels.map(c => (
              <option key={c.id} value={c.id}>
                {c.topic?.substring(0, 80) || c.id} ({c.numSlides || '?'} slides)
              </option>
            ))}
          </select>
          {carousels.length === 0 && (
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Nenhum carrossel salvo ainda. Gere um na aba Básico primeiro.
            </p>
          )}
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
            <Clock className="w-3.5 h-3.5" /> Duração: <span className="text-rose-500 font-bold">{duration}s</span>
          </label>
          <input
            type="range"
            min={15}
            max={120}
            step={5}
            value={duration}
            onChange={e => setDuration(Number(e.target.value))}
            className="w-full accent-rose-500"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
            <span>15s</span><span>30s</span><span>60s</span><span>90s</span><span>120s</span>
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={generating || !selectedCarouselId}
          className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {generating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {generateStep || 'Gerando...'}
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Gerar Roteiro de Reels
            </>
          )}
        </button>
      </div>

      {/* Detalhes do reel ativo */}
      {activeReel && (
        <ReelCard
          reel={activeReel}
          onTeleprompter={() => setTeleprompterOpen(true)}
          onClose={() => setActiveReel(null)}
        />
      )}

      {/* Histórico */}
      {reels.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-2">
            Reels salvos ({reels.length})
          </h3>
          <div className="space-y-2">
            {reels.map(r => (
              <button
                key={r.id}
                onClick={() => { setActiveReel(r); setTeleprompterOpen(false); }}
                className={`w-full text-left p-3 rounded-xl bg-card hover:bg-secondary/50 transition-colors flex items-center gap-3 ${
                  activeReel?.id === r.id ? 'ring-2 ring-rose-500/50' : ''
                }`}
                style={{ boxShadow: 'var(--shadow-card)' }}
              >
                <div className="shrink-0 w-10 h-10 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-500">
                  <Video className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{r.title || r.carouselTopic || 'Sem título'}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {r.duration}s · {(r.body?.length || 0) + 2} segmentos · {r.carouselTopic}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}
                  className="shrink-0 p-2 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                  title="Excluir"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Teleprompter modal */}
      <AnimatePresence>
        {teleprompterOpen && activeReel && (
          <Teleprompter
            text={activeReel.teleprompter}
            title={activeReel.title}
            onClose={() => setTeleprompterOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Card de detalhes do reel ────────────────────────────────────────────────

function ReelCard({ reel, onTeleprompter, onClose }: {
  reel: SavedReel;
  onTeleprompter: () => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<'hook' | 'body' | 'cta' | 'caption' | null>('hook');

  function copy(text: string, label = 'Texto') {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  }

  return (
    <div className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: 'var(--shadow-card)' }}>
      <div className="p-4 border-b border-border flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold text-rose-500 uppercase tracking-wider">{reel.duration}s · Reels</p>
          <p className="text-base font-bold truncate">{reel.title}</p>
        </div>
        <button
          onClick={onTeleprompter}
          className="shrink-0 px-3 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs flex items-center gap-1.5"
        >
          <Mic className="w-3.5 h-3.5" />
          Teleprompter
        </button>
        <button
          onClick={onClose}
          className="shrink-0 p-2 rounded-lg text-muted-foreground hover:bg-secondary"
          title="Fechar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="divide-y divide-border">
        <Section
          label="HOOK (0-3s)"
          icon={<Sparkles className="w-3.5 h-3.5" />}
          open={expanded === 'hook'}
          onToggle={() => setExpanded(expanded === 'hook' ? null : 'hook')}
        >
          <SegmentRow segment={reel.hook} copy={copy} />
        </Section>

        <Section
          label={`BODY (${reel.body?.length || 0} segmentos)`}
          icon={<FileText className="w-3.5 h-3.5" />}
          open={expanded === 'body'}
          onToggle={() => setExpanded(expanded === 'body' ? null : 'body')}
        >
          <div className="space-y-3">
            {reel.body?.map((seg, i) => (
              <div key={i} className="rounded-lg bg-secondary/30 p-3">
                {seg.timestamp && <p className="text-[10px] font-semibold text-rose-500 mb-1">{seg.timestamp}</p>}
                <SegmentRow segment={seg} copy={copy} />
              </div>
            ))}
          </div>
        </Section>

        <Section
          label="CTA (final)"
          icon={<Video className="w-3.5 h-3.5" />}
          open={expanded === 'cta'}
          onToggle={() => setExpanded(expanded === 'cta' ? null : 'cta')}
        >
          <SegmentRow segment={reel.cta} copy={copy} />
        </Section>

        {reel.legendaPost && (
          <Section
            label="LEGENDA DO POST"
            icon={<FileText className="w-3.5 h-3.5" />}
            open={expanded === 'caption'}
            onToggle={() => setExpanded(expanded === 'caption' ? null : 'caption')}
          >
            <div className="flex items-start gap-2">
              <pre className="text-xs whitespace-pre-wrap break-words flex-1 font-sans text-foreground">{reel.legendaPost}</pre>
              <button
                onClick={() => copy(reel.legendaPost || '', 'Legenda')}
                className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                title="Copiar legenda"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
            {reel.imagensSugeridas && reel.imagensSugeridas.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <ImageIcon className="w-3 h-3" /> Imagens sugeridas para a metade de baixo
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {reel.imagensSugeridas.map((q, i) => (
                    <span key={i} className="text-[11px] px-2 py-1 rounded-full bg-secondary text-muted-foreground">
                      {q}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ label, icon, open, onToggle, children }: {
  label: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-secondary/30 transition-colors"
      >
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          {icon} {label}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function SegmentRow({ segment, copy }: { segment: ReelsSegment; copy: (text: string, label?: string) => void }) {
  if (!segment) return null;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-start gap-2">
        <span className="text-[10px] font-bold text-rose-500 mt-0.5 shrink-0 w-14">FALA</span>
        <span className="flex-1 text-foreground">{segment.fala}</span>
        <button
          onClick={() => copy(segment.fala, 'Fala')}
          className="shrink-0 p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
          title="Copiar fala"
        >
          <Copy className="w-3 h-3" />
        </button>
      </div>
      <div className="flex items-start gap-2">
        <span className="text-[10px] font-bold text-rose-500 mt-0.5 shrink-0 w-14">TELA</span>
        <span className="flex-1 text-muted-foreground italic">"{segment.legenda}"</span>
      </div>
      <div className="flex items-start gap-2">
        <span className="text-[10px] font-bold text-rose-500 mt-0.5 shrink-0 w-14">IMAGEM</span>
        <span className="flex-1 text-muted-foreground text-xs">{segment.imagem}</span>
      </div>
    </div>
  );
}

// ─── Teleprompter ────────────────────────────────────────────────────────────

function Teleprompter({ text, title, onClose }: { text: string; title: string; onClose: () => void }) {
  const [speed, setSpeed] = useState(30);  // pixels per second
  const [fontSize, setFontSize] = useState(56);
  const [running, setRunning] = useState(false);
  const [position, setPosition] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Animação de scroll
  useEffect(() => {
    if (!running) return;
    let rafId: number;
    let lastT = performance.now();
    const step = (now: number) => {
      const dt = (now - lastT) / 1000;
      lastT = now;
      setPosition(p => {
        const max = (contentRef.current?.scrollHeight || 0) - (containerRef.current?.clientHeight || 0) / 2 + 200;
        const next = p + speed * dt;
        if (next >= max) { setRunning(false); return max; }
        return next;
      });
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [running, speed]);

  function restart() {
    setPosition(0);
    setRunning(true);
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black flex flex-col"
    >
      {/* Header */}
      <div className="shrink-0 px-4 py-3 flex items-center justify-between border-b border-white/10">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-rose-400 uppercase tracking-wider font-bold">Teleprompter</p>
          <p className="text-sm text-white truncate">{title}</p>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg text-white/70 hover:bg-white/10" title="Fechar">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Texto rolante */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden relative"
        style={{ background: 'radial-gradient(ellipse at center, rgba(244,63,94,0.05) 0%, transparent 70%)' }}
      >
        <div
          ref={contentRef}
          style={{
            transform: `translateY(calc(50vh - ${position}px))`,
            fontSize: `${fontSize}px`,
            lineHeight: 1.4,
            padding: '0 6vw',
          }}
          className="text-white font-bold text-center transition-none"
        >
          {text.split('\n').map((line, i) => (
            <p key={i} className="mb-8">{line}</p>
          ))}
        </div>

        {/* Linha guia central */}
        <div className="pointer-events-none absolute left-0 right-0 top-1/2 h-px bg-rose-500/40 -translate-y-1/2" />
      </div>

      {/* Controles */}
      <div className="shrink-0 px-4 py-3 border-t border-white/10 space-y-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setRunning(r => !r)}
            className="shrink-0 w-12 h-12 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center"
            title={running ? 'Pausar' : 'Play'}
          >
            {running ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 translate-x-0.5" />}
          </button>
          <button
            onClick={restart}
            className="shrink-0 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold"
          >
            Reiniciar
          </button>
          <div className="flex-1 text-right text-[11px] text-white/50">
            Posição: {Math.round(position)}px
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-[11px] text-white/70 mb-1">
            <span>Velocidade</span>
            <span className="font-bold">{speed}px/s</span>
          </div>
          <input
            type="range" min={10} max={120} step={5}
            value={speed} onChange={e => setSpeed(Number(e.target.value))}
            className="w-full accent-rose-500"
          />
        </div>

        <div>
          <div className="flex items-center justify-between text-[11px] text-white/70 mb-1">
            <span>Tamanho da fonte</span>
            <span className="font-bold">{fontSize}px</span>
          </div>
          <input
            type="range" min={32} max={96} step={4}
            value={fontSize} onChange={e => setFontSize(Number(e.target.value))}
            className="w-full accent-rose-500"
          />
        </div>
      </div>
    </motion.div>
  );
}
