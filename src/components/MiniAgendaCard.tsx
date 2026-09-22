/**
 * MiniAgendaCard.tsx — Mini-agenda fixa na aba "Criar" (ao lado dos carrosséis).
 *
 * Objetivo: ver rapidamente quais DIAS/HORÁRIOS já estão ocupados — inclusive
 * meses à frente — pra programar um post novo sem sobrescrever data/horário.
 *
 * Só leitura. Lê a MESMA fonte do calendário grande (GET /api/mlabs/calendar,
 * agendados pelo app) + os agendamentos externos do mLabs em cache (sem forçar
 * refresh, pra ser leve). Mês navegável (‹ mês ›), começando no mês atual.
 * Marca conflito quando 2 posts ficam a < 1h um do outro (mesma regra do calendário).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, AlertTriangle } from 'lucide-react';

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

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// Cores por tipo (batem com o calendário grande). Fundo sólido pra ler nos 2 temas.
const KIND: Record<Entry['kind'], { label: string; dot: string; pill: string }> = {
  'carrossel':   { label: 'Carrossel',    dot: 'bg-blue-600',    pill: 'bg-blue-600 text-white' },
  'reel-ffmpeg': { label: 'Reel editado', dot: 'bg-amber-500',   pill: 'bg-amber-500 text-black' },
  'reel-pronto': { label: 'Reel pronto',  dot: 'bg-emerald-600', pill: 'bg-emerald-600 text-white' },
  'mlabs':       { label: 'mLabs',        dot: 'bg-purple-500',  pill: 'bg-purple-500 text-white' },
};

const pad = (n: number) => String(n).padStart(2, '0');
const dateKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

// Dois posts a menos de 60 min no mesmo dia = conflito (mesma regra do calendário grande).
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

export default function MiniAgendaCard() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const now = useMemo(() => new Date(), []);
  const [anchor, setAnchor] = useState<{ y: number; m: number }>({ y: now.getFullYear(), m: now.getMonth() });
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const local = fetch(`${API}/api/mlabs/calendar`).then((r) => r.json()).then((d) => (Array.isArray(d) ? d as Entry[] : [])).catch(() => [] as Entry[]);
    // mLabs externo: só cache, sem ?refresh (leitura barata). Best-effort — se falhar, ignora.
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
    Promise.all([local, external]).then(([a, b]) => { if (alive) { setEntries([...a, ...b]); setLoading(false); } });
    return () => { alive = false; };
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

  // Quantos posts há do mês visível em diante (referência rápida de "o que já está marcado").
  const futureCount = useMemo(() => {
    const floor = dateKey(anchor.y, anchor.m, 1);
    return entries.filter((e) => e.date >= floor).length;
  }, [entries, anchor]);

  function shiftMonth(delta: number) {
    setAnchor((a) => {
      const d = new Date(a.y, a.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
    setSelected(null);
  }

  const isCurrentMonth = anchor.y === now.getFullYear() && anchor.m === now.getMonth();

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden text-sm">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-secondary/50">
        <CalendarDays size={15} className="text-primary shrink-0" />
        <div className="min-w-0">
          <div className="font-bold text-foreground leading-tight">Agenda</div>
          <div className="text-[11px] text-muted-foreground leading-tight">onde dá pra encaixar sem colidir</div>
        </div>
      </div>

      {/* Navegação de mês */}
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
          {/* Grade do mês */}
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
              return (
                <button
                  key={i}
                  onClick={() => setSelected(isSel ? null : key)}
                  className={`relative aspect-square border-b border-r border-border/40 flex flex-col items-center justify-center gap-0.5 transition-colors
                    ${isSel ? 'bg-primary/15 ring-1 ring-inset ring-primary/50' : 'hover:bg-secondary/70'}
                    ${isPast ? 'opacity-45' : ''}`}
                >
                  <span className={`text-[11px] leading-none font-semibold ${isToday ? 'text-primary' : 'text-foreground'}`}>{d}</span>
                  {items.length > 0 ? (
                    <span className="flex items-center gap-0.5">
                      {clash && <span className="text-red-500 text-[10px] font-bold leading-none" title="Menos de 1h entre posts">!</span>}
                      {items.slice(0, 3).map((e, j) => (
                        <span key={j} className={`w-1.5 h-1.5 rounded-full ${KIND[e.kind].dot}`} />
                      ))}
                      {items.length > 3 && <span className="text-[8px] text-muted-foreground leading-none">+{items.length - 3}</span>}
                    </span>
                  ) : (
                    <span className="w-1.5 h-1.5" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Detalhe do dia selecionado */}
          {selected && (
            <div className="px-3 py-2.5 border-t border-border bg-secondary/30">
              <div className="text-[11px] font-bold text-foreground mb-1.5">
                {(() => { const [y, m, d] = selected.split('-').map(Number); return `${d} de ${MONTHS[m - 1]}`; })()}
              </div>
              {selItems.length === 0 ? (
                <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" /> Dia livre — pode agendar aqui
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {hasClash(selItems) && (
                    <div className="flex items-center gap-1 text-[10px] text-red-500 font-semibold mb-0.5">
                      <AlertTriangle size={11} /> Tem posts a menos de 1h um do outro
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
            </div>
          )}

          {/* Rodapé: legenda + contagem */}
          <div className="px-3 py-2 border-t border-border flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-600" /> dia com post · vazio = livre</span>
            <span className="font-semibold text-foreground whitespace-nowrap">{futureCount} agendado{futureCount === 1 ? '' : 's'}</span>
          </div>
        </>
      )}
    </div>
  );
}
