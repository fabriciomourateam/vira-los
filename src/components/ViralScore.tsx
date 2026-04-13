import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Gauge, Loader2, ChevronDown, ChevronUp, Copy, Check,
  Zap, Layers, Video, AlertTriangle, Lightbulb, ArrowRight,
  Target, Flame, Brain, Star, Sparkles, Plus,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface CriterionScore {
  score: number;
  feedback: string;
  reescrita: string;
  titulo?: string;
  emocao_detectada?: string;
  formato_detectado?: string;
}

interface ScoreResult {
  scores: {
    hook:      CriterionScore;
    curiosity: CriterionScore;
    emotion:   CriterionScore;
    cta:       CriterionScore;
    format:    CriterionScore;
  };
  overall: number;
  veredicto: string;
  veredicto_motivo: string;
  top3_melhorias: string[];
}

interface ViralScoreProps {
  prefillScript?: string;
  prefillType?: 'carousel' | 'reels';
  onUseInCarrossel?: (script: string) => void;
}

// ─── Helpers visuais ──────────────────────────────────────────────────────────

function scoreToColor(s: number) {
  if (s >= 8) return { ring: '#10b981', text: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-500/30' };
  if (s >= 6) return { ring: '#f59e0b', text: 'text-yellow-400', bg: 'bg-yellow-500/15 border-yellow-500/30' };
  if (s >= 4) return { ring: '#f97316', text: 'text-orange-400', bg: 'bg-orange-500/15 border-orange-500/30' };
  return { ring: '#ef4444', text: 'text-red-400', bg: 'bg-red-500/15 border-red-500/30' };
}

const VEREDICTO_STYLE: Record<string, string> = {
  'Viral':           'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
  'Alto potencial':  'bg-blue-500/20 text-blue-400 border-blue-500/40',
  'Médio':           'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
  'Fraco':           'bg-red-500/20 text-red-400 border-red-500/40',
};

const CRITERION_META = {
  hook:      { label: 'Hook / Gancho', icon: Flame, weight: '30%',  desc: 'Para o scroll nos 3 primeiros segundos' },
  curiosity: { label: 'Curiosity Gaps', icon: Brain, weight: '20%', desc: 'Lacunas que forçam continuar' },
  emotion:   { label: 'Emoção Central', icon: Zap,   weight: '20%', desc: 'Emoção dominante e consistente' },
  cta:       { label: 'CTA',           icon: Target, weight: '15%', desc: 'Call-to-action específico e posicionado' },
  format:    { label: 'Formato Viral', icon: Star,   weight: '15%', desc: 'Estrutura comprovada de engajamento' },
};

// ─── Gauge circular SVG ───────────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  const c = scoreToColor(score);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 10) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="136" height="136" viewBox="0 0 136 136">
        <circle cx="68" cy="68" r={radius} fill="none" stroke="currentColor" strokeWidth="10"
          className="text-border" />
        <circle cx="68" cy="68" r={radius} fill="none" stroke={c.ring} strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          strokeLinecap="round"
          style={{ transform: 'rotate(-90deg)', transformOrigin: '68px 68px', transition: 'stroke-dashoffset 0.8s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-3xl font-black ${c.text}`}>{score.toFixed(1)}</span>
        <span className="text-xs text-muted-foreground">/ 10</span>
      </div>
    </div>
  );
}

// ─── Card de critério ──────────────────────────────────────────────────────────

function CriterionCard({
  name, data, applied, onApply,
}: {
  name: keyof typeof CRITERION_META;
  data: CriterionScore;
  applied?: boolean;
  onApply?: (rewrite: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const meta  = CRITERION_META[name];
  const color = scoreToColor(data.score);
  const Icon  = meta.icon;

  async function copyRewrite() {
    await navigator.clipboard.writeText(data.reescrita);
    setCopied(true);
    toast.success('Reescrita copiada!', { duration: 1200 });
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={`rounded-xl border overflow-hidden ${color.bg}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 p-3 text-left"
      >
        <div className={`flex items-center justify-center w-8 h-8 rounded-lg bg-background/40 shrink-0`}>
          <Icon size={15} className={color.text} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold">{meta.label}</span>
            <span className="text-xs text-muted-foreground opacity-60">{meta.weight}</span>
          </div>
          <p className="text-xs text-muted-foreground truncate">{data.feedback}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-base font-black ${color.text}`}>{data.score}</span>
          {open ? <ChevronUp size={13} className="text-muted-foreground" /> : <ChevronDown size={13} className="text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="expand"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="border-t border-white/10 p-3 space-y-2.5">
              {/* Tags de detalhes */}
              {(data.emocao_detectada || data.formato_detectado || data.titulo) && (
                <div className="flex flex-wrap gap-1.5">
                  {data.titulo         && <span className="text-xs bg-background/40 px-2 py-0.5 rounded-full">{data.titulo}</span>}
                  {data.emocao_detectada && <span className="text-xs bg-background/40 px-2 py-0.5 rounded-full">{data.emocao_detectada}</span>}
                  {data.formato_detectado && <span className="text-xs bg-background/40 px-2 py-0.5 rounded-full">{data.formato_detectado}</span>}
                </div>
              )}

              {/* Feedback completo */}
              <p className="text-xs leading-relaxed">{data.feedback}</p>

              {/* Reescrita */}
              {data.reescrita && (
                <div className="bg-background/30 rounded-lg p-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold uppercase tracking-wide opacity-70">Versão melhorada</span>
                    <div className="flex items-center gap-2">
                      {onApply && (
                        <button
                          onClick={() => onApply(data.reescrita)}
                          className={`flex items-center gap-1 text-xs transition-colors ${
                            applied
                              ? 'text-emerald-500'
                              : 'opacity-70 hover:opacity-100 hover:text-purple-400'
                          }`}
                        >
                          {applied ? <Check size={11} /> : <Plus size={11} />}
                          {applied ? 'Aplicado' : 'Aplicar'}
                        </button>
                      )}
                      <button onClick={copyRewrite} className="flex items-center gap-1 text-xs opacity-70 hover:opacity-100 transition-opacity">
                        {copied ? <Check size={11} /> : <Copy size={11} />}
                        {copied ? 'Copiado' : 'Copiar'}
                      </button>
                    </div>
                  </div>
                  <p className="text-xs italic leading-relaxed">"{data.reescrita}"</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Componente principal ──────────────────────────────────────────────────────

export default function ViralScore({ prefillScript = '', prefillType = 'carousel', onUseInCarrossel }: ViralScoreProps) {
  const [script, setScript] = useState(prefillScript);
  const [type, setType]     = useState<'carousel' | 'reels'>(prefillType);
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<ScoreResult | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [appliedRewrites, setAppliedRewrites] = useState<Partial<Record<keyof typeof CRITERION_META, string>>>({});
  const [improvedScript, setImprovedScript]   = useState('');

  function applyRewrite(name: keyof typeof CRITERION_META, rewrite: string) {
    const isNew = !(name in appliedRewrites);
    setAppliedRewrites(prev => ({ ...prev, [name]: rewrite }));
    setImprovedScript(prev => {
      const base = prev || script;
      const label = CRITERION_META[name].label.toUpperCase();
      if (!isNew) {
        // Replace existing entry for this criterion
        const regex = new RegExp(`✅ \\[${label}\\]:.*`, 's');
        return base.replace(regex, `✅ [${label}]: ${rewrite}`);
      }
      return base + `\n\n✅ [${label}]: ${rewrite}`;
    });
    toast.success(`"${CRITERION_META[name].label}" aplicado ao script`);
  }

  async function handleEvaluate() {
    if (!script.trim()) { toast.error('Cole um script para avaliar.'); return; }
    setLoading(true);
    setError(null);
    setResult(null);
    setAppliedRewrites({});
    setImprovedScript(script);
    try {
      const res  = await fetch(`${API}/api/viral-score`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ script: script.trim(), type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao avaliar script.');
      setResult(data);
      toast.success(`Score: ${data.overall?.toFixed(1)}/10 — ${data.veredicto}`);
    } catch (e: any) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  const veredictoClass = result ? (VEREDICTO_STYLE[result.veredicto] || 'bg-secondary text-foreground border-border') : '';

  return (
    <div className="space-y-6 pb-10">

      {/* Header */}
      <section>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-2 flex items-center gap-2">
          <Gauge size={24} className="text-yellow-500" />
          Avaliador Viral
        </h1>
        <p className="text-muted-foreground text-xs sm:text-sm">
          Cole qualquer script de carrossel ou roteiro de Reels — IA avalia em 5 critérios e mostra como melhorar cada ponto
        </p>
      </section>

      {/* Input */}
      <div className="rounded-2xl bg-card border border-border p-5 space-y-4" style={{ boxShadow: 'var(--shadow-card)' }}>

        {/* Toggle tipo */}
        <div className="flex gap-2">
          {(['carousel', 'reels'] as const).map(t => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                type === t
                  ? 'bg-foreground text-background border-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'carousel' ? <Layers size={12} /> : <Video size={12} />}
              {t === 'carousel' ? 'Carrossel' : 'Reels'}
            </button>
          ))}
        </div>

        <textarea
          value={script}
          onChange={e => setScript(e.target.value)}
          placeholder={type === 'carousel'
            ? 'Cole o script do carrossel aqui (SLIDE 1 — CAPA, SLIDE 2 — CONTEXTO, etc.)'
            : 'Cole o roteiro de Reels aqui (ABERTURA, FALA — GANCHO, DESENVOLVIMENTO, CTA FINAL...)'
          }
          rows={10}
          disabled={loading}
          className="w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50 placeholder:text-muted-foreground font-mono resize-none leading-relaxed"
        />

        <button
          onClick={handleEvaluate}
          disabled={loading || !script.trim()}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-foreground text-background text-sm font-bold disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          {loading
            ? <><Loader2 size={16} className="animate-spin" /> Avaliando...</>
            : <><Gauge size={16} /> Avaliar potencial viral</>
          }
        </button>
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
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
            {/* Overall score */}
            <div className="rounded-2xl bg-card border border-border p-5" style={{ boxShadow: 'var(--shadow-card)' }}>
              <div className="flex items-center gap-6">
                <ScoreGauge score={result.overall} />
                <div className="flex-1">
                  <span className={`inline-block text-sm font-black px-3 py-1 rounded-full border mb-2 ${veredictoClass}`}>
                    {result.veredicto}
                  </span>
                  <p className="text-sm leading-relaxed text-foreground/80">{result.veredicto_motivo}</p>
                </div>
              </div>
            </div>

            {/* Top 3 melhorias */}
            <div className="rounded-2xl bg-card border border-border p-4" style={{ boxShadow: 'var(--shadow-card)' }}>
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                <Lightbulb size={12} className="text-yellow-500" />
                Top 3 ações para melhorar agora
              </h2>
              <ol className="space-y-2">
                {result.top3_melhorias.map((m, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-foreground text-background text-xs font-black flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed">{m}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Critérios */}
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                <Target size={12} />
                Avaliação por critério — clique para ver melhoria
              </h2>
              <div className="space-y-2">
                {(Object.keys(CRITERION_META) as Array<keyof typeof CRITERION_META>).map(k => (
                  <CriterionCard
                    key={k}
                    name={k}
                    data={result.scores[k]}
                    applied={k in appliedRewrites}
                    onApply={(rewrite) => applyRewrite(k, rewrite)}
                  />
                ))}
              </div>
            </div>

            {/* Script Melhorado */}
            {Object.keys(appliedRewrites).length > 0 && (
              <div className="rounded-2xl border border-purple-500/30 bg-card p-5 space-y-4" style={{ boxShadow: 'var(--shadow-card)' }}>
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-purple-400 flex items-center gap-2">
                    <Sparkles size={12} />
                    Script com {Object.keys(appliedRewrites).length} melhoria{Object.keys(appliedRewrites).length > 1 ? 's' : ''} aplicada{Object.keys(appliedRewrites).length > 1 ? 's' : ''}
                  </h2>
                  <span className="text-xs text-muted-foreground">Edite livremente antes de gerar</span>
                </div>
                <textarea
                  value={improvedScript}
                  onChange={e => setImprovedScript(e.target.value)}
                  rows={12}
                  className="w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/30 font-mono resize-none leading-relaxed"
                />
                {onUseInCarrossel && (
                  <button
                    onClick={() => {
                      onUseInCarrossel(improvedScript);
                      toast.success('Script melhorado enviado para o Carrossel!');
                    }}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-bold transition-colors"
                  >
                    <Layers size={16} /> Gerar Carrossel com Script Melhorado
                  </button>
                )}
              </div>
            )}

            {/* Dica */}
            <div className="rounded-2xl bg-foreground text-background p-4 flex items-start gap-3">
              <ArrowRight size={16} className="shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-bold mb-1">Como usar as melhorias</p>
                <p className="opacity-75 text-xs leading-relaxed">
                  Clique em cada critério → expand → botão <strong>Aplicar</strong> para incluir a versão melhorada no script. Edite o script montado e clique em Gerar Carrossel.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
