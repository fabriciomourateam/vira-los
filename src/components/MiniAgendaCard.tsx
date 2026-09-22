/**
 * MiniAgendaCard.tsx — Mini-agenda fixa na aba "Criar" (ao lado dos carrosséis).
 *
 * v1: ver quais DIAS/HORÁRIOS já estão ocupados (inclusive meses à frente), pra
 *     programar sem sobrescrever data/horário. Mês navegável, aviso de conflito <1h.
 * v2 (atalho): clicar num dia abre "Agendar aqui" — escolhe um carrossel salvo, o
 *     horário e quantos dias em sequência (padrão 4 = esse dia + os 3 seguintes), e
 *     agenda o MESMO carrossel nesses dias via POST /api/mlabs/schedule (o mesmo
 *     endpoint do botão Agendar de cada carrossel). Mostra conflito por dia antes.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, AlertTriangle, CalendarPlus } from 'lucide-react';
import { toast } from 'sonner';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface Entry {
  scheduleId: string;
  date: string;   // YYYY-MM-DD (Brasília)
  time: string;   // HH:MM
  kind: 'carrossel' | 'reel-ffmpeg' | 'reel-pronto' | 'mlabs';
  typeLabel: string;
  contentType: string;
  caption: string;
  status: string;
}

interface SavedCarousel {
  id: string;
  topic: string;
  folderName: string;
  numSlides: number;
  legenda: string;
  archived?: boolean;
  isTemplate?: boolean;
}

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const KIND: Record<Entry['kind'], { label: string; dot: string; pill: string }> = {
  'carrossel':   { label: 'Carrossel',    dot: 'bg-blue-600',    pill: 'bg-blue-600 text-white' },
  'reel-ffmpeg': { label: 'Reel editado', dot: 'bg-amber-500',   pill: 'bg-amber-500 text-black' },
  'reel-pronto': { label: 'Reel pronto',  dot: 'bg-emerald-600', pill: 'bg-emerald-600 text-white' },
  'mlabs':       { label: 'mLabs',        dot: 'bg-purple-500',  pill: 'bg-purple-500 text-white' },
};

const pad = (n: number) => String(n).padStart(2, '0');
const dateKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

function hasClash(items: Entry[]): boolean {
  return items.length > 1 && items.some((a, ai) => items.some((b, bi) => ai !== bi && Math.abs(toMin(a.time) - toMin(b.time)) < 60));
}

function monthWeeks(year: number, month: number): (number | null)[][] {
  const startDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// "YYYY-MM-DD" (dia base) + i dias → "YYYY-MM-DDTHH:MM" (mesma hora), respeitando virada de mês.
function seqDateTime(baseKey: string, addDays: number, time: string): { key: string; dt: string } {
  const [y, m, d] = baseKey.split('-').map(Number);
  const dd = new Date(y, m - 1, d + addDays);
  const key = dateKey(dd.getFullYear(), dd.getMonth(), dd.getDate());
  return { key, dt: `${key}T${time}` };
}

export default function MiniAgendaCard() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const now = useMemo(() => new Date(), []);
  const [anchor, setAnchor] = useState<{ y: number; m: number }>({ y: now.getFullYear(), m: now.getMonth() });
  const [selected, setSelected] = useState<string | null>(null);

  // Atalho de agendamento
  const [carousels, setCarousels] = useState<SavedCarousel[]>([]);
  const [selCarousel, setSelCarousel] = useState<string>('');
  const [time, setTime] = useState<string>('18:00');
  const [count, setCount] = useState<number>(4);
  const [submitting, setSubmitting] = useState(false);

  const loadCalendar = useCallback(() => {
    setLoading(true);
    const local = fetch(`${API}/api/mlabs/calendar`).then((r) => r.json()).then((d) => (Array.isArray(d) ? d as Entry[] : [])).catch(() => [] as Entry[]);
    const external = fetch(`${API}/api/mlabs/mlabs-schedules`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data): Entry[] => {
        if (!data || data.needsSync || !Array.isArray(data.items)) return [];
        return (data.items as { id: string; date: string; message?: string }[])
          .map((item): Entry | null => {
            const m = String(item.date).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
            if (!m) return null;
            return { scheduleId: `mlabs_${item.id}`, date: m[1], time: m[2], kind: 'mlabs', typeLabel: 'mLabs', contentType: 'mlabs', caption: item.message || '', status: 'agendado' };
          })
          .filter((x): x is Entry => x !== null);
      })
      .catch(() => [] as Entry[]);
    return Promise.all([local, external]).then(([a, b]) => { setEntries([...a, ...b]); setLoading(false); });
  }, []);

  useEffect(() => { loadCalendar(); }, [loadCalendar]);

  // Carrosséis salvos (pro seletor) + horário padrão configurado.
  useEffect(() => {
    fetch(`${API}/api/carousel/saved`).then((r) => r.json())
      .then((d) => {
        const list = (Array.isArray(d) ? d : []).filter((c: SavedCarousel) => !c.archived && !c.isTemplate);
        setCarousels(list);
        if (list.length) setSelCarousel((prev) => prev || list[0].id);
      })
      .catch(() => {});
    fetch(`${API}/api/mlabs/default-dates`).then((r) => r.json())
      .then((d) => {
        const first = Array.isArray(d?.dates) ? d.dates[0] : null;
        const m = first && String(first).match(/T(\d{2}:\d{2})/);
        if (m) setTime(m[1]);
      })
      .catch(() => {});
  }, []);

  const byDate = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of entries) {
      const arr = m.get(e.date) || [];
      arr.push(e);
      m.set(e.date, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.time.localeCompare(b.time));
    return m;
  }, [entries]);

  const todayKey = dateKey(now.getFullYear(), now.getMonth(), now.getDate());
  const weeks = monthWeeks(anchor.y, anchor.m);
  const selItems = selected ? (byDate.get(selected) || []) : [];
  const isCurrentMonth = anchor.y === now.getFullYear() && anchor.m === now.getMonth();

  const futureCount = useMemo(() => {
    const floor = dateKey(anchor.y, anchor.m, 1);
    return entries.filter((e) => e.date >= floor).length;
  }, [entries, anchor]);

  // Datas-alvo do atalho: dia selecionado + (count-1) dias seguidos, no horário escolhido.
  const targets = useMemo(() => {
    if (!selected) return [];
    return Array.from({ length: count }, (_, i) => {
      const { key, dt } = seqDateTime(selected, i, time);
      const dayItems = byDate.get(key) || [];
      const clash = dayItems.some((e) => Math.abs(toMin(e.time) - toMin(time)) < 60);
      const past = `${key}T${time}` < `${todayKey}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
      return { key, dt, clash, past };
    });
  }, [selected, count, time, byDate, todayKey, now]);

  function shiftMonth(delta: number) {
    setAnchor((a) => { const d = new Date(a.y, a.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
    setSelected(null);
  }

  async function agendar() {
    if (!selCarousel) { toast.error('Escolhe um carrossel primeiro.'); return; }
    const dates = targets.filter((t) => !t.past).map((t) => t.dt);
    if (!dates.length) { toast.error('Todas as datas escolhidas já passaram.'); return; }
    const cur = carousels.find((c) => c.id === selCarousel);
    setSubmitting(true);
    try {
      const r = await fetch(`${API}/api/mlabs/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: 'carousel', contentId: selCarousel, dates, caption: cur?.legenda || '' }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'falhou');
      toast.success(`Agendado em ${dates.length} dia(s)!`);
      await loadCalendar();
    } catch (e: any) {
      toast.error(`Não consegui agendar: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden text-sm">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-secondary/50">
        <CalendarDays size={15} className="text-primary shrink-0" />
        <div className="min-w-0">
          <div className="font-bold text-foreground leading-tight">Agenda</div>
          <div className="text-[11px] text-muted-foreground leading-tight">clique num dia pra ver ou agendar</div>
        </div>
      </div>

      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border">
        <button onClick={() => shiftMonth(-1)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors" aria-label="Mês anterior">
          <ChevronLeft size={16} />
        </button>
        <div className="text-center leading-tight">
          <div className="font-bold text-foreground text-[13px]">{MONTHS[anchor.m]} <span className="text-muted-foreground font-medium">{anchor.y}</span></div>
          {!isCurrentMonth && (
            <button onClick={() => { setAnchor({ y: now.getFullYear(), m: now.getMonth() }); setSelected(null); }} className="text-[10px] text-primary hover:underline">
              voltar pro mês atual
            </button>
          )}
        </div>
        <button onClick={() => shiftMonth(1)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors" aria-label="Próximo mês">
          <ChevronRight size={16} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-xs">
          <Loader2 size={15} className="animate-spin" /> carregando agenda…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-7 text-[10px] font-semibold text-muted-foreground uppercase border-b border-border/70">
            {WEEKDAYS.map((w, i) => <div key={i} className="py-1 text-center">{w}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {weeks.flat().map((d, i) => {
              if (d === null) return <div key={i} className="aspect-square border-b border-r border-border/40 bg-background/20" />;
              const key = dateKey(anchor.y, anchor.m, d);
              const items = byDate.get(key) || [];
              const isToday = key === todayKey;
              const isSel = key === selected;
              const clash = hasClash(items);
              const isPast = key < todayKey;
              const isTarget = targets.some((t) => t.key === key);
              return (
                <button
                  key={i}
                  onClick={() => setSelected(isSel ? null : key)}
                  className={`relative aspect-square border-b border-r border-border/40 flex flex-col items-center justify-center gap-0.5 transition-colors
                    ${isSel ? 'bg-primary/15 ring-1 ring-inset ring-primary/50' : isTarget ? 'bg-primary/5' : 'hover:bg-secondary/70'}
                    ${isPast ? 'opacity-45' : ''}`}
                >
                  <span className={`text-[11px] leading-none font-semibold ${isToday ? 'text-primary' : 'text-foreground'}`}>{d}</span>
                  {items.length > 0 ? (
                    <span className="flex items-center gap-0.5">
                      {clash && <span className="text-red-500 text-[10px] font-bold leading-none" title="Menos de 1h entre posts">!</span>}
                      {items.slice(0, 3).map((e, j) => <span key={j} className={`w-1.5 h-1.5 rounded-full ${KIND[e.kind].dot}`} />)}
                      {items.length > 3 && <span className="text-[8px] text-muted-foreground leading-none">+{items.length - 3}</span>}
                    </span>
                  ) : (
                    <span className="w-1.5 h-1.5" />
                  )}
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="px-3 py-2.5 border-t border-border bg-secondary/30 flex flex-col gap-2.5">
              <div className="text-[11px] font-bold text-foreground">
                {(() => { const [y, m, d] = selected.split('-').map(Number); return `${d} de ${MONTHS[m - 1]}`; })()}
              </div>

              {/* Posts já marcados nesse dia */}
              {selItems.length === 0 ? (
                <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" /> Dia livre
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {hasClash(selItems) && (
                    <div className="flex items-center gap-1 text-[10px] text-red-500 font-semibold">
                      <AlertTriangle size={11} /> Posts a menos de 1h um do outro
                    </div>
                  )}
                  {selItems.map((e, j) => (
                    <div key={j} className="flex items-center gap-2 text-[11px]">
                      <span className={`tabular-nums font-bold px-1.5 py-0.5 rounded ${KIND[e.kind].pill}`}>{e.time}</span>
                      <span className="text-foreground truncate">{e.typeLabel}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Atalho: agendar carrossel nesse dia + próximos */}
              <div className="rounded-xl border border-border bg-background/50 p-2.5 flex flex-col gap-2">
                <div className="text-[10px] font-bold uppercase tracking-wide text-primary flex items-center gap-1">
                  <CalendarPlus size={12} /> Agendar aqui
                </div>
                {carousels.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground">Nenhum carrossel salvo ainda — gere um primeiro.</div>
                ) : (
                  <>
                    <label className="text-[10px] text-muted-foreground -mb-1">Carrossel</label>
                    <select
                      value={selCarousel}
                      onChange={(e) => setSelCarousel(e.target.value)}
                      className="w-full text-[12px] rounded-lg border border-border bg-card px-2 py-1.5 text-foreground"
                    >
                      {carousels.map((c) => (
                        <option key={c.id} value={c.id}>{c.topic || c.folderName} ({c.numSlides} slides)</option>
                      ))}
                    </select>

                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-[10px] text-muted-foreground">Horário</label>
                        <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                          className="w-full text-[12px] rounded-lg border border-border bg-card px-2 py-1.5 text-foreground tabular-nums" />
                      </div>
                      <div className="w-[92px]">
                        <label className="text-[10px] text-muted-foreground">Dias seguidos</label>
                        <input type="number" min={1} max={14} value={count}
                          onChange={(e) => setCount(Math.max(1, Math.min(14, Number(e.target.value) || 1)))}
                          className="w-full text-[12px] rounded-lg border border-border bg-card px-2 py-1.5 text-foreground tabular-nums" />
                      </div>
                    </div>

                    {/* Preview das datas-alvo com aviso de conflito */}
                    <div className="flex flex-col gap-0.5">
                      {targets.map((t) => {
                        const [ty, tm, td] = t.key.split('-').map(Number);
                        return (
                          <div key={t.key} className={`flex items-center gap-1.5 text-[11px] ${t.past ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                            <span className="tabular-nums">{td}/{pad(tm)} {time}</span>
                            {t.past && <span className="text-[9px] text-muted-foreground">(passou)</span>}
                            {!t.past && t.clash && <span className="text-red-500 text-[10px] font-semibold flex items-center gap-0.5"><AlertTriangle size={9} /> colide</span>}
                            {!t.past && !t.clash && <span className="text-emerald-600 dark:text-emerald-400 text-[10px]">livre</span>}
                          </div>
                        );
                      })}
                    </div>
                    {targets.some((t) => !t.past && t.clash) && (
                      <div className="text-[10px] text-amber-600 dark:text-amber-400">⚠️ Algum dia colide com post existente (&lt;1h). Ele ainda será agendado — mude o horário se não quiser.</div>
                    )}

                    <button
                      onClick={agendar}
                      disabled={submitting || !selCarousel}
                      className="mt-0.5 w-full flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground text-[12px] font-bold py-2 disabled:opacity-60 hover:opacity-90 transition-opacity"
                    >
                      {submitting ? <Loader2 size={13} className="animate-spin" /> : <CalendarPlus size={13} />}
                      Agendar em {targets.filter((t) => !t.past).length} dia(s)
                    </button>
                    <div className="text-[9px] text-muted-foreground leading-tight">Agenda o MESMO carrossel nesses dias, direto no mLabs (igual ao botão Agendar do carrossel).</div>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="px-3 py-2 border-t border-border flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-600" /> dia com post · vazio = livre</span>
            <span className="font-semibold text-foreground whitespace-nowrap">{futureCount} agendado{futureCount === 1 ? '' : 's'}</span>
          </div>
        </>
      )}
    </div>
  );
}
