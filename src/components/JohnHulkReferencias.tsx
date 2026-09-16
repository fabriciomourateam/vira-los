import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Dumbbell, Sparkles, Loader2, Image as ImageIcon, ExternalLink,
  Copy, ChevronDown, ChevronUp, AlertTriangle, CalendarClock, Check, Clock,
  RefreshCw, Search, Star, Eye, Heart, MessageCircle, Link2, Edit3, X,
  Library, FileStack, TrendingUp, Film, CheckSquare, Kanban, Zap, Wallet,
  Lightbulb, Plus, Trash2, ArrowRight, Repeat,
} from 'lucide-react';
import CarouselEditor from './CarouselEditor';
import { MlabsScheduleButton } from './MlabsScheduler';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ─── Tipos: rotina diária (auto) ──────────────────────────────────────────────

interface Step { id: string; label: string; status: 'running' | 'done' | 'error'; ms: number; error?: string; }

type JHMode = 'organico' | 'anuncio';
type CtaDestination = 'whatsapp' | 'link' | 'dm';

interface JHCarousel {
  id: string; topic: string; folderName: string; numSlides: number;
  screenshots?: string[]; legenda?: string; layoutStyle?: string; source?: string; archived?: boolean;
  sourceReel?: { shortCode?: string; url?: string; handle?: string };
  derivedTopic?: string; config?: Record<string, unknown>; created_at?: string;
  viralInsight?: string | null; variantIndex?: number;
  mode?: JHMode; ctaDestination?: CtaDestination; offer?: string;
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
type ReelRuntimeStatus = ReelStatus | 'erro';

interface Reel {
  shortCode: string; handle: string; url: string; thumbnailUrl?: string; caption?: string;
  timestampMs?: number; views?: number; likes?: number; comments?: number; durationSec?: number;
  fetchedAt?: string;
  status: ReelRuntimeStatus; usedAt?: string; carouselId?: string; topic?: string;
  favorite?: boolean; themeTag?: string;
  errorMessage?: string | null; errorAt?: string | null; carouselIds?: string[];
  viralInsight?: string | null;
}

interface LibraryState { refreshing: boolean; startedAt?: string; lastHandle?: string; lastError?: string; lastFinishedAt?: string; }

interface InsightSummaryItem {
  shortCode: string; topic?: string; themeTag?: string; carouselId?: string;
  matchedPosts: number; avgEngagement: number | null;
}
interface InsightsResponse { available: boolean; summary?: InsightSummaryItem[]; error?: string; }

interface CostFeature { brl: number; count: number; savedBrl?: number; }
interface CostResponse {
  available: boolean; today?: number; total?: number; error?: string;
  johnHulk?: CostFeature; byFeature?: Record<string, CostFeature>;
}

interface DupeCheckItem { shortCode: string; topic?: string; carouselId?: string; overlap: number; }
interface DupeCheckResponse { similar: DupeCheckItem[]; count: number; error?: string; }

type SubView = 'biblioteca' | 'rascunhos' | 'insights' | 'auto' | 'pipeline';

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
const REEL_STATUS_LABELS: Record<string, string> = {
  ...Object.fromEntries(REEL_STATUS_OPTIONS.map(o => [o.value, o.label])),
  erro: 'Falhou',
};
const REEL_STATUS_BADGE: Record<string, string> = {
  novo: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  modelado: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  editado: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  agendado: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  postado: 'bg-green-500/15 text-green-400 border-green-500/30',
  erro: 'bg-red-500/15 text-red-400 border-red-500/30',
};
// Ordem do pipeline pro Kanban (erro fica fora — é um estado de falha, não um passo).
const PIPELINE_ORDER: ReelStatus[] = ['novo', 'modelado', 'editado', 'agendado', 'postado'];

// Modo anúncio (tráfego pago) — item novo do contrato /model e /model-url.
const NUM_SLIDES_OPTIONS = [4, 5, 6, 7, 8, 9, 10] as const;
const CTA_DESTINATION_OPTIONS: { value: CtaDestination; label: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'link', label: 'Link (site)' },
  { value: 'dm', label: 'DM' },
];
const CTA_DESTINATION_LABELS: Record<string, string> = Object.fromEntries(
  CTA_DESTINATION_OPTIONS.map((o) => [o.value, o.label])
);
const CTA_COPY_PREVIEW: Record<CtaDestination, string> = {
  whatsapp: 'CHAME NO WHATSAPP',
  link: 'CLIQUE EM SAIBA MAIS',
  dm: 'CHAME NA DM',
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

function formatBRL(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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

// ─── Botão "Aprovar → agendar" com escolha de data/hora (item 6) ──────────────
// Datas usam <input type="datetime-local"> — valor "AAAA-MM-DDTHH:MM" em horário
// de Brasília, mesmo padrão do MlabsScheduler.tsx. Se nenhuma data for escolhida,
// manda dates:[] e o backend cai no comportamento padrão (computeDefaultDates()).
function ApproveScheduleControl({
  approving, approved, disabled, onApprove,
}: {
  approving: boolean; approved: boolean; disabled?: boolean; onApprove: (dates: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dates, setDates] = useState<string[]>(['']);

  function setDateAt(i: number, v: string) {
    setDates((p) => p.map((d, j) => (j === i ? v : d)));
  }
  function addDate() {
    setDates((p) => [...p, '']);
  }
  function removeDate(i: number) {
    setDates((p) => (p.length > 1 ? p.filter((_, j) => j !== i) : ['']));
  }
  function confirm() {
    setOpen(false);
    onApprove(dates.filter(Boolean));
    setDates(['']);
  }

  if (approved) {
    return (
      <span className="text-xs font-medium text-green-400 inline-flex items-center gap-1">
        <Check size={12} /> Aprovado
      </span>
    );
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={approving || disabled}
        className="text-xs font-medium text-foreground bg-blue-600 hover:bg-blue-500 px-2.5 py-1 rounded-lg inline-flex items-center gap-1 transition-colors disabled:opacity-60"
      >
        {approving ? <Loader2 size={12} className="animate-spin" /> : <CalendarClock size={12} />}
        Aprovar → agendar no mLabs
      </button>

      {open && (
        <div
          className="absolute z-20 top-full left-0 mt-1.5 w-64 bg-card border border-border rounded-xl p-3 space-y-2 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-[11px] text-muted-foreground">
            Escolha data/hora (Brasília) ou deixe em branco para o agendamento automático.
          </p>
          <div className="space-y-1.5">
            {dates.map((d, i) => (
              <div key={i} className="flex items-center gap-1">
                <input
                  type="datetime-local"
                  value={d}
                  onChange={(e) => setDateAt(i, e.target.value)}
                  className="flex-1 min-w-0 rounded-lg border border-border bg-background px-1.5 py-1 text-[11px]"
                />
                <button
                  onClick={() => removeDate(i)}
                  title="Remover"
                  className="shrink-0 text-muted-foreground hover:text-red-400 p-0.5"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <button onClick={addDate} className="text-[11px] text-purple-400 hover:text-purple-300 inline-flex items-center gap-1">
            <Plus size={11} /> Adicionar horário
          </button>
          <div className="flex items-center gap-2 pt-1">
            <button onClick={confirm} className="flex-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg py-1.5">
              Confirmar e agendar
            </button>
            <button onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground px-2">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Card de reel da Biblioteca ────────────────────────────────────────────────

interface ModelRequestOpts {
  variants: number; angle: string; numSlides: number; mode: JHMode;
  ctaDestination?: CtaDestination; offer?: string;
}

function ReelCard({
  reel, selected, onToggleSelect, onToggleFavorite, favoriting, onRequestModel, onRetryError, modeling,
}: {
  reel: Reel; selected: boolean; onToggleSelect: () => void; onToggleFavorite: () => void;
  favoriting: boolean;
  onRequestModel: (opts: ModelRequestOpts) => void;
  onRetryError: () => void;
  modeling: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [variants, setVariants] = useState(1);
  const [angle, setAngle] = useState('');
  const [numSlides, setNumSlides] = useState(7);
  const [mode, setMode] = useState<JHMode>('organico');
  const [ctaDestination, setCtaDestination] = useState<CtaDestination>('whatsapp');
  const [offer, setOffer] = useState('');
  const isErro = reel.status === 'erro';
  const used = reel.status !== 'novo' && !isErro;

  return (
    <div className={`rounded-xl border bg-card overflow-hidden flex flex-col transition-opacity ${isErro ? 'border-red-500/40' : 'border-border'} ${used ? 'opacity-60' : ''}`}>
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

        {reel.viralInsight && (
          <p className="text-[10px] italic text-purple-300/90 line-clamp-2" title={reel.viralInsight}>
            <Lightbulb size={10} className="inline mr-1 -mt-0.5" />
            Por que viralizou: “{reel.viralInsight}”
          </p>
        )}

        {isErro && (
          <div className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-2 py-1 flex items-start gap-1" title={reel.errorMessage || ''}>
            <AlertTriangle size={11} className="shrink-0 mt-0.5" />
            <span className="line-clamp-2">{reel.errorMessage || 'Falha ao modelar este reel.'}</span>
          </div>
        )}

        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{formatDate(reel.timestampMs)}</span>
          <a href={reel.url} target="_blank" rel="noreferrer" className="text-purple-400 hover:text-purple-300 inline-flex items-center gap-0.5">
            <ExternalLink size={10} /> Instagram
          </a>
        </div>

        {isErro ? (
          <button
            onClick={onRetryError}
            disabled={modeling}
            className="mt-1 w-full flex items-center justify-center gap-1.5 text-xs font-semibold px-2 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-60"
          >
            {modeling ? <Loader2 size={12} className="animate-spin" /> : <Repeat size={12} />}
            {modeling ? 'Tentando de novo…' : 'Tentar de novo'}
          </button>
        ) : (
          <div className="relative">
            <button
              onClick={() => setPanelOpen((o) => !o)}
              disabled={modeling}
              className="mt-1 w-full flex items-center justify-center gap-1.5 text-xs font-semibold px-2 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-colors disabled:opacity-60"
            >
              {modeling ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {modeling ? 'Modelando…' : reel.status === 'novo' ? 'Modelar' : 'Remodelar'}
            </button>

            {panelOpen && !modeling && (
              <div className="absolute z-20 bottom-full left-0 mb-1.5 w-64 bg-card border border-border rounded-xl p-3 space-y-2 shadow-xl">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">Variações</span>
                  <select
                    value={variants}
                    onChange={(e) => setVariants(Number(e.target.value))}
                    className="rounded-lg border border-border bg-background px-1.5 py-1 text-[11px]"
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">Nº de slides</span>
                  <select
                    value={numSlides}
                    onChange={(e) => setNumSlides(Number(e.target.value))}
                    className="rounded-lg border border-border bg-background px-1.5 py-1 text-[11px]"
                  >
                    {NUM_SLIDES_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <input
                  value={angle}
                  onChange={(e) => setAngle(e.target.value)}
                  placeholder="Ângulo (opcional)…"
                  className="w-full rounded-lg border border-border bg-background px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                />

                <div className="pt-1 border-t border-border space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">Tipo</span>
                    <div className="flex gap-1 bg-secondary rounded-lg p-0.5">
                      <button
                        type="button"
                        onClick={() => setMode('organico')}
                        className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors ${mode === 'organico' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                      >
                        Orgânico
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode('anuncio')}
                        className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors ${mode === 'anuncio' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                      >
                        Anúncio
                      </button>
                    </div>
                  </div>

                  {mode === 'anuncio' && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground">Destino do clique</span>
                        <select
                          value={ctaDestination}
                          onChange={(e) => setCtaDestination(e.target.value as CtaDestination)}
                          className="rounded-lg border border-border bg-background px-1.5 py-1 text-[11px]"
                        >
                          {CTA_DESTINATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                      <input
                        value={offer}
                        onChange={(e) => setOffer(e.target.value)}
                        placeholder="Oferta (opcional): avaliação grátis…"
                        className="w-full rounded-lg border border-border bg-background px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                      />
                      <p className="text-[10px] text-muted-foreground leading-snug">
                        CTA direto no carrossel (ex.: “{CTA_COPY_PREVIEW[ctaDestination]}”). Segue as políticas de
                        anúncio da Meta — sem prometer resultado, sem apontar o corpo do espectador.
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setPanelOpen(false);
                      onRequestModel({
                        variants, angle: angle.trim(), numSlides, mode,
                        ctaDestination: mode === 'anuncio' ? ctaDestination : undefined,
                        offer: mode === 'anuncio' && offer.trim() ? offer.trim() : undefined,
                      });
                    }}
                    className="flex-1 text-[11px] font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-lg py-1.5"
                  >
                    Gerar
                  </button>
                  <button onClick={() => setPanelOpen(false)} className="text-[11px] text-muted-foreground hover:text-foreground px-1.5">
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Card de rascunho (carrossel gerado pelo John Hulk) ───────────────────────

function DraftCard({
  draft, reel, batchId, variantLabel, editingOpen, onToggleEdit, captionOpen, onToggleCaption,
  approving, approved, onApprove,
}: {
  draft: JHCarousel; reel?: Reel; batchId?: string; variantLabel?: string;
  editingOpen: boolean; onToggleEdit: () => void;
  captionOpen: boolean; onToggleCaption: () => void;
  approving: boolean; approved: boolean; onApprove: (dates: string[]) => void;
}) {
  const status = reel?.status;
  const dateStr = draft.created_at
    ? new Date(draft.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })
    : '';

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm font-semibold text-foreground flex-1 min-w-[160px]">{draft.topic || draft.derivedTopic}</p>
        {variantLabel && (
          <span className="text-[10px] px-2 py-0.5 rounded-full border bg-purple-500/15 text-purple-300 border-purple-500/30">
            {variantLabel}
          </span>
        )}
        {status && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${REEL_STATUS_BADGE[status] || ''}`}>
            {REEL_STATUS_LABELS[status] || status}
          </span>
        )}
        {draft.mode === 'anuncio' && (
          <span className="text-[10px] px-2 py-0.5 rounded-full border bg-amber-500/15 text-amber-400 border-amber-500/30 font-semibold">
            Anúncio
          </span>
        )}
      </div>

      {draft.mode === 'anuncio' && (draft.ctaDestination || draft.offer) && (
        <p className="text-xs text-amber-400/90">
          {draft.ctaDestination && <>CTA: {CTA_DESTINATION_LABELS[draft.ctaDestination] || draft.ctaDestination}</>}
          {draft.ctaDestination && draft.offer && <> · </>}
          {draft.offer && <>oferta: {draft.offer}</>}
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
        {dateStr && <span>{dateStr}</span>}
        {draft.sourceReel?.handle && <span>· fonte: @{draft.sourceReel.handle}</span>}
        {draft.sourceReel?.url && (
          <a href={draft.sourceReel.url} target="_blank" rel="noreferrer" className="text-purple-400 hover:text-purple-300 inline-flex items-center gap-1">
            <ExternalLink size={11} /> reel original
          </a>
        )}
      </div>

      {draft.viralInsight && (
        <p className="text-xs italic text-purple-300/90">
          <Lightbulb size={11} className="inline mr-1 -mt-0.5" />
          Por que viralizou: “{draft.viralInsight}”
        </p>
      )}

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
          <ApproveScheduleControl
            approving={approving}
            approved={approved}
            disabled={!draft.screenshots?.length}
            onApprove={onApprove}
          />
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

  async function handleApprove(batch: Batch, dates: string[] = []) {
    setApproving((s) => ({ ...s, [batch.id]: true }));
    try {
      const res = await fetch(`${API}/api/john-hulk/${batch.id}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dates }),
      });
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
  const [urlOptionsOpen, setUrlOptionsOpen] = useState(false);
  const [urlNumSlides, setUrlNumSlides] = useState(7);
  const [urlMode, setUrlMode] = useState<JHMode>('organico');
  const [urlCtaDestination, setUrlCtaDestination] = useState<CtaDestination>('whatsapp');
  const [urlOffer, setUrlOffer] = useState('');
  const [refreshingLib, setRefreshingLib] = useState(false);
  const [refreshingLibFast, setRefreshingLibFast] = useState(false);
  const [pendingDupe, setPendingDupe] = useState<{
    shortCode: string; topic?: string; variants: number; angle: string; numSlides: number; mode: JHMode;
    ctaDestination?: CtaDestination; offer?: string; similar: DupeCheckItem[];
  } | null>(null);
  const [dupeChecking, setDupeChecking] = useState<Record<string, boolean>>({});
  const [movingStatusMap, setMovingStatusMap] = useState<Record<string, boolean>>({});

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

  useEffect(() => { if (subView === 'biblioteca' || subView === 'pipeline') fetchReels(); }, [subView, fetchReels]);

  // Poll enquanto o refresh da biblioteca ou a modelagem de algum reel estiver rodando.
  useEffect(() => {
    if (subView !== 'biblioteca' && subView !== 'pipeline') return;
    const active = libraryState.refreshing || Object.keys(modelingMap).length > 0;
    if (!active) return;
    const id = setInterval(fetchReels, 5000);
    return () => clearInterval(id);
  }, [subView, libraryState.refreshing, modelingMap, fetchReels]);

  async function handleRefreshLibrary(mode?: 'incremental') {
    const setBusy = mode === 'incremental' ? setRefreshingLibFast : setRefreshingLib;
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/john-hulk/reels/refresh`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: handleFilter || undefined, ...(mode === 'incremental' ? { mode: 'incremental' } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao atualizar biblioteca.');
      if (data.skipped === 'disabled') {
        toast.error('John Hulk está desativado (kill-switch) — ative na aba "Diário automático".');
        return;
      }
      toast.info(mode === 'incremental' ? 'Atualizando biblioteca (rápido)…' : 'Atualizando biblioteca de reels… pode levar alguns minutos.');
      fetchReels();
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao atualizar biblioteca.');
    } finally {
      setBusy(false);
    }
  }

  // POST real de modelagem — chamado direto (retry de erro) ou depois da
  // confirmação de duplicidade (fluxo normal do botão "Modelar").
  async function handleModelReel(shortCode: string, opts: {
    regenerate?: boolean; variants?: number; angle?: string; numSlides?: number; mode?: JHMode;
    ctaDestination?: CtaDestination; offer?: string;
  } = {}) {
    setModelingMap((m) => ({ ...m, [shortCode]: Date.now() }));
    try {
      const res = await fetch(`${API}/api/john-hulk/reels/${shortCode}/model`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          regenerate: !!opts.regenerate,
          variants: opts.variants && opts.variants > 1 ? opts.variants : undefined,
          angle: opts.angle || undefined,
          numSlides: opts.numSlides || undefined,
          mode: opts.mode || undefined,
          ctaDestination: opts.mode === 'anuncio' ? opts.ctaDestination : undefined,
          offer: opts.mode === 'anuncio' && opts.offer ? opts.offer : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao modelar.');
      toast.info('Modelando reel em carrossel FMTeam… leva alguns minutos.');
    } catch (err: any) {
      setModelingMap((m) => { const n = { ...m }; delete n[shortCode]; return n; });
      toast.error(err?.message || 'Erro ao modelar.');
    }
  }

  // Item 1: antes de modelar, checa duplicidade de tema nos últimos 21 dias.
  // Se achar tema parecido, abre confirmação; senão modela direto.
  async function handleRequestModel(reel: Reel, opts: ModelRequestOpts) {
    const shortCode = reel.shortCode;
    const { variants, angle, numSlides, mode, ctaDestination, offer } = opts;
    setDupeChecking((s) => ({ ...s, [shortCode]: true }));
    try {
      const res = await fetch(`${API}/api/john-hulk/reels/${shortCode}/dupe-check?days=21`);
      const data: DupeCheckResponse = await res.json();
      if (data.count > 0) {
        setPendingDupe({ shortCode, topic: reel.topic || reel.caption, variants, angle, numSlides, mode, ctaDestination, offer, similar: data.similar });
        return;
      }
    } catch {
      // dupe-check é best-effort — se falhar, segue com a modelagem normalmente.
    } finally {
      setDupeChecking((s) => { const n = { ...s }; delete n[shortCode]; return n; });
    }
    handleModelReel(shortCode, { regenerate: reel.status !== 'novo', variants, angle, numSlides, mode, ctaDestination, offer });
  }

  function confirmPendingDupeModel() {
    if (!pendingDupe) return;
    const { shortCode, variants, angle, numSlides, mode, ctaDestination, offer } = pendingDupe;
    const reel = reels.find((r) => r.shortCode === shortCode);
    setPendingDupe(null);
    handleModelReel(shortCode, { regenerate: reel ? reel.status !== 'novo' : false, variants, angle, numSlides, mode, ctaDestination, offer });
  }

  // Item 2: retry rápido de um reel com status 'erro' — sem passar pelo painel
  // de variações/dupe-check, pra desbloquear o card o quanto antes.
  function handleRetryError(shortCode: string) {
    handleModelReel(shortCode, { regenerate: true, variants: 1 });
  }

  async function handleModelUrl() {
    const url = modelUrl.trim();
    if (!url) { toast.error('Cole a URL do reel/post do Instagram.'); return; }
    setUrlModeling(true);
    try {
      const res = await fetch(`${API}/api/john-hulk/reels/model-url`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          numSlides: urlNumSlides || undefined,
          mode: urlMode || undefined,
          ctaDestination: urlMode === 'anuncio' ? urlCtaDestination : undefined,
          offer: urlMode === 'anuncio' && urlOffer.trim() ? urlOffer.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao modelar por URL.');
      toast.info('Modelando reel em carrossel… leva alguns minutos. A biblioteca atualiza sozinha.');
      setModelUrl('');
      setUrlOffer('');
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

  // Item 5: move um reel pra outro status a partir do Kanban.
  async function handleMoveStatus(shortCode: string, status: ReelRuntimeStatus) {
    setMovingStatusMap((m) => ({ ...m, [shortCode]: true }));
    try {
      const res = await fetch(`${API}/api/john-hulk/reels/${shortCode}/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      const updated = await res.json();
      if (!res.ok) throw new Error(updated.error || 'Falha ao mover status.');
      setReels((prev) => prev.map((r) => (r.shortCode === shortCode ? updated : r)));
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao mover o card.');
    } finally {
      setMovingStatusMap((m) => { const n = { ...m }; delete n[shortCode]; return n; });
    }
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

  // Item 4: agrupa rascunhos por reel de origem (sourceReel.shortCode) — quando um
  // reel gerou várias variações elas aparecem juntas, rotuladas "Variação N", pra
  // dono comparar/editar/aprovar a escolhida. Rascunhos sem reel de origem (ex.:
  // modelados por URL avulsa antiga) ficam cada um no seu próprio grupo de 1.
  const draftGroups = useMemo(() => {
    const groups = new Map<string, JHCarousel[]>();
    for (const d of drafts) {
      const key = d.sourceReel?.shortCode || `single:${d.id}`;
      const arr = groups.get(key) || [];
      arr.push(d);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).map(([key, items]) => ({
      key,
      items: [...items].sort((a, b) => (a.variantIndex ?? 0) - (b.variantIndex ?? 0)),
    }));
  }, [drafts]);

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

  async function handleApproveDraft(d: JHCarousel, dates: string[] = []) {
    const batchId = carouselIdToBatchId[d.id];
    if (!batchId) return;
    setApprovingDraft((s) => ({ ...s, [d.id]: true }));
    try {
      const res = await fetch(`${API}/api/john-hulk/${batchId}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dates }),
      });
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
  const [cost, setCost] = useState<CostResponse>({ available: false });
  const [costLoading, setCostLoading] = useState(true);

  const fetchCost = useCallback(async () => {
    setCostLoading(true);
    try {
      const res = await fetch(`${API}/api/john-hulk/cost`);
      const data = await res.json();
      setCost(data);
    } catch {
      setCost({ available: false });
    } finally {
      setCostLoading(false);
    }
  }, []);

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

  useEffect(() => { if (subView === 'insights') { fetchInsights(); fetchCost(); } }, [subView, fetchInsights, fetchCost]);

  // ── Sub-views ────────────────────────────────────────────────────────────────

  function renderBiblioteca() {
    return (
      <div className="space-y-4">
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => handleRefreshLibrary()}
                disabled={refreshingLib || refreshingLibFast || libraryState.refreshing}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition-colors disabled:opacity-60"
              >
                {(refreshingLib || libraryState.refreshing) ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {libraryState.refreshing ? 'Atualizando biblioteca…' : 'Atualizar biblioteca'}
              </button>
              <button
                onClick={() => handleRefreshLibrary('incremental')}
                disabled={refreshingLib || refreshingLibFast || libraryState.refreshing}
                title="Busca só os últimos reels (limite 30) — mais rápido e mais barato."
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/70 text-foreground text-xs font-semibold transition-colors disabled:opacity-60"
              >
                {refreshingLibFast ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                Atualizar (rápido)
              </button>
            </div>
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
            <select
              value={urlNumSlides}
              onChange={(e) => setUrlNumSlides(Number(e.target.value))}
              title="Nº de slides"
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
            >
              {NUM_SLIDES_OPTIONS.map((n) => <option key={n} value={n}>{n} slides</option>)}
            </select>
            <button
              onClick={() => setUrlOptionsOpen((o) => !o)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${urlOptionsOpen || urlMode === 'anuncio' ? 'bg-purple-500/20 text-purple-300' : 'bg-secondary hover:bg-secondary/70 text-foreground'}`}
            >
              Opções {urlOptionsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            <button
              onClick={handleModelUrl}
              disabled={urlModeling || !modelUrl.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/70 text-foreground text-xs font-semibold transition-colors disabled:opacity-60"
            >
              {urlModeling ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
              Modelar por URL
            </button>
          </div>

          {urlOptionsOpen && (
            <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">Tipo</span>
                <div className="flex gap-1 bg-secondary rounded-lg p-0.5">
                  <button
                    type="button"
                    onClick={() => setUrlMode('organico')}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors ${urlMode === 'organico' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Orgânico
                  </button>
                  <button
                    type="button"
                    onClick={() => setUrlMode('anuncio')}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors ${urlMode === 'anuncio' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Anúncio
                  </button>
                </div>
              </div>
              {urlMode === 'anuncio' && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">Destino do clique</span>
                    <select
                      value={urlCtaDestination}
                      onChange={(e) => setUrlCtaDestination(e.target.value as CtaDestination)}
                      className="rounded-lg border border-border bg-background px-1.5 py-1 text-[11px]"
                    >
                      {CTA_DESTINATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <input
                    value={urlOffer}
                    onChange={(e) => setUrlOffer(e.target.value)}
                    placeholder="Oferta (opcional): avaliação grátis…"
                    className="w-full rounded-lg border border-border bg-background px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  />
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    CTA direto no carrossel (ex.: “{CTA_COPY_PREVIEW[urlCtaDestination]}”). Segue as políticas de
                    anúncio da Meta — sem prometer resultado, sem apontar o corpo do espectador.
                  </p>
                </div>
              )}
            </div>
          )}

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
                onRequestModel={(opts) => handleRequestModel(r, opts)}
                onRetryError={() => handleRetryError(r.shortCode)}
                modeling={!!modelingMap[r.shortCode] || !!dupeChecking[r.shortCode]}
              />
            ))}
          </div>
        )}

        {pendingDupe && (
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setPendingDupe(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-card border border-border rounded-2xl w-full max-w-sm p-5 space-y-3"
            >
              <div className="flex items-center gap-2 text-amber-400">
                <AlertTriangle size={18} />
                <h3 className="font-semibold text-foreground">Tema parecido encontrado</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                Você já modelou tema parecido nos últimos 21 dias:
              </p>
              <ul className="space-y-1">
                {pendingDupe.similar.slice(0, 4).map((s) => (
                  <li key={s.shortCode} className="text-xs text-foreground bg-secondary/50 border border-border rounded-lg px-2.5 py-1.5">
                    “{s.topic || s.shortCode}”
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">Modelar “{pendingDupe.topic || pendingDupe.shortCode}” mesmo assim?</p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={confirmPendingDupeModel}
                  className="flex-1 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-lg py-2"
                >
                  Modelar mesmo assim
                </button>
                <button
                  onClick={() => setPendingDupe(null)}
                  className="text-xs text-muted-foreground hover:text-foreground px-3 py-2 rounded-lg hover:bg-secondary"
                >
                  Cancelar
                </button>
              </div>
            </div>
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
          draftGroups.map(({ key, items }) => (
            <div key={key} className={items.length > 1 ? 'border border-purple-500/20 rounded-2xl p-3 space-y-3 bg-purple-500/5' : 'space-y-3'}>
              {items.length > 1 && (
                <p className="text-xs font-semibold text-purple-300 px-1">
                  {items.length} variações do mesmo reel — compare e aprove a que preferir
                </p>
              )}
              {items.map((d, i) => (
                <DraftCard
                  key={d.id}
                  draft={d}
                  reel={d.sourceReel?.shortCode ? reelByShortCode[d.sourceReel.shortCode] : undefined}
                  batchId={carouselIdToBatchId[d.id]}
                  variantLabel={items.length > 1 ? `Variação ${d.variantIndex ?? i + 1}` : undefined}
                  editingOpen={draftEditing?.id === d.id}
                  onToggleEdit={() => handleToggleDraftEdit(d)}
                  captionOpen={!!openDraftCaption[d.id]}
                  onToggleCaption={() => setOpenDraftCaption((s) => ({ ...s, [d.id]: !s[d.id] }))}
                  approving={!!approvingDraft[d.id]}
                  approved={!!approvedDraft[d.id]}
                  onApprove={(dates) => handleApproveDraft(d, dates)}
                />
              ))}
            </div>
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

  function renderCostPanel() {
    if (costLoading) {
      return (
        <div className="bg-card border border-border rounded-2xl p-3.5 flex items-center gap-2 text-muted-foreground text-xs">
          <Loader2 size={14} className="animate-spin" /> Carregando custo...
        </div>
      );
    }
    if (!cost.available) return null;
    const jh = cost.johnHulk;
    return (
      <div className="bg-card border border-border rounded-2xl p-3.5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-foreground">
          <Wallet size={16} className="text-purple-400" />
          <div>
            <p className="text-sm font-semibold">{formatBRL(jh?.brl ?? 0)} <span className="text-xs font-normal text-muted-foreground">no John Hulk</span></p>
            <p className="text-[11px] text-muted-foreground">
              {jh?.count ?? 0} gerações
              {jh?.savedBrl != null && jh.savedBrl > 0 && <> · {formatBRL(jh.savedBrl)} economizados (cache/dedupe)</>}
            </p>
          </div>
        </div>
        <div className="text-right text-[11px] text-muted-foreground">
          <p>hoje (app todo): {formatBRL(cost.today)}</p>
          <p>total (app todo): {formatBRL(cost.total)}</p>
        </div>
      </div>
    );
  }

  function renderInsights() {
    return (
      <div className="space-y-4">
        {renderCostPanel()}

        {insightsLoading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground"><Loader2 size={22} className="animate-spin mr-2" /> Carregando insights...</div>
        ) : !insights.available || !insights.summary?.length ? (
          <div className="bg-card border border-border rounded-2xl p-6 text-center text-muted-foreground space-y-2">
            <TrendingUp size={24} className="mx-auto opacity-40" />
            <p>Ainda sem dados suficientes pra aprendizado.</p>
            <p className="text-xs">Conecte/sincronize o Instagram e modele alguns reels na Biblioteca pra ver aqui o que performou melhor.</p>
          </div>
        ) : (
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
        )}
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
                      <ApproveScheduleControl
                        approving={!!approving[b.id]}
                        approved={!!alreadyApproved}
                        disabled={!c.screenshots?.length}
                        onApprove={(dates) => handleApprove(b, dates)}
                      />
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

  // Item 5: Kanban/Pipeline — agrupa os reels da biblioteca por status em colunas.
  // 'erro' vira uma coluna própria (destacada em vermelho) fora da sequência normal
  // do pipeline, já que é uma falha e não um passo do fluxo.
  function renderPipeline() {
    const columns: { status: ReelRuntimeStatus; label: string }[] = [
      { status: 'erro', label: 'Falhou' },
      ...PIPELINE_ORDER.map((s) => ({ status: s as ReelRuntimeStatus, label: REEL_STATUS_LABELS[s] })),
    ];
    const byStatus = (s: ReelRuntimeStatus) => reels.filter((r) => r.status === s);

    if (reelsLoading) {
      return <div className="flex items-center justify-center h-40 text-muted-foreground"><Loader2 size={22} className="animate-spin mr-2" /> Carregando pipeline...</div>;
    }
    if (!reels.length) {
      return (
        <div className="bg-card border border-border rounded-2xl p-6 text-center text-muted-foreground">
          Nenhum reel na biblioteca ainda. Vá em <b className="text-foreground">Biblioteca</b> e atualize.
        </div>
      );
    }

    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => {
          const items = byStatus(col.status);
          if (col.status === 'erro' && !items.length) return null;
          const nextStatus = col.status !== 'erro'
            ? PIPELINE_ORDER[PIPELINE_ORDER.indexOf(col.status as ReelStatus) + 1]
            : undefined;
          return (
            <div key={col.status} className={`w-64 shrink-0 rounded-2xl border p-2.5 space-y-2 ${col.status === 'erro' ? 'border-red-500/30 bg-red-500/5' : 'border-border bg-card'}`}>
              <div className="flex items-center justify-between px-1">
                <span className={`text-xs font-semibold ${col.status === 'erro' ? 'text-red-400' : 'text-foreground'}`}>{col.label}</span>
                <span className="text-[10px] text-muted-foreground">{items.length}</span>
              </div>
              <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-0.5">
                {items.map((r) => (
                  <div key={r.shortCode} className="rounded-xl border border-border bg-secondary/30 p-2 space-y-1.5">
                    <div className="flex gap-2">
                      <div className="w-10 h-12 rounded-md bg-secondary overflow-hidden shrink-0">
                        {r.thumbnailUrl ? (
                          <img src={r.thumbnailUrl} alt={r.caption || r.shortCode} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground"><ImageIcon size={12} className="opacity-40" /></div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-foreground line-clamp-2 leading-tight">{r.topic || r.caption || r.shortCode}</p>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
                          <span className="inline-flex items-center gap-0.5"><Eye size={9} /> {formatCompact(r.views)}</span>
                          <span className="inline-flex items-center gap-0.5"><Heart size={9} /> {formatCompact(r.likes)}</span>
                        </div>
                      </div>
                    </div>
                    {col.status === 'erro' ? (
                      <button
                        onClick={() => handleRetryError(r.shortCode)}
                        disabled={!!modelingMap[r.shortCode]}
                        className="w-full text-[10px] font-semibold text-white bg-red-600 hover:bg-red-500 rounded-lg py-1 inline-flex items-center justify-center gap-1 disabled:opacity-60"
                      >
                        {modelingMap[r.shortCode] ? <Loader2 size={10} className="animate-spin" /> : <Repeat size={10} />}
                        Tentar de novo
                      </button>
                    ) : nextStatus ? (
                      <button
                        onClick={() => handleMoveStatus(r.shortCode, nextStatus)}
                        disabled={!!movingStatusMap[r.shortCode]}
                        className="w-full text-[10px] font-medium text-foreground bg-secondary hover:bg-secondary/70 rounded-lg py-1 inline-flex items-center justify-center gap-1 disabled:opacity-60"
                      >
                        {movingStatusMap[r.shortCode] ? <Loader2 size={10} className="animate-spin" /> : <ArrowRight size={10} />}
                        mover pra {REEL_STATUS_LABELS[nextStatus]}
                      </button>
                    ) : null}
                  </div>
                ))}
                {!items.length && <p className="text-[10px] text-muted-foreground text-center py-3">vazio</p>}
              </div>
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
            { id: 'pipeline', label: 'Pipeline', icon: Kanban },
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
      {subView === 'pipeline' && renderPipeline()}
      {subView === 'rascunhos' && renderRascunhos()}
      {subView === 'insights' && renderInsights()}
      {subView === 'auto' && renderAuto()}
    </div>
  );
}
