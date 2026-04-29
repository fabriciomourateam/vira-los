/**
 * IdeasGenerator.tsx
 * Gerador de ideias de conteúdo baseado em dados reais de engajamento.
 * Tabs: Ideias | Semana | Performance
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Lightbulb, Zap, Calendar, BarChart3, Settings, X, Trash2, Copy,
  ChevronDown, Plus, Minus, RefreshCw, Loader2, Check, Sparkles,
  Instagram, Play, Bookmark, Video, TrendingUp, AlertCircle,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface IdeasConfig {
  niche: string;
  instagramHandle: string;
  hashtags: string[];
  keywords: string[];
  platforms: string[];
  postsPerDay: number;
  country: string;
}

interface ContentIdea {
  id: string;
  title: string;
  hook: string;
  format: string;
  funnelStage: 'TOFU' | 'MOFU' | 'BOFU';
  emotion: string;
  cta: string;
  contentType: 'carrossel' | 'reels' | 'ambos';
  numSlides: number;
  slideOutline: string[];
  whyItWorks: string;
  viralScore: number;
  created_at?: string;
}

interface ScrapedItem {
  platform: string;
  title?: string;
  hashtag?: string;
  subreddit?: string;
  likes?: number;
  comments?: number;
  score?: number;
  views?: number;
  videoCount?: number;
  engagement?: number;
  url?: string;
}

interface PlatformStatusEntry {
  active: boolean;
  count: number;
  error: string | null;
}

interface ScrapedData {
  instagram: ScrapedItem[];
  tiktok: ScrapedItem[];
  reddit: ScrapedItem[];
  trends: string[];
  youtube?: ScrapedItem[];
  platformStatus?: {
    instagram: PlatformStatusEntry;
    tiktok: PlatformStatusEntry;
    trends: PlatformStatusEntry;
    reddit: PlatformStatusEntry;
    youtube?: PlatformStatusEntry;
  };
}

interface JobStatus {
  status: 'running' | 'scraped' | 'done' | 'error';
  progress: number;
  steps: { step: string; label: string; time: string }[];
  scrapedData?: ScrapedData;
  results: ContentIdea[] | null;
  error: string | null;
  startedAt: string;
}

interface TrackedPost {
  id: string;
  title: string;
  postedAt: string;
  likes: number;
  comments: number;
  saves: number;
  followers: number;
  url: string;
  isTopPerformer?: boolean;
  convertedToReels?: boolean;
  created_at?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FUNNEL_COLORS: Record<string, string> = {
  TOFU: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  MOFU: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  BOFU: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
};
const FORMAT_EMOJI: Record<string, string> = {
  lista: '📋', revelação: '🔓', 'mito-busting': '🚫', 'antes-depois': '🔄',
  tutorial: '📚', polêmica: '🔥', série: '📺', pergunta: '❓',
};
function engagementRate(p: TrackedPost): number {
  if (!p.followers) return 0;
  return ((p.likes + p.comments * 2 + (p.saves || 0) * 3) / p.followers) * 100;
}
function weekDates(): { iso: string; label: string; weekday: string }[] {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const iso = d.toISOString().split('T')[0];
    const weekday = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][d.getDay()];
    const label = `${d.getDate()}/${d.getMonth() + 1}`;
    return { iso, label, weekday };
  });
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface Props {
  onCreateCarousel: (topic: string, script: string) => void;
  onUseInMaquina?: (idea: ContentIdea) => void;
}

export default function IdeasGenerator({ onCreateCarousel, onUseInMaquina }: Props) {
  const [subTab, setSubTab] = useState<'ideias' | 'semana' | 'performance'>('ideias');
  const [showConfig, setShowConfig] = useState(false);

  // Config
  const [config, setConfig] = useState<IdeasConfig>({
    niche: '', instagramHandle: '', hashtags: [], keywords: [],
    platforms: ['instagram', 'tiktok', 'trends', 'reddit'], postsPerDay: 3, country: 'BR',
  });
  const [hashtagInput, setHashtagInput] = useState('');
  const [keywordInput, setKeywordInput] = useState('');

  // Discovery
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [ideas, setIdeas] = useState<ContentIdea[]>([]);
  const [ideasSort, setIdeasSort] = useState<'score' | 'original' | 'format'>('score');

  const sortedIdeas = [...ideas].sort((a, b) => {
    if (ideasSort === 'score') return (b.viralScore || 0) - (a.viralScore || 0);
    if (ideasSort === 'format') return (a.format || '').localeCompare(b.format || '');
    return 0;
  });
  const [scrapedData, setScrapedData] = useState<ScrapedData | null>(null);
  const [generatingIdeas, setGeneratingIdeas] = useState(false);
  const [collapsedSources, setCollapsedSources] = useState<Record<string, boolean>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Calendário
  const [calendar, setCalendar] = useState<Record<string, string[]>>({});
  const [calendarIdeas, setCalendarIdeas] = useState<ContentIdea[]>([]);

  // Performance
  const [trackedPosts, setTrackedPosts] = useState<TrackedPost[]>([]);
  const [addingPost, setAddingPost] = useState(false);
  const [newPost, setNewPost] = useState<Partial<TrackedPost>>({ title: '', postedAt: new Date().toISOString().split('T')[0] });

  // Reels converter
  const [reelsIdea, setReelsIdea] = useState<ContentIdea | null>(null);
  const [reelsScript, setReelsScript] = useState('');
  const [reelsLoading, setReelsLoading] = useState(false);

  // ── Carregar dados iniciais ──────────────────────────────────────────────────
  useEffect(() => {
    fetchConfig();
    fetchIdeas();
    fetchCalendar();
    fetchTracked();
  }, []);

  async function fetchConfig() {
    try {
      const r = await fetch(`${API}/api/ideas/config`);
      if (r.ok) setConfig(await r.json());
    } catch {}
  }
  async function fetchIdeas() {
    try {
      const r = await fetch(`${API}/api/ideas/discovered`);
      if (r.ok) setIdeas(await r.json());
    } catch {}
  }
  async function fetchCalendar() {
    try {
      const r = await fetch(`${API}/api/ideas/calendar`);
      if (r.ok) { const data = await r.json(); setCalendar(data || {}); }
    } catch {}
  }
  async function fetchTracked() {
    try {
      const r = await fetch(`${API}/api/ideas/tracked`);
      if (r.ok) setTrackedPosts(await r.json());
    } catch {}
  }

  // ── Salvar config ────────────────────────────────────────────────────────────
  async function saveConfig() {
    try {
      await fetch(`${API}/api/ideas/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      toast.success('Configurações salvas');
      setShowConfig(false);
    } catch { toast.error('Erro ao salvar config'); }
  }

  // ── Iniciar descoberta ────────────────────────────────────────────────────────
  async function startDiscovery() {
    try {
      const r = await fetch(`${API}/api/ideas/discover`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const { jobId: id } = await r.json();
      setJobId(id);
      setJobStatus({ status: 'running', progress: 5, steps: [], results: null, error: null, startedAt: new Date().toISOString() });
    } catch { toast.error('Erro ao iniciar descoberta'); }
  }

  // ── Polling de status ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!jobId) return;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${API}/api/ideas/status/${jobId}`);
        if (!r.ok) return;
        const status: JobStatus = await r.json();
        setJobStatus(status);

        if (status.status === 'scraped') {
          // Coleta concluída — exibe dados para revisão
          clearInterval(pollRef.current!);
          setJobId(null);
          if (status.scrapedData) {
            setScrapedData(status.scrapedData);
            const total = (status.scrapedData.reddit?.length || 0) +
                          (status.scrapedData.tiktok?.length || 0) +
                          (status.scrapedData.instagram?.length || 0) +
                          (status.scrapedData.trends?.length || 0) +
                          (status.scrapedData.youtube?.length || 0);
            const ps = status.scrapedData.platformStatus;
            const failed: string[] = [];
            if (ps) {
              if (ps.reddit.error)    failed.push('Reddit');
              if (ps.trends.error)    failed.push('Trends');
              if (ps.tiktok.error)    failed.push('TikTok');
              if (ps.instagram.error) failed.push('Instagram');
            }
            const suffix = failed.length ? ` (${failed.join(', ')} bloqueado${failed.length > 1 ? 's' : ''})` : '';
            toast.success(`${total} resultados coletados${suffix} — revise antes de gerar ideias`);
          }
        } else if (status.status === 'done') {
          clearInterval(pollRef.current!);
          setJobId(null);
          if (status.results) {
            setIdeas(status.results);
            // Se chegou direto a 'done' (sem 'scraped'), todos os scrapers falharam — usou fallback IA
            const ps = status.scrapedData?.platformStatus;
            const blocked: string[] = [];
            if (ps) {
              if (ps.reddit.error)    blocked.push('Reddit');
              if (ps.trends.error)    blocked.push('Google Trends');
              if (ps.tiktok.error)    blocked.push('TikTok');
              if (ps.instagram.error) blocked.push('Instagram');
            }
            if (blocked.length === 4) {
              toast.warning(`Scrapers bloquearam o servidor (${blocked.join(', ')}). ${status.results.length} ideias geradas via IA com base no nicho.`, { duration: 7000 });
            } else {
              toast.success(`${status.results.length} ideias geradas! 🎉`);
            }
          }
        } else if (status.status === 'error') {
          clearInterval(pollRef.current!);
          setJobId(null);
          toast.error(status.error || 'Erro na descoberta');
        }
      } catch {}
    }, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobId]);

  // ── Gerar ideias a partir dos dados revisados ─────────────────────────────────
  async function generateFromScrapedData(data: ScrapedData) {
    setGeneratingIdeas(true);
    try {
      const r = await fetch(`${API}/api/ideas/generate-ideas`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scrapedData: data }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      const { ideas: newIdeas } = await r.json();
      setIdeas(newIdeas);
      setScrapedData(null);
      toast.success(`${newIdeas.length} ideias geradas! 🎉`);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao gerar ideias');
    } finally {
      setGeneratingIdeas(false);
    }
  }

  // ── Remover item dos dados coletados ──────────────────────────────────────────
  function removeScrapedItem(source: keyof ScrapedData, index: number) {
    if (!scrapedData) return;
    const updated = { ...scrapedData };
    if (source === 'trends') {
      updated.trends = (updated.trends as string[]).filter((_, i) => i !== index);
    } else {
      (updated[source] as ScrapedItem[]) = (updated[source] as ScrapedItem[]).filter((_, i) => i !== index);
    }
    setScrapedData(updated);
  }

  // ── Criar carrossel a partir de ideia ─────────────────────────────────────────
  function createCarouselFromIdea(idea: ContentIdea) {
    const script = [
      `Hook: "${idea.hook}"`,
      ``,
      `Formato: ${idea.format}`,
      `Funil: ${idea.funnelStage}`,
      `Emoção: ${idea.emotion}`,
      `CTA: "${idea.cta}"`,
      ``,
      `Estrutura dos slides:`,
      ...(idea.slideOutline || []).map((s, i) => `${i + 1}. ${s}`),
      ``,
      `Por que funciona: ${idea.whyItWorks}`,
    ].join('\n');
    onCreateCarousel(idea.title, script);
  }

  // ── Gerar script de Reels ─────────────────────────────────────────────────────
  async function generateReels(idea: ContentIdea) {
    setReelsIdea(idea);
    setReelsScript('');
    setReelsLoading(true);
    try {
      const r = await fetch(`${API}/api/ideas/to-reels`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea }),
      });
      const { script } = await r.json();
      setReelsScript(script);
    } catch { toast.error('Erro ao gerar script'); } finally { setReelsLoading(false); }
  }

  // ── Calendário: adicionar/remover ideia de um dia ─────────────────────────────
  async function calendarToggleIdea(dateIso: string, ideaId: string) {
    const dayIdeas = calendar[dateIso] || [];
    const updated = dayIdeas.includes(ideaId)
      ? dayIdeas.filter(id => id !== ideaId)
      : [...dayIdeas, ideaId].slice(0, config.postsPerDay);
    const newCal = { ...calendar, [dateIso]: updated };
    setCalendar(newCal);
    await fetch(`${API}/api/ideas/calendar`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newCal) });
  }

  // ── Performance: adicionar post ────────────────────────────────────────────────
  async function addTracked() {
    if (!newPost.title?.trim()) return;
    const post: TrackedPost = {
      id: `tp-${Date.now()}`,
      title: newPost.title || '',
      postedAt: newPost.postedAt || new Date().toISOString().split('T')[0],
      likes: Number(newPost.likes) || 0,
      comments: Number(newPost.comments) || 0,
      saves: Number(newPost.saves) || 0,
      followers: Number(newPost.followers) || 0,
      url: newPost.url || '',
    };
    await fetch(`${API}/api/ideas/tracked`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(post) });
    setTrackedPosts(prev => [post, ...prev]);
    setNewPost({ title: '', postedAt: new Date().toISOString().split('T')[0] });
    setAddingPost(false);
    toast.success('Post adicionado');
  }

  async function deleteTracked(id: string) {
    await fetch(`${API}/api/ideas/tracked/${id}`, { method: 'DELETE' });
    setTrackedPosts(prev => prev.filter(p => p.id !== id));
  }

  async function deleteIdea(id: string) {
    await fetch(`${API}/api/ideas/discovered/${id}`, { method: 'DELETE' });
    setIdeas(prev => prev.filter(i => i.id !== id));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  const isRunning = !!jobId || jobStatus?.status === 'running';
  const weeks = weekDates();
  const sortedTracked = [...trackedPosts].sort((a, b) => engagementRate(b) - engagementRate(a));

  return (
    <div className="flex flex-col h-full">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-secondary rounded-lg p-0.5">
            {([
              { id: 'ideias',      label: '💡 Ideias',      },
              { id: 'semana',      label: '📅 Semana',      },
              { id: 'performance', label: '📊 Performance', },
            ] as const).map(t => (
              <button
                key={t.id}
                onClick={() => setSubTab(t.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${subTab === t.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => setShowConfig(!showConfig)}
          className={`p-2 rounded-lg transition-colors ${showConfig ? 'bg-orange-500/20 text-orange-400' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}>
          <Settings className="w-4 h-4" />
        </button>
      </div>

      {/* ── Config panel ── */}
      {showConfig && (
        <div className="border-b border-border bg-secondary/30 px-4 py-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">Configurações do Gerador</h3>
            <button onClick={() => setShowConfig(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Nicho</label>
              <textarea value={config.niche} onChange={e => setConfig(p => ({ ...p, niche: e.target.value }))}
                rows={2} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-500/50" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Instagram Handle</label>
              <input value={config.instagramHandle} onChange={e => setConfig(p => ({ ...p, instagramHandle: e.target.value }))}
                placeholder="@seuhandle" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-500/50" />
              <label className="text-xs text-muted-foreground font-medium">Posts por dia</label>
              <div className="flex items-center gap-2">
                <button onClick={() => setConfig(p => ({ ...p, postsPerDay: Math.max(1, p.postsPerDay - 1) }))} className="w-7 h-7 rounded bg-secondary hover:bg-border flex items-center justify-center"><Minus className="w-3 h-3" /></button>
                <span className="text-sm font-mono w-4 text-center">{config.postsPerDay}</span>
                <button onClick={() => setConfig(p => ({ ...p, postsPerDay: Math.min(5, p.postsPerDay + 1) }))} className="w-7 h-7 rounded bg-secondary hover:bg-border flex items-center justify-center"><Plus className="w-3 h-3" /></button>
              </div>
            </div>
          </div>

          {/* Hashtags */}
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground font-medium">Hashtags para busca</label>
            <div className="flex gap-2">
              <input value={hashtagInput} onChange={e => setHashtagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && hashtagInput.trim()) { setConfig(p => ({ ...p, hashtags: [...new Set([...p.hashtags, hashtagInput.trim().replace(/^#/, '')])] })); setHashtagInput(''); } }}
                placeholder="Digite e pressione Enter" className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-500/50" />
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              {config.hashtags.map(tag => (
                <span key={tag} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary text-xs text-foreground">
                  #{tag}
                  <button onClick={() => setConfig(p => ({ ...p, hashtags: p.hashtags.filter(h => h !== tag) }))} className="text-muted-foreground hover:text-red-400"><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
          </div>

          {/* Plataformas */}
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground font-medium">Plataformas de busca</label>
            <div className="flex flex-wrap gap-2">
              {([
                { id: 'reddit',    label: 'Reddit',    emoji: '💬', free: true  },
                { id: 'trends',    label: 'G. Trends', emoji: '📈', free: true  },
                { id: 'tiktok',    label: 'TikTok CC', emoji: '🎵', free: true  },
                { id: 'instagram', label: 'Instagram', emoji: '📸', free: false },
              ] as const).map(p => (
                <button key={p.id}
                  onClick={() => setConfig(prev => ({
                    ...prev,
                    platforms: prev.platforms.includes(p.id) ? prev.platforms.filter(x => x !== p.id) : [...prev.platforms, p.id],
                  }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors flex items-center gap-1.5 ${config.platforms.includes(p.id) ? 'bg-orange-500/20 border-orange-500/40 text-orange-300' : 'bg-secondary border-border text-muted-foreground hover:border-orange-500/30'}`}
                >
                  {p.emoji} {p.label}
                  <span className={`text-[9px] px-1 py-0.5 rounded ${p.free ? 'bg-emerald-500/20 text-emerald-400' : 'bg-blue-500/20 text-blue-400'}`}>
                    {p.free ? 'grátis' : 'Apify'}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/60">Instagram requer APIFY_API_KEY. As demais fontes são 100% gratuitas.</p>
          </div>

          <button onClick={saveConfig} className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors">
            Salvar configurações
          </button>
        </div>
      )}

      {/* ─────────────────────────────────────── TAB: IDEIAS ───────────────────── */}
      {subTab === 'ideias' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-5">

          {/* Botão descobrir */}
          <div className="rounded-xl border border-border bg-gradient-to-br from-orange-500/5 to-purple-500/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-orange-400" />
              <span className="text-sm font-bold text-foreground">Descobrir Novas Ideias</span>
              {!isRunning && ideas.length > 0 && (
                <span className="ml-auto text-xs text-muted-foreground">{ideas.length} ideias na lista</span>
              )}
            </div>

            {/* Fontes ativas */}
            {!isRunning && (
              <div className="flex flex-wrap gap-1.5">
                {[
                  { key: 'reddit',    label: 'Reddit',    emoji: '💬', free: true  },
                  { key: 'trends',    label: 'G. Trends', emoji: '📈', free: true  },
                  { key: 'tiktok',    label: 'TikTok CC', emoji: '🎵', free: true  },
                  { key: 'instagram', label: 'Instagram', emoji: '📸', free: false },
                ].map(p => {
                  const active = config.platforms.includes(p.key);
                  return (
                    <span key={p.key} className={`text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                      active
                        ? p.free ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                        : 'bg-secondary border-border text-muted-foreground/50 line-through'
                    }`}>
                      {p.emoji} {p.label}
                      {p.free ? <span className="text-[9px] opacity-70">grátis</span> : <span className="text-[9px] opacity-70">Apify</span>}
                    </span>
                  );
                })}
              </div>
            )}

            {isRunning && jobStatus ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-400" />
                  <span>{jobStatus.steps[jobStatus.steps.length - 1]?.label || 'Iniciando...'}</span>
                </div>
                <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-orange-500 to-purple-500 rounded-full transition-all duration-500" style={{ width: `${jobStatus.progress}%` }} />
                </div>
              </div>
            ) : (
              <button
                onClick={startDiscovery}
                disabled={isRunning}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 disabled:opacity-50 text-white font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20"
              >
                <Zap className="w-4 h-4" />
                Descobrir Ideias
              </button>
            )}

            {!isRunning && (
              <p className="text-[11px] text-muted-foreground/60 text-center">
                Reddit OAuth · YouTube · TikTok CC · Google Trends → Claude analisa → 12 ideias
              </p>
            )}
          </div>

          {/* ── Revisão dos dados coletados ── */}
          {scrapedData && !generatingIdeas && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-0 overflow-hidden">
              {/* Header */}
              <div className="px-4 py-3 flex items-center justify-between border-b border-amber-500/20">
                <div>
                  <p className="text-sm font-bold text-foreground">📊 Dados coletados — revise antes de gerar</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Remova o que não é relevante para o seu nicho. O que sobrar alimenta a IA.
                  </p>
                </div>
                <button onClick={() => setScrapedData(null)} className="text-muted-foreground hover:text-foreground ml-3 shrink-0"><X className="w-4 h-4" /></button>
              </div>

              {/* Reddit */}
              {scrapedData.reddit?.length > 0 && (
                <ScrapedSection
                  emoji="💬" label="Reddit" subtitle="Dores e perguntas reais da audiência"
                  count={scrapedData.reddit.length}
                  collapsed={!!collapsedSources['reddit']}
                  onToggle={() => setCollapsedSources(p => ({ ...p, reddit: !p['reddit'] }))}
                  onRemoveAll={() => setScrapedData(p => p ? { ...p, reddit: [] } : p)}
                >
                  {scrapedData.reddit.map((item, i) => (
                    <ScrapedItemRow key={i}
                      label={item.title || ''}
                      meta={`r/${item.subreddit} · ${(item.score || 0).toLocaleString()} upvotes · ${item.comments} comentários`}
                      onRemove={() => removeScrapedItem('reddit', i)}
                    />
                  ))}
                </ScrapedSection>
              )}

              {/* TikTok CC */}
              {scrapedData.tiktok?.length > 0 && (
                <ScrapedSection
                  emoji="🎵" label="TikTok" subtitle="Hashtags e vídeos trending"
                  count={scrapedData.tiktok.length}
                  collapsed={!!collapsedSources['tiktok']}
                  onToggle={() => setCollapsedSources(p => ({ ...p, tiktok: !p['tiktok'] }))}
                  onRemoveAll={() => setScrapedData(p => p ? { ...p, tiktok: [] } : p)}
                >
                  {scrapedData.tiktok.map((item, i) => (
                    <ScrapedItemRow key={i}
                      label={item.title || `#${item.hashtag}`}
                      meta={item.views ? `${(item.views / 1000000).toFixed(1)}M views · ${(item.videoCount || 0).toLocaleString()} vídeos` : ''}
                      onRemove={() => removeScrapedItem('tiktok', i)}
                    />
                  ))}
                </ScrapedSection>
              )}

              {/* Google Trends */}
              {scrapedData.trends?.length > 0 && (
                <ScrapedSection
                  emoji="📈" label="Google Trends" subtitle="Buscas em alta no Brasil agora"
                  count={scrapedData.trends.length}
                  collapsed={!!collapsedSources['trends']}
                  onToggle={() => setCollapsedSources(p => ({ ...p, trends: !p['trends'] }))}
                  onRemoveAll={() => setScrapedData(p => p ? { ...p, trends: [] } : p)}
                >
                  <div className="flex flex-wrap gap-1.5 px-3 pb-3">
                    {scrapedData.trends.map((t, i) => (
                      <span key={i} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary border border-border text-[11px] text-foreground">
                        {t}
                        <button onClick={() => removeScrapedItem('trends', i)} className="text-muted-foreground hover:text-red-400 transition-colors"><X className="w-2.5 h-2.5" /></button>
                      </span>
                    ))}
                  </div>
                </ScrapedSection>
              )}

              {/* YouTube */}
              {(scrapedData.youtube?.length ?? 0) > 0 && (
                <ScrapedSection
                  emoji="▶️" label="YouTube" subtitle="Vídeos mais vistos do nicho (último mês, BR)"
                  count={scrapedData.youtube!.length}
                  collapsed={!!collapsedSources['youtube']}
                  onToggle={() => setCollapsedSources(p => ({ ...p, youtube: !p['youtube'] }))}
                  onRemoveAll={() => setScrapedData(p => p ? { ...p, youtube: [] } : p)}
                >
                  {scrapedData.youtube!.map((item, i) => (
                    <ScrapedItemRow key={i}
                      label={item.title || ''}
                      meta={item.views ? `${((item.views || 0) / 1000).toFixed(0)}K views · ${(item.likes || 0).toLocaleString()} likes${item.channel ? ` · ${item.channel}` : ''}` : (item.channel || '')}
                      onRemove={() => removeScrapedItem('youtube' as any, i)}
                    />
                  ))}
                </ScrapedSection>
              )}

              {/* Instagram */}
              {scrapedData.instagram?.length > 0 && (
                <ScrapedSection
                  emoji="📸" label="Instagram" subtitle="Posts de maior engajamento"
                  count={scrapedData.instagram.length}
                  collapsed={!!collapsedSources['instagram']}
                  onToggle={() => setCollapsedSources(p => ({ ...p, instagram: !p['instagram'] }))}
                  onRemoveAll={() => setScrapedData(p => p ? { ...p, instagram: [] } : p)}
                >
                  {scrapedData.instagram.map((item, i) => (
                    <ScrapedItemRow key={i}
                      label={item.title || ''}
                      meta={`${(item.likes || 0).toLocaleString()} curtidas · ${item.comments} comentários`}
                      onRemove={() => removeScrapedItem('instagram', i)}
                    />
                  ))}
                </ScrapedSection>
              )}

              {/* Zero resultados: mostra guia de setup de APIs */}
              {(() => {
                const ps = scrapedData.platformStatus;
                const total = (scrapedData.reddit?.length || 0) + (scrapedData.tiktok?.length || 0) +
                              (scrapedData.instagram?.length || 0) + (scrapedData.trends?.length || 0) +
                              (scrapedData.youtube?.length || 0);
                if (total > 0 || !ps) return null;
                return (
                  <div className="px-4 pb-4 space-y-3">
                    <p className="text-xs font-semibold text-amber-600">⚠️ Nenhuma plataforma retornou dados — IPs do servidor bloqueados pelos sites gratuitos.</p>
                    <p className="text-[11px] text-muted-foreground">Configure as APIs autenticadas abaixo (gratuitas) para obter dados reais:</p>
                    <div className="space-y-2">
                      {ps.youtube?.error && (
                        <div className="rounded-lg bg-card border border-border p-3 text-[11px] space-y-1">
                          <p className="font-semibold text-foreground">▶️ YouTube Data API (10k req/dia grátis)</p>
                          <p className="text-muted-foreground">1. <span className="text-blue-400">console.cloud.google.com</span> → Ative "YouTube Data API v3" → Crie API Key</p>
                          <p className="text-muted-foreground">2. Adicione no Fly.io: <code className="bg-secondary px-1 rounded">YOUTUBE_API_KEY</code></p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Botão gerar (só aparece quando há dados) */}
              {((scrapedData.reddit?.length || 0) + (scrapedData.tiktok?.length || 0) +
                (scrapedData.instagram?.length || 0) + (scrapedData.trends?.length || 0) +
                (scrapedData.youtube?.length || 0)) > 0 && (
                <div className="px-4 py-3 bg-secondary/30 border-t border-amber-500/20">
                  <button
                    onClick={() => generateFromScrapedData(scrapedData)}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20"
                  >
                    <Sparkles className="w-4 h-4" />
                    Gerar 12 Ideias com esses dados
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Gerando ideias (loading) */}
          {generatingIdeas && (
            <div className="rounded-xl border border-border bg-card p-6 text-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-orange-400 mx-auto" />
              <p className="text-sm font-semibold text-foreground">Claude analisando padrões virais...</p>
              <p className="text-xs text-muted-foreground">Identificando formatos, hooks e ângulos que funcionam</p>
            </div>
          )}

          {/* Lista de ideias */}
          {ideas.length > 0 && !scrapedData && !generatingIdeas && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {ideas.length} ideias geradas
                </h3>
                <div className="flex items-center gap-2">
                  <select
                    value={ideasSort}
                    onChange={e => setIdeasSort(e.target.value as any)}
                    className="rounded-lg border border-border bg-background px-2 py-1 text-[11px] focus:outline-none"
                  >
                    <option value="score">Maior potencial</option>
                    <option value="original">Ordem original</option>
                    <option value="format">Por formato</option>
                  </select>
                  <button onClick={async () => { await fetch(`${API}/api/ideas/discovered`, { method: 'DELETE' }); setIdeas([]); }}
                    className="text-[11px] text-muted-foreground hover:text-red-400 transition-colors flex items-center gap-1">
                    <Trash2 className="w-3 h-3" /> Limpar
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {sortedIdeas.map(idea => (
                  <IdeaCard
                    key={idea.id}
                    idea={idea}
                    onCreateCarousel={() => createCarouselFromIdea(idea)}
                    onGenerateReels={() => generateReels(idea)}
                    onUseInMaquina={onUseInMaquina ? () => onUseInMaquina(idea) : undefined}
                    onAddToCalendar={() => {
                      setSubTab('semana');
                      toast('Vá para a aba Semana e clique no dia para adicionar esta ideia', { icon: '📅' });
                    }}
                    onDelete={() => deleteIdea(idea.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {!isRunning && ideas.length === 0 && (
            <div className="text-center py-12 space-y-3">
              <Lightbulb className="w-10 h-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground">Nenhuma ideia ainda. Clique em "Descobrir" para começar.</p>
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────── TAB: SEMANA ───────────────────── */}
      {subTab === 'semana' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-bold">Plano da Semana</h3>
            <span className="text-xs text-muted-foreground ml-auto">{config.postsPerDay} posts/dia</span>
          </div>

          {ideas.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-6 text-center">
              <p className="text-sm text-muted-foreground">Gere ideias primeiro na aba 💡 Ideias</p>
            </div>
          )}

          <div className="space-y-2">
            {weeks.map(({ iso, label, weekday }) => {
              const dayIds = calendar[iso] || [];
              const dayIdeas = dayIds.map(id => ideas.find(i => i.id === id)).filter(Boolean) as ContentIdea[];
              const slots = Array.from({ length: config.postsPerDay }, (_, si) => dayIdeas[si] || null);

              return (
                <div key={iso} className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="flex items-center px-3 py-2 bg-secondary/40">
                    <span className="text-xs font-bold text-foreground w-8">{weekday}</span>
                    <span className="text-xs text-muted-foreground ml-1">{label}</span>
                    <span className={`ml-auto text-[10px] font-semibold ${dayIdeas.length >= config.postsPerDay ? 'text-emerald-400' : dayIdeas.length > 0 ? 'text-amber-400' : 'text-muted-foreground/50'}`}>
                      {dayIdeas.length}/{config.postsPerDay}
                    </span>
                  </div>
                  <div className="divide-y divide-border/50">
                    {slots.map((slotIdea, si) => (
                      <div key={si} className="px-3 py-2">
                        {slotIdea ? (
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold border ${FUNNEL_COLORS[slotIdea.funnelStage]}`}>{slotIdea.funnelStage}</span>
                            <span className="text-xs text-foreground flex-1 truncate">{slotIdea.title}</span>
                            <button onClick={() => calendarToggleIdea(iso, slotIdea.id)} className="text-muted-foreground hover:text-red-400 transition-colors"><X className="w-3 h-3" /></button>
                          </div>
                        ) : (
                          <CalendarSlotPicker
                            ideas={ideas}
                            existingIds={dayIds}
                            onSelect={id => calendarToggleIdea(iso, id)}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────── TAB: PERFORMANCE ─────────────── */}
      {subTab === 'performance' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold">Performance dos Posts</h3>
            </div>
            <button onClick={() => setAddingPost(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:bg-border text-xs font-semibold transition-colors">
              <Plus className="w-3.5 h-3.5" /> Adicionar post
            </button>
          </div>

          {/* Formulário adicionar */}
          {addingPost && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold">Novo post rastreado</span>
                <button onClick={() => setAddingPost(false)} className="text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2 space-y-1">
                  <label className="text-[11px] text-muted-foreground">Título / Tema do post</label>
                  <input value={newPost.title || ''} onChange={e => setNewPost(p => ({ ...p, title: e.target.value }))}
                    placeholder="Ex: 5 sinais que sua testosterona está baixa"
                    className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/50" />
                </div>
                {[
                  { key: 'postedAt', label: 'Data', type: 'date' },
                  { key: 'followers', label: 'Seguidores', type: 'number', placeholder: '10000' },
                  { key: 'likes', label: 'Curtidas', type: 'number', placeholder: '0' },
                  { key: 'comments', label: 'Comentários', type: 'number', placeholder: '0' },
                  { key: 'saves', label: 'Salvamentos', type: 'number', placeholder: '0' },
                  { key: 'url', label: 'URL (opcional)', type: 'url', placeholder: 'https://instagram.com/p/...' },
                ].map(f => (
                  <div key={f.key} className="space-y-1">
                    <label className="text-[11px] text-muted-foreground">{f.label}</label>
                    <input type={f.type} value={(newPost as any)[f.key] || ''} onChange={e => setNewPost(p => ({ ...p, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/50" />
                  </div>
                ))}
              </div>
              <button onClick={addTracked} className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors">
                Adicionar post
              </button>
            </div>
          )}

          {/* Ranking de posts */}
          {sortedTracked.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <BarChart3 className="w-10 h-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground">Adicione posts para monitorar o desempenho</p>
              <p className="text-xs text-muted-foreground/70">Os melhores posts serão identificados automaticamente para converter em Reels</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sortedTracked.map((post, idx) => {
                const rate = engagementRate(post);
                const isTop = idx === 0 && rate > 0;
                return (
                  <div key={post.id} className={`rounded-xl border p-4 space-y-3 ${isTop ? 'border-amber-500/40 bg-amber-500/5' : 'border-border bg-card'}`}>
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {isTop && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 font-bold">🏆 TOP</span>}
                          <span className="text-sm font-semibold text-foreground truncate">{post.title}</span>
                        </div>
                        <span className="text-[11px] text-muted-foreground">{post.postedAt}</span>
                      </div>
                      <button onClick={() => deleteTracked(post.id)} className="text-muted-foreground hover:text-red-400 transition-colors shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>

                    {/* Métricas */}
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: '❤️ Curtidas', value: post.likes.toLocaleString() },
                        { label: '💬 Coment.', value: post.comments.toLocaleString() },
                        { label: '🔖 Salvos', value: (post.saves || 0).toLocaleString() },
                        { label: '📊 Taxa', value: rate > 0 ? `${rate.toFixed(1)}%` : '—' },
                      ].map(m => (
                        <div key={m.label} className="text-center">
                          <div className="text-sm font-bold text-foreground">{m.value}</div>
                          <div className="text-[10px] text-muted-foreground">{m.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Taxa de engajamento bar */}
                    {rate > 0 && post.followers > 0 && (
                      <div className="space-y-1">
                        <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${rate >= 3 ? 'bg-emerald-500' : rate >= 1 ? 'bg-amber-500' : 'bg-red-500'}`}
                            style={{ width: `${Math.min(100, rate * 10)}%` }} />
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {rate >= 3 ? '🔥 Excelente engajamento' : rate >= 1 ? '⚡ Bom engajamento' : '📉 Engajamento baixo'}
                        </p>
                      </div>
                    )}

                    {/* CTA converter */}
                    {(isTop || rate >= 2) && (
                      <button
                        onClick={() => {
                          const idea: ContentIdea = {
                            id: post.id, title: post.title, hook: '', format: 'revelação',
                            funnelStage: 'MOFU', emotion: 'curiosidade', cta: '',
                            contentType: 'reels', numSlides: 0, slideOutline: [],
                            whyItWorks: `Gerou ${rate.toFixed(1)}% de engajamento`, viralScore: Math.min(9.5, rate * 2),
                          };
                          generateReels(idea);
                        }}
                        className="w-full py-2 rounded-lg bg-purple-600/20 border border-purple-500/30 hover:bg-purple-600/30 text-purple-300 text-xs font-semibold transition-colors flex items-center justify-center gap-2"
                      >
                        <Video className="w-3.5 h-3.5" /> Converter para Reels
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Modal Roteiro de Reels ── */}
      {reelsIdea && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-background border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h3 className="font-bold text-foreground">🎬 Roteiro de Reels</h3>
                <p className="text-xs text-muted-foreground truncate max-w-xs">{reelsIdea.title}</p>
              </div>
              <button onClick={() => { setReelsIdea(null); setReelsScript(''); }} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {reelsLoading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
                  <p className="text-sm text-muted-foreground">Gerando roteiro com Claude...</p>
                </div>
              ) : reelsScript ? (
                <pre className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">{reelsScript}</pre>
              ) : null}
            </div>
            {reelsScript && (
              <div className="px-5 py-4 border-t border-border flex gap-2">
                <button onClick={() => { navigator.clipboard.writeText(reelsScript); toast.success('Copiado!'); }}
                  className="flex-1 py-2 rounded-lg bg-secondary hover:bg-border text-sm font-semibold transition-colors flex items-center justify-center gap-2">
                  <Copy className="w-4 h-4" /> Copiar roteiro
                </button>
                <button onClick={() => createCarouselFromIdea(reelsIdea)}
                  className="flex-1 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors">
                  Criar Carrossel também
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Componente: Card de Ideia ─────────────────────────────────────────────────

function IdeaCard({
  idea, onCreateCarousel, onGenerateReels, onUseInMaquina, onAddToCalendar, onDelete,
}: {
  idea: ContentIdea;
  onCreateCarousel: () => void;
  onGenerateReels: () => void;
  onUseInMaquina?: () => void;
  onAddToCalendar: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-card hover:border-orange-500/30 transition-colors overflow-hidden">
      {/* Header */}
      <div className="p-3 space-y-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold border ${FUNNEL_COLORS[idea.funnelStage]}`}>{idea.funnelStage}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border">{FORMAT_EMOJI[idea.format] || '📌'} {idea.format}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border">{idea.contentType === 'ambos' ? '🎠🎬' : idea.contentType === 'carrossel' ? '🎠' : '🎬'}</span>
          <span className="ml-auto text-[10px] font-bold text-orange-400">⚡{idea.viralScore?.toFixed(1)}</span>
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
        <h4 className="text-sm font-bold text-foreground leading-snug">{idea.title}</h4>
        <p className="text-xs text-muted-foreground italic leading-snug">"{ idea.hook}"</p>
      </div>

      {/* Expandido */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-border/50 pt-2">
          <div className="text-[11px] space-y-1">
            <div><span className="text-muted-foreground">Emoção:</span> <span className="text-foreground">{idea.emotion}</span></div>
            <div><span className="text-muted-foreground">CTA:</span> <span className="text-foreground">"{idea.cta}"</span></div>
            {idea.whyItWorks && <div><span className="text-muted-foreground">Por quê funciona:</span> <span className="text-foreground">{idea.whyItWorks}</span></div>}
          </div>
          {idea.slideOutline?.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Estrutura ({idea.numSlides} slides)</p>
              <ol className="space-y-0.5">
                {idea.slideOutline.slice(0, 5).map((s, i) => (
                  <li key={i} className="text-[11px] text-muted-foreground flex gap-1.5">
                    <span className="text-muted-foreground/50 shrink-0">{i + 1}.</span> {s}
                  </li>
                ))}
                {idea.slideOutline.length > 5 && <li className="text-[10px] text-muted-foreground/50">+{idea.slideOutline.length - 5} slides...</li>}
              </ol>
            </div>
          )}
        </div>
      )}

      {/* Ações */}
      <div className="border-t border-border/50 px-3 py-2 flex items-center gap-1 flex-wrap">
        <button onClick={onCreateCarousel}
          className="flex-1 min-w-0 py-1.5 rounded-lg bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/30 text-orange-300 text-[11px] font-semibold transition-colors flex items-center justify-center gap-1">
          🎠 Carrossel
        </button>
        <button onClick={onGenerateReels}
          className="flex-1 min-w-0 py-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 text-purple-300 text-[11px] font-semibold transition-colors flex items-center justify-center gap-1">
          🎬 Reels
        </button>
        {onUseInMaquina && (
          <button onClick={onUseInMaquina}
            className="flex-1 min-w-0 py-1.5 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/30 text-violet-300 text-[11px] font-semibold transition-colors flex items-center justify-center gap-1">
            ⚙ Máquina
          </button>
        )}
        <button onClick={onAddToCalendar}
          className="py-1.5 px-2 rounded-lg bg-secondary hover:bg-border text-muted-foreground text-[11px] transition-colors"
          title="Agendar na semana">
          📅
        </button>
        <button onClick={onDelete}
          className="py-1.5 px-2 rounded-lg bg-secondary hover:bg-red-500/20 text-muted-foreground hover:text-red-400 text-[11px] transition-colors">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ─── Componente: Seção de dados coletados (colapsável) ────────────────────────

function ScrapedSection({
  emoji, label, subtitle, count, collapsed, onToggle, onRemoveAll, children,
}: {
  emoji: string;
  label: string;
  subtitle: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onRemoveAll: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-amber-500/10 last:border-b-0">
      {/* Header da seção */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-amber-500/5 transition-colors select-none"
        onClick={onToggle}
      >
        <span className="text-base leading-none">{emoji}</span>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold text-foreground">{label}</span>
          <span className="text-[11px] text-muted-foreground ml-2">{subtitle}</span>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary border border-border text-muted-foreground font-mono shrink-0">
          {count}
        </span>
        <button
          onClick={e => { e.stopPropagation(); onRemoveAll(); }}
          className="text-[10px] text-muted-foreground/50 hover:text-red-400 transition-colors px-1.5 py-0.5 rounded hover:bg-red-500/10 shrink-0"
          title="Remover todos"
        >
          Limpar
        </button>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform shrink-0 ${collapsed ? '' : 'rotate-180'}`} />
      </div>
      {/* Conteúdo */}
      {!collapsed && (
        <div className="pb-1">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Componente: Linha de item coletado ────────────────────────────────────────

function ScrapedItemRow({
  label, meta, onRemove,
}: {
  label: string;
  meta?: string;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-start gap-2 px-4 py-1.5 hover:bg-secondary/40 transition-colors group">
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-foreground leading-snug line-clamp-2">{label}</p>
        {meta && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{meta}</p>}
      </div>
      <button
        onClick={onRemove}
        className="shrink-0 mt-0.5 text-muted-foreground/30 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
        title="Remover"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// ─── Componente: Seletor de slot no calendário ─────────────────────────────────

function CalendarSlotPicker({ ideas, existingIds, onSelect }: { ideas: ContentIdea[]; existingIds: string[]; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const available = ideas.filter(i => !existingIds.includes(i.id));

  if (!open) return (
    <button onClick={() => setOpen(true)} className="w-full text-left text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors flex items-center gap-1">
      <Plus className="w-3 h-3" /> Adicionar ideia
    </button>
  );

  return (
    <div className="relative">
      <div className="absolute top-0 left-0 right-0 z-10 bg-background border border-border rounded-lg shadow-xl max-h-48 overflow-y-auto">
        <div className="p-1">
          {available.length === 0 ? (
            <p className="text-[11px] text-muted-foreground p-2">Nenhuma ideia disponível</p>
          ) : available.map(idea => (
            <button key={idea.id} onClick={() => { onSelect(idea.id); setOpen(false); }}
              className="w-full text-left px-2 py-1.5 rounded hover:bg-secondary text-[11px] text-foreground truncate block">
              <span className={`text-[9px] px-1 py-0.5 rounded font-bold mr-1 border ${FUNNEL_COLORS[idea.funnelStage]}`}>{idea.funnelStage}</span>
              {idea.title}
            </button>
          ))}
        </div>
        <button onClick={() => setOpen(false)} className="w-full py-1.5 text-[10px] text-muted-foreground hover:text-foreground border-t border-border transition-colors">
          Cancelar
        </button>
      </div>
    </div>
  );
}
