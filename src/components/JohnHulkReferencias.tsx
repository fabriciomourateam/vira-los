import React, { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  Dumbbell, Sparkles, Loader2, Image as ImageIcon, ExternalLink,
  Copy, ChevronDown, ChevronUp, AlertTriangle, CalendarClock, Check, Clock,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface Step { id: string; label: string; status: 'running' | 'done' | 'error'; ms: number; error?: string; }
interface Carousel {
  id: string; topic: string; folderName: string; numSlides: number;
  screenshots?: string[]; legenda?: string; layoutStyle?: string; source?: string; archived?: boolean;
  sourceReel?: { shortCode?: string; url?: string; handle?: string };
  derivedTopic?: string;
}
interface Batch {
  id: string; date: string; trigger?: string; handle?: string;
  reelShortCode?: string; reelUrl?: string; topic?: string; carouselId?: string;
  steps: Step[]; note?: string;
  status: 'generating' | 'done' | 'partial' | 'error';
  errors?: string[]; created_at?: string; carousel?: Carousel | null;
}
interface JohnHulkState { generating: boolean; startedAt?: string; lastError?: string; }
interface Settings { johnHulkEnabled: boolean; autoScheduleJohnHulk: boolean; }

const STATUS_BADGE: Record<string, string> = {
  generating: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  done: 'bg-green-500/15 text-green-400 border-green-500/30',
  partial: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  error: 'bg-red-500/15 text-red-400 border-red-500/30',
};

const STEP_BADGE: Record<string, string> = {
  running: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  done: 'bg-green-500/15 text-green-400 border-green-500/30',
  error: 'bg-red-500/15 text-red-400 border-red-500/30',
};

function copy(text: string) {
  navigator.clipboard.writeText(text).then(() => toast.success('Copiado!'));
}

// Toggle no mesmo padrão visual usado no MlabsSettingsModal (checkbox estilizado, sem shadcn).
function ToggleRow({ label, hint, checked, onChange, disabled }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <label className={`flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/30 px-3 py-2.5 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <span className="text-sm text-foreground">
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <input
        type="checkbox" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="w-5 h-5 accent-purple-500 shrink-0"
      />
    </label>
  );
}

export default function JohnHulkReferencias() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [state, setState] = useState<JohnHulkState>({ generating: false });
  const [settings, setSettings] = useState<Settings>({ johnHulkEnabled: true, autoScheduleJohnHulk: false });
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [openCaption, setOpenCaption] = useState<Record<string, boolean>>({});
  const [openSteps, setOpenSteps] = useState<Record<string, boolean>>({});
  const [approving, setApproving] = useState<Record<string, boolean>>({});
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/john-hulk`);
      if (res.ok) {
        const data = await res.json();
        setBatches(data.batches || []);
        setState(data.state || { generating: false });
        if (data.settings) setSettings(data.settings);
        return data.state?.generating;
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
    return false;
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Enquanto gera, faz polling a cada 6s e para quando terminar (mesmo padrão do Conteúdo Diário).
  useEffect(() => {
    if (state.generating && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        const stillGen = await fetchData();
        if (!stillGen && pollRef.current) {
          clearInterval(pollRef.current); pollRef.current = null;
          toast.success('Geração do John Hulk concluída!');
        }
      }, 6000);
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [state.generating, fetchData]);

  async function handleGenerate() {
    try {
      const res = await fetch(`${API}/api/john-hulk/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trigger: 'manual' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao iniciar.');
      setState({ generating: true });
      toast.info('Buscando reel de referência e gerando carrossel... leva alguns minutos.');
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao gerar.');
    }
  }

  async function handleSettingsChange(patch: Partial<Settings>) {
    setSettings((s) => ({ ...s, ...patch }));
    setSavingSettings(true);
    try {
      const res = await fetch(`${API}/api/john-hulk/settings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error();
      setSettings(data);
    } catch {
      toast.error('Não consegui salvar a configuração — atualize a página.');
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleApprove(batch: Batch) {
    setApproving((s) => ({ ...s, [batch.id]: true }));
    try {
      const res = await fetch(`${API}/api/john-hulk/${batch.id}/approve`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao aprovar/agendar.');
      setApproved((s) => ({ ...s, [batch.id]: true }));
      toast.success('Aprovado e agendado no mLabs!');
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao aprovar/agendar.');
    } finally {
      setApproving((s) => ({ ...s, [batch.id]: false }));
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground"><Loader2 size={26} className="animate-spin mr-2" /> Carregando...</div>;
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Dumbbell size={22} className="text-purple-400" />
          <h2 className="text-xl font-bold text-foreground">Referências (John Hulk)</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleGenerate}
            disabled={state.generating}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-foreground text-sm font-semibold transition-colors disabled:opacity-60"
          >
            {state.generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {state.generating ? 'Gerando...' : 'Gerar agora'}
          </button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Pega o reel mais recente de uma conta de referência, transcreve e gera um carrossel no
        estilo FMTeam como <b className="text-foreground">rascunho</b> pra revisão. Nada é postado
        sem aprovação (a menos que "Auto-agendar" esteja ligado).
      </p>

      {/* Configurações */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ToggleRow
          label="Ativado (johnHulkEnabled)"
          hint="Kill-switch — desliga a geração automática/manual deste job."
          checked={settings.johnHulkEnabled}
          disabled={savingSettings}
          onChange={(v) => handleSettingsChange({ johnHulkEnabled: v })}
        />
        <ToggleRow
          label="Auto-agendar no mLabs (autoScheduleJohnHulk)"
          hint="Agenda automaticamente ao gerar, sem passar por aprovação manual."
          checked={settings.autoScheduleJohnHulk}
          disabled={savingSettings}
          onChange={(v) => handleSettingsChange({ autoScheduleJohnHulk: v })}
        />
      </div>

      {batches.length === 0 && !state.generating && (
        <div className="bg-card border border-border rounded-2xl p-6 text-center text-muted-foreground">
          Nada gerado ainda. Clique em <b className="text-foreground">Gerar agora</b>.
        </div>
      )}

      {batches.map((b) => {
        const c = b.carousel;
        const stepsOpen = openSteps[b.id];
        const captionOpen = openCaption[b.id];
        const alreadyApproved = approved[b.id];
        return (
          <div key={b.id} className="bg-card border border-border rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-foreground">{new Date(b.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_BADGE[b.status] || ''}`}>{b.status}</span>
              {b.trigger === 'cron' && <span className="text-xs text-muted-foreground">(automático)</span>}
              {b.handle && <span className="text-xs text-muted-foreground">· fonte: @{b.handle}</span>}
              {(b.topic || c?.derivedTopic) && (
                <span className="text-xs text-muted-foreground">· tema: {b.topic || c?.derivedTopic}</span>
              )}
              {b.reelUrl && (
                <a href={b.reelUrl} target="_blank" rel="noreferrer" className="text-xs text-purple-400 hover:text-purple-300 inline-flex items-center gap-1">
                  <ExternalLink size={11} /> reel original
                </a>
              )}
            </div>

            {b.note && (
              <div className="flex items-start gap-2 text-xs text-muted-foreground bg-secondary/40 border border-border rounded-lg p-2">
                <Clock size={13} className="shrink-0 mt-0.5" /> {b.note}
              </div>
            )}

            {b.errors && b.errors.length > 0 && (
              <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-2">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {b.errors.join(' · ')}
              </div>
            )}

            {/* Steps (observabilidade) */}
            {b.steps && b.steps.length > 0 && (
              <div>
                <button onClick={() => setOpenSteps((s) => ({ ...s, [b.id]: !s[b.id] }))} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                  Etapas ({b.steps.length}) {stepsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                {stepsOpen && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {b.steps.map((s) => (
                      <span key={s.id} title={s.error || s.label} className={`text-[11px] px-1.5 py-0.5 rounded border ${STEP_BADGE[s.status] || ''}`}>
                        {s.label} · {s.status} · {s.ms}ms
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Carrossel (quando existe) */}
            {c && (
              <div className="border border-border rounded-xl overflow-hidden bg-secondary/30">
                <div className="p-3 space-y-3">
                  <div className="flex items-center gap-1.5 text-xs text-purple-400">
                    <ImageIcon size={13} /> Carrossel · {c.numSlides} slides {c.archived && <span className="text-muted-foreground">(arquivado)</span>}
                  </div>
                  <p className="text-sm font-medium text-foreground">{c.topic}</p>

                  {c.screenshots && c.screenshots.length > 0 ? (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {c.screenshots.map((shot, i) => (
                        <img
                          key={shot + i}
                          src={`${API}/output/${c.folderName}/${shot}`}
                          alt={`${c.topic} — slide ${i + 1}`}
                          className="h-40 w-auto rounded-lg border border-border object-cover shrink-0"
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="h-24 flex items-center justify-center text-muted-foreground text-xs bg-secondary rounded-lg">
                      <ImageIcon size={16} className="mr-1.5" /> Sem screenshots
                    </div>
                  )}

                  <div className="flex items-center gap-3 flex-wrap">
                    <a href={`${API}/output/${c.folderName}/carrossel.html`} target="_blank" rel="noreferrer" className="text-xs text-purple-400 hover:text-purple-300 inline-flex items-center gap-1">
                      <ExternalLink size={12} /> Abrir carrossel
                    </a>
                    {c.legenda && (
                      <button onClick={() => setOpenCaption((s) => ({ ...s, [b.id]: !s[b.id] }))} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                        Legenda {captionOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    )}
                    <button
                      onClick={() => handleApprove(b)}
                      disabled={approving[b.id] || alreadyApproved || !c.screenshots?.length}
                      className="text-xs font-medium text-foreground bg-blue-600 hover:bg-blue-500 px-2.5 py-1 rounded-lg inline-flex items-center gap-1 transition-colors disabled:opacity-60"
                    >
                      {approving[b.id] ? <Loader2 size={12} className="animate-spin" /> : alreadyApproved ? <Check size={12} /> : <CalendarClock size={12} />}
                      {alreadyApproved ? 'Aprovado' : 'Aprovar → agendar no mLabs'}
                    </button>
                  </div>

                  {captionOpen && c.legenda && (
                    <div>
                      <div className="bg-background border border-border rounded-lg p-2 text-xs text-muted-foreground whitespace-pre-wrap max-h-40 overflow-auto">{c.legenda}</div>
                      <button onClick={() => copy(c.legenda!)} className="mt-1.5 text-xs text-purple-400 inline-flex items-center gap-1"><Copy size={11} /> Copiar legenda</button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
