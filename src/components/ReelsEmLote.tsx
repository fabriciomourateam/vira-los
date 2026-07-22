/**
 * ReelsEmLote.tsx — Tabela embutida pra produzir reels em massa.
 *
 * Cada linha = { texto na tela, legenda, data (opcional), clipe (opcional) }.
 * O texto é SEU (não o da IA). Clipe vazio → o sistema pega um aleatório do
 * banco de crus. Data vazia → próximo horário livre. "Gerar lote" cria +
 * renderiza (queima o texto) + agenda tudo de uma vez, via POST /api/reels/bulk.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Loader2, Wand2, ListChecks, Film, Calendar, ClipboardPaste } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface RawVideo { id: string; file: string; originalName?: string; used: boolean; }
interface Row { texto: string; legenda: string; data: string; rawVideoId: string; }
interface RowResult { row: number; ok: boolean; reelId?: string; dates?: string[] | null; error?: string; }

const emptyRow = (): Row => ({ texto: '', legenda: '', data: '', rawVideoId: '' });

// Preview aproximada de como o texto fica queimado no vídeo (branco, negrito,
// contorno/sombra preta, terço inferior). Não é o render real — é pra você
// julgar o texto/tamanho antes de gastar processamento.
function FramePreview({ texto, cta, y = 0.6 }: { texto: string; cta: string; y?: number }) {
  const stroke = '0 0 4px #000, 2px 2px 3px #000, -1px -1px 2px #000, 1px 1px 0 #000';
  const hookPct = Math.max(20, Math.min(90, y * 100));
  const ctaPct = Math.min(92, hookPct + 13);
  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-border bg-gradient-to-b from-neutral-700 to-neutral-900" style={{ aspectRatio: '9 / 16' }}>
      {/* Gancho: branco, centralizado na altura escolhida — o vídeo todo */}
      <div className="absolute inset-x-0 -translate-y-1/2 px-3" style={{ top: `${hookPct}%` }}>
        <p className="text-center font-extrabold leading-tight text-white" style={{ fontSize: 'clamp(13px, 4.2vw, 20px)', textShadow: stroke }}>
          {texto || 'Seu texto na tela aparece aqui'}
        </p>
      </div>
      {/* CTA dourado, ~0.13 abaixo — entra na METADE do vídeo */}
      <div className="absolute inset-x-0 -translate-y-1/2 px-3" style={{ top: `${ctaPct}%` }}>
        <p className="text-center font-bold leading-tight" style={{ color: '#F5B301', fontSize: 'clamp(10px, 2.9vw, 15px)', textShadow: stroke }}>
          {cta}
        </p>
      </div>
    </div>
  );
}

// Aceita o lote que o Claude gera: JSON [{texto, legenda, data?}] OU linhas
// separadas por TAB/"|" (texto | legenda | data). Robusto a legenda com quebra
// de linha quando vem em JSON.
function parseImport(text: string): Row[] {
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith('[') || t.startsWith('{')) {
    const arr = JSON.parse(t);
    const list = Array.isArray(arr) ? arr : [arr];
    return list.map((o: any) => ({
      texto: String(o.texto ?? o.text ?? o.titulo ?? o.hook ?? o.fraseTela ?? '').trim(),
      legenda: String(o.legenda ?? o.caption ?? o.legendaPost ?? '').trim(),
      data: String(o.data ?? o.date ?? '').trim(),
      rawVideoId: '',
    })).filter((r) => r.texto);
  }
  return t.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.includes('\t') ? line.split('\t') : line.split('|');
    return { texto: (parts[0] || '').trim(), legenda: (parts[1] || '').trim(), data: (parts[2] || '').trim(), rawVideoId: '' };
  }).filter((r) => r.texto);
}

const DRAFT_KEY = 'viralos.emLote.rows';

// Rascunho automático: as linhas que você digita ficam salvas no navegador,
// então trocar de aba / atualizar a página não perde nada.
function loadDraft(): Row[] {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) {
        return arr.map((r: any) => ({ texto: r.texto || '', legenda: r.legenda || '', data: r.data || '', rawVideoId: r.rawVideoId || '' }));
      }
    }
  } catch { /* ignora */ }
  return [emptyRow(), emptyRow(), emptyRow()];
}

export default function ReelsEmLote() {
  const [rows, setRows] = useState<Row[]>(loadDraft);
  const [clips, setClips] = useState<RawVideo[]>([]);
  const [schedule, setSchedule] = useState(true);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');

  function doImport() {
    let parsed: Row[];
    try { parsed = parseImport(importText); }
    catch { toast.error('Formato inválido — cole o JSON que o Claude gerou (começa com [).'); return; }
    if (!parsed.length) { toast.error('Nada pra importar — nenhuma linha com texto.'); return; }
    setRows(parsed);
    setImportOpen(false);
    setImportText('');
    setFocused(0);
    toast.success(`${parsed.length} reel(s) preenchidos na tabela.`);
  }
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [focused, setFocused] = useState(0);
  const [textY, setTextY] = useState(0.6); // altura do texto (pra preview bater com o render)

  function loadClips() {
    fetch(`${API}/api/reels/raw-videos`).then((r) => r.json()).then((d) => setClips(Array.isArray(d) ? d : [])).catch(() => {});
  }
  useEffect(loadClips, []);

  // Puxa a altura do texto das settings pra prévia refletir o render real.
  useEffect(() => {
    fetch(`${API}/api/mlabs/settings`).then((r) => r.json())
      .then((s) => { if (typeof s?.reelTextY === 'number') setTextY(s.reelTextY); })
      .catch(() => {});
  }, []);

  // Salva o rascunho sempre que a tabela muda (as frases não se perdem mais).
  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(rows)); } catch { /* ignora */ }
  }, [rows]);

  const freeClips = useMemo(() => clips.filter((c) => !c.used), [clips]);
  const filled = rows.filter((r) => r.texto.trim());

  function setRow(i: number, patch: Partial<Row>) {
    setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function addRow() { setRows((p) => [...p, emptyRow()]); }
  function removeRow(i: number) {
    setRows((p) => (p.length > 1 ? p.filter((_, j) => j !== i) : p));
    setFocused(0);
  }

  async function generate() {
    if (!filled.length) { toast.error('Preencha ao menos uma linha com o texto na tela.'); return; }
    if (schedule && !freeClips.length && rows.every((r) => !r.rawVideoId)) {
      // Sem clipe informado e banco vazio → o render vai falhar linha a linha.
      toast.error('Banco de clipes crus vazio. Suba clipes (engrenagem mLabs → Reels) ou escolha um clipe por linha.');
      return;
    }
    setRunning(true);
    setResults(null);
    setStep('Enviando lote...');
    try {
      const payload = {
        schedule,
        rows: filled.map((r) => ({ texto: r.texto.trim(), legenda: r.legenda.trim(), data: r.data || null, rawVideoId: r.rawVideoId || null })),
      };
      const r = await fetch(`${API}/api/reels/bulk`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha ao iniciar o lote.');
      await pollJob(d.jobId);
    } catch (e: any) {
      toast.error(e?.message || 'Erro no lote.');
      setRunning(false);
      setStep('');
    }
  }

  async function pollJob(jobId: string) {
    for (;;) {
      await new Promise((res) => setTimeout(res, 1300));
      let d: any;
      try {
        const r = await fetch(`${API}/api/reels/jobs/${jobId}`);
        d = await r.json();
      } catch { continue; }
      if (d.status === 'done') {
        const res: RowResult[] = d.result?.results || [];
        setResults(res);
        setRunning(false);
        setStep('');
        loadClips();
        const ok = res.filter((x) => x.ok).length;
        const fail = res.length - ok;
        if (fail === 0) toast.success(`${ok} reel(s) prontos${schedule ? ' e agendados' : ''}!`);
        else toast.warning(`${ok} ok, ${fail} com erro. Veja os detalhes abaixo.`);
        return;
      }
      if (d.status === 'error') { toast.error(d.error || 'Erro no lote.'); setRunning(false); setStep(''); return; }
      if (d.step) setStep(d.step);
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div>
        <h2 className="text-lg font-bold text-foreground inline-flex items-center gap-2">
          <ListChecks size={20} className="text-blue-400" /> Reels em lote
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Preencha o texto que vai <b>na tela</b> e a <b>legenda</b> de cada reel. O clipe é opcional
          (vazio = aleatório do banco) e a data também (vazia = próximo horário livre). Clique em
          <b> Gerar lote</b> e o sistema queima o texto no vídeo e agenda tudo.
        </p>
        <button onClick={() => setImportOpen((v) => !v)}
          className="mt-2 text-xs font-medium text-blue-400 hover:text-blue-300 inline-flex items-center gap-1.5">
          <ClipboardPaste size={13} /> Importar / colar lote (do Claude)
        </button>
      </div>

      {importOpen && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Cole aqui o lote que o Claude te mandou (JSON começando com <code>[</code>, ou uma linha por reel
            no formato <code>texto | legenda | data</code>). Isso <b>substitui</b> a tabela atual.
          </p>
          <textarea
            value={importText} onChange={(e) => setImportText(e.target.value)}
            placeholder='[{"texto":"...","legenda":"...","data":""}, ...]'
            className="w-full h-32 bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground font-mono"
          />
          <div className="flex items-center gap-2">
            <button onClick={doImport} className="text-xs font-semibold text-foreground bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded-lg">Preencher tabela</button>
            <button onClick={() => { setImportOpen(false); setImportText(''); }} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5">Cancelar</button>
          </div>
        </div>
      )}

      {freeClips.length === 0 && (
        <div className="text-xs text-yellow-300 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-2.5 inline-flex items-center gap-2">
          <Film size={14} /> Banco de clipes crus vazio. Suba clipes na engrenagem <b>mLabs → Reels → Banco de clipes crus</b> pra usar o modo aleatório.
        </div>
      )}

      <div className="grid md:grid-cols-[1fr_220px] gap-4 items-start">
        {/* Tabela */}
        <div className="space-y-2">
          <div className="hidden md:grid grid-cols-[1.3fr_1.3fr_150px_120px_28px] gap-2 px-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            <span>Texto na tela</span><span>Legenda do post</span><span>Data (opcional)</span><span>Clipe</span><span></span>
          </div>
          {rows.map((r, i) => (
            <div
              key={i}
              onFocusCapture={() => setFocused(i)}
              className={`grid grid-cols-1 md:grid-cols-[1.3fr_1.3fr_150px_120px_28px] gap-2 items-start rounded-lg p-1.5 ${focused === i ? 'bg-blue-500/5 ring-1 ring-blue-500/30' : ''}`}
            >
              <textarea
                value={r.texto} onChange={(e) => setRow(i, { texto: e.target.value })}
                placeholder="Ex.: Você treina e não seca? O problema é a insulina."
                rows={2}
                className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground resize-y min-h-[42px]"
              />
              <textarea
                value={r.legenda} onChange={(e) => setRow(i, { legenda: e.target.value })}
                placeholder="Legenda completa + Comenta DIETA que eu te mando o cardápio..."
                rows={2}
                className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground resize-y min-h-[42px]"
              />
              <input
                type="datetime-local" value={r.data} onChange={(e) => setRow(i, { data: e.target.value })}
                className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground"
              />
              <select
                value={r.rawVideoId} onChange={(e) => setRow(i, { rawVideoId: e.target.value })}
                className="bg-background border border-border rounded-lg px-1.5 py-1.5 text-xs text-foreground"
              >
                <option value="">Aleatório</option>
                {freeClips.map((c) => (
                  <option key={c.id} value={c.id}>{(c.originalName || c.file).slice(0, 22)}</option>
                ))}
              </select>
              <button onClick={() => removeRow(i)} className="text-muted-foreground hover:text-red-400 p-1 mt-1" title="Remover linha"><Trash2 size={15} /></button>
            </div>
          ))}
          <button onClick={addRow} className="text-xs text-blue-400 hover:text-blue-300 inline-flex items-center gap-1 mt-1">
            <Plus size={13} /> Adicionar linha
          </button>
        </div>

        {/* Preview + controles */}
        <div className="space-y-3 md:sticky md:top-4">
          <FramePreview texto={rows[focused]?.texto || ''} cta="👇 LEIA A LEGENDA" y={textY} />
          <p className="text-[10px] text-muted-foreground text-center -mt-1">Prévia aproximada da linha em foco</p>

          <label className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/60 px-2.5 py-2 cursor-pointer">
            <span className="text-xs text-foreground inline-flex items-center gap-1.5"><Calendar size={13} /> Agendar no mLabs</span>
            <input type="checkbox" checked={schedule} onChange={(e) => setSchedule(e.target.checked)} className="w-4 h-4 accent-blue-500" />
          </label>

          <button
            onClick={generate} disabled={running || !filled.length}
            className="w-full text-sm font-semibold text-foreground bg-blue-600 hover:bg-blue-500 px-4 py-2.5 rounded-lg inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {running ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
            {running ? 'Processando...' : `Gerar lote (${filled.length})`}
          </button>
          {step && <p className="text-xs text-muted-foreground text-center">{step}</p>}
        </div>
      </div>

      {/* Resultados */}
      {results && (
        <div className="pt-2 border-t border-border space-y-1.5">
          <p className="text-sm font-semibold text-foreground">Resultado</p>
          {results.map((r) => (
            <div key={r.row} className="text-xs flex items-center gap-2 bg-background border border-border rounded-lg px-2 py-1.5">
              <span className={`px-1.5 py-0.5 rounded ${r.ok ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                linha {r.row}
              </span>
              {r.ok ? (
                <span className="text-muted-foreground truncate flex-1">
                  pronto{r.dates?.length ? ` · agendado ${r.dates[0].replace('T', ' ')}` : ''}
                </span>
              ) : (
                <span className="text-red-300 truncate flex-1">{r.error}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
