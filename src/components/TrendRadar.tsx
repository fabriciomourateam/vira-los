import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Radio, RefreshCw, ChevronDown, ChevronUp, Zap, Loader2,
  Copy, Check, Layers, Video, Target, TrendingUp, Clock,
  Sparkles, AlertTriangle, ArrowRight,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Oportunidade {
  id: number;
  titulo_viral: string;
  tema: string;
  fonte: string;
  angulo_viral: string;
  formato: string;
  emocao: string;
  hook_reels: string;
  pontos_chave: string[];
  score_viral: number;
  por_que_funciona: string;
}

interface RadarResult {
  oportunidades: Oportunidade[];
  resumo_semana: string;
  nicho_processado: string;
  subredditsConsultados: string[];
  totalPostsAnalisados: number;
  updatedAt: string;
  fromCache: boolean;
  cachedAt?: string;
}

interface TrendRadarProps {
  onUseAsCarrossel?: (titulo: string) => void;
  onUseAsScript?: (hook: string) => void;
  onOpenStudio?: (op: Oportunidade) => void;
}

// ─── Niches pré-definidos ──────────────────────────────────────────────────────

const QUICK_NICHES = [
  'fitness', 'hormônios', 'nutrição', 'finanças',
  'negócios', 'marketing digital', 'desenvolvimento pessoal',
  'inteligência artificial', 'saúde mental', 'empreendedorismo',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FORMAT_COLORS: Record<string, string> = {
  lista:          'bg-blue-500/20 text-blue-400 border-blue-500/30',
  revelação:      'bg-purple-500/20 text-purple-400 border-purple-500/30',
  'mito-busting': 'bg-red-500/20 text-red-400 border-red-500/30',
  'antes-depois': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  tutorial:       'bg-orange-500/20 text-orange-400 border-orange-500/30',
  investigativo:  'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
};

const EMOTION_ICONS: Record<string, string> = {
  curiosidade: '🧠',
  medo:        '⚡',
  urgência:    '🔥',
  surpresa:    '😱',
  aspiração:   '🎯',
};

function scoreColor(score: number) {
  if (score >= 8) return 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30';
  if (score >= 6) return 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30';
  return 'text-red-400 bg-red-500/15 border-red-500/30';
}

function timeSince(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1)  return 'agora mesmo';
  if (mins < 60) return `há ${mins}min`;
  return `há ${Math.floor(mins / 60)}h`;
}

// ─── CopyButton ───────────────────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function handle() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Copiado!', { duration: 1200 });
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button onClick={handle} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-lg hover:bg-secondary">
      {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
      {copied ? 'Copiado' : 'Copiar'}
    </button>
  );
}

// ─── Card de oportunidade ──────────────────────────────────────────────────────

function OportunidadeCard({
  op,
  onUseAsCarrossel,
  onUseAsScript,
  onOpenStudio,
}: {
  op: Oportunidade;
  onUseAsCarrossel?: (titulo: string) => void;
  onUseAsScript?: (hook: string) => void;
  onOpenStudio?: (op: Oportunidade) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const fmtClass = FORMAT_COLORS[op.formato.toLowerCase()] || 'bg-secondary text-muted-foreground border-border';
  const emojiIcon = EMOTION_ICONS[op.emocao.toLowerCase()] || '✨';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl bg-card border border-border overflow-hidden"
      style={{ boxShadow: 'var(--shadow-card)' }}
    >
      {/* Header do card */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${fmtClass}`}>
              {op.formato}
            </span>
            <span className="text-xs text-muted-foreground">{emojiIcon} {op.emocao}</span>
            <span className="text-xs text-muted-foreground opacity-60">{op.fonte}</span>
          </div>
          <span className={`text-sm font-black px-2.5 py-1 rounded-xl border font-mono shrink-0 ${scoreColor(op.score_viral)}`}>
            {op.score_viral}/10
          </span>
        </div>

        {/* Título viral — pronto para usar como capa */}
        <p className="font-black text-base leading-tight mb-2 tracking-tight uppercase">
          {op.titulo_viral}
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed mb-3">
          {op.angulo_viral}
        </p>

        {/* Por que funciona */}
        <div className="flex items-start gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 rounded-lg px-3 py-2 mb-3">
          <Target size={11} className="shrink-0 mt-0.5" />
          <span>{op.por_que_funciona}</span>
        </div>

        {/* Ações */}
        <div className="flex items-center gap-2 flex-wrap">
          {onUseAsCarrossel && (
            <button
              onClick={() => { onUseAsCarrossel(op.titulo_viral); toast.success('Título carregado na aba Carrossel!'); }}
              className="flex items-center gap-1.5 text-xs bg-purple-600 hover:bg-purple-500 text-white font-bold px-3 py-1.5 rounded-lg transition-colors"
            >
              <Layers size={12} /> Gerar Carrossel
            </button>
          )}
          {onUseAsScript && (
            <button
              onClick={() => { onUseAsScript(op.hook_reels); toast.success('Hook copiado!'); }}
              className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-1.5 rounded-lg transition-colors"
            >
              <Video size={12} /> Usar Hook
            </button>
          )}
          {onOpenStudio && (
            <button
              onClick={() => { onOpenStudio(op); }}
              className="flex items-center gap-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white font-bold px-3 py-1.5 rounded-lg transition-colors"
            >
              ✦ Studio
            </button>
          )}
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground ml-auto transition-colors"
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {expanded ? 'Menos' : 'Ver detalhes'}
          </button>
        </div>
      </div>

      {/* Detalhes expandidos */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="border-t border-border p-4 space-y-4">
              {/* Hook de Reels */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Video size={11} /> Hook de Reels
                  </p>
                  <CopyBtn text={op.hook_reels} />
                </div>
                <p className="text-sm leading-relaxed bg-secondary/50 rounded-lg p-3 italic">
                  "{op.hook_reels}"
                </p>
              </div>

              {/* Pontos-chave */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
                  <Sparkles size={11} /> Pontos-chave do conteúdo
                </p>
                <ul className="space-y-1">
                  {op.pontos_chave.map((p, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
                      <span className="text-orange-500 font-bold shrink-0 w-4">{i + 1}.</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Componente principal ──────────────────────────────────────────────────────

export default function TrendRadar({ onUseAsCarrossel, onUseAsScript, onOpenStudio }: TrendRadarProps) {
  const [niche, setNiche]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [result, setResult]       = useState<RadarResult | null>(null);
  const [error, setError]         = useState<string | null>(null);

  async function handleFetch(forceRefresh = false) {
    const q = niche.trim();
    if (!q) { toast.error('Informe o nicho antes de buscar.'); return; }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ niche: q });
      if (forceRefresh) params.set('refresh', '');
      const res  = await fetch(`${API}/api/trend-radar?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao buscar tendências.');
      setResult(data);
      toast.success(
        data.fromCache
          ? `Tendências do cache (${timeSince(data.cachedAt || data.updatedAt)})`
          : `${data.totalPostsAnalisados} posts analisados — ${data.oportunidades?.length || 0} oportunidades`
      );
    } catch (e: any) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 pb-10">

      {/* Header */}
      <section>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-2 flex items-center gap-2">
          <Radio size={24} className="text-orange-500" />
          Radar de Tendências
        </h1>
        <p className="text-muted-foreground text-xs sm:text-sm">
          Trending topics do Reddit analisados por IA — oportunidades de conteúdo meio de funil, prontas para gravar ou publicar
        </p>
      </section>

      {/* Input de nicho */}
      <div className="rounded-2xl bg-card border border-border p-5 space-y-4" style={{ boxShadow: 'var(--shadow-card)' }}>
        <div className="flex items-center gap-2 mb-1">
          <Target size={15} className="text-orange-500" />
          <span className="font-bold text-sm uppercase tracking-wider">Seu nicho</span>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={niche}
            onChange={e => setNiche(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !loading) handleFetch(); }}
            placeholder="Ex: fitness, finanças, hormônios, marketing digital..."
            disabled={loading}
            className="flex-1 bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50 placeholder:text-muted-foreground"
          />
          <button
            onClick={() => handleFetch()}
            disabled={loading || !niche.trim()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-foreground text-background text-sm font-bold disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0"
          >
            {loading
              ? <><Loader2 size={14} className="animate-spin" /> Buscando...</>
              : <><TrendingUp size={14} /> Analisar</>
            }
          </button>
        </div>

        {/* Quick-select niches */}
        <div className="flex flex-wrap gap-1.5">
          {QUICK_NICHES.map(n => (
            <button
              key={n}
              onClick={() => setNiche(n)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                niche.toLowerCase() === n
                  ? 'bg-foreground text-background border-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/40'
              }`}
            >
              {n}
            </button>
          ))}
        </div>

        <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Clock size={11} className="mt-0.5 shrink-0" />
          <span>Resultado em cache por 30 min. Fontes: Reddit (top posts da semana) + análise Claude.</span>
        </div>
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-4 flex items-start gap-3"
          >
            <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
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
            {/* Resumo */}
            <div className="rounded-2xl bg-card border border-border p-4" style={{ boxShadow: 'var(--shadow-card)' }}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp size={14} className="text-orange-500" />
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Semana em {result.nicho_processado || niche}
                    </span>
                    {result.fromCache && (
                      <span className="text-xs text-muted-foreground opacity-60">
                        · cache {timeSince(result.cachedAt || result.updatedAt)}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium leading-relaxed">{result.resumo_semana}</p>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {result.totalPostsAnalisados} posts analisados de: {result.subredditsConsultados?.join(', ')}
                  </p>
                </div>
                <button
                  onClick={() => handleFetch(true)}
                  disabled={loading}
                  className="p-2 rounded-xl border border-border hover:bg-secondary transition-colors shrink-0"
                  title="Atualizar tendências"
                >
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {/* Oportunidades */}
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                <Zap size={12} className="text-orange-500" />
                {result.oportunidades?.length || 0} oportunidades esta semana
              </h2>
              <div className="space-y-3">
                {(result.oportunidades || []).map(op => (
                  <OportunidadeCard
                    key={op.id}
                    op={op}
                    onUseAsCarrossel={onUseAsCarrossel}
                    onUseAsScript={onUseAsScript}
                    onOpenStudio={onOpenStudio}
                  />
                ))}
              </div>
            </div>

            {/* Dica de uso */}
            <div className="rounded-2xl bg-foreground text-background p-4 flex items-start gap-3">
              <ArrowRight size={16} className="shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-bold mb-1">Como usar</p>
                <p className="opacity-75 text-xs leading-relaxed">
                  Clique em <strong>Gerar Carrossel</strong> para abrir a aba Carrossel com o título viral pré-preenchido. Clique em <strong>Usar Hook</strong> para copiar o gancho e colar no teleprompter do Roteiro. Expanda cada card para ver os pontos-chave prontos para o roteiro.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
