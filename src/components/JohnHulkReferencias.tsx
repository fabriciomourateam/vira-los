import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Dumbbell, Sparkles, Loader2, Image as ImageIcon, ExternalLink,
  Copy, ChevronDown, ChevronUp, AlertTriangle, CalendarClock, Check, Clock,
  RefreshCw, Search, Star, Eye, Heart, MessageCircle, Link2, Edit3, X,
  Library, FileStack, TrendingUp, Film, CheckSquare,
} from 'lucide-react';
import CarouselEditor from './CarouselEditor';
import { MlabsScheduleButton } from './MlabsScheduler';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ─── Tipos: rotina diária (auto) ──────────────────────────────────────────────

interface Step { id: string; label: string; status: 'running' | 'done' | 'error'; ms: number; error?: string; }

interface JHCarousel {
  id: string; topic: string; folderName: string; numSlides: number;
  screenshots?: string[]; legenda?: string; layoutStyle?: string; source?: string; archived?: boolean;
  sourceReel?: { shortCode?: string; url?: string; handle?: string };
  derivedTopic?: string; config?: Record<string, unknown>; created_at?: string;
}

interface Batch {
  id: string; date: string; trigger?: string; handle?: string;
  reelShortCode?: string; reelUrl?: string; topic?: string; carouselId?: string;
  steps: Step[]; note?: string;
  status: 'generating' | 'done' | 'partial' | 'error';
  errors?: string[]; created_at?: string; carousel?: JHCarousel | null;
}

interface JohnHulkState { generating: boolean; startedAt?: string; lastError?: string; }
interface Settings { johnHulkEnabled: boolean; autoScheduleJohnHulk: boolean; }

// ─── Tipos: Biblioteca de reels ───────────────────────────────────────────────

type ReelStatus = 'novo' | 'modelado' | 'editado' | 'agendado' | 'postado';

interface Reel {
  shortCode: string; handle: string; url: string; thumbnailUrl?: string; caption?: string;
  timestampMs?: number; views?: number; likes?: number; comments?: number; durationSec?: number;
  fetchedAt?: string;
  status: ReelStatus; usedAt?: string; carouselId?: string; topic?: string;
  favorite?: boolean; themeTag?: string;
}

interface LibraryState { refreshing: boolean; startedAt?: string; lastHandle?: string; lastError?: string; lastFinishedAt?: string; }

interface InsightSummaryItem {
  shortCode: string; topic?: string; themeTag?: string; carouselId?: string;
  matchedPosts: number; avgEngagement: number | null;
}
interface InsightsResponse { available: boolean; summary?: InsightSummaryItem[]; error?: string; }

type SubView = 'biblioteca' | 'rascunhos' | 'insights' | 'auto';

// ─── Constantes visuais ────────────────────────────────────────────────────────

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

const REEL_STATUS_OPTIONS: { value: ReelStatus; label: string }[] = [
  { value: 'novo', label: 'Novo' },
  { value: 'modelado', label: 'Modelado' },
  { value: 'editado', label: 'Editado' },
  { value: 'agendado', label: 'Agendado' },
  { value: 'postado', label: 'Postado' },
];
const REEL_STATUS_LABELS: Record<string, string> = Object.fromEntries(REEL_STATUS_OPTIONS.map(o => [o.value, o.label]));
const REEL_STATUS_BADGE: Record<string, string> = {
  novo: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  modelado: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  editado: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  agendado: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  postado: 'bg-green-500/15 text-green-400 border-green-500/30',
};

// ─── Helpers ────────────────────────────────────────────────────────────────────

function copy(text: string) {
  navigator.clipboard.writeText(text).then(() => toast.success('Copiado!'));
}

function formatCompact(n?: number | null): string {
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${(n / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return Math.round(n).toLocaleString('pt-BR');
}

function formatDuration(sec?: number | null): string {
  if (sec == null) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDate(ms?: number | null): string {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
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

// ─── Card de reel da Biblioteca ────────────────────────────────────────────────

function ReelCard({
  reel, selected, onToggleSelect, onToggleFavorite, favoriting, onModel, modeling,
}: {
  reel: Reel; selected: boolean; onToggleSelect: () => void; onToggleFavorite: () => void;
  favoriting: boolean; onModel: (regenerate: boolean) => void; modeling: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const used = reel.status !== 'novo';

  return (
    <div className={`rounded-xl border border-border bg-card overflow-hidden flex flex-col transition-opacity ${used ? 'opacity-60' : ''}`}>
      <div className="relative aspect-[4/5] bg-secondary">
        {reel.thumbnailUrl && !imgError ? (
          <img
            src={reel.thumbnailUrl}
            alt={reel.caption || reel.shortCode}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <ImageIcon size={28} className="opacity-30" />
          </div>
        )}

        {reel.status === 'novo' ? (
          <label className="absolute top-1.5 left-1.5 z-10 cursor-pointer bg-black/40 rounded p-0.5">
            <input type="checkbox" checked={selected} onChange={onToggleSelect} className="w-4 h-4 accent-purple-500 block" />
          </label>
        ) : (
          <span className={`absolute top-1.5 left-1.5 z-10 text-[10px] px-1.5 py-0.5 rounded-full border ${REEL_STATUS_BADGE[reel.status] || ''}`}>
            {REEL_STATUS_LABELS[reel.status] || reel.status}
          </span>
        )}

        <button
          onClick={onToggleFavorite}
          disabled={favoriting}
          title={reel.favorite ? 'Remover dos favoritos' : 'Favoritar'}
          className="absolute top-1.5 right-1.5 z-10 p-1 rounded-full bg-black/50 hover:bg-black/70 transition-colors disabled:opacity-60"
        >
          <Star size={14} className={reel.favorite ? 'fill-yellow-400 text-yellow-400' : 'text-white/80'} />
        </button>

        {reel.durationSec != null && (
          <span className="absolute bottom-1.5 right-1.5 z-10 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded">
            {formatDuration(reel.durationSec)}
          </span>
        )}
      </div>

      <div className="p-2.5 space-y-1.5 flex-1 flex flex-col">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-0.5" title="Views"><Eye size={11} /> {formatCompact(reel.views)}</span>
          <span className="inline-flex items-center gap-0.5" title="Likes"><Heart size={11} /> {formatCompact(reel.likes)}</span>
          <span className="inline-flex items-center gap-0.5" title="Comentários"><MessageCircle size={11} /> {formatCompact(reel.comments)}</span>
        </div>
        <p className="text-[11px] text-muted-foreground line-clamp-2 flex-1">{reel.caption || 'Sem legenda'}</p>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{formatDate(reel.timestampMs)}</span>
          <a href={reel.url} target="_blank" rel="noreferrer" className="text-purple-400 hover:text-purple-300 inline-flex items-center gap-0.5">
            <ExternalLink size={10} /> Instagram
          </a>
        </div>
        <button
          onClick={() => onModel(reel.status !== 'novo')}
          disabled={modeling}
          className="mt-1 w-full flex items-center justify-center gap-1.5 text-xs font-semibold px-2 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-colors disabled:opacity-60"
        >
          {modeling ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {modeling ? 'Modelando…' : reel.status === 'novo' ? 'Modelar' : 'Remodelar'}
        </button>
      </div>
    </div>
  );
}

// ─── Card de rascunho (carrossel gerado pelo John Hulk) ───────────────────────

function DraftCard({
  draft, reel, batchId, editingOpen, onToggleEdit, captionOpen, onToggleCaption,
  approving, approved, onApprove,
}: {
  draft: JHCarousel; reel?: Reel; batchId?: string;
  editingOpen: boolean; onToggleEdit: () => void;
  captionOpen: boolean; onToggleCaption: () => void;
  approving: boolean; approved: boolean; onApprove: () => void;
}) {
  const status = reel?.status;
  const dateStr = draft.created_at
    ? new Date(draft.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })
    : '';

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm font-semibold text-foreground flex-1 min-w-[160px]">{draft.topic || draft.derivedTopic}</p>
        {status && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${REEL_STATUS_BADGE[status] || ''}`}>
            {REEL_STATUS_LABELS[status] || status}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
        {dateStr && <span>{dateStr}</span>}
        {draft.sourceReel?.handle && <span>· fonte: @{draft.sourceReel.handle}</span>}
        {draft.sourceReel?.url && (
          <a href={draft.sourceReel.url} target="_blank" rel="noreferrer" className="text-purple-400 hover:text-purple-300 inline-flex items-center gap-1">
            <ExternalLink size={11} /> reel original
          </a>
        )}
      </div>

      {draft.screenshots && draft.screenshots.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {draft.screenshots.map((shot, i) => (
            <img
              key={shot + i}
              src={`${API}/output/${draft.folderName}/${shot}`}
              alt={`slide ${i + 1}`}
              className="h-32 w-auto rounded-lg border border-border object-cover shrink-0"
            />
          ))}
        </div>
      ) : (
        <div className="h-20 flex items-center justify-center text-muted-foreground text-xs bg-secondary rounded-lg">
          <ImageIcon size={16} className="mr-1.5" /> Sem screenshots
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <a href={`${API}/output/${draft.folderName}/carrossel.html`} target="_blank" rel="noreferrer" className="text-xs text-purple-400 hover:text-purple-300 inline-flex items-center gap-1">
          <ExternalLink size={12} /> Abrir carrossel
        </a>
        {draft.legenda && (
          <button onClick={onToggleCaption} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            Legenda {captionOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        )}
        <button
          onClick={onToggleEdit}
          className={`text-xs font-medium px-2.5 py-1 rounded-lg inline-flex items-center gap-1 transition-colors ${editingOpen ? 'bg-purple-500/20 text-purple-300' : 'bg-secondary text-foreground hover:bg-secondary/70'}`}
        >
          <Edit3 size={12} /> Editar
        </button>
        {batchId ? (
          <button
            onClick={onApprove}
            disabled={approving || approved || !draft.screenshots?.length}
            className="text-xs font-medium text-foreground bg-blue-600 hover:bg-blue-500 px-2.5 py-1 rounded-lg inline-flex items-center gap-1 transition-colors disabled:opacity-60"
          >
            {approving ? <Loader2 size={12} className="animate-spin" /> : approved ? <Check size={12} /> : <CalendarClock size={12} />}
            {approved ? 'Aprovado' : 'Aprovar → agendar no mLabs'}
          </button>
        ) : (
          draft.screenshots?.length ? <MlabsScheduleButton kind="carousel" contentId={draft.id} caption={draft.legenda} /> : null
        )}
      </div>

      {captionOpen && draft.legenda && (
        <div>
          <div className="bg-background border border-border rounded-lg p-2 text-xs text-muted-foreground whitespace-pre-wrap max-h-40 overflow-auto">{draft.legenda}</div>
          <button onClick={() => copy(draft.legenda!)} className="mt-1.5 text-xs text-purple-400 inline-flex items-center gap-1"><Copy size={11} /> Copiar legenda</button>
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ───────────────────────────────────────────────────────

export default function JohnHulkReferencias() {
  const [subView, setSubView] = useState<SubView>('biblioteca');

  // ── Rotina diária (auto) ────────────────────────────────────────────────────
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

  // batchId por carouselId — usado pelos rascunhos gerados pela rotina diária,
  // que têm um batch correspondente (e por isso podem usar o approve 1-clique
  // já existente). Rascunhos modelados manualmente na Biblioteca não têm batch.
  const carouselIdToBatchId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of batches) if (b.carouselId) map[b.carouselId] = b.id;
    return map;
  }, [batches]);

  // ── Biblioteca de reels ─────────────────────────────────────────────────────
  const [reels, setReels] = useState<Reel[]>([]);
  const [libraryState, setLibraryState] = useState<LibraryState>({ refreshing: false });
  const [reelsLoading, setReelsLoading] = useState(true);
  const [handleOptions, setHandleOptions] = useState<string[]>([]);
  const [handleFilter, setHandleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | ReelStatus>('');
  const [favoriteFilter, setFavoriteFilter] = useState<'all' | 'true' | 'false'>('all');
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [sort, setSort] = useState<'views' | 'likes' | 'comments' | 'date'>('date');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [favoritingMap, setFavoritingMap] = useState<Record<string, boolean>>({});
  const [modelingMap, setModelingMap] = useState<Record<string, number>>({});
  const [modelUrl, setModelUrl] = useState('');
  const [urlModeling, setUrlModeling] = useState(false);
  const [refreshingLib, setRefreshingLib] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 400);
    return () => clearTimeout(t);
  }, [q]);

  const libraryStateRef = useRef(libraryState);
  libraryStateRef.current = libraryState;
  const modelingMapRef = useRef(modelingMap);
  modelingMapRef.current = modelingMap;

  const fetchReels = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (handleFilter) params.set('handle', handleFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (favoriteFilter !== 'all') params.set('favorite', favoriteFilter);
      if (qDebounced) params.set('q', qDebounced);
      params.set('sort', sort);
      params.set('order', order);

      const res = await fetch(`${API}/api/john-hulk/reels?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      const list: Reel[] = Array.isArray(data.reels) ? data.reels : [];
      const wasRefreshing = libraryStateRef.current.refreshing;
      const nowState: LibraryState = data.libraryState || { refreshing: false };

      setLibraryState(nowState);
      setReels(list);
      if (!handleFilter) {
        setHandleOptions(Array.from(new Set(list.map((r) => r.handle).filter(Boolean))).sort());
      }
      if (wasRefreshing && !nowState.refreshing) {
        toast.success(nowState.lastError ? `Atualização concluída com aviso: ${nowState.lastError}` : 'Biblioteca atualizada!');
      }

      // Detecta reels que terminaram de modelar (status saiu de 'novo').
      const stillModeling = modelingMapRef.current;
      if (Object.keys(stillModeling).length) {
        const next = { ...stillModeling };
        let changed = false;
        for (const sc of Object.keys(stillModeling)) {
          const r = list.find((x) => x.shortCode === sc);
          const timedOut = Date.now() - stillModeling[sc] > 6 * 60 * 1000;
          if (r && r.status !== 'novo') {
            delete next[sc]; changed = true;
            toast.success(`"${r.topic || sc}" modelado! Rascunho pronto.`, {
              action: { label: 'Ver rascunho', onClick: () => setSubView('rascunhos') },
            });
          } else if (timedOut) {
            delete next[sc]; changed = true;
          }
        }
        if (changed) setModelingMap(next);
      }
    } catch {
      // silent
    } finally {
      setReelsLoading(false);
    }
  }, [handleFilter, statusFilter, favoriteFilter, qDebounced, sort, order]);

  useEffect(() => { if (subView === 'biblioteca') fetchReels(); }, [subView, fetchReels]);

  // Poll enquanto o refresh da biblioteca ou a modelagem de algum reel estiver rodando.
  useEffect(() => {
    if (subView !== 'biblioteca') return;
    const active = libraryState.refreshing || Object.keys(modelingMap).length > 0;
    if (!active) return;
    const id = setInterval(fetchReels, 5000);
    return () => clearInterval(id);
  }, [subView, libraryState.refreshing, modelingMap, fetchReels]);

  async function handleRefreshLibrary() {
    setRefreshingLib(true);
    try {
      const res = await fetch(`${API}/api/john-hulk/reels/refresh`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: handleFilter || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao atualizar biblioteca.');
      if (data.skipped === 'disabled') {
        toast.error('John Hulk está desativado (kill-switch) — ative na aba "Diário automático".');
        return;
      }
      toast.info('Atualizando biblioteca de reels… pode levar alguns minutos.');
      fetchReels();
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao atualizar biblioteca.');
    } finally {
      setRefreshingLib(false);
    }
  }

  async function handleModelReel(shortCode: string, regenerate: boolean) {
    setModelingMap((m) => ({ ...m, [shortCode]: Date.now() }));
    try {
      const res = await fetch(`${API}/api/john-hulk/reels/${shortCode}/model`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao modelar.');
      toast.info('Modelando reel em carrossel FMTeam… leva alguns minutos.');
    } catch (err: any) {
      setModelingMap((m) => { const n = { ...m }; delete n[shortCode]; return n; });
      toast.error(err?.message || 'Erro ao modelar.');
    }
  }

  async function handleModelUrl() {
    const url = modelUrl.trim();
    if (!url) { toast.error('Cole a URL do reel/post do Instagram.'); return; }
    setUrlModeling(true);
    try {
      const res = await fetch(`${API}/api/john-hulk/reels/model-url`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao modelar por URL.');
      toast.info('Modelando reel em carrossel… leva alguns minutos. A biblioteca atualiza sozinha.');
      setModelUrl('');
      // Modelagem por URL avulsa não tem shortCode conhecido de antemão pra rastrear
      // por polling reativo — faz alguns refreshes best-effort da lista.
      setTimeout(fetchReels, 10000);
      setTimeout(fetchReels, 30000);
      setTimeout(fetchReels, 60000);
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao modelar por URL.');
    } finally {
      setUrlModeling(false);
    }
  }

  async function handleModelSelected() {
    const codes = Array.from(selected);
    if (!codes.length) return;
    setModelingMap((m) => { const n = { ...m }; codes.forEach((c) => { n[c] = Date.now(); }); return n; });
    try {
      const res = await fetch(`${API}/api/john-hulk/reels/model-batch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortCodes: codes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao iniciar o lote.');
      toast.info(`Modelando ${codes.length} reels em lote… acompanhe pelos cards.`);
      setSelected(new Set());
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao modelar em lote.');
    }
  }

  async function handleToggleFavorite(shortCode: string) {
    setFavoritingMap((m) => ({ ...m, [shortCode]: true }));
    try {
      const res = await fetch(`${API}/api/john-hulk/reels/${shortCode}/favorite`, { method: 'POST' });
      const updated = await res.json();
      if (!res.ok) throw new Error(updated.error || 'Falha ao favoritar.');
      setReels((prev) => prev.map((r) => (r.shortCode === shortCode ? updated : r)));
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao favoritar.');
    } finally {
      setFavoritingMap((m) => { const n = { ...m }; delete n[shortCode]; return n; });
    }
  }

  function toggleSelect(shortCode: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(shortCode)) next.delete(shortCode); else next.add(shortCode);
      return next;
    });
  }

  // ── Rascunhos (carrosséis gerados) ──────────────────────────────────────────
  const [drafts, setDrafts] = useState<JHCarousel[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(true);
  const [openDraftCaption, setOpenDraftCaption] = useState<Record<string, boolean>>({});
  const [draftEditing, setDraftEditing] = useState<JHCarousel | null>(null);
  const [draftEditingHtml, setDraftEditingHtml] = useState<string | null>(null);
  const [approvingDraft, setApprovingDraft] = useState<Record<string, boolean>>({});
  const [approvedDraft, setApprovedDraft] = useState<Record<string, boolean>>({});

  const fetchDrafts = useCallback(async () => {
    setDraftsLoading(true);
    try {
      const res = await fetch(`${API}/api/carousel/saved`);
      const data = await res.json();
      const list: JHCarousel[] = Array.isArray(data)
        ? data.filter((c: any) => c.source === 'john-hulk' && !c.archived)
        : [];
      setDrafts(list);
    } catch {
      toast.error('Não consegui carregar os rascunhos.');
    } finally {
      setDraftsLoading(false);
    }
  }, []);

  useEffect(() => { if (subView === 'rascunhos') fetchDrafts(); }, [subView, fetchDrafts]);

  const reelByShortCode = useMemo(() => {
    const map: Record<string, Reel> = {};
    for (const r of reels) map[r.shortCode] = r;
    return map;
  }, [reels]);

  async function handleToggleDraftEdit(d: JHCarousel) {
    if (draftEditing?.id === d.id) { setDraftEditing(null); setDraftEditingHtml(null); return; }
    try {
      const res = await fetch(`${API}/output/${d.folderName}/carrossel.html`);
      if (!res.ok) throw new Error('HTML não encontrado');
      const html = await res.text();
      setDraftEditing(d);
      setDraftEditingHtml(html);
    } catch {
      toast.error('Não foi possível carregar o HTML deste carrossel');
    }
  }

  async function handleApproveDraft(d: JHCarousel) {
    const batchId = carouselIdToBatchId[d.id];
    if (!batchId) return;
    setApprovingDraft((s) => ({ ...s, [d.id]: true }));
    try {
      const res = await fetch(`${API}/api/john-hulk/${batchId}/approve`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao aprovar/agendar.');
      setApprovedDraft((s) => ({ ...s, [d.id]: true }));
      toast.success('Aprovado e agendado no mLabs!');
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao aprovar/agendar.');
    } finally {
      setApprovingDraft((s) => ({ ...s, [d.id]: false }));
    }
  }

  // ── Insights ─────────────────────────────────────────────────────────────────
  const [insights, setInsights] = useState<InsightsResponse>({ available: false });
  const [insightsLoading, setInsightsLoading] = useState(true);

  const fetchInsights = useCallback(async () => {
    setInsightsLoading(true);
    try {
      const res = await fetch(`${API}/api/john-hulk/insights`);
      const data = await res.json();
      setInsights(data);
    } catch {
      setInsights({ available: false });
    } finally {
      setInsightsLoading(false);
    }
  }, []);

  useEffect(() => { if (subView === 'insights') fetchInsights(); }, [subView, fetchInsights]);

  // ── Sub-views ────────────────────────────────────────────────────────────────

  function renderBiblioteca() {
    return (
      <div className="space-y-4">
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <button
              onClick={handleRefreshLibrary}
              disabled={refreshingLib || libraryState.refreshing}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition-colors disabled:opacity-60"
            >
              {(refreshingLib || libraryState.refreshing) ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {libraryState.refreshing ? 'Atualizando biblioteca…' : 'Atualizar biblioteca'}
            </button>
            {libraryState.lastFinishedAt && !libraryState.refreshing && (
              <span className="text-[11px] text-muted-foreground">
                última atualização: {new Date(libraryState.lastFinishedAt).toLocaleString('pt-BR')}
                {libraryState.lastError && <span className="text-red-400"> · {libraryState.lastError}</span>}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={modelUrl}
              onChange={(e) => setModelUrl(e.target.value)}
              placeholder="Colar URL de um reel/post do Instagram para modelar…"
              className="flex-1 min-w-[220px] rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            />
            <button
              onClick={handleModelUrl}
              disabled={urlModeling || !modelUrl.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/70 text-foreground text-xs font-semibold transition-colors disabled:opacity-60"
            >
              {urlModeling ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
              Modelar por URL
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {handleOptions.length > 1 && (
              <select value={handleFilter} onChange={(e) => setHandleFilter(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs">
                <option value="">Todas as contas</option>
                {handleOptions.map((h) => <option key={h} value={h}>@{h}</option>)}
              </select>
            )}
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs">
              <option value="">Todos os status</option>
              {REEL_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={favoriteFilter} onChange={(e) => setFavoriteFilter(e.target.value as any)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs">
              <option value="all">Favoritos: todos</option>
              <option value="true">Só favoritos</option>
              <option value="false">Sem favoritos</option>
            </select>
            <div className="relative flex-1 min-w-[160px]">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por legenda ou tema…"
                className="w-full rounded-lg border border-border bg-background pl-7 pr-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
            </div>
            <select value={sort} onChange={(e) => setSort(e.target.value as any)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs">
              <option value="date">Ordenar: data</option>
              <option value="views">Ordenar: views</option>
              <option value="likes">Ordenar: likes</option>
              <option value="comments">Ordenar: comentários</option>
            </select>
            <select value={order} onChange={(e) => setOrder(e.target.value as any)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs">
              <option value="desc">Desc.</option>
              <option value="asc">Asc.</option>
            </select>
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] text-muted-foreground">{reels.length} reel{reels.length === 1 ? '' : 's'} na lista</span>
            <button
              onClick={handleModelSelected}
              disabled={selected.size === 0}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors disabled:opacity-40"
            >
              <CheckSquare size={13} /> Modelar selecionados ({selected.size})
            </button>
          </div>
        </div>

        {reelsLoading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground"><Loader2 size={22} className="animate-spin mr-2" /> Carregando reels...</div>
        ) : reels.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-6 text-center text-muted-foreground">
            Nenhum reel na biblioteca ainda. Clique em <b className="text-foreground">Atualizar biblioteca</b> para buscar os últimos reels da(s) conta(s) de referência.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {reels.map((r) => (
              <ReelCard
                key={r.shortCode}
                reel={r}
                selected={selected.has(r.shortCode)}
                onToggleSelect={() => toggleSelect(r.shortCode)}
                onToggleFavorite={() => handleToggleFavorite(r.shortCode)}
                favoriting={!!favoritingMap[r.shortCode]}
                onModel={(regenerate) => handleModelReel(r.shortCode, regenerate)}
                modeling={!!modelingMap[r.shortCode]}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderRascunhos() {
    return (
      <div className="space-y-4">
        {draftsLoading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground"><Loader2 size={22} className="animate-spin mr-2" /> Carregando rascunhos...</div>
        ) : drafts.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-6 text-center text-muted-foreground">
            Nenhum rascunho ainda. Modele um reel na aba <b className="text-foreground">Biblioteca</b> ou gere pelo <b className="text-foreground">Diário automático</b>.
          </div>
        ) : (
          drafts.map((d) => (
            <DraftCard
              key={d.id}
              draft={d}
              reel={d.sourceReel?.shortCode ? reelByShortCode[d.sourceReel.shortCode] : undefined}
              batchId={carouselIdToBatchId[d.id]}
              editingOpen={draftEditing?.id === d.id}
              onToggleEdit={() => handleToggleDraftEdit(d)}
              captionOpen={!!openDraftCaption[d.id]}
              onToggleCaption={() => setOpenDraftCaption((s) => ({ ...s, [d.id]: !s[d.id] }))}
              approving={!!approvingDraft[d.id]}
              approved={!!approvedDraft[d.id]}
              onApprove={() => handleApproveDraft(d)}
            />
          ))
        )}

        {draftEditing && draftEditingHtml && (
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-2 sm:p-4"
            onClick={() => { setDraftEditing(null); setDraftEditingHtml(null); }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-card rounded-2xl w-full max-w-4xl my-2 sm:my-4 border border-border shadow-xl"
            >
              <div className="flex items-center justify-between gap-2 p-3 border-b border-border sticky top-0 bg-card rounded-t-2xl z-10">
                <span className="text-xs font-semibold text-purple-400 flex items-center gap-1.5 min-w-0">
                  <Edit3 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Editando: <span className="text-foreground">{draftEditing.topic}</span></span>
                </span>
                <button
                  onClick={() => { setDraftEditing(null); setDraftEditingHtml(null); }}
                  className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-lg hover:bg-secondary"
                >
                  <X className="w-4 h-4" /> Fechar
                </button>
              </div>
              <div className="p-3">
                <CarouselEditor
                  html={draftEditingHtml}
                  folderName={draftEditing.folderName}
                  topic={draftEditing.topic}
                  numSlides={draftEditing.numSlides}
                  legenda={draftEditing.legenda}
                  config={(draftEditing.config as Record<string, unknown>) || {}}
                  onScreenshotsUpdated={(screenshots) => {
                    const id = draftEditing.id;
                    setDrafts((prev) => prev.map((c) => (c.id === id ? { ...c, screenshots } : c)));
                    // Persiste no banco de dados — mesmo endpoint usado pela aba Carrossel
                    // pra qualquer carrossel salvo (John Hulk usa a mesma coleção).
                    fetch(`${API}/api/carousel/saved/${id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ screenshots }),
                    }).catch(() => {});

                    const sc = draftEditing.sourceReel?.shortCode;
                    if (sc) {
                      fetch(`${API}/api/john-hulk/reels/${sc}/status`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: 'editado' }),
                      })
                        .then((r) => (r.ok ? r.json() : null))
                        .then((updated) => {
                          if (updated) setReels((prev) => prev.map((r) => (r.shortCode === sc ? updated : r)));
                        })
                        .catch(() => {});
                    }
                    toast.success('Edição salva! Status do reel atualizado para "editado".');
                  }}
                  onHtmlUpdated={(html) => setDraftEditingHtml(html)}
                  onTemplateSaved={fetchDrafts}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderInsights() {
    if (insightsLoading) {
      return <div className="flex items-center justify-center h-40 text-muted-foreground"><Loader2 size={22} className="animate-spin mr-2" /> Carregando insights...</div>;
    }
    if (!insights.available || !insights.summary?.length) {
      return (
        <div className="bg-card border border-border rounded-2xl p-6 text-center text-muted-foreground space-y-2">
          <TrendingUp size={24} className="mx-auto opacity-40" />
          <p>Ainda sem dados suficientes pra aprendizado.</p>
          <p className="text-xs">Conecte/sincronize o Instagram e modele alguns reels na Biblioteca pra ver aqui o que performou melhor.</p>
        </div>
      );
    }
    return (
      <div className="bg-card border border-border rounded-2xl divide-y divide-border">
        {insights.summary.map((item, i) => (
          <div key={item.shortCode + i} className="p-3.5 flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{item.topic || item.shortCode}</p>
              <p className="text-[11px] text-muted-foreground">
                {item.matchedPosts} post{item.matchedPosts === 1 ? '' : 's'} relacionado{item.matchedPosts === 1 ? '' : 's'}
                {item.themeTag && <> · tema: {item.themeTag}</>}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-bold text-purple-400">{item.avgEngagement != null ? formatCompact(item.avgEngagement) : '—'}</p>
              <p className="text-[10px] text-muted-foreground">engajamento médio</p>
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderAuto() {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm text-muted-foreground max-w-2xl">
            Pega o reel mais recente de uma conta de referência, transcreve e gera um carrossel no
            estilo FMTeam como <b className="text-foreground">rascunho</b> pra revisão. Nada é postado
            sem aprovação (a menos que "Auto-agendar" esteja ligado).
          </p>
          <button
            onClick={handleGenerate}
            disabled={state.generating}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-foreground text-sm font-semibold transition-colors disabled:opacity-60"
          >
            {state.generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {state.generating ? 'Gerando...' : 'Gerar agora'}
          </button>
        </div>

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

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground"><Loader2 size={26} className="animate-spin mr-2" /> Carregando...</div>;
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Dumbbell size={22} className="text-purple-400" />
          <h2 className="text-xl font-bold text-foreground">Biblioteca & Estúdio (John Hulk)</h2>
        </div>
        <div className="flex gap-1 bg-secondary rounded-lg p-0.5">
          {([
            { id: 'biblioteca', label: 'Biblioteca', icon: Library },
            { id: 'rascunhos', label: 'Rascunhos', icon: FileStack },
            { id: 'insights', label: 'Insights', icon: TrendingUp },
            { id: 'auto', label: 'Diário automático', icon: Film },
          ] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => setSubView(t.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${subView === t.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <t.icon size={13} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {subView === 'biblioteca' && renderBiblioteca()}
      {subView === 'rascunhos' && renderRascunhos()}
      {subView === 'insights' && renderInsights()}
      {subView === 'auto' && renderAuto()}
    </div>
  );
}
