/**
 * AgendaCalendario.tsx — Calendário de agendamentos (planejamento de conteúdo).
 *
 * Puxa GET /api/mlabs/calendar (carrosséis + reels que VOCÊ agendou pelo app) e
 * mostra em grade de mês, DOIS meses lado a lado (atual + seguinte), com
 * navegação pros meses futuros. Cada dia mostra sempre data, horário e o tipo
 * postado (Carrossel / Reel editado com ffmpeg / Reel pronto). Clicar num dia
 * abre os detalhes (legenda completa) embaixo.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Loader2 } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface Entry {
  scheduleId: string;
  date: string;   // YYYY-MM-DD (Brasília)
  time: string;   // HH:MM
  kind: 'carrossel' | 'reel-ffmpeg' | 'reel-pronto';
  typeLabel: string;
  contentType: string;
  caption: string;
  status: string;
  platformsCount: number;
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// Estilo por tipo de conteúdo — pílula de fundo SÓLIDO e texto de alto contraste
// (lê bem no tema claro e no escuro; o translúcido sumia no fundo branco).
const KIND: Record<Entry['kind'], { label: string; dot: string; pill: string; bar: string }> = {
  'carrossel':   { label: 'Carrossel',    dot: 'bg-blue-600',    pill: 'bg-blue-600 text-white',     bar: 'border-l-blue-600' },
  'reel-ffmpeg': { label: 'Reel editado', dot: 'bg-amber-500',   pill: 'bg-amber-500 text-black',    bar: 'border-l-amber-500' },
  'reel-pronto': { label: 'Reel pronto',  dot: 'bg-emerald-600', pill: 'bg-emerald-600 text-white',  bar: 'border-l-emerald-600' },
};

const pad = (n: number) => String(n).padStart(2, '0');
const dateKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

// Matriz do mês: array de semanas (7 dias), começando no Domingo. null = vazio.
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

function MonthGrid({ year, month, byDate, todayKey, selected, onSelect }: {
  year: number; month: number;
  byDate: Map<string, Entry[]>;
  todayKey: string;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const weeks = monthWeeks(year, month);
  return (
    <div className="rounded-xl border border-border bg-background/40 overflow-hidden">
      <div className="px-3 py-2 text-sm font-bold text-foreground bg-background/60 border-b border-border">
        {MONTHS[month]} <span className="text-muted-foreground font-medium">{year}</span>
      </div>
      <div className="grid grid-cols-7 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">
        {WEEKDAYS.map((w) => <div key={w} className="px-1.5 py-1.5 text-center">{w}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {weeks.flat().map((d, i) => {
          if (d === null) return <div key={i} className="min-h-[70px] border-b border-r border-border/50 bg-background/20" />;
          const key = dateKey(year, month, d);
          const items = byDate.get(key) || [];
          const isToday = key === todayKey;
          const isSel = key === selected;
          return (
            <button
              key={i}
              onClick={() => onSelect(key)}
              className={`min-h-[70px] border-b border-r border-border/50 p-1 text-left align-top flex flex-col gap-0.5 transition-colors
                ${isSel ? 'bg-blue-500/10 ring-1 ring-inset ring-blue-500/40' : 'hover:bg-background/60'}`}
            >
              <span className={`text-[11px] font-semibold self-end leading-none ${isToday ? 'text-blue-400' : 'text-muted-foreground'}`}>
                {isToday ? `${d} • hoje` : d}
              </span>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                {items.slice(0, 3).map((e, j) => (
                  <span key={j} className={`text-[10px] leading-tight rounded px-1 py-0.5 truncate font-semibold ${KIND[e.kind].pill}`}
                    title={`${e.time} · ${e.typeLabel}`}>
                    <span className="tabular-nums">{e.time}</span> {e.typeLabel.replace('Reel ', 'R. ')}
                  </span>
                ))}
                {items.length > 3 && <span className="text-[9px] font-medium text-muted-foreground pl-0.5">+{items.length - 3} mais</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function AgendaCalendario() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  // Âncora = 1º mês visível. O 2º é âncora+1.
  const now = new Date();
  const [anchor, setAnchor] = useState<{ y: number; m: number }>({ y: now.getFullYear(), m: now.getMonth() });
  const [selected, setSelected] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetch(`${API}/api/mlabs/calendar`)
      .then((r) => r.json())
      .then((d) => setEntries(Array.isArray(d) ? d : []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

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
  const second = anchor.m === 11 ? { y: anchor.y + 1, m: 0 } : { y: anchor.y, m: anchor.m + 1 };
  const shift = (delta: number) => setAnchor((a) => {
    const idx = a.y * 12 + a.m + delta;
    return { y: Math.floor(idx / 12), m: ((idx % 12) + 12) % 12 };
  });
  const goToday = () => setAnchor({ y: now.getFullYear(), m: now.getMonth() });

  const selItems = selected ? (byDate.get(selected) || []) : [];
  const counts = useMemo(() => {
    const c = { carrossel: 0, 'reel-ffmpeg': 0, 'reel-pronto': 0 } as Record<Entry['kind'], number>;
    for (const e of entries) c[e.kind]++;
    return c;
  }, [entries]);

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground inline-flex items-center gap-2">
            <CalendarDays size={20} className="text-blue-400" /> Agenda de conteúdo
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Tudo o que você agendou pelo app (carrosséis e reels), em horário de Brasília. Use pra planejar os próximos.
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="text-xs font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 border border-border rounded-lg px-2.5 py-1.5">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Atualizar
        </button>
      </div>

      {/* Legenda + navegação */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {(Object.keys(KIND) as Entry['kind'][]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span className={`w-2.5 h-2.5 rounded-full ${KIND[k].dot}`} /> {KIND[k].label}
              <span className="text-foreground/60 tabular-nums">({counts[k]})</span>
            </span>
          ))}
        </div>
        <div className="inline-flex items-center gap-1">
          <button onClick={() => shift(-1)} className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground" title="Meses anteriores"><ChevronLeft size={16} /></button>
          <button onClick={goToday} className="text-xs font-medium text-foreground border border-border rounded-lg px-2.5 py-1.5 hover:bg-background/60">Hoje</button>
          <button onClick={() => shift(1)} className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground" title="Próximos meses"><ChevronRight size={16} /></button>
        </div>
      </div>

      {/* Dois meses lado a lado (empilha no mobile) */}
      <div className="grid md:grid-cols-2 gap-4">
        <MonthGrid year={anchor.y} month={anchor.m} byDate={byDate} todayKey={todayKey} selected={selected} onSelect={setSelected} />
        <MonthGrid year={second.y} month={second.m} byDate={byDate} todayKey={todayKey} selected={selected} onSelect={setSelected} />
      </div>

      {/* Detalhes do dia selecionado */}
      {selected && (
        <div className="rounded-xl border border-border bg-background/40 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">
              {(() => { const [y, m, d] = selected.split('-').map(Number); return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]}, ${d} de ${MONTHS[m - 1]}`; })()}
            </p>
            <span className="text-xs text-muted-foreground">{selItems.length} agendamento(s)</span>
          </div>
          {selItems.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Nada agendado nesse dia. Bom candidato pra encaixar conteúdo novo.</p>
          ) : (
            <div className="space-y-1.5">
              {selItems.map((e, i) => (
                <div key={i} className={`text-xs rounded-lg border border-border bg-background px-2.5 py-2 border-l-4 ${KIND[e.kind].bar}`}>
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums font-bold text-foreground">{e.time}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${KIND[e.kind].pill}`}>{e.typeLabel}</span>
                    {e.platformsCount > 0 && <span className="text-[10px] text-muted-foreground">{e.platformsCount} canal(is)</span>}
                    {e.status !== 'agendado' && <span className="text-[10px] text-amber-400">{e.status}</span>}
                  </div>
                  {e.caption && <p className="text-muted-foreground mt-1 line-clamp-2">{e.caption}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && entries.length === 0 && (
        <p className="text-sm text-muted-foreground italic text-center py-8">
          Nenhum agendamento ainda. Assim que você agendar carrosséis ou reels pelo app, eles aparecem aqui.
        </p>
      )}
    </div>
  );
}
