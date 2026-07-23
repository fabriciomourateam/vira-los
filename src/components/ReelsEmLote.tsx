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
import { Plus, Trash2, Loader2, Wand2, ListChecks, Film, Calendar, ClipboardPaste, Upload, Type, MoveVertical, Play, Repeat, Music } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface RawVideo { id: string; file: string; originalName?: string; used: boolean; }
interface Row { texto: string; legenda: string; data: string; rawVideoId: string; }
interface RowResult { row: number; ok: boolean; reelId?: string; videoFile?: string | null; dates?: string[] | null; error?: string; }

const emptyRow = (): Row => ({ texto: '', legenda: '', data: '', rawVideoId: '' });

// Mostra a data agendada em horário de Brasília (o backend devolve em UTC "…Z").
function fmtBRT(s: string): string {
  try {
    const iso = /[Z+]/.test(s) ? s : `${s}Z`;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return s; }
}

// Preview aproximada de como o texto fica queimado no vídeo (branco, negrito,
// contorno/sombra preta, terço inferior). Não é o render real — é pra você
// julgar o texto/tamanho antes de gastar processamento.
function FramePreview({ texto, cta, y = 0.6, fontScale = 1, ctaColor = '#F5B301', gap = 60, style = 'contorno', boxColor = '#F5C518', boxTextColor = '#111111' }: { texto: string; cta: string; y?: number; fontScale?: number; ctaColor?: string; gap?: number; style?: string; boxColor?: string; boxTextColor?: string }) {
  const stroke = '0 0 4px #000, 2px 2px 3px #000, -1px -1px 2px #000, 1px 1px 0 #000';
  const box = style === 'caixa';
  const hookPct = Math.max(20, Math.min(90, y * 100));
  const ctaPct = Math.min(93, hookPct + 9 + gap / 19.2);
  const k = Math.max(0.5, Math.min(2, fontScale));
  const hookFont = `clamp(${13 * k}px, ${4.2 * k}vw, ${20 * k}px)`;
  const ctaFont = `clamp(${10 * k}px, ${2.9 * k}vw, ${15 * k}px)`;
  // box-decoration-break: clone → cada linha ganha sua própria caixa (como no render).
  const clone = { WebkitBoxDecorationBreak: 'clone', boxDecorationBreak: 'clone' } as React.CSSProperties;
  const hookSpan: React.CSSProperties = box
    ? { color: boxTextColor, background: boxColor, padding: '0.06em 0.3em', borderRadius: 5, ...clone }
    : { color: '#fff', textShadow: stroke };
  const ctaSpan: React.CSSProperties = box
    ? { color: boxColor, background: boxTextColor, padding: '0.06em 0.32em', borderRadius: 5, ...clone }
    : { color: ctaColor, textShadow: stroke };
  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-border bg-gradient-to-b from-neutral-700 to-neutral-900" style={{ aspectRatio: '9 / 16' }}>
      <div className="absolute inset-x-0 -translate-y-1/2 px-3 text-center" style={{ top: `${hookPct}%`, lineHeight: box ? 1.55 : 1.15 }}>
        <span className="font-extrabold" style={{ fontSize: hookFont, ...hookSpan }}>{texto || 'Seu texto na tela aparece aqui'}</span>
      </div>
      <div className="absolute inset-x-0 -translate-y-1/2 px-3 text-center" style={{ top: `${ctaPct}%`, lineHeight: box ? 1.6 : 1.15 }}>
        <span className="font-bold" style={{ fontSize: ctaFont, ...ctaSpan }}>{cta}</span>
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
  const [repostOn, setRepostOn] = useState(false);
  const [repostMonths, setRepostMonths] = useState(3);
  const [repostCount, setRepostCount] = useState(4);
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
  const [cfg, setCfg] = useState<any>(null);        // settings do reel (estilo + automação)
  const [configOpen, setConfigOpen] = useState(false);
  const [uploadingClip, setUploadingClip] = useState(false);
  const [tracks, setTracks] = useState<{ id: string; file: string; originalName?: string }[]>([]);
  const [uploadingMusic, setUploadingMusic] = useState(false);
  const textY = typeof cfg?.reelTextY === 'number' ? cfg.reelTextY : 0.6;
  const fontSize = typeof cfg?.reelFontSize === 'number' ? cfg.reelFontSize : 72;
  const ctaColor = cfg?.reelCtaColor || '#F5B301';
  const ctaGap = typeof cfg?.reelCtaGap === 'number' ? cfg.reelCtaGap : 60;
  const textStyle = cfg?.reelTextStyle === 'caixa' ? 'caixa' : 'contorno';
  const boxColor = cfg?.reelBoxColor || '#F5C518';
  const boxTextColor = cfg?.reelBoxTextColor || '#111111';

  function loadClips() {
    fetch(`${API}/api/reels/raw-videos`).then((r) => r.json()).then((d) => setClips(Array.isArray(d) ? d : [])).catch(() => {});
  }
  function loadSettings() {
    fetch(`${API}/api/mlabs/settings`).then((r) => r.json()).then(setCfg).catch(() => {});
  }
  useEffect(() => { loadClips(); loadSettings(); loadMusic(); }, []);

  // Salva um ajuste de estilo/automação (otimista: reflete na hora + PUT no servidor).
  function saveSetting(patch: Record<string, any>) {
    setCfg((p: any) => ({ ...(p || {}), ...patch }));
    fetch(`${API}/api/mlabs/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).catch(() => {});
  }

  async function uploadClips(files: FileList) {
    setUploadingClip(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('videos', f));
      const r = await fetch(`${API}/api/reels/raw-videos`, { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha no upload.');
      toast.success(`${d.count} clipe(s) no banco.`);
      loadClips();
    } catch (e: any) { toast.error(e?.message || 'Erro ao subir clipes.'); }
    finally { setUploadingClip(false); }
  }
  async function deleteClip(id: string) {
    try { await fetch(`${API}/api/reels/raw-videos/${id}`, { method: 'DELETE' }); setClips((p) => p.filter((v) => v.id !== id)); } catch { /* ignora */ }
  }

  function loadMusic() {
    fetch(`${API}/api/reels/music`).then((r) => r.json()).then((d) => setTracks(Array.isArray(d) ? d : [])).catch(() => {});
  }
  async function uploadMusic(files: FileList) {
    setUploadingMusic(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('tracks', f));
      const r = await fetch(`${API}/api/reels/music`, { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha no upload.');
      toast.success(`${d.count} música(s) no banco.`);
      loadMusic();
    } catch (e: any) { toast.error(e?.message || 'Erro ao subir músicas.'); }
    finally { setUploadingMusic(false); }
  }
  async function deleteMusic(id: string) {
    try { await fetch(`${API}/api/reels/music/${id}`, { method: 'DELETE' }); setTracks((p) => p.filter((m) => m.id !== id)); } catch { /* ignora */ }
  }

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
        repost: schedule && repostOn ? { months: repostMonths, count: repostCount } : null,
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
        <button onClick={() => setConfigOpen(true)}
          className="text-xs text-yellow-300 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-2.5 inline-flex items-center gap-2 hover:bg-yellow-500/15 text-left">
          <Film size={14} /> Banco de clipes vazio — clique aqui pra <b>subir seus vídeos de treino</b> e usar o modo aleatório.
        </button>
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

        {/* Preview + estilo + gerar */}
        <div className="space-y-3 md:sticky md:top-4">
          <FramePreview texto={rows[focused]?.texto || ''} cta="LEIA A LEGENDA" y={textY} fontScale={fontSize / 96} ctaColor={ctaColor} gap={ctaGap} style={textStyle} boxColor={boxColor} boxTextColor={boxTextColor} />
          <p className="text-[10px] text-muted-foreground text-center -mt-1">Prévia da linha em foco — mexa no estilo abaixo e veja aqui</p>

          {/* Controles de estilo — tudo aqui, ao lado da prévia */}
          <div className="rounded-lg border border-border bg-background/60 p-2.5 space-y-2.5">
            {/* Estilo do texto: contorno x caixa */}
            <div className="grid grid-cols-2 gap-1.5">
              {(['contorno', 'caixa'] as const).map((st) => (
                <button key={st} onClick={() => saveSetting({ reelTextStyle: st })}
                  className={`text-xs font-semibold py-1.5 rounded-lg border transition-colors ${textStyle === st ? 'bg-blue-600 text-foreground border-blue-500' : 'bg-background text-muted-foreground border-border hover:text-foreground'}`}>
                  {st === 'contorno' ? 'Contorno' : 'Caixa'}
                </button>
              ))}
            </div>
            {textStyle === 'caixa' && (
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs text-foreground">Cor da caixa</span>
                  <input type="color" value={boxColor} onChange={(e) => saveSetting({ reelBoxColor: e.target.value })}
                    className="w-9 h-7 bg-background border border-border rounded cursor-pointer" />
                </div>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs text-foreground">Cor do texto</span>
                  <input type="color" value={boxTextColor} onChange={(e) => saveSetting({ reelBoxTextColor: e.target.value })}
                    className="w-9 h-7 bg-background border border-border rounded cursor-pointer" />
                </div>
              </div>
            )}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-foreground inline-flex items-center gap-1.5"><MoveVertical size={12} /> Altura do texto</span>
                <span className="text-[11px] text-muted-foreground tabular-nums">{Math.round(textY * 100)}%</span>
              </div>
              <input type="range" min={20} max={90} step={1} value={Math.round(textY * 100)}
                onChange={(e) => saveSetting({ reelTextY: parseInt(e.target.value, 10) / 100 })}
                className="w-full accent-blue-500" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-foreground inline-flex items-center gap-1.5"><Type size={12} /> Tamanho da fonte</span>
                <span className="text-[11px] text-muted-foreground tabular-nums">{fontSize}px</span>
              </div>
              <input type="range" min={56} max={140} step={2} value={fontSize}
                onChange={(e) => saveSetting({ reelFontSize: parseInt(e.target.value, 10) })}
                className="w-full accent-blue-500" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-foreground">Espaço até "Leia a legenda"</span>
                <span className="text-[11px] text-muted-foreground tabular-nums">{ctaGap}px</span>
              </div>
              <input type="range" min={0} max={240} step={5} value={ctaGap}
                onChange={(e) => saveSetting({ reelCtaGap: parseInt(e.target.value, 10) })}
                className="w-full accent-blue-500" />
            </div>
            {textStyle === 'contorno' && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-foreground">Cor do "Leia a legenda"</span>
                <input type="color" value={ctaColor} onChange={(e) => saveSetting({ reelCtaColor: e.target.value })}
                  className="w-9 h-7 bg-background border border-border rounded cursor-pointer" />
              </div>
            )}
            <label className="flex items-center justify-between gap-2 cursor-pointer">
              <span className="text-xs text-foreground">"Leia a legenda" no meio do vídeo</span>
              <input type="checkbox" checked={cfg?.reelCtaAtMiddle !== false} onChange={(e) => saveSetting({ reelCtaAtMiddle: e.target.checked })} className="w-4 h-4 accent-blue-500" />
            </label>
          </div>

          <label className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/60 px-2.5 py-2 cursor-pointer">
            <span className="text-xs text-foreground inline-flex items-center gap-1.5"><Calendar size={13} /> Agendar no mLabs</span>
            <input type="checkbox" checked={schedule} onChange={(e) => setSchedule(e.target.checked)} className="w-4 h-4 accent-blue-500" />
          </label>

          {schedule && (
            <div className="rounded-lg border border-border bg-background/60 px-2.5 py-2 space-y-2">
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span className="text-xs text-foreground inline-flex items-center gap-1.5"><Repeat size={13} /> Repostar de tempos em tempos</span>
                <input type="checkbox" checked={repostOn} onChange={(e) => setRepostOn(e.target.checked)} className="w-4 h-4 accent-blue-500" />
              </label>
              {repostOn && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground pl-1">
                  a cada
                  <input type="number" min={1} max={12} value={repostMonths}
                    onChange={(e) => setRepostMonths(Math.max(1, Math.min(12, parseInt(e.target.value, 10) || 1)))}
                    className="w-12 bg-background border border-border rounded px-1.5 py-1 text-center text-foreground" />
                  meses,
                  <input type="number" min={2} max={12} value={repostCount}
                    onChange={(e) => setRepostCount(Math.max(2, Math.min(12, parseInt(e.target.value, 10) || 2)))}
                    className="w-12 bg-background border border-border rounded px-1.5 py-1 text-center text-foreground" />
                  vezes
                </div>
              )}
              {repostOn && (
                <p className="text-[10px] text-muted-foreground pl-1">Cada reel será repostado {repostCount}× (mesmo vídeo), a cada {repostMonths} meses.</p>
              )}
            </div>
          )}

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

      {/* Clipes + automação — recolhível, tudo do reel numa página só */}
      <div className="rounded-lg border border-border">
        <button onClick={() => setConfigOpen((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold text-foreground">
          <span className="inline-flex items-center gap-2"><Film size={15} className="text-blue-400" /> Clipes de treino e automação</span>
          <span className="text-xs text-muted-foreground">{freeClips.length} clipe(s) livre(s) {configOpen ? '▲' : '▼'}</span>
        </button>
        {configOpen && (
          <div className="px-3 pb-3 space-y-4 border-t border-border pt-3">
            {/* Banco de clipes crus */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">
                  Banco de clipes crus
                  <span className="block text-xs text-muted-foreground">Vídeos de treino 9:16, sem texto. O lote pega deles (aleatório).</span>
                </span>
                <label className="text-xs font-medium text-foreground bg-blue-600 hover:bg-blue-500 px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1 cursor-pointer">
                  {uploadingClip ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Subir clipes
                  <input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm" multiple className="hidden"
                    disabled={uploadingClip} onChange={(e) => e.target.files?.length && uploadClips(e.target.files)} />
                </label>
              </div>
              {clips.length > 0 && (
                <div className="space-y-1 max-h-40 overflow-auto">
                  {clips.map((v) => (
                    <div key={v.id} className="text-xs flex items-center gap-2 bg-background border border-border rounded-lg px-2 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded ${v.used ? 'bg-muted text-muted-foreground' : 'bg-green-500/15 text-green-400'}`}>{v.used ? 'usado' : 'livre'}</span>
                      <span className="text-foreground truncate flex-1">{v.originalName || v.file}</span>
                      <button onClick={() => deleteClip(v.id)} className="text-muted-foreground hover:text-red-400 p-0.5"><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Banco de músicas */}
            <div className="space-y-2 border-t border-border pt-3">
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <span className="text-sm text-foreground inline-flex items-center gap-1.5"><Music size={14} className="text-blue-400" /> Música na trilha
                  <span className="block text-xs text-muted-foreground font-normal">Corta o áudio do treino e põe uma música aleatória do banco.</span></span>
                <input type="checkbox" checked={!!cfg?.reelMusicOn} onChange={(e) => saveSetting({ reelMusicOn: e.target.checked })} className="w-5 h-5 accent-blue-500" />
              </label>
              {cfg?.reelMusicOn && (
                <div className="space-y-1 pl-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-foreground">Volume da música</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">{Math.round((cfg?.reelMusicVolume ?? 0.9) * 100)}%</span>
                  </div>
                  <input type="range" min={10} max={100} step={5} value={Math.round((cfg?.reelMusicVolume ?? 0.9) * 100)}
                    onChange={(e) => saveSetting({ reelMusicVolume: parseInt(e.target.value, 10) / 100 })}
                    className="w-full accent-blue-500" />
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{tracks.length} música(s) no banco · use faixas livres de direito</span>
                <label className="text-xs font-medium text-foreground bg-blue-600 hover:bg-blue-500 px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1 cursor-pointer">
                  {uploadingMusic ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Subir músicas
                  <input type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac" multiple className="hidden"
                    disabled={uploadingMusic} onChange={(e) => e.target.files?.length && uploadMusic(e.target.files)} />
                </label>
              </div>
              {tracks.length > 0 && (
                <div className="space-y-1 max-h-32 overflow-auto">
                  {tracks.map((m) => (
                    <div key={m.id} className="text-xs flex items-center gap-2 bg-background border border-border rounded-lg px-2 py-1.5">
                      <Music size={12} className="text-muted-foreground shrink-0" />
                      <span className="text-foreground truncate flex-1">{m.originalName || m.file}</span>
                      <button onClick={() => deleteMusic(m.id)} className="text-muted-foreground hover:text-red-400 p-0.5"><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Automação da rotina diária */}
            <div className="space-y-2.5 border-t border-border pt-3">
              <span className="text-sm font-semibold text-foreground">Rotina automática (opcional)</span>
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <span className="text-sm text-foreground">Renderizar reels do dia automaticamente
                  <span className="block text-xs text-muted-foreground">A rotina diária queima o texto num clipe do banco.</span></span>
                <input type="checkbox" checked={!!cfg?.autoRenderReel} onChange={(e) => saveSetting({ autoRenderReel: e.target.checked })} className="w-5 h-5 accent-blue-500" />
              </label>
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <span className="text-sm text-foreground">Agendar no mLabs automaticamente
                  <span className="block text-xs text-muted-foreground">Assim que renderiza, entra no próximo horário livre.</span></span>
                <input type="checkbox" checked={!!cfg?.autoScheduleReel} onChange={(e) => saveSetting({ autoScheduleReel: e.target.checked })} className="w-5 h-5 accent-blue-500" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-foreground">Posts por dia</span>
                  <input type="number" min={1} max={12} value={cfg?.reelPostsPerDay ?? 2}
                    onChange={(e) => saveSetting({ reelPostsPerDay: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    className="w-16 bg-background border border-border rounded-lg px-2 py-1 text-sm text-foreground text-center" />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-foreground">Por X dias</span>
                  <input type="number" min={1} max={365} value={cfg?.reelScheduleDays ?? 30}
                    onChange={(e) => saveSetting({ reelScheduleDays: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    className="w-16 bg-background border border-border rounded-lg px-2 py-1 text-sm text-foreground text-center" />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">Horários (Brasília)
                  <span className="block text-xs text-muted-foreground">Separados por vírgula. Ex.: 11:00,18:00</span></span>
                <input type="text" defaultValue={(cfg?.reelScheduleTimes || []).join(',')}
                  onBlur={(e) => saveSetting({ reelScheduleTimes: e.target.value.split(',').map((x) => x.trim()).filter((x) => /^\d{1,2}:\d{2}$/.test(x)) })}
                  className="w-28 bg-background border border-border rounded-lg px-2 py-1 text-sm text-foreground text-center" />
              </div>
            </div>
          </div>
        )}
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
                <>
                  <span className="text-muted-foreground truncate flex-1">
                    pronto{r.dates?.length ? ` · agendado ${fmtBRT(r.dates[0])} (Brasília)${r.dates.length > 1 ? ` +${r.dates.length - 1} repost` : ''}` : ''}
                  </span>
                  {r.videoFile && (
                    <a href={`${API}/uploads/reels/rendered/${r.videoFile}`} target="_blank" rel="noreferrer"
                      className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1 shrink-0">
                      <Play size={12} /> ver vídeo
                    </a>
                  )}
                </>
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
