import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot, Play, Square, Clock, CheckCircle2, XCircle,
  Loader2, ChevronDown, ChevronUp, ExternalLink,
  Calendar, Trash2, TrendingUp, Search, Zap,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface AgentStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
  detail?: string;
}

interface VideoResult {
  platform: 'tiktok' | 'instagram' | 'youtube';
  title: string;
  likes: string;
  views: string;
  url: string;
}

interface AgentResults {
  keyword: string;
  platforms: string[];
  videos: VideoResult[];
  analysis: string | null;
  collectedAt: string;
}

interface ScheduleConfig {
  active: boolean;
  mode?: 'daily' | 'weekly';
  hour?: number;
  minute?: number;
  keyword?: string;
  platforms?: string[];
  weekdays?: number[];  // 0=Dom 1=Seg 2=Ter 3=Qua 4=Qui 5=Sex 6=Sáb
}

const WEEK_DAYS = [
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PLATFORM_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  tiktok:    { label: 'TikTok',    color: 'text-pink-400',   bg: 'bg-pink-500/10 border-pink-500/30' },
  instagram: { label: 'Instagram', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/30' },
  youtube:   { label: 'YouTube',   color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/30' },
};

const STEP_ICON = {
  pending: <div className="w-4 h-4 rounded-full border border-zinc-600" />,
  running: <Loader2 className="w-4 h-4 text-orange-400 animate-spin" />,
  done:    <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
  error:   <XCircle className="w-4 h-4 text-red-400" />,
};

// ─── Markdown renderer simples ────────────────────────────────────────────────

function renderInlineMd(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-white font-semibold">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

function MarkdownAnalysis({ text }: { text: string }) {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];

  lines.forEach((line, i) => {
    if (line.startsWith('## ')) {
      nodes.push(
        <h3 key={i} className="text-white font-bold text-sm mt-4 mb-1.5 first:mt-0">
          {line.slice(3)}
        </h3>
      );
    } else if (line.startsWith('# ')) {
      nodes.push(
        <h2 key={i} className="text-white font-bold text-base mt-4 mb-2 first:mt-0">
          {line.slice(2)}
        </h2>
      );
    } else if (line.match(/^[-•*] /)) {
      nodes.push(
        <div key={i} className="flex gap-2 text-sm text-zinc-300 leading-relaxed mb-0.5">
          <span className="text-orange-400 shrink-0 mt-0.5">•</span>
          <span>{renderInlineMd(line.slice(2))}</span>
        </div>
      );
    } else if (line.trim() === '') {
      nodes.push(<div key={i} className="h-1.5" />);
    } else {
      nodes.push(
        <p key={i} className="text-sm text-zinc-300 leading-relaxed mb-0.5">
          {renderInlineMd(line)}
        </p>
      );
    }
  });

  return <div className="pt-4">{nodes}</div>;
}

// ─── Tipos de props ───────────────────────────────────────────────────────────

interface AgenteProps {
  onUseInRoteiro?: (data: { references: string }) => void;
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function AgenteAutonomo({ onUseInRoteiro }: AgenteProps) {
  const [keyword, setKeyword]         = useState('testosterona');
  const [platforms, setPlatforms]     = useState(['tiktok', 'instagram', 'youtube']);
  const [steps, setSteps]             = useState<AgentStep[]>([]);
  const [results, setResults]         = useState<AgentResults | null>(null);
  const [running, setRunning]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [schedule, setSchedule]       = useState<ScheduleConfig>({ active: false });
  const [schedHour, setSchedHour]     = useState('07');
  const [schedMin, setSchedMin]       = useState('00');
  const [schedMode, setSchedMode]     = useState<'daily' | 'weekly'>('daily');
  const [schedWeekdays, setSchedWeekdays] = useState<number[]>([1, 2, 3, 4, 5]); // Seg-Sex
  const [showScheduler, setShowScheduler] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const stepsEndRef    = useRef<HTMLDivElement | null>(null);

  // ── Carrega status atual + agendamento ao montar ──
  useEffect(() => {
    fetchStatus();
    fetchSchedule();
  }, []);

  // ── Scroll automático nos steps ──
  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [steps]);

  async function fetchStatus() {
    try {
      const r = await fetch(`${API}/api/agent/status`);
      const data = await r.json();
      if (data.steps?.length) setSteps(data.steps);
      if (data.results)       setResults(data.results);
      if (data.running)       { setRunning(true); connectSSE(); }
    } catch (_) {}
  }

  async function fetchSchedule() {
    try {
      const r = await fetch(`${API}/api/agent/schedule`);
      const data = await r.json();
      setSchedule(data);
      if (data.active) {
        setSchedHour(String(data.hour).padStart(2, '0'));
        setSchedMin(String(data.minute).padStart(2, '0'));
        setSchedMode(data.mode || 'daily');
        if (data.weekdays?.length) setSchedWeekdays(data.weekdays);
      }
    } catch (_) {}
  }

  function connectSSE() {
    if (eventSourceRef.current) return;

    const es = new EventSource(`${API}/api/agent/stream`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      const event = JSON.parse(e.data);

      if (event.type === 'init') {
        setSteps(event.steps);
        setRunning(true);
        setError(null);
      } else if (event.type === 'step') {
        setSteps(prev => prev.map(s => s.id === event.step.id ? event.step : s));
      } else if (event.type === 'complete') {
        setResults(event.results);
        setRunning(false);
        es.close();
        eventSourceRef.current = null;
      } else if (event.type === 'error') {
        setError(event.message);
        setRunning(false);
        es.close();
        eventSourceRef.current = null;
      } else if (event.type === 'state') {
        const s = event.state;
        if (s.steps?.length) setSteps(s.steps);
        if (s.results)       setResults(s.results);
        if (!s.running)      { setRunning(false); es.close(); eventSourceRef.current = null; }
      }
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
    };
  }

  async function startAgent() {
    if (!keyword.trim() || running) return;
    setError(null);
    setResults(null);
    setSteps([]);
    connectSSE();

    try {
      const r = await fetch(`${API}/api/agent/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: keyword.trim(), platforms }),
      });
      if (!r.ok) {
        const err = await r.json();
        setError(err.error || 'Erro ao iniciar agente');
        setRunning(false);
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
      }
    } catch (err: any) {
      setError(err.message);
      setRunning(false);
    }
  }

  async function saveSchedule() {
    try {
      const r = await fetch(`${API}/api/agent/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hour: Number(schedHour),
          minute: Number(schedMin),
          mode: schedMode,
          weekdays: schedMode === 'weekly' ? schedWeekdays : [],
          keyword: keyword.trim(),
          platforms,
        }),
      });
      const data = await r.json();
      if (data.ok) setSchedule(data.schedule);
    } catch (_) {}
  }

  function toggleWeekday(d: number) {
    setSchedWeekdays(prev =>
      prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]
    );
  }

  function scheduleLabel(s: ScheduleConfig) {
    if (!s.active) return null;
    const time = `${String(s.hour).padStart(2,'0')}:${String(s.minute).padStart(2,'0')}`;
    if (s.mode === 'weekly' && s.weekdays?.length) {
      const DAYS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
      return s.weekdays.map(d => DAYS[d]).join(', ') + ' ' + time;
    }
    return 'Todo dia ' + time;
  }

  async function removeSchedule() {
    await fetch(`${API}/api/agent/schedule`, { method: 'DELETE' });
    setSchedule({ active: false });
  }

  function togglePlatform(p: string) {
    setPlatforms(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    );
  }

  const completedSteps = steps.filter(s => s.status === 'done').length;
  const progress = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : 0;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20">
          <Bot className="w-5 h-5 text-orange-400" />
        </div>
        <div>
          <h2 className="text-white font-semibold text-lg">Agente Autônomo</h2>
          <p className="text-zinc-400 text-sm">Segue o roteiro Vira-Los automaticamente</p>
        </div>
        {schedule.active && (
          <div className="ml-auto flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
            <Clock className="w-3 h-3" />
            {scheduleLabel(schedule)}
          </div>
        )}
      </div>

      {/* Configuração */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
        <h3 className="text-zinc-300 text-sm font-medium">Configuração da Pesquisa</h3>

        {/* Palavra-chave */}
        <div>
          <label className="text-zinc-400 text-xs mb-1.5 block">Palavra-chave</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              disabled={running}
              placeholder="testosterona, TRT, GLP-1..."
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-9 pr-4 py-2.5 text-white text-sm placeholder:text-zinc-500 focus:outline-none focus:border-orange-500 disabled:opacity-50"
            />
          </div>
        </div>

        {/* Plataformas */}
        <div>
          <label className="text-zinc-400 text-xs mb-1.5 block">Plataformas</label>
          <div className="flex gap-2">
            {(['tiktok', 'instagram', 'youtube'] as const).map(p => {
              const { label, color, bg } = PLATFORM_LABELS[p];
              const active = platforms.includes(p);
              return (
                <button
                  key={p}
                  onClick={() => togglePlatform(p)}
                  disabled={running}
                  className={`flex-1 py-2 px-3 rounded-lg border text-xs font-medium transition-all disabled:opacity-50
                    ${active ? `${bg} ${color} border-current` : 'bg-zinc-800 text-zinc-500 border-zinc-700 hover:border-zinc-600'}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Ações */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={startAgent}
            disabled={running || !keyword.trim() || platforms.length === 0}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
          >
            {running
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Pesquisando...</>
              : <><Play className="w-4 h-4" /> Iniciar Pesquisa</>
            }
          </button>

          <button
            onClick={() => setShowScheduler(s => !s)}
            className="px-3 py-2.5 rounded-lg border border-zinc-700 hover:border-zinc-600 text-zinc-400 hover:text-white transition-colors"
            title="Agendar"
          >
            <Calendar className="w-4 h-4" />
          </button>
        </div>

        {/* Agendador */}
        <AnimatePresence>
          {showScheduler && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="border-t border-zinc-800 pt-4 space-y-4">

                {/* Modo: todo dia vs dias específicos */}
                <div>
                  <p className="text-zinc-400 text-xs mb-2">Frequência</p>
                  <div className="flex gap-2">
                    {(['daily', 'weekly'] as const).map(m => (
                      <button
                        key={m}
                        onClick={() => setSchedMode(m)}
                        className={`flex-1 py-2 px-3 rounded-lg border text-xs font-medium transition-all
                          ${schedMode === m
                            ? 'bg-orange-500/10 border-orange-500/40 text-orange-400'
                            : 'bg-zinc-800 border-zinc-700 text-zinc-500 hover:border-zinc-600'}`}
                      >
                        {m === 'daily' ? 'Todo dia' : 'Dias específicos'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Dias da semana (só aparece no modo weekly) */}
                <AnimatePresence>
                  {schedMode === 'weekly' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <p className="text-zinc-400 text-xs mb-2">Dias da semana</p>
                      <div className="flex gap-1.5 flex-wrap">
                        {WEEK_DAYS.map(({ value, label }) => {
                          const active = schedWeekdays.includes(value);
                          return (
                            <button
                              key={value}
                              onClick={() => toggleWeekday(value)}
                              className={`w-10 h-9 rounded-lg border text-xs font-medium transition-all
                                ${active
                                  ? 'bg-orange-500/15 border-orange-500/50 text-orange-300'
                                  : 'bg-zinc-800 border-zinc-700 text-zinc-500 hover:border-zinc-600'}`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Horário */}
                <div>
                  <p className="text-zinc-400 text-xs mb-2">Horário (Brasília)</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min="0" max="23"
                      value={schedHour}
                      onChange={e => setSchedHour(String(e.target.value).padStart(2,'0'))}
                      className="w-16 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm text-center focus:outline-none focus:border-orange-500"
                    />
                    <span className="text-zinc-400 font-bold">:</span>
                    <input
                      type="number" min="0" max="59"
                      value={schedMin}
                      onChange={e => setSchedMin(String(e.target.value).padStart(2,'0'))}
                      className="w-16 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm text-center focus:outline-none focus:border-orange-500"
                    />
                    <button
                      onClick={saveSchedule}
                      className="ml-auto px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition-colors"
                    >
                      Salvar
                    </button>
                    {schedule.active && (
                      <button
                        onClick={removeSchedule}
                        className="p-2 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Remover agendamento"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-zinc-500 text-xs">
                  ⚠️ O PC (ou servidor) precisa estar ligado no horário agendado.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Erro */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 text-sm font-medium">Erro no agente</p>
            <p className="text-red-300/70 text-xs mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Checklist em tempo real */}
      <AnimatePresence>
        {steps.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden"
          >
            {/* Header com progresso */}
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-orange-400" />
                <span className="text-zinc-300 text-sm font-medium">Progresso do Roteiro</span>
              </div>
              <span className="text-orange-400 text-sm font-mono">{progress}%</span>
            </div>

            {/* Barra de progresso */}
            <div className="h-1 bg-zinc-800">
              <motion.div
                className="h-full bg-gradient-to-r from-orange-500 to-orange-400"
                animate={{ width: `${progress}%` }}
                transition={{ type: 'spring', stiffness: 80 }}
              />
            </div>

            {/* Steps */}
            <div className="p-4 space-y-2">
              {steps.map((step, idx) => (
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  className={`flex items-start gap-3 p-2.5 rounded-lg transition-colors
                    ${step.status === 'running' ? 'bg-orange-500/5 border border-orange-500/20' : ''}
                    ${step.status === 'done'    ? 'opacity-70' : ''}
                    ${step.status === 'error'   ? 'bg-red-500/5 border border-red-500/20' : ''}
                  `}
                >
                  <div className="mt-0.5 shrink-0">{STEP_ICON[step.status]}</div>
                  <div className="min-w-0">
                    <p className={`text-sm ${
                      step.status === 'running' ? 'text-orange-300 font-medium' :
                      step.status === 'done'    ? 'text-zinc-400' :
                      step.status === 'error'   ? 'text-red-400' :
                      'text-zinc-500'
                    }`}>
                      {step.label}
                    </p>
                    {step.detail && (
                      <p className="text-xs text-zinc-500 mt-0.5 truncate">{step.detail}</p>
                    )}
                  </div>
                </motion.div>
              ))}
              <div ref={stepsEndRef} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Resultados */}
      <AnimatePresence>
        {results && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >

            {/* Vídeos coletados */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-zinc-300 text-sm font-medium">
                    {results.videos.length} vídeos coletados — "{results.keyword}"
                  </span>
                </div>
                <span className="text-zinc-500 text-xs">
                  {new Date(results.collectedAt).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
                </span>
              </div>

              <div className="divide-y divide-zinc-800/50">
                {results.videos.map((v, i) => {
                  const { label, color, bg } = PLATFORM_LABELS[v.platform] || PLATFORM_LABELS.tiktok;
                  return (
                    <div key={i} className="p-3 flex items-start gap-3 hover:bg-zinc-800/40 transition-colors">
                      <span className={`text-xs px-2 py-0.5 rounded border ${bg} ${color} shrink-0 mt-0.5`}>
                        {label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-zinc-300 text-sm truncate">{v.title || '(título não capturado)'}</p>
                        <div className="flex gap-3 mt-0.5 text-xs text-zinc-500">
                          {v.views && <span>👁 {v.views}</span>}
                          {v.likes && <span>❤️ {v.likes}</span>}
                        </div>
                      </div>
                      {v.url && (
                        <a
                          href={v.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 p-1.5 rounded text-zinc-500 hover:text-white hover:bg-zinc-700 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Botão: usar no Roteiro */}
            {onUseInRoteiro && results.videos.length > 0 && (
              <div className="p-4 border-t border-zinc-800">
                <button
                  onClick={() => {
                    const refsText = results.videos
                      .map((v, i) => `${i + 1}. ${v.title || '(sem título)'} [${v.platform}] — ${v.url}`)
                      .join('\n');
                    onUseInRoteiro({ references: refsText });
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium transition-colors"
                >
                  <Zap className="w-4 h-4" />
                  Usar esses vídeos no Roteiro (passo 1.5)
                </button>
              </div>
            )}

            {/* Análise Claude */}
            {results.analysis && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                <button
                  onClick={() => setShowAnalysis(s => !s)}
                  className="w-full p-4 flex items-center justify-between hover:bg-zinc-800/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-orange-400" />
                    <span className="text-zinc-300 text-sm font-medium">Análise Claude — Formatos + Próximos Passos</span>
                  </div>
                  {showAnalysis ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
                </button>

                <AnimatePresence>
                  {showAnalysis && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: 'auto' }}
                      exit={{ height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 border-t border-zinc-800">
                        <MarkdownAnalysis text={results.analysis} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
