import React, { useState, useEffect } from 'react';
import {
  Search, Plus, Trash2, Copy, CheckCircle2, X, ExternalLink,
  Loader2, Lightbulb, Link2, BookOpen, TrendingUp, Eye, Heart,
  MessageCircle, Share2, Flame,
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

  async function loadTrending() {
    setViralLoading(true);
    setViralError('');
    try {
      const data = await api.get<ViralVideo[]>('/api/research/trending');
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
      const data = await api.get<ViralVideo[]>(`/api/research/viral?q=${encodeURIComponent(viralQuery)}`);
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

  const filteredRefs = references.filter((r) =>
    !refFilter || r.title?.toLowerCase().includes(refFilter.toLowerCase()) ||
    r.url?.toLowerCase().includes(refFilter.toLowerCase()) ||
    r.notes?.toLowerCase().includes(refFilter.toLowerCase())
  );

  const filteredHooks = hookCatFilter === 'all' ? hooks : hooks.filter((h) => h.category === hookCatFilter);
  const filteredIdeas = ideaStatusFilter === 'all' ? ideas : ideas.filter((i) => i.status === ideaStatusFilter);

  return (
    <div className="space-y-8">
      {/* Header */}
      <section>
        <h2 className="text-2xl font-extrabold tracking-tight mb-1">🔍 Pesquisa de Conteúdo</h2>
        <p className="text-muted-foreground text-sm">
          Salve referências virais, organize hooks e desenvolva ideias de conteúdo
        </p>
      </section>

      {!backendOk && !loading && (
        <div className="p-4 bg-orange-50 border border-orange-200 rounded-2xl text-xs text-orange-700">
          <strong>Servidor offline</strong> — os dados serão carregados quando o servidor estiver rodando.
          Inicie com <code className="bg-orange-100 px-1 rounded">cd server && npm run dev</code>
        </div>
      )}

      {/* ── Busca Viral TikTok ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Flame size={18} className="text-red-500" />
          <h3 className="font-bold text-sm uppercase tracking-wider">Busca Viral TikTok</h3>
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

        {viralError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">{viralError}</div>
        )}

        {viralLoading ? (
          <div className="py-8 flex justify-center"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
        ) : viralResults.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {viralResults.map((v) => (
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
        ) : !viralLoading && (
          <div className="py-6 text-center text-muted-foreground">
            <Flame size={24} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">Busque por palavras-chave para encontrar vídeos virais</p>
          </div>
        )}
      </section>

      <div className="h-px bg-border" />

      {/* ── Referências Virais ── */}
      <section className="space-y-3">
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
      </section>

      <div className="h-px bg-border" />

      {/* ── Hook Templates ── */}
      <section className="space-y-3">
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
      </section>

      <div className="h-px bg-border" />

      {/* ── Ideias de Conteúdo ── */}
      <section className="space-y-3">
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
      </section>

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
