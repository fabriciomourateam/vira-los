import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Link2, Play, CheckCircle2, XCircle, Loader2, Copy, Check,
  Mic, Eye, Layers, Video, ChevronDown, ChevronUp, AlertTriangle,
  Zap, FileText, Tv2,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface AnalyzerStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
  detail?: string;
}

interface ReelInfo {
  caption: string;
  owner: string;
  likes: number;
  views: number;
  thumbnailUrl: string | null;
  url: string;
}

interface AnalyzerResult {
  reelInfo: ReelInfo;
  transcription: string | null;
  visualAnalysis: string;
  carouselScript: string;
  reelsScript: string;
  hasAudio: boolean;
  hasFrames: boolean;
}

interface AnalyzerState {
  running: boolean;
  steps: AnalyzerStep[];
  result: AnalyzerResult | null;
  error: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtNumber(n: number | string): string {
  const num = typeof n === 'string' ? parseInt(n, 10) : n;
  if (isNaN(num) || num === 0) return '—';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

const STEP_ICONS: Record<string, React.ComponentType<any>> = {
  fetch:     Instagram,
  download:  Eye,
  transcribe: Mic,
  vision:    Eye,
  carousel:  Layers,
  reels:     Video,
};

// ─── Sub-componente: Bloco de resultado com botão de cópia ────────────────────

function ResultBlock({
  title,
  icon: Icon,
  content,
  accent = 'text-foreground',
  defaultOpen = false,
}: {
  title: string;
  icon: React.ComponentType<any>;
  content: string;
  accent?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success('Copiado!', { duration: 1500 });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Falha ao copiar.');
    }
  }

  return (
    <div className="rounded-2xl bg-card border border-border overflow-hidden" style={{ boxShadow: 'var(--shadow-card)' }}>
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 hover:bg-secondary/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <Icon size={16} className={accent} />
          <span className="font-bold text-sm">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            role="button"
            tabIndex={0}
            onClick={e => { e.stopPropagation(); handleCopy(); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); handleCopy(); } }}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title="Copiar conteúdo"
          >
            {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
          </span>
          {open ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
        </div>
      </button>

      {/* Content */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
          >
            <div className="px-4 pb-4 border-t border-border pt-3">
              <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans text-foreground/90 max-h-[500px] overflow-y-auto">
                {content}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Sub-componente: Step indicator ──────────────────────────────────────────

function StepItem({ step }: { step: AnalyzerStep }) {
  const Icon = STEP_ICONS[step.id] || Zap;
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-0.5 shrink-0">
        {step.status === 'done'    && <CheckCircle2 size={16} className="text-emerald-500" />}
        {step.status === 'error'   && <XCircle      size={16} className="text-red-500" />}
        {step.status === 'running' && <Loader2      size={16} className="text-blue-500 animate-spin" />}
        {step.status === 'pending' && <div className="w-4 h-4 rounded-full border-2 border-border" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${step.status === 'pending' ? 'text-muted-foreground' : 'text-foreground'}`}>
          {step.label}
        </p>
        {step.detail && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{step.detail}</p>
        )}
      </div>
    </div>
  );
}

// ─── Componente principal ──────────────────────────────────────────────────────

export default function AnalisadorReels() {
  const [url, setUrl]         = useState('');
  const [running, setRunning] = useState(false);
  const [steps, setSteps]     = useState<AnalyzerStep[]>([]);
  const [result, setResult]   = useState<AnalyzerResult | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [activeResultTab, setActiveResultTab] = useState<'transcricao' | 'visual' | 'carrossel' | 'reels'>('carrossel');

  const eventSourceRef = useRef<EventSource | null>(null);
  const stepsEndRef    = useRef<HTMLDivElement | null>(null);

  // Verifica status ao montar (caso análise esteja em andamento)
  useEffect(() => {
    fetch(`${API}/api/reels-analyzer/status`)
      .then(r => r.json())
      .then((state: AnalyzerState) => {
        if (state.steps?.length) setSteps(state.steps);
        if (state.result)        setResult(state.result);
        if (state.running) {
          setRunning(true);
          connectSSE();
        }
      })
      .catch(() => {});
  }, []);

  // Scroll automático nos steps
  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [steps]);

  function connectSSE() {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`${API}/api/reels-analyzer/stream`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      if (!e.data || e.data.trim() === '') return;
      try {
        const event = JSON.parse(e.data);

        if (event.type === 'state') {
          const state: AnalyzerState = event.state;
          if (state.steps?.length) setSteps(state.steps);
          if (state.result)        setResult(state.result);
          setRunning(state.running);
        }

        if (event.type === 'step') {
          setSteps(prev => {
            const idx = prev.findIndex(s => s.id === event.step.id);
            if (idx === -1) return [...prev, event.step];
            const next = [...prev];
            next[idx] = event.step;
            return next;
          });
        }

        if (event.type === 'done') {
          setResult(event.result);
          setRunning(false);
          toast.success('Análise concluída!');
          es.close();
          eventSourceRef.current = null;
        }

        if (event.type === 'error') {
          setError(event.message);
          setRunning(false);
          toast.error(`Erro: ${event.message}`);
          es.close();
          eventSourceRef.current = null;
        }
      } catch { /* ignora linhas de heartbeat */ }
    };

    es.onerror = () => {
      if (running) {
        toast.error('Conexão com o servidor perdida.');
      }
      es.close();
      eventSourceRef.current = null;
      setRunning(false);
    };
  }

  async function handleStart() {
    if (!url.trim()) {
      toast.error('Cole a URL do vídeo antes de analisar.');
      return;
    }

    setError(null);
    setResult(null);
    setSteps([]);

    try {
      const response = await fetch(`${API}/api/reels-analyzer/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Erro ao iniciar análise.');
        toast.error(data.error || 'Erro ao iniciar análise.');
        return;
      }

      setRunning(true);
      connectSSE();
    } catch (e: any) {
      const msg = e.message || 'Erro de conexão com o servidor.';
      setError(msg);
      toast.error(msg);
    }
  }

  function handleReset() {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setRunning(false);
    setSteps([]);
    setResult(null);
    setError(null);
  }

  const resultTabs: { id: typeof activeResultTab; label: string; icon: React.ComponentType<any> }[] = [
    { id: 'carrossel',   label: 'Script Carrossel',   icon: Layers },
    { id: 'reels',       label: 'Roteiro Reels',      icon: Video },
    { id: 'visual',      label: 'Análise Visual',     icon: Eye },
    { id: 'transcricao', label: 'Transcrição',        icon: Mic },
  ];

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <section>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-2">
          Analisador de Vídeos
        </h1>
        <p className="text-muted-foreground text-xs sm:text-sm">
          Cole o link de um Reel do Instagram ou vídeo do TikTok → transcrição + análise visual + script de carrossel + roteiro pronto para gravar
        </p>
      </section>

      {/* Input Card */}
      <div className="rounded-2xl bg-card border border-border p-5 space-y-4" style={{ boxShadow: 'var(--shadow-card)' }}>
        <div className="flex items-center gap-2 mb-1">
          <Link2 size={16} className="text-orange-500" />
          <span className="font-bold text-sm uppercase tracking-wider">URL do vídeo</span>
        </div>

        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !running) handleStart(); }}
            placeholder="Instagram Reel ou TikTok — cole a URL aqui"
            disabled={running}
            className="flex-1 bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50 placeholder:text-muted-foreground"
          />
          <button
            onClick={handleStart}
            disabled={running || !url.trim()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-foreground text-background text-sm font-bold disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0"
          >
            {running
              ? <><Loader2 size={15} className="animate-spin" /> Analisando...</>
              : <><Play size={15} /> Analisar</>
            }
          </button>
        </div>

        {/* Nota sobre recursos */}
        <div className="text-xs text-muted-foreground flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 shrink-0 text-orange-400" />
          <span>
            Requer <code className="bg-secondary px-1 rounded">APIFY_API_KEY</code> no servidor.
            Transcrição de áudio requer <code className="bg-secondary px-1 rounded">OPENAI_API_KEY</code> + ffmpeg.
          </span>
        </div>
      </div>

      {/* Steps */}
      <AnimatePresence>
        {steps.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-2xl bg-card border border-border p-5"
            style={{ boxShadow: 'var(--shadow-card)' }}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-sm uppercase tracking-wider text-muted-foreground">
                Progresso
              </h2>
              {!running && (result || error) && (
                <button
                  onClick={handleReset}
                  className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
                >
                  Nova análise
                </button>
              )}
            </div>
            <div className="divide-y divide-border">
              {steps.map(step => <StepItem key={step.id} step={step} />)}
            </div>
            <div ref={stepsEndRef} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-4 flex items-start gap-3"
          >
            <XCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm text-red-700 dark:text-red-400">Erro na análise</p>
              <p className="text-sm text-red-600 dark:text-red-300 mt-0.5">{error}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-4"
          >
            {/* Reel Info Card */}
            <div className="rounded-2xl bg-card border border-border p-4" style={{ boxShadow: 'var(--shadow-card)' }}>
              <div className="flex gap-4 items-start">
                {result.reelInfo.thumbnailUrl && (
                  <img
                    src={result.reelInfo.thumbnailUrl}
                    alt="Thumbnail do Reel"
                    className="w-16 h-16 rounded-xl object-cover shrink-0 border border-border"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {result.reelInfo.platform === 'tiktok'
                      ? <Tv2 size={14} className="text-foreground" />
                      : <Zap size={14} className="text-pink-500" />
                    }
                    <span className="font-bold text-sm">
                      {result.reelInfo.owner ? `@${result.reelInfo.owner}` : 'Vídeo analisado'}
                    </span>
                    <div className="flex items-center gap-1 ml-auto">
                      {result.hasAudio && (
                        <span className="text-xs bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full font-medium">
                          Áudio transcrito
                        </span>
                      )}
                      {result.hasFrames && (
                        <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full font-medium">
                          Frames extraídos
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground mb-2">
                    <span><strong className="text-foreground">{fmtNumber(result.reelInfo.likes)}</strong> curtidas</span>
                    <span><strong className="text-foreground">{fmtNumber(result.reelInfo.views)}</strong> views</span>
                  </div>
                  {result.reelInfo.caption && (
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {result.reelInfo.caption}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Result Tabs */}
            <div className="rounded-2xl bg-card border border-border overflow-hidden" style={{ boxShadow: 'var(--shadow-card)' }}>
              {/* Tab bar */}
              <div className="flex border-b border-border overflow-x-auto">
                {resultTabs.map(tab => {
                  const Icon = tab.icon;
                  const isActive = activeResultTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveResultTab(tab.id)}
                      className={`flex items-center gap-1.5 px-3 py-3 text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-all border-b-2 ${
                        isActive
                          ? 'border-foreground text-foreground'
                          : 'border-transparent text-muted-foreground hover:text-foreground/70'
                      }`}
                    >
                      <Icon size={13} />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* Tab content */}
              <div className="p-4">
                {activeResultTab === 'transcricao' && (
                  <div>
                    {result.transcription ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            Transcrição do Áudio
                          </p>
                          <CopyButton text={result.transcription} />
                        </div>
                        <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans text-foreground/90 bg-secondary/50 rounded-xl p-3 max-h-[400px] overflow-y-auto">
                          {result.transcription}
                        </pre>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <Mic size={32} className="mx-auto mb-2 opacity-30" />
                        <p className="text-sm font-medium">Transcrição não disponível</p>
                        <p className="text-xs mt-1">
                          Configure <code className="bg-secondary px-1 rounded">OPENAI_API_KEY</code> e instale ffmpeg para transcrição de áudio.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {activeResultTab === 'visual' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Análise Visual (Claude AI)
                      </p>
                      <CopyButton text={result.visualAnalysis} />
                    </div>
                    <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans text-foreground/90 bg-secondary/50 rounded-xl p-3 max-h-[400px] overflow-y-auto">
                      {result.visualAnalysis}
                    </pre>
                  </div>
                )}

                {activeResultTab === 'carrossel' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Script de Carrossel — Meio de Funil Viral
                      </p>
                      <CopyButton text={result.carouselScript} />
                    </div>
                    <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans text-foreground/90 bg-secondary/50 rounded-xl p-3 max-h-[600px] overflow-y-auto">
                      {result.carouselScript}
                    </pre>
                  </div>
                )}

                {activeResultTab === 'reels' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Roteiro de Reels — Meio de Funil Viral
                      </p>
                      <CopyButton text={result.reelsScript} />
                    </div>
                    <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans text-foreground/90 bg-secondary/50 rounded-xl p-3 max-h-[600px] overflow-y-auto">
                      {result.reelsScript}
                    </pre>
                  </div>
                )}
              </div>
            </div>

            {/* Quick copy cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ResultBlock
                title="Script Carrossel Completo"
                icon={Layers}
                content={result.carouselScript}
                accent="text-orange-500"
                defaultOpen={false}
              />
              <ResultBlock
                title="Roteiro Reels Completo"
                icon={Video}
                content={result.reelsScript}
                accent="text-blue-500"
                defaultOpen={false}
              />
            </div>

            {/* Use in Roteiro hint */}
            <div className="rounded-2xl bg-foreground text-background p-4 flex items-start gap-3">
              <FileText size={16} className="shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-bold mb-1">Use no seu Roteiro</p>
                <p className="opacity-75 text-xs leading-relaxed">
                  Copie o roteiro de Reels e cole na aba <strong>Roteiro</strong> em "Roteiro Final A" ou "B" para usar o teleprompter e gravar. O script de carrossel vai direto para a aba <strong>Carrossel</strong>.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Mini botão de cópia ──────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Copiado!', { duration: 1500 });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Falha ao copiar.');
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-lg hover:bg-secondary"
    >
      {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
      {copied ? 'Copiado' : 'Copiar'}
    </button>
  );
}
