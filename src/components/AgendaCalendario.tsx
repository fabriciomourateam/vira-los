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
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Loader2, Trash2, CloudDownload, AlertTriangle } from 'lucide-react';
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
  platformsCount: number;
  source?: 'local' | 'mlabs';
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// Estilo por tipo de conteúdo — pílula de fundo SÓLIDO e texto de alto contraste
// (lê bem no tema claro e no escuro; o translúcido sumia no fundo branco).
const KIND: Record<Entry['kind'], { label: string; dot: string; pill: string; bar: string }> = {
  'carrossel':   { label: 'Carrossel',    dot: 'bg-blue-600',    pill: 'bg-blue-600 text-white',     bar: 'border-l-blue-600' },
  'reel-ffmpeg': { label: 'Reel editado', dot: 'bg-amber-500',   pill: 'bg-amber-500 text-black',    bar: 'border-l-amber-500' },
  'reel-pronto': { label: 'Reel pronto',  dot: 'bg-emerald-600', pill: 'bg-emerald-600 text-white',  bar: 'border-l-emerald-600' },
  'mlabs':       { label: 'mLabs',        dot: 'bg-purple-500',  pill: 'bg-purple-500 text-white',   bar: 'border-l-purple-500' },
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
              className={`min-h-[104px] border-b border-r border-border/50 p-1.5 text-left align-top flex flex-col gap-1 transition-colors
                ${isSel ? 'bg-blue-500/10 ring-1 ring-inset ring-blue-500/40' : 'hover:bg-background/60'}`}
            >
              <span className={`text-xs font-semibold self-end leading-none ${isToday ? 'text-blue-500' : 'text-muted-foreground'}`}>
                {(() => {
                  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
                  const hasClash = items.length > 1 && items.some((a, ai) => items.some((b, bi) => ai !== bi && Math.abs(toMin(a.time) - toMin(b.time)) < 120));
                  return <>{hasClash && <span className="text-red-400 mr-0.5" title="Conflito de horário!">!</span>}{isToday ? `${d} • hoje` : d}</>;
                })()}
              </span>
              <div className="flex flex-col gap-1 w-full">
                {items.slice(0, 4).map((e, j) => (
                  <span key={j} className={`text-[9px] leading-tight rounded px-1.5 py-0.5 font-semibold ${KIND[e.kind].pill}`}
                    title={`${e.time} · ${e.typeLabel}`}>
                    <span className="tabular-nums">{e.time}</span>{e.kind === 'carrossel' ? ` ${e.typeLabel}` : ''}
                  </span>
                ))}
                {items.length > 4 && <span className="text-[9px] font-medium text-muted-foreground pl-0.5">+{items.length - 4} mais</span>}
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
  const [deleting, setDeleting] = useState<string | null>(null);
  const [mlabsItems, setMlabsItems] = useState<Entry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  // Apaga o registro do PLANEJAMENTO aqui no app. Isso NÃO cancela no mLabs —
  // o post já está na fila de lá. Por isso o aviso forte antes de confirmar.
  function removeEntry(scheduleId: string) {
    const ok = window.confirm(
      'ATENÇÃO: isso remove o item só do SEU planejamento aqui no app.\n\n' +
      'NÃO cancela no mLabs — o post continua na fila e VAI ser publicado.\n' +
      'Pra ele NÃO ser postado, apague também dentro do mLabs.\n\n' +
      'Remover do planejamento aqui?'
    );
    if (!ok) return;
    setDeleting(scheduleId);
    fetch(`${API}/api/mlabs/agendados/${scheduleId}`, { method: 'DELETE' })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(() => {
        setEntries((prev) => prev.filter((e) => e.scheduleId !== scheduleId));
        toast.success('Removido do planejamento. Lembra de apagar no mLabs pra não postar.');
      })
      .catch(() => toast.error('Não consegui remover. Tenta de novo.'))
      .finally(() => setDeleting(null));
  }

  function load() {
    setLoading(true);
    fetch(`${API}/api/mlabs/calendar`)
      .then((r) => r.json())
      .then((d) => setEntries(Array.isArray(d) ? d : []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }

  function loadMlabs(refresh = false) {
    setSyncing(true);
    fetch(`${API}/api/mlabs/mlabs-schedules${refresh ? '?refresh=true' : ''}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.fetchedAt) setLastSync(data.fetchedAt);
        const items: Entry[] = ((data.items || []) as { id: string; date: string; message?: string; status?: number }[])
          .map((item) => {
            const m = String(item.date).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
            if (!m) return null;
            return {
              scheduleId: `mlabs_${item.id}`,
              date: m[1],
              time: m[2],
              kind: 'mlabs' as const,
              typeLabel: 'mLabs',
              contentType: 'mlabs',
              caption: item.message || '',
              status: item.status === 1 ? 'agendado' : `status ${item.status}`,
              platformsCount: 0,
              source: 'mlabs' as const,
            };
          })
          .filter((x): x is Entry => x !== null);
        setMlabsItems(items);
        if (refresh) toast.success(`mLabs sincronizado: ${items.length} agendamento(s) encontrado(s).`);
      })
      .catch(() => { if (refresh) toast.error('Falha ao sincronizar com mLabs.'); })
      .finally(() => setSyncing(false));
  }

  useEffect(() => { load(); loadMlabs(); }, []);

  // Mostra TUDO (local + mLabs) sem dedup — assim vc vê quando dois posts batem no mesmo horário.
  const allEntries = useMemo(() => [...entries, ...mlabsItems], [entries, mlabsItems]);

  const byDate = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of allEntries) {
      const arr = m.get(e.date) || [];
      arr.push(e);
      m.set(e.date, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.time.localeCompare(b.time));
    return m;
  }, [allEntries]);

  const todayKey = dateKey(now.getFullYear(), now.getMonth(), now.getDate());
  const second = anchor.m === 11 ? { y: anchor.y + 1, m: 0 } : { y: anchor.y, m: anchor.m + 1 };
  const shift = (delta: number) => setAnchor((a) => {
    const idx = a.y * 12 + a.m + delta;
    return { y: Math.floor(idx / 12), m: ((idx % 12) + 12) % 12 };
  });
  const goToday = () => setAnchor({ y: now.getFullYear(), m: now.getMonth() });

  const selItems = selected ? (byDate.get(selected) || []) : [];
  const counts = useMemo(() => {
    const c = { carrossel: 0, 'reel-ffmpeg': 0, 'reel-pronto': 0, mlabs: 0 } as Record<Entry['kind'], number>;
    for (const e of allEntries) c[e.kind]++;
    return c;
  }, [allEntries]);

  return (
    <div className="max-w-[1500px] mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground inline-flex items-center gap-2">
            <CalendarDays size={20} className="text-blue-400" /> Agenda de conteúdo
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Seus agendamentos (app + mLabs) em horário de Brasília. Sincronize o mLabs pra ver tudo e manter o gap de 2h.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => loadMlabs(true)} disabled={syncing}
            className="text-xs font-medium text-purple-400 hover:text-purple-300 inline-flex items-center gap-1.5 border border-purple-500/30 rounded-lg px-2.5 py-1.5"
            title={lastSync ? `Último sync: ${new Date(lastSync).toLocaleString('pt-BR')}` : 'Nunca sincronizado'}>
            {syncing ? <Loader2 size={13} className="animate-spin" /> : <CloudDownload size={13} />} Sincronizar mLabs
          </button>
          <button onClick={load} disabled={loading}
            className="text-xs font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 border border-border rounded-lg px-2.5 py-1.5">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Atualizar
          </button>
        </div>
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
              {selItems.map((e, i) => {
                const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
                const mine = toMin(e.time);
                const conflict = selItems.some((o, j) => j !== i && Math.abs(toMin(o.time) - mine) < 120);
                return (
                  <div key={i} className={`text-xs rounded-lg border bg-background px-2.5 py-2 border-l-4 ${KIND[e.kind].bar} ${conflict ? 'border-red-500/60 bg-red-500/5' : 'border-border'}`}>
                    <div className="flex items-center gap-2">
                      {conflict && <AlertTriangle size={13} className="text-red-400 shrink-0" title="Menos de 2h de outro post!" />}
                      <span className="tabular-nums font-bold text-foreground">{e.time}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${KIND[e.kind].pill}`}>{e.typeLabel}</span>
                      {e.platformsCount > 0 && <span className="text-[10px] text-muted-foreground">{e.platformsCount} canal(is)</span>}
                      {e.status !== 'agendado' && <span className="text-[10px] text-amber-400">{e.status}</span>}
                      {e.source === 'mlabs' ? (
                        <span className="ml-auto text-[10px] text-purple-400 italic">do mLabs</span>
                      ) : (
                        <button
                          onClick={() => removeEntry(e.scheduleId)}
                          disabled={deleting === e.scheduleId}
                          className="ml-auto text-muted-foreground hover:text-red-400 p-1 disabled:opacity-50"
                          title="Remover do planejamento (não cancela no mLabs)"
                        >
                          {deleting === e.scheduleId ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        </button>
                      )}
                    </div>
                    {conflict && <p className="text-[10px] text-red-400 mt-0.5">Menos de 2h de outro post nesse dia</p>}
                    {e.caption && <p className="text-muted-foreground mt-1 line-clamp-2">{e.caption}</p>}
                  </div>
                );
              })}
              <p className="text-[10px] text-amber-500/90 pt-1">
                Apagar aqui limpa só o seu planejamento. Pra o post <b>não ser publicado</b>, apague também dentro do mLabs.
              </p>
            </div>
          )}
        </div>
      )}

      {lastSync && (
        <p className="text-[10px] text-muted-foreground text-center">
          mLabs sincronizado em {new Date(lastSync).toLocaleString('pt-BR')} · A distância mínima de 2h entre posts está ativa.
        </p>
      )}

      {!loading && allEntries.length === 0 && (
        <p className="text-sm text-muted-foreground italic text-center py-8">
          Nenhum agendamento ainda. Agende carrosséis/reels pelo app ou clique "Sincronizar mLabs" pra puxar os agendamentos de lá.
        </p>
      )}
    </div>
  );
}
