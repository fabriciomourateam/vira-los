import React, { useState, useEffect } from 'react';
import {
  Search, Plus, Trash2, Copy, CheckCircle2, X, ExternalLink,
  Loader2, Lightbulb, Link2, BookOpen, TrendingUp, Eye, Heart,
  MessageCircle, Share2, Flame, Sparkles, Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, checkBackend, ViralReference, HookTemplate, ContentIdea } from '../lib/api';

interface ViralVideo {
  id: string;
  title: string;
  author: string;
  author_handle: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  cover: string;
  url: string;
  platform: string;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const FORMAT_OPTIONS = [
  { value: 'lista', label: 'Lista (#N erros, #N dicas...)' },
  { value: 'storytelling', label: 'Storytelling (antes/depois)' },
  { value: 'revelacao', label: 'Revelação (o que ninguém conta)' },
  { value: 'prova_social', label: 'Prova Social (resultados)' },
  { value: 'tutorial', label: 'Tutorial / How-to' },
  { value: 'medo', label: 'Medo / Urgência' },
  { value: 'curiosidade', label: 'Curiosidade / Gancho' },
  { value: 'outros', label: 'Outros' },
];

const HOOK_CATEGORIES = [
  { value: 'list',         label: 'Lista',         color: 'bg-blue-100 text-blue-700' },
  { value: 'curiosity',    label: 'Curiosidade',   color: 'bg-purple-100 text-purple-700' },
  { value: 'before_after', label: 'Antes/Depois',  color: 'bg-emerald-100 text-emerald-700' },
  { value: 'fear',         label: 'Medo/Urgência', color: 'bg-red-100 text-red-700' },
  { value: 'question',     label: 'Pergunta',      color: 'bg-orange-100 text-orange-700' },
];

const PLATFORM_OPTIONS = ['instagram', 'tiktok', 'youtube', 'other'];

function getCategoryStyle(cat: string) {
  return HOOK_CATEGORIES.find((c) => c.value === cat)?.color || 'bg-gray-100 text-gray-600';
}

function parseTagsSafe(str: string): string[] {
  try { return JSON.parse(str); } catch { return []; }
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function PesquisaConteudo() {
  const [references, setReferences] = useState<ViralReference[]>([]);
  const [hooks, setHooks] = useState<HookTemplate[]>([]);
  const [ideas, setIdeas] = useState<ContentIdea[]>([]);
  const [loading, setLoading] = useState(true);
  const [backendOk, setBackendOk] = useState(false);

  // Busca viral
  const [viralQuery, setViralQuery] = useState('');
  const [viralResults, setViralResults] = useState<ViralVideo[]>([]);
  const [viralLoading, setViralLoading] = useState(false);
  const [viralError, setViralError] = useState('');
  const [viralMode, setViralMode] = useState<'search' | 'trending'>('trending');
  const [minViews, setMinViews] = useState('');
  const [minLikes, setMinLikes] = useState('');
  const [sortBy, setSortBy] = useState<'views' | 'likes' | 'comments'>('views');
  const [publishedAfter, setPublishedAfter] = useState('');

  // Modais
  const [addRefOpen, setAddRefOpen] = useState(false);
  const [addHookOpen, setAddHookOpen] = useState(false);
  const [addIdeaOpen, setAddIdeaOpen] = useState(false);

  // Filtros
  const [refFilter, setRefFilter] = useState('');
  const [hookCatFilter, setHookCatFilter] = useState('all');
  const [ideaStatusFilter, setIdeaStatusFilter] = useState('all');

  // Cópia confirmada
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // TikTok viral
  const [ttMode, setTtMode] = useState<'search' | 'creators' | 'videos'>('search');
  const [ttQuery, setTtQuery] = useState('');
  const [ttResults, setTtResults] = useState<ViralVideo[]>([]);
  const [ttCreators, setTtCreators] = useState<any[]>([]);
  const [ttLoading, setTtLoading] = useState(false);
  const [ttError, setTtError] = useState('');
  const [ttMinViews, setTtMinViews] = useState('');
  const [ttMinLikes, setTtMinLikes] = useState('');
  const [ttSortBy, setTtSortBy] = useState<'views' | 'likes' | 'comments'>('views');

  // Instagram viral
  const [igMode, setIgMode] = useState<'search' | 'creators' | 'username'>('search');
  const [igQuery, setIgQuery] = useState('');
  const [igResults, setIgResults] = useState<ViralVideo[]>([]);
  const [igCreators, setIgCreators] = useState<any[]>([]);
  const [igLoading, setIgLoading] = useState(false);
  const [igError, setIgError] = useState('');
  const [igMinLikes, setIgMinLikes] = useState('');
  const [igMinComments, setIgMinComments] = useState('');
  const [igSortBy, setIgSortBy] = useState<'likes' | 'comments'>('likes');

  // IA Descoberta Viral
  const [aiNiche, setAiNiche] = useState('testosterona hormônios shape ganho muscular perda de gordura');
  const [aiResults, setAiResults] = useState<(ViralVideo & { viral_score: number; niche_fit: number; gancho_score: number; roteiro_format: string; ai_why: string; keyword: string; region: string; lang: string })[]>([]);
  const [aiCreators, setAiCreators] = useState<{ username: string; nickname: string; followers: number; avatar: string; is_verified: boolean; keyword: string }[]>([]);
  const [aiKeywords, setAiKeywords] = useState<{ pt: string[]; en: string[]; es: string[] }>({ pt: [], en: [], es: [] });
  const [aiInsights, setAiInsights] = useState('');
  const [aiPlatformStatus, setAiPlatformStatus] = useState<any>(null);
  const [aiPlatformErrors, setAiPlatformErrors] = useState<{ platform: string; error: string }[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  // Região
  const [ytRegion, setYtRegion] = useState('BR');
  const [ttRegion, setTtRegion] = useState('br');

  // Aba ativa
  const [activeTab, setActiveTab] = useState<'viral' | 'tiktok' | 'instagram' | 'ia' | 'referencias' | 'hooks' | 'ideias'>('viral');

  async function load() {
    const ok = await checkBackend();
    setBackendOk(ok);
    if (!ok) { setLoading(false); return; }
    try {
      const [r, h, i] = await Promise.all([
        api.get<ViralReference[]>('/api/research/references'),
        api.get<HookTemplate[]>('/api/research/hooks'),
        api.get<ContentIdea[]>('/api/research/ideas'),
      ]);
      setReferences(r);
      setHooks(h);
      setIdeas(i);
    } catch { /* silent */ }
    setLoading(false);
  }

  useEffect(() => { load(); loadTrending(); }, []);

  async function loadTrending(region = ytRegion) {
    setViralLoading(true);
    setViralError('');
    try {
      const data = await api.get<ViralVideo[]>(`/api/research/trending?regionCode=${region}`);
      setViralResults(data);
    } catch (e: any) {
      setViralError(e?.message || 'Erro ao carregar trending');
    }
    setViralLoading(false);
  }

  async function searchViral(e: React.FormEvent) {
    e.preventDefault();
    if (!viralQuery.trim()) return;
    setViralMode('search');
    setViralLoading(true);
    setViralError('');
    try {
      const params = new URLSearchParams({ q: viralQuery, regionCode: ytRegion });
      if (publishedAfter) params.set('publishedAfter', publishedAfter);
      const data = await api.get<ViralVideo[]>(`/api/research/viral?${params}`);
      setViralResults(data);
    } catch (e: any) {
      setViralError(e?.message || 'Erro na busca');
    }
    setViralLoading(false);
  }

  async function switchTrending() {
    setViralMode('trending');
    setViralQuery('');
    loadTrending();
  }

  async function searchTikTok(e: React.FormEvent) {
    e.preventDefault();
    if (!ttQuery.trim()) return;
    setTtLoading(true);
    setTtError('');
    try {
      if (ttMode === 'creators') {
        const data = await api.get<any[]>(`/api/research/tiktok-creators?q=${encodeURIComponent(ttQuery)}`);
        setTtCreators(data);
        setTtResults([]);
      } else if (ttMode === 'search') {
        const data = await api.get<ViralVideo[]>(`/api/research/tiktok-search?q=${encodeURIComponent(ttQuery)}&region=${ttRegion}`);
        setTtResults(data);
        setTtCreators([]);
      } else {
        const data = await api.get<ViralVideo[]>(`/api/research/viral-tiktok?q=${encodeURIComponent(ttQuery)}`);
        setTtResults(data);
        setTtCreators([]);
      }
    } catch (e: any) {
      setTtError(e?.message || 'Erro na busca');
    }
    setTtLoading(false);
  }

  async function loadTikTokVideos(username: string) {
    setTtMode('videos');
    setTtQuery(username);
    setTtLoading(true);
    setTtError('');
    setTtCreators([]);
    try {
      const data = await api.get<ViralVideo[]>(`/api/research/viral-tiktok?q=${encodeURIComponent(username)}`);
      setTtResults(data);
    } catch (e: any) {
      setTtError(e?.message || 'Erro');
    }
    setTtLoading(false);
  }

  const filteredTt = ttResults
    .filter((v) => !ttMinViews || v.views >= Number(ttMinViews))
    .filter((v) => !ttMinLikes || v.likes >= Number(ttMinLikes))
    .sort((a, b) => b[ttSortBy] - a[ttSortBy]);

  async function searchInstagram(e: React.FormEvent) {
    e.preventDefault();
    if (!igQuery.trim()) return;
    setIgLoading(true);
    setIgError('');
    try {
      if (igMode === 'search') {
        const data = await api.get<ViralVideo[]>(`/api/research/instagram-search?q=${encodeURIComponent(igQuery)}`);
        setIgResults(data);
        setIgCreators([]);
      } else if (igMode === 'creators') {
        const data = await api.get<any[]>(`/api/research/instagram-creators?q=${encodeURIComponent(igQuery)}`);
        setIgCreators(data);
        setIgResults([]);
      } else {
        const data = await api.get<ViralVideo[]>(`/api/research/viral-instagram?q=${encodeURIComponent(igQuery.replace(/^@/, ''))}`);
        setIgResults(data);
        setIgCreators([]);
      }
    } catch (e: any) {
      setIgError(e?.message || 'Erro na busca');
    }
    setIgLoading(false);
  }

  async function loadIgVideos(username: string) {
    setIgMode('username');
    setIgQuery(username);
    setIgLoading(true);
    setIgError('');
    setIgCreators([]);
    try {
      const data = await api.get<ViralVideo[]>(`/api/research/viral-instagram?q=${encodeURIComponent(username)}`);
      setIgResults(data);
    } catch (e: any) {
      setIgError(e?.message || 'Erro');
    }
    setIgLoading(false);
  }

  const filteredIg = igResults
    .filter((v) => !igMinLikes || v.likes >= Number(igMinLikes))
    .filter((v) => !igMinComments || v.comments >= Number(igMinComments))
    .sort((a, b) => b[igSortBy] - a[igSortBy]);

  async function discoverWithAI(e: React.FormEvent) {
    e.preventDefault();
    setAiLoading(true);
    setAiError('');
    setAiResults([]);
    setAiCreators([]);
    setAiKeywords({ pt: [], en: [], es: [] });
    setAiInsights('');
    setAiPlatformStatus(null);
    setAiPlatformErrors([]);
    try {
      const res = await fetch('/api/research/ai-discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ niche: aiNiche.trim() || 'testosterona hormônios shape perda de gordura' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro na descoberta');
      setAiResults(data.videos || []);
      setAiCreators(data.creators || []);
      setAiKeywords(data.keywords || { pt: [], en: [], es: [] });
      setAiInsights(data.insights || '');
      setAiPlatformStatus(data.platformStatus || null);
      setAiPlatformErrors(data.errors || []);
    } catch (err: any) {
      setAiError(err.message || 'Erro ao descobrir conteúdo');
    }
    setAiLoading(false);
  }

  async function saveAsReference(v: ViralVideo) {
    try {
      const item = await api.post<ViralReference>('/api/research/references', {
        url: v.url, title: v.title || `@${v.author_handle}`, platform: 'tiktok',
        notes: `👁 ${fmtNum(v.views)} views · ❤️ ${fmtNum(v.likes)} likes`,
        tags: [],
      });
      setReferences((p) => [item, ...p]);
    } catch { /* silent */ }
  }

  async function copyHook(hook: HookTemplate) {
    await navigator.clipboard.writeText(hook.text);
    setCopiedId(hook.id);
    setTimeout(() => setCopiedId(null), 2000);
    try { await api.post(`/api/research/hooks/${hook.id}/use`); } catch { /* silent */ }
    setHooks((p) => p.map((h) => h.id === hook.id ? { ...h, use_count: h.use_count + 1 } : h));
  }

  async function deleteRef(id: string) {
    await api.delete(`/api/research/references/${id}`);
    setReferences((p) => p.filter((r) => r.id !== id));
  }

  async function deleteHook(id: string) {
    await api.delete(`/api/research/hooks/${id}`);
    setHooks((p) => p.filter((h) => h.id !== id));
  }

  async function deleteIdea(id: string) {
    await api.delete(`/api/research/ideas/${id}`);
    setIdeas((p) => p.filter((i) => i.id !== id));
  }

  async function updateIdeaStatus(id: string, status: ContentIdea['status']) {
    await api.patch(`/api/research/ideas/${id}`, { status });
    setIdeas((p) => p.map((i) => i.id === id ? { ...i, status } : i));
  }

  const filteredViral = viralResults
    .filter((v) => !minViews || v.views >= Number(minViews.replace(/[kKmM]/g, (m) => m.toLowerCase() === 'k' ? '000' : '000000')))
    .filter((v) => !minLikes || v.likes >= Number(minLikes.replace(/[kKmM]/g, (m) => m.toLowerCase() === 'k' ? '000' : '000000')))
    .sort((a, b) => b[sortBy] - a[sortBy]);

  const filteredRefs = references.filter((r) =>
    !refFilter || r.title?.toLowerCase().includes(refFilter.toLowerCase()) ||
    r.url?.toLowerCase().includes(refFilter.toLowerCase()) ||
    r.notes?.toLowerCase().includes(refFilter.toLowerCase())
  );

  const filteredHooks = hookCatFilter === 'all' ? hooks : hooks.filter((h) => h.category === hookCatFilter);
  const filteredIdeas = ideaStatusFilter === 'all' ? ideas : ideas.filter((i) => i.status === ideaStatusFilter);

  const TABS = [
    { id: 'viral',      label: 'YouTube',      icon: <Flame size={14} />,    color: 'text-red-500' },
    { id: 'tiktok',     label: 'TikTok',       icon: <TrendingUp size={14} />, color: 'text-foreground' },
    { id: 'instagram',  label: 'Instagram',    icon: <Heart size={14} />,    color: 'text-pink-500' },
    { id: 'ia',         label: 'IA Viral',     icon: <Sparkles size={14} />, color: 'text-violet-500' },
    { id: 'referencias', label: 'Referências', icon: <Link2 size={14} />,    color: 'text-blue-500' },
    { id: 'hooks',      label: 'Hooks',        icon: <Lightbulb size={14} />, color: 'text-orange-500' },
    { id: 'ideias',     label: 'Ideias',       icon: <BookOpen size={14} />, color: 'text-emerald-500' },
  ] as const;

  return (
    <div className="space-y-6">
      {/* Header */}
      <section>
        <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight mb-1">🔍 Pesquisa de Conteúdo</h2>
        <p className="text-muted-foreground text-xs sm:text-sm hidden sm:block">
          Encontre vídeos virais, salve referências, organize hooks e ideias
        </p>
      </section>

      {!backendOk && !loading && (
        <div className="p-4 bg-orange-50 border border-orange-200 rounded-2xl text-xs text-orange-700">
          <strong>Servidor offline</strong> — os dados serão carregados quando o servidor estiver rodando.
        </div>
      )}

      {/* ── Tab Bar ── */}
      <div className="flex gap-1 bg-secondary p-1 rounded-xl overflow-x-auto scrollbar-hide">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-shrink-0 flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className={activeTab === tab.id ? tab.color : ''}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Busca Viral ── */}
      {activeTab === 'viral' && <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Flame size={18} className="text-red-500" />
          <h3 className="font-bold text-sm uppercase tracking-wider">Busca Viral YouTube</h3>
        </div>

        <form onSubmit={searchViral} className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar vídeos virais... (ex: treino, marketing, saúde)"
              value={viralQuery}
              onChange={(e) => setViralQuery(e.target.value)}
              className="w-full bg-secondary border border-border rounded-xl pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10"
            />
          </div>
          <button type="submit" disabled={viralLoading}
            className="px-4 py-2 bg-foreground text-background rounded-xl text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-opacity">
            {viralLoading ? <Loader2 size={16} className="animate-spin" /> : 'Buscar'}
          </button>
          <button type="button" onClick={switchTrending} disabled={viralLoading}
            className={`px-3 py-2 rounded-xl text-sm font-bold transition-all ${viralMode === 'trending' ? 'bg-red-500 text-white' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>
            <TrendingUp size={16} />
          </button>
        </form>

        {/* Filtros */}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <input type="number" placeholder="Mín. views" value={minViews} onChange={(e) => setMinViews(e.target.value)}
            className="w-full bg-secondary border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none" />
          <input type="number" placeholder="Mín. curtidas" value={minLikes} onChange={(e) => setMinLikes(e.target.value)}
            className="w-full bg-secondary border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none" />
          <select value={publishedAfter} onChange={(e) => setPublishedAfter(e.target.value)}
            className="col-span-2 sm:w-auto bg-secondary border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none">
            <option value="">Qualquer data</option>
            <option value={new Date(Date.now() - 7*86400000).toISOString()}>Última semana</option>
            <option value={new Date(Date.now() - 30*86400000).toISOString()}>Último mês</option>
            <option value={new Date(Date.now() - 90*86400000).toISOString()}>Últimos 3 meses</option>
            <option value={new Date(Date.now() - 365*86400000).toISOString()}>Último ano</option>
          </select>
          <select value={ytRegion} onChange={(e) => { setYtRegion(e.target.value); if (viralMode === 'trending') loadTrending(e.target.value); }}
            className="col-span-2 sm:w-auto bg-secondary border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none">
            <option value="BR">🇧🇷 Brasil</option>
            <option value="US">🇺🇸 EUA</option>
            <option value="PT">🇵🇹 Portugal</option>
            <option value="ES">🇪🇸 Espanha</option>
            <option value="MX">🇲🇽 México</option>
            <option value="AR">🇦🇷 Argentina</option>
            <option value="CO">🇨🇴 Colômbia</option>
            <option value="GB">🇬🇧 Reino Unido</option>
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}
            className="col-span-2 sm:w-auto bg-secondary border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none">
            <option value="views">Ordenar: Views</option>
            <option value="likes">Ordenar: Curtidas</option>
            <option value="comments">Ordenar: Comentários</option>
          </select>
          {(minViews || minLikes || publishedAfter) && (
            <button onClick={() => { setMinViews(''); setMinLikes(''); setPublishedAfter(''); }}
              className="col-span-2 sm:w-auto px-2 py-1.5 text-xs text-muted-foreground hover:text-red-500 flex items-center gap-1">
              <X size={12} /> Limpar
            </button>
          )}
        </div>

        {viralError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">{viralError}</div>
        )}

        {viralLoading ? (
          <div className="py-8 flex justify-center"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
        ) : filteredViral.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
            {filteredViral.map((v) => (
              <div key={v.id} className="bg-card border border-border rounded-xl overflow-hidden group" style={{ boxShadow: 'var(--shadow-card)' }}>
                <div className="relative aspect-[9/16] bg-secondary overflow-hidden">
                  {v.cover ? (
                    <img src={v.cover} alt={v.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">Sem capa</div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <a href={v.url} target="_blank" rel="noreferrer"
                      className="p-2 bg-white/20 backdrop-blur rounded-lg text-white hover:bg-white/30">
                      <ExternalLink size={16} />
                    </a>
                    <button onClick={() => saveAsReference(v)}
                      className="p-2 bg-white/20 backdrop-blur rounded-lg text-white hover:bg-white/30" title="Salvar como referência">
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
                <div className="p-2">
                  <p className="text-[11px] font-semibold line-clamp-2 mb-1">{v.title || `@${v.author_handle}`}</p>
                  <p className="text-[10px] text-muted-foreground mb-1.5">@{v.author_handle}</p>
                  <div className="grid grid-cols-2 gap-1">
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Eye size={10} />{fmtNum(v.views)}
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Heart size={10} />{fmtNum(v.likes)}
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <MessageCircle size={10} />{fmtNum(v.comments)}
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Share2 size={10} />{fmtNum(v.shares)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : viralResults.length > 0 && filteredViral.length === 0 ? (
          <div className="py-6 text-center text-muted-foreground">
            <Search size={24} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">Nenhum resultado com esses filtros</p>
          </div>
        ) : !viralLoading && (
          <div className="py-6 text-center text-muted-foreground">
            <Flame size={24} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">Busque por palavras-chave para encontrar vídeos virais</p>
          </div>
        )}
      </section>}

      {/* ── TikTok Viral ── */}
      {activeTab === 'tiktok' && <section className="space-y-3">
        <div className="flex w-full rounded-lg overflow-hidden border border-border">
          {(['search', 'creators', 'videos'] as const).map((m) => (
            <button key={m} onClick={() => { setTtMode(m); setTtResults([]); setTtCreators([]); }}
              className={`flex-1 px-2 py-2 text-xs font-bold text-center transition-all leading-tight ${ttMode === m ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground'}`}>
              {m === 'search' ? '🔥 Palavra-chave' : m === 'creators' ? '🔍 Criadores' : '🎬 @Username'}
            </button>
          ))}
        </div>

        <form onSubmit={searchTikTok} className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input type="text"
              placeholder={ttMode === 'search' ? 'Palavra-chave (ex: treino, marketing, saúde)' : ttMode === 'creators' ? 'Nicho (ex: treino, marketing, saúde)' : '@username (ex: @cbum, @khaby.lame)'}
              value={ttQuery} onChange={(e) => setTtQuery(e.target.value)}
              className="w-full bg-secondary border border-border rounded-xl pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10" />
          </div>
          <button type="submit" disabled={ttLoading}
            className="px-4 py-2 bg-foreground text-background rounded-xl text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-opacity">
            {ttLoading ? <Loader2 size={16} className="animate-spin" /> : 'Buscar'}
          </button>
        </form>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <input type="number" placeholder="Mín. views" value={ttMinViews} onChange={(e) => setTtMinViews(e.target.value)}
            className="w-full bg-secondary border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none" />
          <input type="number" placeholder="Mín. curtidas" value={ttMinLikes} onChange={(e) => setTtMinLikes(e.target.value)}
            className="w-full bg-secondary border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none" />
          {ttMode === 'search' && (
            <select value={ttRegion} onChange={(e) => setTtRegion(e.target.value)}
              className="col-span-2 sm:w-auto bg-secondary border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none">
              <option value="br">🇧🇷 Brasil</option>
              <option value="us">🇺🇸 EUA</option>
              <option value="pt">🇵🇹 Portugal</option>
              <option value="es">🇪🇸 Espanha</option>
              <option value="mx">🇲🇽 México</option>
              <option value="ar">🇦🇷 Argentina</option>
              <option value="co">🇨🇴 Colômbia</option>
              <option value="gb">🇬🇧 Reino Unido</option>
            </select>
          )}
          <select value={ttSortBy} onChange={(e) => setTtSortBy(e.target.value as any)}
            className="col-span-2 sm:w-auto bg-secondary border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none">
            <option value="views">Ordenar: Views</option>
            <option value="likes">Ordenar: Curtidas</option>
            <option value="comments">Ordenar: Comentários</option>
          </select>
        </div>

        {ttError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">{ttError}</div>}

        {ttLoading ? (
          <div className="py-8 flex justify-center"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
        ) : ttCreators.length > 0 ? (
          <div className="grid gap-2">
            {ttCreators.map((c) => (
              <div key={c.uid} className="bg-card border border-border rounded-xl p-3 flex items-center gap-3 group" style={{ boxShadow: 'var(--shadow-card)' }}>
                {c.avatar && <img src={c.avatar} alt={c.nickname} className="w-10 h-10 rounded-full object-cover shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{c.nickname}</p>
                  <p className="text-xs text-muted-foreground">@{c.username} · {fmtNum(c.followers)} seguidores</p>
                </div>
                <button onClick={() => loadTikTokVideos(c.username)}
                  className="px-3 py-1.5 text-xs font-bold bg-secondary hover:bg-foreground hover:text-background rounded-lg transition-all shrink-0">
                  Ver vídeos
                </button>
                <a href={`https://www.tiktok.com/@${c.username}`} target="_blank" rel="noreferrer"
                  className="p-1.5 text-muted-foreground hover:text-foreground"><ExternalLink size={14} /></a>
              </div>
            ))}
          </div>
        ) : filteredTt.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
            {filteredTt.map((v) => (
              <div key={v.id} className="bg-card border border-border rounded-xl overflow-hidden group" style={{ boxShadow: 'var(--shadow-card)' }}>
                <div className="relative aspect-[9/16] bg-secondary overflow-hidden">
                  {v.cover ? <img src={v.cover} alt={v.title} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">Sem capa</div>}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <a href={v.url} target="_blank" rel="noreferrer" className="p-2 bg-white/20 backdrop-blur rounded-lg text-white hover:bg-white/30"><ExternalLink size={16} /></a>
                    <button onClick={() => saveAsReference(v)} className="p-2 bg-white/20 backdrop-blur rounded-lg text-white hover:bg-white/30"><Plus size={16} /></button>
                  </div>
                </div>
                <div className="p-2">
                  <p className="text-[11px] font-semibold line-clamp-2 mb-1">{v.title || `@${v.author_handle}`}</p>
                  <p className="text-[10px] text-muted-foreground mb-1.5">@{v.author_handle}</p>
                  <div className="grid grid-cols-2 gap-1">
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><Eye size={10} />{fmtNum(v.views)}</div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><Heart size={10} />{fmtNum(v.likes)}</div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><MessageCircle size={10} />{fmtNum(v.comments)}</div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><Share2 size={10} />{fmtNum(v.shares)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : !ttLoading && (
          <div className="py-6 text-center text-muted-foreground">
            <TrendingUp size={24} className="mx-auto mb-2 opacity-30" />
            {ttMode === 'search'
              ? <><p className="text-sm">Busque vídeos virais por palavra-chave</p><p className="text-xs mt-1">Ex: treino, marketing, saúde, finanças</p></>
              : ttMode === 'creators'
              ? <><p className="text-sm">Busque por nicho para ver os top criadores</p><p className="text-xs mt-1">Ex: treino, marketing, saúde, finanças</p></>
              : <><p className="text-sm">Digite o @ de uma conta viral do TikTok</p><p className="text-xs mt-1">Ex: @cbum, @khaby.lame</p></>
            }
          </div>
        )}
      </section>}

      {/* ── Instagram Viral ── */}
      {activeTab === 'instagram' && <section className="space-y-3">
        {/* Modo */}
        <div className="flex w-full rounded-lg overflow-hidden border border-border">
          {(['search', 'creators', 'username'] as const).map((m) => (
            <button key={m} onClick={() => { setIgMode(m); setIgResults([]); setIgCreators([]); setIgQuery(''); }}
              className={`flex-1 px-2 py-2 text-xs font-bold text-center transition-all leading-tight ${igMode === m ? 'bg-pink-500 text-white' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>
              {m === 'search' ? '🔍 Palavra-chave' : m === 'creators' ? '🧑‍💻 Criadores' : '🎬 @Username'}
            </button>
          ))}
        </div>

        <form onSubmit={searchInstagram} className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder={igMode === 'search' ? 'Palavra-chave (ex: treino, marketing, saúde)' : igMode === 'creators' ? 'Nicho (ex: treino, finanças, moda)' : '@username (ex: @cbum, @leomessi)'}
              value={igQuery}
              onChange={(e) => setIgQuery(e.target.value)}
              className="w-full bg-secondary border border-border rounded-xl pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10"
            />
          </div>
          <button type="submit" disabled={igLoading}
            className="px-4 py-2 bg-pink-500 text-white rounded-xl text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-opacity">
            {igLoading ? <Loader2 size={16} className="animate-spin" /> : 'Buscar'}
          </button>
        </form>

        {/* Filtros (só no modo de vídeos) */}
        {igMode !== 'creators' && <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <input type="number" placeholder="Mín. curtidas" value={igMinLikes} onChange={(e) => setIgMinLikes(e.target.value)}
            className="w-full bg-secondary border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none" />
          <input type="number" placeholder="Mín. comentários" value={igMinComments} onChange={(e) => setIgMinComments(e.target.value)}
            className="w-full bg-secondary border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none" />
          <select value={igSortBy} onChange={(e) => setIgSortBy(e.target.value as any)}
            className="col-span-2 sm:w-auto bg-secondary border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none">
            <option value="likes">Ordenar: Curtidas</option>
            <option value="comments">Ordenar: Comentários</option>
          </select>
        </div>}

        {igError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">{igError}</div>}

        {igLoading ? (
          <div className="py-8 flex justify-center"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
        ) : igCreators.length > 0 ? (
          <div className="grid gap-2">
            {igCreators.map((c) => (
              <div key={c.username} className="bg-card border border-border rounded-xl p-3 flex items-center gap-3" style={{ boxShadow: 'var(--shadow-card)' }}>
                {c.avatar && <img src={c.avatar} alt={c.nickname} className="w-10 h-10 rounded-full object-cover shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{c.nickname || c.username}{c.is_verified && <span className="ml-1 text-blue-400 text-xs">✓</span>}</p>
                  <p className="text-xs text-muted-foreground">@{c.username}{c.followers > 0 && ` · ${fmtNum(c.followers)} seguidores`}</p>
                </div>
                <button onClick={() => loadIgVideos(c.username)}
                  className="px-3 py-1.5 text-xs font-bold bg-secondary hover:bg-pink-500 hover:text-white rounded-lg transition-all shrink-0">
                  Ver reels
                </button>
                <a href={`https://www.instagram.com/${c.username}`} target="_blank" rel="noreferrer"
                  className="p-1.5 text-muted-foreground hover:text-foreground shrink-0"><ExternalLink size={14} /></a>
              </div>
            ))}
          </div>
        ) : filteredIg.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
            {filteredIg.map((v) => (
              <div key={v.id} className="bg-card border border-border rounded-xl overflow-hidden group" style={{ boxShadow: 'var(--shadow-card)' }}>
                <div className="relative aspect-[9/16] bg-secondary overflow-hidden">
                  {v.cover ? (
                    <img src={v.cover} alt={v.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">Sem capa</div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <a href={v.url} target="_blank" rel="noreferrer"
                      className="p-2 bg-white/20 backdrop-blur rounded-lg text-white hover:bg-white/30">
                      <ExternalLink size={16} />
                    </a>
                    <button onClick={() => saveAsReference(v)}
                      className="p-2 bg-white/20 backdrop-blur rounded-lg text-white hover:bg-white/30" title="Salvar como referência">
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
                <div className="p-2">
                  <p className="text-[11px] font-semibold line-clamp-2 mb-1">{v.title || 'Reel'}</p>
                  <div className="flex gap-3 flex-wrap">
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><Eye size={10} />{fmtNum(v.views)}</div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><Heart size={10} className="text-pink-500" />{fmtNum(v.likes)}</div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><MessageCircle size={10} />{fmtNum(v.comments)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : !igLoading && (
          <div className="py-6 text-center text-muted-foreground">
            <Heart size={24} className="mx-auto mb-2 opacity-30" />
            {igMode === 'search'
              ? <><p className="text-sm">Busque reels virais por palavra-chave</p><p className="text-xs mt-1">Ex: treino, marketing, saúde, finanças</p></>
              : igMode === 'creators'
              ? <><p className="text-sm">Busque por nicho para ver os top criadores</p><p className="text-xs mt-1">Ex: treino, marketing, saúde, finanças</p></>
              : <><p className="text-sm">Digite o @ de um perfil viral do seu nicho</p><p className="text-xs mt-1">Ex: @cbum, @nataliamills, @khabylame</p></>
            }
          </div>
        )}
      </section>}

      {/* ── IA Viral: Descoberta Automática ── */}
      {activeTab === 'ia' && <section className="space-y-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={18} className="text-violet-500" />
            <h3 className="font-bold text-sm uppercase tracking-wider">IA Viral — Roteiro Automático</h3>
          </div>
          <p className="text-xs text-muted-foreground hidden sm:block">
            A IA gera palavras-chave em PT/EN/ES, busca TikTok em 🇧🇷·🇵🇹·🇺🇸·🇲🇽 ordenado por <strong>mais curtidas + último mês</strong> e pontua alinhamento ao Roteiro.
          </p>
        </div>

        <form onSubmit={discoverWithAI} className="flex gap-2">
          <div className="relative flex-1">
            <Sparkles size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-violet-400" />
            <input
              type="text"
              placeholder="Seu nicho (ex: testosterona, hormônios, treino, emagrecimento)"
              value={aiNiche}
              onChange={(e) => setAiNiche(e.target.value)}
              className="w-full bg-secondary border border-border rounded-xl pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            />
          </div>
          <button
            type="submit"
            disabled={aiLoading}
            className="px-4 py-2 bg-violet-600 text-white rounded-xl text-sm font-bold hover:bg-violet-700 disabled:opacity-50 transition-all flex items-center gap-2 whitespace-nowrap"
          >
            {aiLoading ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
            {aiLoading ? 'Descobrindo...' : 'Descobrir'}
          </button>
        </form>

        {aiError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">{aiError}</div>}

        {aiLoading && (
          <div className="p-4 bg-violet-50 border border-violet-200 rounded-2xl text-xs text-violet-700 space-y-1.5">
            <div className="flex items-center gap-2 font-bold"><Loader2 size={14} className="animate-spin" /> IA trabalhando...</div>
            <p>① Gerando palavras-chave PT/EN/ES alinhadas ao Roteiro</p>
            <p>② Buscando TikTok em 🇧🇷·🇵🇹·🇺🇸·🇲🇽 — filtro <strong>mais curtidas + último mês</strong></p>
            <p>③ Buscando criadores Instagram relevantes</p>
            <p>④ Pontuando: formato do Roteiro + alinhamento ao nicho + força do gancho</p>
            <p>⑤ Gerando insight sobre padrão viral atual</p>
          </div>
        )}

        {!aiLoading && aiPlatformStatus && (
          <div className="flex flex-wrap gap-2">
            <div className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full ${aiPlatformStatus.tiktok?.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
              {aiPlatformStatus.tiktok?.ok ? '✓' : '✗'} TikTok {aiPlatformStatus.tiktok?.ok ? `— ${aiPlatformStatus.tiktok.videos_found} vídeos` : '— erro'}
            </div>
            <div className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full ${aiPlatformStatus.instagram?.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>
              {aiPlatformStatus.instagram?.ok ? '✓' : '✗'} Instagram {aiPlatformStatus.instagram?.ok ? `— ${aiPlatformStatus.instagram.creators_found} criadores` : '— erro'}
            </div>
            {aiPlatformStatus.tiktok?.countries?.length > 0 && (
              <div className="text-[11px] text-muted-foreground px-2.5 py-1 bg-secondary rounded-full">
                🌍 {aiPlatformStatus.tiktok.countries.join(' · ')}
              </div>
            )}
          </div>
        )}
        {!aiLoading && aiPlatformErrors.map((e) => (
          <div key={e.platform} className="p-2.5 bg-orange-50 border border-orange-200 rounded-lg text-[11px] text-orange-700">
            ⚠️ <strong>{e.platform}</strong>: {e.error}
          </div>
        ))}

        {!aiLoading && (aiKeywords.pt.length > 0 || aiKeywords.en.length > 0) && (
          <div className="p-3 bg-secondary rounded-xl space-y-2">
            <span className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wide">Palavras-chave geradas pela IA</span>
            <div className="flex flex-wrap gap-1.5">
              {aiKeywords.pt.map((kw) => <span key={kw} className="text-[11px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">🇧🇷 {kw}</span>)}
              {aiKeywords.en.map((kw) => <span key={kw} className="text-[11px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">🇺🇸 {kw}</span>)}
              {aiKeywords.es.map((kw) => <span key={kw} className="text-[11px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">🇲🇽 {kw}</span>)}
            </div>
          </div>
        )}

        {!aiLoading && aiInsights && (
          <div className="p-4 bg-violet-50 border border-violet-200 rounded-2xl space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-bold text-violet-700"><Sparkles size={13} /> Padrão Viral do Momento</div>
            <p className="text-xs text-violet-800 leading-relaxed whitespace-pre-line">{aiInsights}</p>
          </div>
        )}

        {!aiLoading && aiCreators.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-pink-600 uppercase tracking-wide"><Heart size={13} /> Criadores Instagram</div>
            <div className="grid gap-2">
              {aiCreators.map((c) => (
                <div key={c.username} className="bg-card border border-border rounded-xl p-3 flex items-center gap-3">
                  {c.avatar && <img src={c.avatar} alt={c.nickname} className="w-9 h-9 rounded-full object-cover shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{c.nickname}{c.is_verified && ' ✓'}</p>
                    <p className="text-xs text-muted-foreground">@{c.username} · {fmtNum(c.followers)} seguidores</p>
                  </div>
                  <a href={`https://www.instagram.com/${c.username}`} target="_blank" rel="noreferrer"
                    className="p-1.5 text-muted-foreground hover:text-pink-500"><ExternalLink size={14} /></a>
                </div>
              ))}
            </div>
          </div>
        )}

        {!aiLoading && aiResults.length > 0 && (() => {
          const RF: Record<string, string> = {
            lista: '📋 Lista', revelacao: '💡 Revelação', antes_depois: '↔️ Antes/Depois',
            medo: '😨 Medo', curiosidade: '🤔 Curiosidade', prova_social: '✅ Prova Social',
            tutorial: '🎓 Tutorial', outro: '📌 Outro',
          };
          const FLAG: Record<string, string> = { br: '🇧🇷', pt: '🇵🇹', us: '🇺🇸', mx: '🇲🇽', ar: '🇦🇷' };
          return (
            <div className="space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-1">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide"><TrendingUp size={13} /> {aiResults.length} vídeos ranqueados</div>
                <span className="text-[11px] text-muted-foreground">viral score + curtidas + views</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
                {aiResults.map((v) => {
                  const sc = v.viral_score >= 8 ? 'bg-emerald-500' : v.viral_score >= 6 ? 'bg-yellow-500' : 'bg-gray-400';
                  const nc = v.niche_fit >= 8 ? 'text-emerald-600' : v.niche_fit >= 6 ? 'text-yellow-600' : 'text-gray-400';
                  return (
                    <div key={v.id} className="bg-card border border-border rounded-xl overflow-hidden group relative" style={{ boxShadow: 'var(--shadow-card)' }}>
                      <div className={`absolute top-2 left-2 z-10 ${sc} text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5`}>
                        <Zap size={9} /> {v.viral_score}/10
                      </div>
                      <div className="absolute top-2 right-2 z-10 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                        {FLAG[v.region] || v.region}
                      </div>
                      <div className="relative aspect-[9/16] bg-secondary overflow-hidden">
                        {v.cover
                          ? <img src={v.cover} alt={v.title} className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">Sem capa</div>}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          <a href={v.url} target="_blank" rel="noreferrer" className="p-2 bg-white/20 backdrop-blur rounded-lg text-white hover:bg-white/30"><ExternalLink size={16} /></a>
                          <button onClick={() => saveAsReference(v)} className="p-2 bg-white/20 backdrop-blur rounded-lg text-white hover:bg-white/30"><Plus size={16} /></button>
                        </div>
                      </div>
                      <div className="p-2 space-y-1.5">
                        <p className="text-[11px] font-semibold line-clamp-2">{v.title || `@${v.author_handle}`}</p>
                        <p className="text-[10px] text-muted-foreground">@{v.author_handle}</p>
                        <span className="inline-block text-[10px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full font-medium">{RF[v.roteiro_format] || v.roteiro_format}</span>
                        <div className="flex gap-2 text-[10px]">
                          <span className={`font-bold ${nc}`}>nicho {v.niche_fit}/10</span>
                          <span className="text-muted-foreground">gancho {v.gancho_score}/10</span>
                        </div>
                        {v.ai_why && <p className="text-[10px] text-muted-foreground italic line-clamp-2">"{v.ai_why}"</p>}
                        <div className="grid grid-cols-2 gap-1">
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><Eye size={10} />{fmtNum(v.views)}</div>
                          <div className="flex items-center gap-1 text-[10px] font-semibold text-rose-500"><Heart size={10} />{fmtNum(v.likes)}</div>
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><MessageCircle size={10} />{fmtNum(v.comments)}</div>
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><Share2 size={10} />{fmtNum(v.shares)}</div>
                        </div>
                        <span className="inline-block text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-full">#{v.keyword}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {!aiLoading && aiResults.length === 0 && !aiPlatformStatus && (
          <div className="py-12 text-center text-muted-foreground">
            <Sparkles size={32} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">IA pronta para trabalhar</p>
            <p className="text-xs mt-1 max-w-xs mx-auto">Descreva seu nicho e clique em Descobrir. A IA busca em PT/EN/ES, ranqueia por curtidas + views e aponta formatos do Roteiro que estão viralizando.</p>
          </div>
        )}
      </section>}

      {/* ── Referências Virais ── */}
      {activeTab === 'referencias' && <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link2 size={18} className="text-blue-500" />
            <h3 className="font-bold text-sm uppercase tracking-wider">Referências Virais</h3>
            <span className="text-[11px] bg-secondary text-muted-foreground px-2 py-0.5 rounded-full">{references.length}</span>
          </div>
          <button
            onClick={() => setAddRefOpen(true)}
            className="flex items-center gap-1 px-3 py-1.5 bg-foreground text-background rounded-lg text-xs font-bold hover:opacity-90 transition-opacity"
          >
            <Plus size={13} /> Adicionar
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar referências..."
            value={refFilter}
            onChange={(e) => setRefFilter(e.target.value)}
            className="w-full bg-secondary border border-border rounded-xl pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10"
          />
        </div>

        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
        ) : filteredRefs.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <Link2 size={24} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">Nenhuma referência salva</p>
            <p className="text-xs mt-1">Salve links de vídeos que viralizaram para estudar depois</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredRefs.map((ref) => (
              <ReferenceCard key={ref.id} ref_={ref} onDelete={deleteRef} />
            ))}
          </div>
        )}
      </section>}

      {/* ── Hook Templates ── */}
      {activeTab === 'hooks' && <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lightbulb size={18} className="text-orange-500" />
            <h3 className="font-bold text-sm uppercase tracking-wider">Templates de Hook</h3>
            <span className="text-[11px] bg-secondary text-muted-foreground px-2 py-0.5 rounded-full">{hooks.length}</span>
          </div>
          <button
            onClick={() => setAddHookOpen(true)}
            className="flex items-center gap-1 px-3 py-1.5 bg-foreground text-background rounded-lg text-xs font-bold hover:opacity-90 transition-opacity"
          >
            <Plus size={13} /> Adicionar
          </button>
        </div>

        {/* Category filter */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setHookCatFilter('all')}
            className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all ${hookCatFilter === 'all' ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
          >
            Todos
          </button>
          {HOOK_CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setHookCatFilter(cat.value)}
              className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all ${hookCatFilter === cat.value ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid gap-2">
            {filteredHooks.map((hook) => (
              <HookCard
                key={hook.id}
                hook={hook}
                copied={copiedId === hook.id}
                onCopy={copyHook}
                onDelete={deleteHook}
              />
            ))}
          </div>
        )}
      </section>}

      {/* ── Ideias de Conteúdo ── */}
      {activeTab === 'ideias' && <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen size={18} className="text-emerald-500" />
            <h3 className="font-bold text-sm uppercase tracking-wider">Ideias de Conteúdo</h3>
            <span className="text-[11px] bg-secondary text-muted-foreground px-2 py-0.5 rounded-full">{ideas.length}</span>
          </div>
          <button
            onClick={() => setAddIdeaOpen(true)}
            className="flex items-center gap-1 px-3 py-1.5 bg-foreground text-background rounded-lg text-xs font-bold hover:opacity-90 transition-opacity"
          >
            <Plus size={13} /> Adicionar
          </button>
        </div>

        {/* Status filter */}
        <div className="flex gap-2">
          {[
            { value: 'all', label: 'Todas' },
            { value: 'idea', label: '💡 Ideia' },
            { value: 'in_progress', label: '🎬 Produzindo' },
            { value: 'done', label: '✅ Feito' },
          ].map((f) => (
            <button
              key={f.value}
              onClick={() => setIdeaStatusFilter(f.value)}
              className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all ${
                ideaStatusFilter === f.value ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
        ) : filteredIdeas.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <BookOpen size={24} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">Nenhuma ideia ainda</p>
            <p className="text-xs mt-1">Registre suas ideias de vídeo antes de esquecer</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {filteredIdeas.map((idea) => (
              <IdeaCard key={idea.id} idea={idea} onDelete={deleteIdea} onStatusChange={updateIdeaStatus} />
            ))}
          </div>
        )}
      </section>}

      {/* Modais */}
      {addRefOpen && (
        <AddReferenceModal
          onClose={() => setAddRefOpen(false)}
          onSuccess={(item) => { setReferences((p) => [item, ...p]); setAddRefOpen(false); }}
        />
      )}
      {addHookOpen && (
        <AddHookModal
          onClose={() => setAddHookOpen(false)}
          onSuccess={(item) => { setHooks((p) => [item, ...p]); setAddHookOpen(false); }}
        />
      )}
      {addIdeaOpen && (
        <AddIdeaModal
          onClose={() => setAddIdeaOpen(false)}
          onSuccess={(item) => { setIdeas((p) => [item, ...p]); setAddIdeaOpen(false); }}
        />
      )}
    </div>
  );
}

// ── Cards ─────────────────────────────────────────────────────────────────────
function ReferenceCard({ ref_: r, onDelete }: { ref_: ViralReference; onDelete: (id: string) => void }) {
  const tags = parseTagsSafe(r.tags);
  return (
    <div className="bg-card rounded-xl p-4 border border-border group" style={{ boxShadow: 'var(--shadow-card)' }}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {r.platform !== 'other' && (
              <span className="text-[10px] font-bold px-2 py-0.5 bg-secondary rounded-full uppercase text-muted-foreground">
                {r.platform}
              </span>
            )}
            {r.format && (
              <span className="text-[10px] font-bold px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">
                {FORMAT_OPTIONS.find((f) => f.value === r.format)?.label || r.format}
              </span>
            )}
          </div>
          {r.title && <p className="text-sm font-semibold mb-1">{r.title}</p>}
          <a
            href={r.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 truncate"
          >
            <ExternalLink size={11} />
            <span className="truncate">{r.url}</span>
          </a>
          {r.hook && (
            <div className="mt-2 p-2 bg-secondary rounded-lg">
              <p className="text-[11px] font-bold text-muted-foreground mb-0.5">GANCHO</p>
              <p className="text-xs">{r.hook}</p>
            </div>
          )}
          {r.notes && <p className="text-xs text-muted-foreground mt-2">{r.notes}</p>}
          {tags.length > 0 && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {tags.map((tag, i) => (
                <span key={i} className="text-[10px] bg-secondary px-1.5 py-0.5 rounded text-muted-foreground">#{tag}</span>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => onDelete(r.id)}
          className="p-1.5 rounded-lg hover:bg-secondary opacity-0 group-hover:opacity-100 transition-all text-muted-foreground hover:text-red-500 shrink-0"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function HookCard({ hook, copied, onCopy, onDelete }: {
  hook: HookTemplate;
  copied: boolean;
  onCopy: (h: HookTemplate) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="bg-card rounded-xl p-4 border border-border group flex items-start gap-3" style={{ boxShadow: 'var(--shadow-card)' }}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getCategoryStyle(hook.category)}`}>
            {HOOK_CATEGORIES.find((c) => c.value === hook.category)?.label || hook.category}
          </span>
          {hook.use_count > 0 && (
            <span className="text-[10px] text-muted-foreground">usado {hook.use_count}x</span>
          )}
        </div>
        <p className="text-sm font-medium leading-relaxed">{hook.text}</p>
      </div>
      <div className="flex gap-1 shrink-0">
        <button
          onClick={() => onCopy(hook)}
          className={`p-1.5 rounded-lg transition-all ${
            copied ? 'bg-emerald-100 text-emerald-600' : 'hover:bg-secondary text-muted-foreground hover:text-foreground'
          }`}
          title="Copiar"
        >
          {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
        </button>
        <button
          onClick={() => onDelete(hook.id)}
          className="p-1.5 rounded-lg hover:bg-secondary opacity-0 group-hover:opacity-100 transition-all text-muted-foreground hover:text-red-500"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function IdeaCard({ idea, onDelete, onStatusChange }: {
  idea: ContentIdea;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: ContentIdea['status']) => void;
}) {
  const tags = parseTagsSafe(idea.tags);
  const statusEmoji = { idea: '💡', in_progress: '🎬', done: '✅' }[idea.status];
  const nextStatus: Record<ContentIdea['status'], ContentIdea['status']> = {
    idea: 'in_progress', in_progress: 'done', done: 'idea',
  };

  return (
    <div className="bg-card rounded-xl p-4 border border-border group" style={{ boxShadow: 'var(--shadow-card)' }}>
      <div className="flex items-start gap-3">
        <button
          onClick={() => onStatusChange(idea.id, nextStatus[idea.status])}
          className="text-lg mt-0.5 shrink-0 hover:scale-110 transition-transform"
          title="Avançar status"
        >
          {statusEmoji}
        </button>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${idea.status === 'done' ? 'line-through text-muted-foreground' : ''}`}>
            {idea.title}
          </p>
          {idea.body && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{idea.body}</p>}
          {tags.length > 0 && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {tags.map((tag, i) => (
                <span key={i} className="text-[10px] bg-secondary px-1.5 py-0.5 rounded text-muted-foreground">#{tag}</span>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => onDelete(idea.id)}
          className="p-1.5 rounded-lg hover:bg-secondary opacity-0 group-hover:opacity-100 transition-all text-muted-foreground hover:text-red-500 shrink-0"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Modais de adição ──────────────────────────────────────────────────────────
function AddReferenceModal({ onClose, onSuccess }: {
  onClose: () => void;
  onSuccess: (item: ViralReference) => void;
}) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [platform, setPlatform] = useState('other');
  const [format, setFormat] = useState('');
  const [hook, setHook] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setSaving(true);
    try {
      const item = await api.post<ViralReference>('/api/research/references', {
        url: url.trim(), title: title.trim(), platform, format, hook: hook.trim(),
        notes: notes.trim(),
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      onSuccess(item);
    } catch { /* silent */ }
    setSaving(false);
  }

  return (
    <ModalWrapper title="📎 Nova Referência Viral" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input required type="url" placeholder="URL do vídeo *" value={url} onChange={(e) => setUrl(e.target.value)}
          className="w-full input-base" />
        <input type="text" placeholder="Título / assunto do vídeo" value={title} onChange={(e) => setTitle(e.target.value)}
          className="w-full input-base" />
        <div className="grid grid-cols-2 gap-2">
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="input-base">
            {PLATFORM_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={format} onChange={(e) => setFormat(e.target.value)} className="input-base">
            <option value="">Formato...</option>
            {FORMAT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <input type="text" placeholder="Gancho usado no vídeo" value={hook} onChange={(e) => setHook(e.target.value)}
          className="w-full input-base" />
        <textarea placeholder="Observações / o que funcionou" value={notes} onChange={(e) => setNotes(e.target.value)}
          rows={3} className="w-full input-base resize-none" />
        <input type="text" placeholder="Tags separadas por vírgula" value={tags} onChange={(e) => setTags(e.target.value)}
          className="w-full input-base" />
        <ModalSubmitBtn loading={saving} label="Salvar Referência" />
      </form>
    </ModalWrapper>
  );
}

function AddHookModal({ onClose, onSuccess }: {
  onClose: () => void;
  onSuccess: (item: HookTemplate) => void;
}) {
  const [text, setText] = useState('');
  const [category, setCategory] = useState('curiosity');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSaving(true);
    try {
      const item = await api.post<HookTemplate>('/api/research/hooks', { text: text.trim(), category });
      onSuccess(item);
    } catch { /* silent */ }
    setSaving(false);
  }

  return (
    <ModalWrapper title="💡 Novo Template de Hook" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-xs text-muted-foreground">Use {'{variável}'} para indicar partes que você vai personalizar</p>
        <textarea required placeholder="Ex: 3 sinais que sua {tema} está em colapso..." value={text}
          onChange={(e) => setText(e.target.value)} rows={4} className="w-full input-base resize-none" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full input-base">
          {HOOK_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <ModalSubmitBtn loading={saving} label="Salvar Hook" />
      </form>
    </ModalWrapper>
  );
}

function AddIdeaModal({ onClose, onSuccess }: {
  onClose: () => void;
  onSuccess: (item: ContentIdea) => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const item = await api.post<ContentIdea>('/api/research/ideas', {
        title: title.trim(), body: body.trim(),
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      onSuccess(item);
    } catch { /* silent */ }
    setSaving(false);
  }

  return (
    <ModalWrapper title="📓 Nova Ideia de Conteúdo" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input required type="text" placeholder="Título da ideia *" value={title} onChange={(e) => setTitle(e.target.value)}
          className="w-full input-base" />
        <textarea placeholder="Descreva a ideia, o gancho, o roteiro..." value={body}
          onChange={(e) => setBody(e.target.value)} rows={4} className="w-full input-base resize-none" />
        <input type="text" placeholder="Tags: testosterona, trt, gancho..." value={tags}
          onChange={(e) => setTags(e.target.value)} className="w-full input-base" />
        <ModalSubmitBtn loading={saving} label="Salvar Ideia" />
      </form>
    </ModalWrapper>
  );
}

// ── Componentes utilitários ───────────────────────────────────────────────────
function ModalWrapper({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-4">
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-background rounded-2xl p-6 w-full max-w-md"
        style={{ boxShadow: 'var(--shadow-layered)' }}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-base">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-secondary"><X size={18} /></button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

function ModalSubmitBtn({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full py-2.5 bg-foreground text-background rounded-xl text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2"
    >
      {loading ? <><Loader2 size={16} className="animate-spin" /> Salvando...</> : label}
    </button>
  );
}
