/**
 * LimpezaPanel.tsx — Aba "Limpeza": libera espaço do volume apagando carrosséis e
 * reels já usados. Seleção em LOTE (marca o que quer + "selecionar todos" e
 * "só postados"). Apaga registro + ARQUIVO do disco (o delete normal só tira o
 * registro). Apagar aqui NÃO desfaz o post no Instagram/mLabs — só limpa a cópia local.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Trash2, RefreshCw, Loader2, HardDrive, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { OriginBadge } from '@/lib/reelOrigin';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface Item {
  id: string;
  title: string;
  date: string | null;
  sizeBytes: number;
  posted: boolean;
  archived: boolean;
  source: string | null;
}
interface Overview {
  disk: { totalBytes: number; usedBytes: number; freeBytes: number } | null;
  carousels: Item[];
  reels: Item[];
}

function fmtBytes(b: number): string {
  if (!b) return '0 MB';
  const mb = b / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(b / 1024))} KB`;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
function fmtDate(d: string | null): string {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }); }
  catch { return ''; }
}

export default function LimpezaPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [selC, setSelC] = useState<Set<string>>(new Set());
  const [selR, setSelR] = useState<Set<string>>(new Set());

  function load() {
    setLoading(true);
    fetch(`${API}/api/maintenance/overview`)
      .then((r) => r.json())
      .then((d) => { setData(d); setSelC(new Set()); setSelR(new Set()); })
      .catch(() => toast.error('Não consegui carregar o uso de espaço.'))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const carousels = data?.carousels || [];
  const reels = data?.reels || [];

  const toggle = (set: Set<string>, setSet: (s: Set<string>) => void, id: string) => {
    const n = new Set(set);
    n.has(id) ? n.delete(id) : n.add(id);
    setSet(n);
  };
  const selectAll = (items: Item[], setSet: (s: Set<string>) => void) => setSet(new Set(items.map((i) => i.id)));
  const selectPosted = (items: Item[], setSet: (s: Set<string>) => void) => setSet(new Set(items.filter((i) => i.posted).map((i) => i.id)));
  const clearSel = (setSet: (s: Set<string>) => void) => setSet(new Set());

  const selectedBytes = useMemo(() => {
    let b = 0;
    for (const c of carousels) if (selC.has(c.id)) b += c.sizeBytes;
    for (const r of reels) if (selR.has(r.id)) b += r.sizeBytes;
    return b;
  }, [carousels, reels, selC, selR]);
  const selectedCount = selC.size + selR.size;

  function doDelete() {
    if (!selectedCount) return;
    if (!window.confirm(
      `Apagar ${selectedCount} item(ns) selecionado(s)?\n\n` +
      `Isso remove os arquivos do app e libera espaço. NÃO desfaz o que já foi postado no Instagram/mLabs.\n\n` +
      `Não dá pra desfazer aqui.`
    )) return;
    setDeleting(true);
    fetch(`${API}/api/maintenance/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ carouselIds: [...selC], reelIds: [...selR] }),
    })
      .then((r) => r.json())
      .then((res) => {
        toast.success(`Apagados ${res.deleted} item(ns) — ${fmtBytes(res.freedBytes || 0)} liberados.`);
        load();
      })
      .catch(() => toast.error('Falha ao apagar. Tenta de novo.'))
      .finally(() => setDeleting(false));
  }

  const disk = data?.disk;
  const pct = disk && disk.totalBytes ? Math.min(100, Math.round((disk.usedBytes / disk.totalBytes) * 100)) : 0;
  const pctColor = pct >= 85 ? 'bg-red-500' : pct >= 65 ? 'bg-amber-500' : 'bg-emerald-500';

  const Section = ({ title, items, sel, setSel, isReel = false }: { title: string; items: Item[]; sel: Set<string>; setSel: (s: Set<string>) => void; isReel?: boolean }) => (
    <div className="rounded-xl border border-border bg-background/40 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-background/60 border-b border-border">
        <span className="text-sm font-bold">{title} <span className="text-muted-foreground font-medium">({items.length})</span></span>
        <div className="flex items-center gap-2 text-[11px]">
          <button onClick={() => selectAll(items, setSel)} className="px-2 py-1 rounded bg-foreground/10 hover:bg-foreground/20 font-semibold">Todos</button>
          <button onClick={() => selectPosted(items, setSel)} className="px-2 py-1 rounded bg-foreground/10 hover:bg-foreground/20 font-semibold" title="Seleciona só os que já foram postados">Só postados</button>
          <button onClick={() => clearSel(setSel)} className="px-2 py-1 rounded bg-foreground/10 hover:bg-foreground/20 font-semibold">Limpar</button>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">Nada aqui.</div>
      ) : (
        <div className="max-h-[420px] overflow-y-auto divide-y divide-border/50">
          {items.map((it) => (
            <label key={it.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-background/60">
              <input type="checkbox" checked={sel.has(it.id)} onChange={() => toggle(sel, setSel, it.id)} className="w-4 h-4 accent-blue-500" />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{it.title}</div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                  <span>{fmtDate(it.date)}</span>
                  <span className="tabular-nums">{fmtBytes(it.sizeBytes)}</span>
                  {isReel && <OriginBadge source={it.source} />}
                  {it.posted && <span className="px-1.5 rounded bg-emerald-600 text-white font-semibold">postado</span>}
                  {it.archived && <span className="px-1.5 rounded bg-foreground/15 font-semibold">arquivado</span>}
                </div>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><HardDrive size={18} /> Limpeza / Espaço</h2>
          <p className="text-sm text-muted-foreground">Marca o que já usou e apaga pra liberar espaço. Não desfaz o que já foi postado.</p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-foreground/10 hover:bg-foreground/20 text-sm font-semibold">
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Atualizar
        </button>
      </div>

      {/* Barra de disco */}
      {disk && (
        <div className="rounded-xl border border-border bg-background/40 p-3">
          <div className="flex items-center justify-between text-sm mb-1.5">
            <span className="font-semibold">Volume do app</span>
            <span className="text-muted-foreground tabular-nums">
              {fmtBytes(disk.usedBytes)} de {fmtBytes(disk.totalBytes)} usados ({pct}%)
            </span>
          </div>
          <div className="h-3 rounded-full bg-foreground/10 overflow-hidden">
            <div className={`h-full ${pctColor} transition-all`} style={{ width: `${pct}%` }} />
          </div>
          {pct >= 85 && (
            <div className="flex items-center gap-1.5 text-[12px] text-red-400 mt-1.5">
              <AlertTriangle size={13} /> Espaço quase no limite — apagar conteúdo antigo evita falha nos renders diários.
            </div>
          )}
        </div>
      )}

      {/* Ação de apagar (sticky no topo das listas) */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/60 px-3 py-2">
        <span className="text-sm">
          {selectedCount > 0
            ? <>Selecionados: <b>{selectedCount}</b> · <b>{fmtBytes(selectedBytes)}</b></>
            : <span className="text-muted-foreground">Marca os itens que quer apagar.</span>}
        </span>
        <button
          onClick={doDelete}
          disabled={!selectedCount || deleting}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold"
        >
          {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Apagar selecionados
        </button>
      </div>

      {loading && !data ? (
        <div className="py-10 text-center text-muted-foreground"><Loader2 className="animate-spin inline mr-2" size={16} /> Carregando...</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Section title="Carrosséis" items={carousels} sel={selC} setSel={setSelC} />
          <Section title="Reels" items={reels} sel={selR} setSel={setSelR} isReel />
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Obs.: os <b>vídeos crus e músicas</b> que você subiu não aparecem aqui de propósito — eles são reutilizados nos reels. Gerencie-os na aba de reels.
      </p>
    </div>
  );
}
