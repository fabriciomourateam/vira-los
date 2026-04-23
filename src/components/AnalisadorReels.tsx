import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Link2, Play, CheckCircle2, XCircle, Loader2, Copy, Check,
  Mic, Eye, Layers, Video, ChevronDown, ChevronUp, AlertTriangle,
  Zap, FileText, Tv2, Sparkles, BookMarked, Gauge,
  BookmarkPlus, Save, Trash2, Tv,
} from 'lucide-react';
import { TeleprompterOverlay, TeleprompterState, initialTeleprompterState } from './Teleprompter';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface StoryItem {
  numero: number;
  tipo: string;
  duracao_seg: number;
  fundo: string;
  texto_principal: string;
  texto_secundario: string;
  sticker: { tipo: string; pergunta_ou_label: string; opcoes: string[] };
  emoji_sugerido: string;
  dica_visual: string;
  copy_legenda: string;
}

interface StoryResult {
  stories: StoryItem[];
  sequencia_resumo: string;
  hashtags: string[];
  melhor_horario_postar: string;
}

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

interface SavedScript {
  id: string;
  title: string;
  script: string;
  created_at: string;
  updated_at?: string;
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
  fetch:     Link2,
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

interface AnalisadorReelsProps {
  onUseInCarrossel?: (script: string, topic: string) => void;
  onEvaluate?: (script: string, type: 'carousel' | 'reels') => void;
}

export default function AnalisadorReels({ onUseInCarrossel, onEvaluate }: AnalisadorReelsProps = {}) {
  const [url, setUrl]         = useState('');
  const [running, setRunning] = useState(false);
  const [steps, setSteps]     = useState<AnalyzerStep[]>([]);
  const [result, setResult]   = useState<AnalyzerResult | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [activeResultTab, setActiveResultTab] = useState<'transcricao' | 'visual' | 'carrossel' | 'reels' | 'stories'>('carrossel');
  const [storyResult, setStoryResult]     = useState<StoryResult | null>(null);
  const [storyLoading, setStoryLoading]   = useState(false);
  const [storyError, setStoryError]       = useState<string | null>(null);
  const [instagramHandle, setInstagramHandle] = useState('');

  // ─── Banco de roteiros ──────────────────────────────────────────────────────
  const [savedScripts, setSavedScripts] = useState<SavedScript[]>([]);
  const [expandedScriptId, setExpandedScriptId] = useState<string | null>(null);
  const [scriptDrafts, setScriptDrafts] = useState<Record<string, { title: string; script: string }>>({});
  const [savingScript, setSavingScript] = useState(false);
  const [teleprompter, setTeleprompter] = useState<TeleprompterState>(initialTeleprompterState);
  const [teleprompterText, setTeleprompterText] = useState('');

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

    // Carrega banco de roteiros
    reloadScripts();
  }, []);

  async function reloadScripts() {
    try {
      const r = await fetch(`${API}/api/reels-analyzer/scripts`);
      const data = await r.json();
      setSavedScripts(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('[ReelsScripts] reload', e);
    }
  }

  async function saveCurrentReelScript() {
    if (!result?.reelsScript?.trim()) {
      toast.error('Nenhum roteiro de Reels disponível');
      return;
    }
    const defaultTitle = result.reelInfo?.caption?.slice(0, 60) || `Roteiro ${new Date().toLocaleDateString('pt-BR')}`;
    const title = window.prompt('Título do roteiro:', defaultTitle);
    if (!title) return;
    setSavingScript(true);
    try {
      const r = await fetch(`${API}/api/reels-analyzer/scripts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), script: result.reelsScript }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await reloadScripts();
      toast.success('Roteiro salvo no banco!');
    } catch (e: any) {
      toast.error(`Falha ao salvar: ${e.message || e}`);
    } finally {
      setSavingScript(false);
    }
  }

  function toggleScriptExpanded(s: SavedScript) {
    if (expandedScriptId === s.id) {
      setExpandedScriptId(null);
      return;
    }
    setExpandedScriptId(s.id);
    setScriptDrafts(prev => ({ ...prev, [s.id]: { title: s.title, script: s.script } }));
  }

  async function persistScriptEdit(id: string) {
    const draft = scriptDrafts[id];
    if (!draft) return;
    try {
      const r = await fetch(`${API}/api/reels-analyzer/scripts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await reloadScripts();
      toast.success('Roteiro atualizado');
    } catch (e: any) {
      toast.error(`Falha ao atualizar: ${e.message || e}`);
    }
  }

  async function removeScript(id: string) {
    if (!window.confirm('Excluir este roteiro?')) return;
    try {
      const r = await fetch(`${API}/api/reels-analyzer/scripts/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (expandedScriptId === id) setExpandedScriptId(null);
      await reloadScripts();
      toast.success('Roteiro excluído');
    } catch (e: any) {
      toast.error(`Falha ao excluir: ${e.message || e}`);
    }
  }

  function openTeleprompter(title: string, text: string) {
    if (!text.trim()) {
      toast.error('Roteiro vazio');
      return;
    }
    setTeleprompterText(text);
    setTeleprompter(prev => ({ ...prev, open: true, title, playing: false }));
  }

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
    setStoryResult(null);
    setStoryError(null);

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
    setStoryResult(null);
    setStoryError(null);
  }

  async function handleGenerateStories() {
    if (!result?.carouselScript) return;
    setStoryLoading(true);
    setStoryError(null);
    try {
      const res = await fetch(`${API}/api/story-sequence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carouselScript: result.carouselScript, instagramHandle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao gerar stories.');
      setStoryResult(data);
      toast.success('Sequência de stories gerada!');
    } catch (e: any) {
      setStoryError(e.message);
      toast.error(e.message);
    } finally {
      setStoryLoading(false);
    }
  }

  const resultTabs: { id: typeof activeResultTab; label: string; icon: React.ComponentType<any> }[] = [
    { id: 'carrossel',   label: 'Carrossel',   icon: Layers },
    { id: 'reels',       label: 'Reels',       icon: Video },
    { id: 'stories',     label: 'Stories',     icon: BookMarked },
    { id: 'visual',      label: 'Visual',      icon: Eye },
    { id: 'transcricao', label: 'Transcrição', icon: Mic },
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
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        {onUseInCarrossel && (
                          <button
                            onClick={() => onUseInCarrossel(
                              result.carouselScript,
                              result.reelInfo.owner || result.reelInfo.caption?.slice(0, 40) || 'viral'
                            )}
                            className="flex items-center gap-1.5 text-xs bg-purple-600 hover:bg-purple-500 text-white font-bold px-3 py-1.5 rounded-lg transition-colors"
                          >
                            <Sparkles size={12} />
                            Carrossel Visual
                          </button>
                        )}
                        {onEvaluate && (
                          <button
                            onClick={() => onEvaluate(result.carouselScript, 'carousel')}
                            className="flex items-center gap-1.5 text-xs bg-yellow-600 hover:bg-yellow-500 text-white font-bold px-3 py-1.5 rounded-lg transition-colors"
                          >
                            <Gauge size={12} />
                            Avaliar Score
                          </button>
                        )}
                        <CopyButton text={result.carouselScript} />
                      </div>
                    </div>
                    <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans text-foreground/90 bg-secondary/50 rounded-xl p-3 max-h-[600px] overflow-y-auto">
                      {result.carouselScript}
                    </pre>
                  </div>
                )}

                {activeResultTab === 'reels' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Roteiro de Reels — Meio de Funil Viral
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={saveCurrentReelScript}
                          disabled={savingScript}
                          className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {savingScript ? <Loader2 size={12} className="animate-spin" /> : <BookmarkPlus size={12} />}
                          Salvar no banco
                        </button>
                        <button
                          onClick={() => openTeleprompter(result.reelInfo?.caption?.slice(0, 60) || 'Roteiro Reels', result.reelsScript)}
                          className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-1.5 rounded-lg transition-colors"
                        >
                          <Tv size={12} />
                          Teleprompter
                        </button>
                        {onEvaluate && (
                          <button
                            onClick={() => onEvaluate(result.reelsScript, 'reels')}
                            className="flex items-center gap-1.5 text-xs bg-yellow-600 hover:bg-yellow-500 text-white font-bold px-3 py-1.5 rounded-lg transition-colors"
                          >
                            <Gauge size={12} />
                            Avaliar Score
                          </button>
                        )}
                        <CopyButton text={result.reelsScript} />
                      </div>
                    </div>
                    <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans text-foreground/90 bg-secondary/50 rounded-xl p-3 max-h-[600px] overflow-y-auto">
                      {result.reelsScript}
                    </pre>
                  </div>
                )}

                {activeResultTab === 'stories' && (
                  <div className="space-y-4">
                    {!storyResult && !storyLoading && (
                      <div className="space-y-3">
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Gera 5 stories sequenciais para divulgar o carrossel — cada um com texto, sticker interativo e instrução visual.
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={instagramHandle}
                            onChange={e => setInstagramHandle(e.target.value)}
                            placeholder="@seucanal (opcional)"
                            className="flex-1 bg-secondary border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 placeholder:text-muted-foreground"
                          />
                          <button
                            onClick={handleGenerateStories}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-foreground text-background text-sm font-bold hover:opacity-90 transition-opacity shrink-0"
                          >
                            <BookMarked size={14} /> Gerar Stories
                          </button>
                        </div>
                      </div>
                    )}

                    {storyLoading && (
                      <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                        <Loader2 size={18} className="animate-spin" />
                        <span className="text-sm">Gerando sequência de stories...</span>
                      </div>
                    )}

                    {storyError && (
                      <div className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-xl p-3">
                        {storyError}
                      </div>
                    )}

                    {storyResult && (
                      <div className="space-y-4">
                        {/* Resumo e metadados */}
                        <div className="bg-secondary/50 rounded-xl p-3 space-y-1">
                          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Narrativa da sequência</p>
                          <p className="text-sm leading-relaxed">{storyResult.sequencia_resumo}</p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                            <span>⏰ {storyResult.melhor_horario_postar}</span>
                            <span>{storyResult.hashtags?.join(' ')}</span>
                          </div>
                        </div>

                        {/* Cards dos 5 stories — scroll horizontal no mobile */}
                        <div className="space-y-3">
                          {storyResult.stories?.map(story => (
                            <div key={story.numero} className="rounded-xl border border-border bg-card overflow-hidden">
                              <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-secondary/30">
                                <span className="w-6 h-6 rounded-full bg-foreground text-background text-xs font-black flex items-center justify-center shrink-0">
                                  {story.numero}
                                </span>
                                <span className="text-xs font-bold uppercase tracking-wider capitalize">{story.tipo}</span>
                                <span className="text-xs text-muted-foreground ml-auto">{story.duracao_seg}s</span>
                              </div>
                              <div className="p-4 space-y-3">
                                {/* Preview visual */}
                                <div className="rounded-xl bg-secondary/60 p-4 text-center space-y-1 border border-border/50">
                                  <p className="text-xs text-muted-foreground">{story.fundo}</p>
                                  <p className="text-lg font-black tracking-tight leading-tight">{story.texto_principal}</p>
                                  {story.emoji_sugerido && <p className="text-2xl">{story.emoji_sugerido}</p>}
                                  <p className="text-sm text-muted-foreground">{story.texto_secundario}</p>
                                  {story.sticker?.tipo !== 'nenhum' && (
                                    <div className="inline-block mt-2 bg-foreground/10 border border-border rounded-full px-3 py-1 text-xs font-medium">
                                      {story.sticker.tipo === 'enquete'
                                        ? `${story.sticker.pergunta_ou_label} · ${story.sticker.opcoes?.join(' / ')}`
                                        : story.sticker.pergunta_ou_label
                                      }
                                    </div>
                                  )}
                                </div>
                                {/* Legenda + dica */}
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-xs text-muted-foreground italic flex-1 truncate">"{story.copy_legenda}"</p>
                                  <CopyButton text={story.copy_legenda} />
                                </div>
                                {story.dica_visual && (
                                  <p className="text-xs text-muted-foreground border-l-2 border-orange-500/50 pl-2">{story.dica_visual}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>

                        <button
                          onClick={() => { setStoryResult(null); setStoryError(null); }}
                          className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
                        >
                          Gerar nova sequência
                        </button>
                      </div>
                    )}
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

            {/* Próximos passos */}
            <div className="rounded-2xl bg-foreground text-background p-4 flex items-start gap-3">
              <FileText size={16} className="shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-bold mb-1">Próximos passos</p>
                <ul className="opacity-75 text-xs leading-relaxed space-y-1">
                  <li>→ <strong>Carrossel Visual</strong>: gera o carrossel na aba Carrossel com o script pronto</li>
                  <li>→ <strong>Avaliar Score</strong>: pontua o script em 5 critérios e sugere melhorias</li>
                  <li>→ <strong>Stories</strong>: cria 5 stories sequenciais para divulgar o carrossel</li>
                  <li>→ Cole o roteiro de Reels na aba <strong>Roteiro</strong> em "Roteiro Final A" para gravar</li>
                </ul>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Banco de Roteiros ──────────────────────────────────────────── */}
      <section className="rounded-2xl bg-card border border-border p-5 space-y-3" style={{ boxShadow: 'var(--shadow-card)' }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BookMarked size={16} className="text-emerald-500" />
            <h2 className="font-bold text-sm uppercase tracking-wider">Banco de Roteiros</h2>
            <span className="text-xs text-muted-foreground">({savedScripts.length})</span>
          </div>
          <p className="text-xs text-muted-foreground hidden sm:block">
            Salve roteiros pra gravar depois. Clique num card pra editar ou abrir no teleprompter.
          </p>
        </div>

        {savedScripts.length === 0 && (
          <p className="text-xs text-muted-foreground py-3 text-center">
            Nenhum roteiro salvo. Gere uma análise e clique em "Salvar no banco" no Roteiro Reels.
          </p>
        )}

        <div className="space-y-2">
          {savedScripts.map(s => {
            const isOpen = expandedScriptId === s.id;
            const draft = scriptDrafts[s.id] || { title: s.title, script: s.script };
            return (
              <div key={s.id} className="rounded-xl border border-border bg-secondary/30 overflow-hidden">
                <button
                  onClick={() => toggleScriptExpanded(s)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-secondary/50 transition-colors"
                >
                  {isOpen ? <ChevronUp size={14} className="text-muted-foreground shrink-0" /> : <ChevronDown size={14} className="text-muted-foreground shrink-0" />}
                  <span className="font-semibold text-sm truncate flex-1">{s.title}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(s.updated_at || s.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-3 pb-3 pt-2 space-y-2 border-t border-border">
                        <input
                          type="text"
                          value={draft.title}
                          onChange={e => setScriptDrafts(prev => ({ ...prev, [s.id]: { ...draft, title: e.target.value } }))}
                          className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-foreground/20"
                          placeholder="Título"
                        />
                        <textarea
                          value={draft.script}
                          onChange={e => setScriptDrafts(prev => ({ ...prev, [s.id]: { ...draft, script: e.target.value } }))}
                          rows={10}
                          className="w-full bg-background border border-border rounded-lg px-2.5 py-2 text-sm font-sans leading-relaxed focus:outline-none focus:ring-2 focus:ring-foreground/20 resize-y"
                          placeholder="Roteiro"
                        />
                        <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              onClick={() => persistScriptEdit(s.id)}
                              disabled={draft.title === s.title && draft.script === s.script}
                              className="flex items-center gap-1.5 text-xs bg-foreground text-background font-bold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-90 disabled:opacity-40"
                            >
                              <Save size={12} />
                              Salvar
                            </button>
                            <button
                              onClick={() => openTeleprompter(draft.title, draft.script)}
                              className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-1.5 rounded-lg transition-colors"
                            >
                              <Tv size={12} />
                              Teleprompter
                            </button>
                            <CopyButton text={draft.script} />
                          </div>
                          <button
                            onClick={() => removeScript(s.id)}
                            className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-400 font-semibold px-2 py-1.5 rounded-lg transition-colors"
                          >
                            <Trash2 size={12} />
                            Excluir
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </section>

      {/* Teleprompter */}
      <TeleprompterOverlay
        open={teleprompter.open}
        title={teleprompter.title}
        text={teleprompterText}
        speed={teleprompter.speed}
        fontSize={teleprompter.fontSize}
        countdownDuration={teleprompter.countdownDuration}
        mirrored={teleprompter.mirrored}
        playing={teleprompter.playing}
        onClose={() => setTeleprompter(prev => ({ ...prev, open: false, playing: false }))}
        onTogglePlaying={() => setTeleprompter(prev => ({ ...prev, playing: !prev.playing }))}
        onSpeedChange={v => setTeleprompter(prev => ({ ...prev, speed: v }))}
        onFontSizeChange={v => setTeleprompter(prev => ({ ...prev, fontSize: v }))}
        onCountdownDurationChange={v => setTeleprompter(prev => ({ ...prev, countdownDuration: v }))}
        onToggleMirror={() => setTeleprompter(prev => ({ ...prev, mirrored: !prev.mirrored }))}
      />
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
