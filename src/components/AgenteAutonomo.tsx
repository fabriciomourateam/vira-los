import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot, Play, Square, Clock, CheckCircle2, XCircle,
  Loader2, ChevronDown, ChevronUp, ExternalLink,
  Calendar, Trash2, TrendingUp, Search, Zap, AlertTriangle, KeyRound, LogIn,
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

const PLATFORM_LABELS: Record<string, { label: string }> = {
  tiktok:    { label: 'TikTok' },
  instagram: { label: 'Instagram' },
  youtube:   { label: 'YouTube' },
};

const STEP_ICON = {
  pending: <div className="w-4 h-4 rounded-full border-2 border-border" />,
  running: <Loader2 className="w-4 h-4 text-orange-500 animate-spin" />,
  done:    <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
  error:   <XCircle className="w-4 h-4 text-red-500" />,
};

// ─── Markdown renderer simples ────────────────────────────────────────────────

function renderInlineMd(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-foreground font-semibold">{part.slice(2, -2)}</strong>;
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
        <h3 key={i} className="text-foreground font-bold text-sm mt-4 mb-1.5 first:mt-0">
          {line.slice(3)}
        </h3>
      );
    } else if (line.startsWith('# ')) {
      nodes.push(
        <h2 key={i} className="text-foreground font-bold text-base mt-4 mb-2 first:mt-0">
          {line.slice(2)}
        </h2>
      );
    } else if (line.match(/^[-•*] /)) {
      nodes.push(
        <div key={i} className="flex gap-2 text-sm text-muted-foreground leading-relaxed mb-0.5">
          <span className="text-orange-500 shrink-0 mt-0.5">•</span>
          <span>{renderInlineMd(line.slice(2))}</span>
        </div>
      );
    } else if (line.trim() === '') {
      nodes.push(<div key={i} className="h-1.5" />);
    } else {
      nodes.push(
        <p key={i} className="text-sm text-muted-foreground leading-relaxed mb-0.5">
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
  const [showSessions, setShowSessions]   = useState(false);
  const [igSession, setIgSession]         = useState('');
  const [ttSession, setTtSession]         = useState('');
  const [sessionStatus, setSessionStatus] = useState<{ instagram: boolean; tiktok: boolean }>({ instagram: false, tiktok: false });
  const [sessionSaving, setSessionSaving] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const stepsEndRef    = useRef<HTMLDivElement | null>(null);

  // ── Carrega status atual + agendamento ao montar ──
  useEffect(() => {
    fetchStatus();
    fetchSchedule();
    fetchSessionStatus();

    // Polling a cada 5s para manter running sincronizado com backend
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`${API}/api/agent/status`);
        const data = await r.json();
        if (data.running && !eventSourceRef.current) {
          setRunning(true);
          connectSSE();
        }
      } catch (_) {}
    }, 5000);

    return () => clearInterval(poll);
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

  async function fetchSessionStatus() {
    try {
      const r = await fetch(`${API}/api/agent/cookies`);
      const data = await r.json();
      setSessionStatus(data);
    } catch (_) {}
  }

  async function saveSessions() {
    if (!igSession && !ttSession) return;
    setSessionSaving(true);
    try {
      await fetch(`${API}/api/agent/cookies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instagram: igSession || undefined, tiktok: ttSession || undefined }),
      });
      setIgSession('');
      setTtSession('');
      await fetchSessionStatus();
    } catch (_) {}
    setSessionSaving(false);
  }

  async function removeSession(platform: 'instagram' | 'tiktok') {
    await fetch(`${API}/api/agent/cookies`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform }),
    });
    await fetchSessionStatus();
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
      } else if (event.type === 'stopped') {
        setError(null);
        setRunning(false);
        es.close();
        eventSourceRef.current = null;
      } else if (event.type === 'state') {
        const s = event.state;
        if (s.steps?.length) setSteps(s.steps);
        if (s.results)       setResults(s.results);
        if (s.running)       { setRunning(true); }
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
    setRunning(true);
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
      <section className="flex items-start gap-4">
        <div className="w-12 h-12 bg-orange-50 rounded-2xl flex items-center justify-center shrink-0">
          <Bot className="w-6 h-6 text-orange-500" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight">Agente Autônomo</h2>
          <p className="text-muted-foreground text-xs sm:text-sm mt-0.5">Segue o roteiro Vira-Los automaticamente</p>
        </div>
        {schedule.active && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full shrink-0">
            <Clock className="w-3 h-3" />
            {scheduleLabel(schedule)}
          </div>
        )}
      </section>

      {/* Configuração */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-5" style={{ boxShadow: 'var(--shadow-layered)' }}>
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Configuração da Pesquisa</h3>

        {/* Palavra-chave */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground">Palavra-chave</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              disabled={running}
              placeholder="testosterona, TRT, GLP-1..."
              className="w-full bg-secondary border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 disabled:opacity-50 transition-all"
            />
          </div>
        </div>

        {/* Plataformas */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground">Plataformas</label>
          <div className="grid grid-cols-3 gap-2">
            {(['tiktok', 'instagram', 'youtube'] as const).map(p => {
              const { label } = PLATFORM_LABELS[p];
              const active = platforms.includes(p);
              return (
                <button
                  key={p}
                  onClick={() => togglePlatform(p)}
                  disabled={running}
                  className={`py-2.5 px-3 rounded-xl border text-sm font-bold transition-all disabled:opacity-50 ${
                    active
                      ? 'bg-foreground text-background border-transparent'
                      : 'bg-secondary text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Ações */}
        <div className="flex gap-2">
          <button
            onClick={startAgent}
            disabled={running || !keyword.trim() || platforms.length === 0}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold transition-colors"
          >
            {running
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Pesquisando...</>
              : <><Play className="w-4 h-4" /> Iniciar Pesquisa</>
            }
          </button>
          <button
            onClick={async () => {
              if (!running) return;
              await fetch(`${API}/api/agent/stop`, { method: 'POST' });
            }}
            disabled={!running}
            className={`px-4 py-3 rounded-xl text-sm font-bold transition-all flex items-center gap-1.5 ${
              running
                ? 'bg-red-500 hover:bg-red-600 text-white cursor-pointer'
                : 'bg-secondary border border-border text-muted-foreground opacity-40 cursor-not-allowed'
            }`}
            title={running ? 'Parar agente' : 'Agente não está rodando'}
          >
            <Square className="w-4 h-4" /> Parar
          </button>

          <button
            onClick={() => setShowSessions(s => !s)}
            className={`px-3 py-2.5 rounded-xl border transition-colors ${sessionStatus.instagram || sessionStatus.tiktok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600' : 'bg-secondary border-border text-muted-foreground hover:text-foreground'}`}
            title="Sessões de login"
          >
            <KeyRound className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowScheduler(s => !s)}
            className="px-3 py-2.5 rounded-xl bg-secondary border border-border text-muted-foreground hover:text-foreground transition-colors"
            title="Agendar"
          >
            <Calendar className="w-4 h-4" />
          </button>
        </div>

        {/* Sessões de login */}
        <AnimatePresence>
          {showSessions && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="border-t border-border pt-5 space-y-4">
                <div className="flex items-center gap-2">
                  <LogIn size={15} className="text-emerald-500" />
                  <span className="text-sm font-bold">Sessões de Login</span>
                  <span className="text-xs text-muted-foreground ml-1">— mais conteúdo com conta logada</span>
                </div>

                <div className="bg-secondary/50 rounded-xl p-3 text-xs text-muted-foreground space-y-1">
                  <p className="font-semibold text-foreground">Como obter o Session ID:</p>
                  <p>1. Abra o Instagram/TikTok no Chrome e faça login</p>
                  <p>2. Aperte F12 → aba <strong>Application</strong> → <strong>Cookies</strong></p>
                  <p>3. Copie o valor do cookie <strong>sessionid</strong></p>
                </div>

                {/* Instagram */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold flex items-center gap-1.5">
                      <span>📸 Instagram — sessionid</span>
                      {sessionStatus.instagram && <span className="text-emerald-500 text-[10px] font-bold">● ATIVO</span>}
                    </label>
                    {sessionStatus.instagram && (
                      <button onClick={() => removeSession('instagram')} className="text-[10px] text-red-400 hover:text-red-500">Remover</button>
                    )}
                  </div>
                  <input
                    type="password"
                    value={igSession}
                    onChange={e => setIgSession(e.target.value)}
                    placeholder={sessionStatus.instagram ? '••••• (sessão ativa — cole para atualizar)' : 'Cole o valor do cookie sessionid aqui'}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
                  />
                </div>

                {/* TikTok */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold flex items-center gap-1.5">
                      <span>🎵 TikTok — sessionid</span>
                      {sessionStatus.tiktok && <span className="text-emerald-500 text-[10px] font-bold">● ATIVO</span>}
                    </label>
                    {sessionStatus.tiktok && (
                      <button onClick={() => removeSession('tiktok')} className="text-[10px] text-red-400 hover:text-red-500">Remover</button>
                    )}
                  </div>
                  <input
                    type="password"
                    value={ttSession}
                    onChange={e => setTtSession(e.target.value)}
                    placeholder={sessionStatus.tiktok ? '••••• (sessão ativa — cole para atualizar)' : 'Cole o valor do cookie sessionid aqui'}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
                  />
                </div>

                <button
                  onClick={saveSessions}
                  disabled={sessionSaving || (!igSession && !ttSession)}
                  className="w-full py-2.5 bg-foreground text-background rounded-xl text-sm font-bold hover:opacity-90 disabled:opacity-40 transition-all flex items-center justify-center gap-2"
                >
                  {sessionSaving ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                  {sessionSaving ? 'Salvando...' : 'Salvar Sessões'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Agendador */}
        <AnimatePresence>
          {showScheduler && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="border-t border-border pt-5 space-y-4">

                {/* Frequência */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Frequência</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['daily', 'weekly'] as const).map(m => (
                      <button
                        key={m}
                        onClick={() => setSchedMode(m)}
                        className={`py-2.5 px-3 rounded-xl border text-sm font-bold transition-all ${
                          schedMode === m
                            ? 'bg-foreground text-background border-transparent'
                            : 'bg-secondary text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground'
                        }`}
                      >
                        {m === 'daily' ? 'Todo dia' : 'Dias específicos'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Dias da semana */}
                <AnimatePresence>
                  {schedMode === 'weekly' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-muted-foreground">Dias da semana</label>
                        <div className="flex gap-1.5 flex-wrap">
                          {WEEK_DAYS.map(({ value, label }) => {
                            const active = schedWeekdays.includes(value);
                            return (
                              <button
                                key={value}
                                onClick={() => toggleWeekday(value)}
                                className={`w-10 h-9 rounded-lg border text-xs font-bold transition-all ${
                                  active
                                    ? 'bg-foreground text-background border-transparent'
                                    : 'bg-secondary text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground'
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Horário */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Horário (Brasília)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min="0" max="23"
                      value={schedHour}
                      onChange={e => setSchedHour(String(e.target.value).padStart(2,'0'))}
                      className="w-20 bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-center focus:outline-none focus:ring-2 focus:ring-foreground/10"
                    />
                    <span className="font-bold text-muted-foreground">:</span>
                    <input
                      type="number" min="0" max="59"
                      value={schedMin}
                      onChange={e => setSchedMin(String(e.target.value).padStart(2,'0'))}
                      className="w-20 bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-center focus:outline-none focus:ring-2 focus:ring-foreground/10"
                    />
                    <button
                      onClick={saveSchedule}
                      className="ml-auto px-4 py-2.5 rounded-xl bg-foreground text-background text-sm font-bold hover:opacity-90 transition-opacity"
                    >
                      Salvar
                    </button>
                    {schedule.active && (
                      <button
                        onClick={removeSchedule}
                        className="p-2.5 rounded-xl border border-border text-muted-foreground hover:text-red-500 hover:border-red-200 transition-colors"
                        title="Remover agendamento"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Aviso */}
                <div className="flex items-start gap-2 p-3 bg-orange-50 border border-orange-100 rounded-xl">
                  <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-orange-700">O PC (ou servidor) precisa estar ligado no horário agendado.</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Erro */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-red-700 text-sm font-semibold">Erro no agente</p>
            <p className="text-red-600 text-xs mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Checklist em tempo real */}
      <AnimatePresence>
        {steps.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card border border-border rounded-2xl overflow-hidden"
            style={{ boxShadow: 'var(--shadow-card)' }}
          >
            {/* Header com progresso */}
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-orange-500" />
                <span className="text-sm font-bold">Progresso do Roteiro</span>
              </div>
              <span className="text-orange-500 text-sm font-mono font-bold">{progress}%</span>
            </div>

            {/* Barra de progresso */}
            <div className="h-1 bg-secondary">
              <motion.div
                className="h-full bg-orange-500"
                animate={{ width: `${progress}%` }}
                transition={{ type: 'spring', stiffness: 80 }}
              />
            </div>

            {/* Steps */}
            <div className="p-4 space-y-1.5">
              {steps.map((step, idx) => (
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  className={`flex items-start gap-3 p-2.5 rounded-xl transition-colors ${
                    step.status === 'running' ? 'bg-orange-50 border border-orange-100' :
                    step.status === 'error'   ? 'bg-red-50 border border-red-100' : ''
                  }`}
                >
                  <div className="mt-0.5 shrink-0">{STEP_ICON[step.status]}</div>
                  <div className="min-w-0">
                    <p className={`text-sm ${
                      step.status === 'running' ? 'text-orange-600 font-semibold' :
                      step.status === 'done'    ? 'text-muted-foreground' :
                      step.status === 'error'   ? 'text-red-600' :
                      'text-muted-foreground'
                    }`}>
                      {step.label}
                    </p>
                    {step.detail && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{step.detail}</p>
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
            <div className="bg-card border border-border rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--shadow-card)' }}>
              <div className="p-4 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  <span className="text-sm font-bold">
                    {results.videos.length} vídeos coletados — "{results.keyword}"
                  </span>
                </div>
                <span className="text-muted-foreground text-xs">
                  {new Date(results.collectedAt).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
                </span>
              </div>

              <div className="divide-y divide-border">
                {results.videos.map((v, i) => {
                  const { label } = PLATFORM_LABELS[v.platform] || PLATFORM_LABELS.tiktok;
                  return (
                    <div key={i} className="p-3 flex items-start gap-3 hover:bg-secondary/50 transition-colors">
                      <span className="text-xs px-2 py-0.5 rounded-md bg-secondary text-muted-foreground font-medium shrink-0 mt-0.5">
                        {label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{v.title || '(título não capturado)'}</p>
                        <div className="flex gap-3 mt-0.5 text-xs text-muted-foreground">
                          {v.views && <span>👁 {v.views}</span>}
                          {v.likes && <span>❤️ {v.likes}</span>}
                        </div>
                      </div>
                      {v.url && (
                        <a
                          href={v.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Botão: usar no Roteiro */}
              {onUseInRoteiro && results.videos.length > 0 && (
                <div className="p-4 border-t border-border">
                  <button
                    onClick={() => {
                      const refsText = results.videos
                        .map((v, i) => `${i + 1}. ${v.title || '(sem título)'} [${v.platform}] — ${v.url}`)
                        .join('\n');
                      onUseInRoteiro({ references: refsText });
                    }}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-colors"
                  >
                    <Zap className="w-4 h-4" />
                    Usar esses vídeos no Roteiro (passo 1.5)
                  </button>
                </div>
              )}
            </div>

            {/* Análise Claude */}
            {results.analysis && (
              <div className="bg-card border border-border rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--shadow-card)' }}>
                <button
                  onClick={() => setShowAnalysis(s => !s)}
                  className="w-full p-4 flex items-center justify-between hover:bg-secondary/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-orange-500" />
                    <span className="text-sm font-bold">Análise Claude — Formatos + Próximos Passos</span>
                  </div>
                  {showAnalysis
                    ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                    : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  }
                </button>

                <AnimatePresence>
                  {showAnalysis && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: 'auto' }}
                      exit={{ height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 border-t border-border">
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
