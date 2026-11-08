import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, CalendarClock, Check, Trash2, X, RefreshCw, ClipboardCheck, AlertTriangle,
} from 'lucide-react';

// Carrosséis gerados pelo robô aguardando revisão: Aprovar (agenda evergreen) ou Descartar.

interface PendingCarousel {
  id: string;
  topic: string;
  folderName: string;
  numSlides: number;
  screenshots: string[];
  legenda: string;
  source?: string;
  themeId?: string;
  created_at?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0); };

// Soma `months` a "AAAA-MM-DDTHH:MM" preservando a hora (mesma lógica de setMonth
// do MiniAgendaCard/MlabsScheduler e do backend).
function shiftMonthsLocal(base: string, months: number): string {
  const m = String(base).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return base;
  const dt = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  dt.setMonth(dt.getMonth() + months);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function tomorrowKey(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtDate(dt: string): string {
  const m = dt.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return dt;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) + ` às ${m[4]}:${m[5]}`;
}

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof data.error === 'string') return data.error;
  } catch { /* corpo não-JSON */ }
  return `Erro ${res.status}`;
}

interface Props {
  api: string;
  /** Chamado após aprovar (ex.: recarregar a lista de salvos). */
  onApproved?: () => void;
}

export default function CarouselReviewPanel({ api, onApproved }: Props) {
  const [pending, setPending] = useState<PendingCarousel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [thumbIdx, setThumbIdx] = useState<Record<string, number>>({});

  // Aprovar
  const [approving, setApproving] = useState<PendingCarousel | null>(null);
  const [dateStr, setDateStr] = useState(tomorrowKey());
  const [timeStr, setTimeStr] = useState('11:00');
  const [intervalMonths, setIntervalMonths] = useState(3);
  const [repetitions, setRepetitions] = useState(4);
  const [caption, setCaption] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Descartar (confirmação inline)
  const [confirmDismissId, setConfirmDismissId] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  // Seleção em lote
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState<'selected' | 'all' | null>(null);

  // Agenda existente (local + mLabs) pra avisar encavalamento de data/hora — mesma
  // fonte e regra (<1h) do calendário ao lado (MiniAgendaCard).
  const [sched, setSched] = useState<{ date: string; time: string; label: string }[]>([]);
  const loadSchedule = useCallback(async () => {
    try {
      const localP = fetch(`${api}/api/mlabs/calendar`).then(r => (r.ok ? r.json() : [])).catch(() => []);
      const extP = fetch(`${api}/api/mlabs/mlabs-schedules`).then(r => (r.ok ? r.json() : null)).catch(() => null);
      const [local, ext] = await Promise.all([localP, extP]);
      const out: { date: string; time: string; label: string }[] = [];
      if (Array.isArray(local)) for (const e of local) {
        if (e?.date && e?.time) out.push({ date: e.date, time: e.time, label: e.typeLabel || e.contentType || 'post' });
      }
      if (ext && !ext.needsSync && Array.isArray(ext.items)) for (const it of ext.items) {
        const m = String(it.date).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
        if (m) out.push({ date: m[1], time: m[2], label: 'mLabs' });
      }
      setSched(out);
    } catch { /* agenda indisponível: sem aviso, não bloqueia aprovar */ }
  }, [api]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`${api}/api/carousel/review`);
      if (!res.ok) throw new Error(await readError(res));
      const data = await res.json();
      setPending(Array.isArray(data?.pending) ? data.pending : []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Falha ao carregar');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); loadSchedule(); }, [load, loadSchedule]);

  const totalDates = intervalMonths <= 0 ? 1 : Math.max(1, repetitions);
  const dates = useMemo(() => {
    if (!dateStr || !timeStr) return [];
    const first = `${dateStr}T${timeStr}`;
    return Array.from({ length: totalDates }, (_, k) => (k === 0 ? first : shiftMonthsLocal(first, k * intervalMonths)));
  }, [dateStr, timeStr, intervalMonths, totalDates]);

  // Pra cada data-alvo (inclusive os meses futuros do evergreen), vê se encavala com
  // um post já agendado no mesmo dia a menos de 1h — mesma regra do calendário.
  const dateClashes = useMemo(() => {
    return dates.map((dt) => {
      const m = dt.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
      if (!m) return { clash: false, conflicts: [] as string[] };
      const mine = toMin(m[2]);
      const conflicts = sched
        .filter((e) => e.date === m[1] && Math.abs(toMin(e.time) - mine) < 60)
        .map((e) => `${e.time} ${e.label}`);
      return { clash: conflicts.length > 0, conflicts };
    });
  }, [dates, sched]);
  const anyClash = dateClashes.some((c) => c.clash);

  function openApprove(item: PendingCarousel) {
    setApproving(item);
    setDateStr(tomorrowKey());
    setTimeStr('11:00');
    setIntervalMonths(3);
    setRepetitions(4);
    setCaption(item.legenda || '');
    setSubmitError(null);
    loadSchedule(); // atualiza a agenda pra o aviso de encavalamento sair fresco
  }

  function closeApprove() {
    if (submitting) return;
    setApproving(null);
  }

  async function submitApprove() {
    if (!approving || !dateStr || !timeStr) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`${api}/api/carousel/saved/${approving.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstDate: `${dateStr}T${timeStr}`,
          intervalMonths,
          repetitions,
          caption,
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const data: { ok?: boolean; dates?: string[]; error?: string } = await res.json();
      if (data.error) throw new Error(data.error);
      const n = Array.isArray(data.dates) ? data.dates.length : dates.length;
      toast.success(`Agendado em ${n} data(s)`);
      const id = approving.id;
      setPending(p => p.filter(x => x.id !== id));
      setApproving(null);
      onApproved?.();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Erro ao agendar');
    } finally {
      setSubmitting(false);
    }
  }

  async function doDismiss(id: string) {
    setDismissingId(id);
    try {
      const res = await fetch(`${api}/api/carousel/saved/${id}/dismiss`, { method: 'POST' });
      if (!res.ok) throw new Error(await readError(res));
      setPending(p => p.filter(x => x.id !== id));
      setConfirmDismissId(null);
      toast.success('Carrossel descartado');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao descartar');
    } finally {
      setDismissingId(null);
    }
  }

  function step(item: PendingCarousel, delta: number) {
    const n = item.screenshots.length;
    if (n < 2) return;
    setThumbIdx(prev => ({ ...prev, [item.id]: (((prev[item.id] ?? 0) + delta) % n + n) % n }));
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  function toggleSelectAll() {
    setSelected(prev => (prev.size === pending.length ? new Set() : new Set(pending.map(p => p.id))));
  }

  async function doBulkDismiss(mode: 'selected' | 'all') {
    setBulkBusy(true);
    try {
      const body = mode === 'all' ? { all: true } : { ids: [...selected] };
      const res = await fetch(`${api}/api/carousel/review/dismiss-bulk`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readError(res));
      const data: { dismissed?: number } = await res.json();
      if (mode === 'all') setPending([]);
      else setPending(p => p.filter(x => !selected.has(x.id)));
      setSelected(new Set());
      setConfirmBulk(null);
      toast.success(`${data.dismissed ?? 0} carrossel(is) descartado(s)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao descartar em lote');
    } finally {
      setBulkBusy(false);
    }
  }

  const allSelected = pending.length > 0 && selected.size === pending.length;

  return (
    <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          <ClipboardCheck className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-foreground">Revisar e aprovar</span>
          <span className="text-xs text-muted-foreground">
            {loading ? '(carregando…)' : `(${pending.length} pendente${pending.length === 1 ? '' : 's'})`}
          </span>
        </button>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          title="Recarregar"
          className="ml-auto p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {open && (
        <>
          {loading && pending.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
            </div>
          )}
          {loadError && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-400 flex items-center gap-2">
              <span className="flex-1">Não foi possível carregar: {loadError}</span>
              <button type="button" onClick={load} className="px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 font-semibold">Tentar de novo</button>
            </div>
          )}
          {!loading && !loadError && pending.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">Nada pra revisar 🎉</p>
          )}

          {!loading && !loadError && pending.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/60 p-2">
              <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer select-none">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="accent-amber-500 w-4 h-4" />
                Selecionar todos
              </label>
              <span className="text-xs text-muted-foreground">{selected.size} selecionado(s)</span>
              <div className="ml-auto flex items-center gap-2">
                {confirmBulk ? (
                  <>
                    <span className="text-xs text-red-400">
                      {confirmBulk === 'all' ? `Descartar TODOS os ${pending.length}?` : `Descartar ${selected.size} selecionado(s)?`}
                    </span>
                    <button type="button" disabled={bulkBusy} onClick={() => doBulkDismiss(confirmBulk)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold disabled:opacity-50">
                      {bulkBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />} Sim, descartar
                    </button>
                    <button type="button" disabled={bulkBusy} onClick={() => setConfirmBulk(null)} className="px-2.5 py-1.5 rounded-lg bg-secondary text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50">Cancelar</button>
                  </>
                ) : (
                  <>
                    <button type="button" disabled={selected.size === 0} onClick={() => setConfirmBulk('selected')} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-red-400 text-xs font-semibold disabled:opacity-40">
                      <Trash2 className="w-3 h-3" /> Descartar selecionados
                    </button>
                    <button type="button" onClick={() => setConfirmBulk('all')} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-600/90 hover:bg-red-500 text-white text-xs font-semibold">
                      <Trash2 className="w-3 h-3" /> Descartar todos
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {pending.map(item => {
              const idx = thumbIdx[item.id] ?? 0;
              const shot = item.screenshots?.[idx];
              const busy = dismissingId === item.id;
              return (
                <div key={item.id} className={`rounded-lg border bg-card overflow-hidden flex flex-col ${selected.has(item.id) ? 'border-amber-500 ring-2 ring-amber-500/60' : 'border-border'}`}>
                  <div className="relative aspect-[4/5] bg-secondary">
                    <label className="absolute left-1.5 top-1.5 z-10 cursor-pointer bg-black/50 rounded p-0.5 flex" title="Selecionar">
                      <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelect(item.id)} className="accent-amber-500 w-5 h-5" />
                    </label>
                    {shot ? (
                      <img src={`${api}/output/${item.folderName}/${shot}`} alt={item.topic} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">Sem prévia</div>
                    )}
                    {item.screenshots?.length > 1 && (
                      <>
                        <button type="button" onClick={() => step(item, -1)} className="absolute left-1 top-1/2 -translate-y-1/2 p-1 rounded-full bg-black/60 text-white hover:bg-black/80">
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => step(item, 1)} className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-full bg-black/60 text-white hover:bg-black/80">
                          <ChevronRight className="w-4 h-4" />
                        </button>
                        <span className="absolute bottom-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">
                          {idx + 1}/{item.screenshots.length}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="p-3 space-y-2 flex-1 flex flex-col">
                    <div>
                      <p className="text-sm font-semibold text-foreground leading-snug">{item.topic}</p>
                      {item.source && (
                        <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">
                          origem: {item.source}
                        </span>
                      )}
                    </div>
                    {item.legenda && (
                      <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-line">{item.legenda}</p>
                    )}
                    <div className="mt-auto pt-1">
                      {confirmDismissId === item.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-red-400 flex-1">Descartar este carrossel?</span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => doDismiss(item.id)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold disabled:opacity-50"
                          >
                            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />} Sim
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirmDismissId(null)}
                            className="px-2.5 py-1.5 rounded-lg bg-secondary text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
                          >
                            Não
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openApprove(item)}
                            disabled={busy}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                          >
                            <Check className="w-3.5 h-3.5" /> Aprovar
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDismissId(item.id)}
                            disabled={busy}
                            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-red-400 text-xs font-semibold transition-colors disabled:opacity-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Descartar
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {approving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={closeApprove}>
          <div
            className="bg-card border border-border rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-foreground inline-flex items-center gap-2">
                <CalendarClock size={18} className="text-emerald-400" /> Aprovar e agendar
              </h3>
              <button onClick={closeApprove} disabled={submitting} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">{approving.topic}</p>

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Data</span>
                <input
                  type="date" value={dateStr} onChange={e => setDateStr(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Hora</span>
                <input
                  type="time" value={timeStr} onChange={e => setTimeStr(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Repostar de N em N meses</span>
                <input
                  type="number" min={0} max={12} value={intervalMonths}
                  onChange={e => setIntervalMonths(Math.max(0, Math.min(12, Number(e.target.value) || 0)))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
                {intervalMonths === 0 && <span className="text-[10px] text-amber-400">0 = posta só 1 vez</span>}
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Repetições</span>
                <input
                  type="number" min={1} max={24} value={repetitions} disabled={intervalMonths === 0}
                  onChange={e => setRepetitions(Math.max(1, Math.min(24, Number(e.target.value) || 1)))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-50"
                />
              </label>
            </div>

            <div className={`rounded-lg border p-3 space-y-1 ${anyClash ? 'border-amber-500/50 bg-amber-500/5' : 'border-border bg-background'}`}>
              <p className="text-xs font-semibold text-foreground">Vai postar em {dates.length} data(s)</p>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {dates.map((d, i) => {
                  const c = dateClashes[i];
                  return (
                    <li key={d + i} className={c?.clash ? 'text-red-400' : ''}>
                      {i + 1}. {fmtDate(d)}
                      {c?.clash && (
                        <span className="ml-1 inline-flex items-center gap-0.5 font-semibold" title={`Já tem: ${c.conflicts.join(', ')}`}>
                          <AlertTriangle size={11} /> encavala
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {anyClash ? (
                <p className="text-[11px] text-amber-500 flex items-start gap-1 pt-0.5">
                  <AlertTriangle size={12} className="shrink-0 mt-px" />
                  <span>Alguma data cai a menos de 1h de um post já agendado (inclusive meses à frente). Vai agendar mesmo assim — mude a data/hora se não quiser sobrepor.</span>
                </p>
              ) : (
                <p className="text-[10px] text-muted-foreground">Horário de Brasília. Nenhum choque com posts já agendados.</p>
              )}
            </div>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Legenda</span>
              <textarea
                value={caption} onChange={e => setCaption(e.target.value)} rows={6}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              />
            </label>

            {submitError && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-400">{submitError}</div>
            )}

            <div className="flex items-center gap-2 justify-end">
              <button
                type="button" onClick={closeApprove} disabled={submitting}
                className="px-3 py-2 rounded-lg bg-secondary text-sm font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button" onClick={submitApprove} disabled={submitting || !dateStr || !timeStr}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50"
              >
                {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Agendando…</> : <><CalendarClock className="w-4 h-4" /> Agendar e postar</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
