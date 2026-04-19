import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Instagram, RefreshCw, Loader2, Zap, TrendingUp, BarChart3,
  Video, Image, Layers, AlertCircle, CheckCircle2, ExternalLink,
  Sparkles, ArrowRight,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface Props {
  onCreateReels: (idea: { title: string; hook: string }) => void;
  onCreateCarousel?: (topic: string, instructions: string) => void;
  onCreateScript?: (script: string, topic: string) => void;
}

interface IGStatus {
  connected: boolean;
  username?: string;
  profilePicture?: string;
  followersCount?: number;
  daysLeft?: number;
  lastSync?: string;
}

interface IGPost {
  id: string;
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'REELS';
  thumbnailUrl: string;
  permalink: string;
  timestamp: string;
  caption: string;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  views: number;
  reach: number;
  follows: number;
  engagementRate: number;
  saveRate: number;
  reelCandidateScore: number;
}

interface AIInsights {
  summary: string;
  topFormat: string;
  topFormatReason: string;
  patterns: { title: string; description: string; impact: 'alto' | 'médio' | 'baixo' }[];
  bestPostingInsight: string;
  reelsOpportunity?: string;
  actionPriority: { action: string; why: string; urgency: 'alta' | 'média' | 'baixa' }[];
  hookPattern: string;
}

interface Analysis {
  aiInsights: AIInsights;
  signals: {
    reelCandidates: IGPost[];
    redoCandidates: IGPost[];
  };
  stats: {
    totalPosts: number;
    avgEngagement: number;
    reelsCount: number;
    carouselsCount: number;
    imagesCount: number;
    avgReelsEng: number;
    avgCarouselEng: number;
  };
  generatedAt: string;
}

function engColor(rate: number) {
  if (rate >= 3) return 'text-green-400';
  if (rate >= 1) return 'text-yellow-400';
  return 'text-red-400';
}

function engBg(rate: number) {
  if (rate >= 3) return 'bg-green-500';
  if (rate >= 1) return 'bg-yellow-500';
  return 'bg-red-500';
}

function impactBadge(impact: 'alto' | 'médio' | 'baixo') {
  const map = {
    alto: 'bg-green-500/20 text-green-400 border border-green-500/30',
    médio: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
    baixo: 'bg-secondary text-muted-foreground border border-border',
  };
  return map[impact];
}

function urgencyBadge(urgency: 'alta' | 'média' | 'baixa') {
  const map = {
    alta: 'bg-red-500/20 text-red-400 border border-red-500/30',
    média: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
    baixa: 'bg-secondary text-muted-foreground border border-border',
  };
  return map[urgency];
}

function mediaIcon(type: IGPost['mediaType']) {
  if (type === 'REELS' || type === 'VIDEO') return <Video size={12} />;
  if (type === 'CAROUSEL_ALBUM') return <Layers size={12} />;
  return <Image size={12} />;
}

function mediaLabel(type: IGPost['mediaType']) {
  if (type === 'REELS') return 'Reels';
  if (type === 'VIDEO') return 'Vídeo';
  if (type === 'CAROUSEL_ALBUM') return 'Carrossel';
  return 'Imagem';
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function formatFollowers(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const SetupStep = ({ num, text }: { num: number; text: React.ReactNode }) => (
  <div className="flex gap-3 items-start">
    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-foreground text-xs font-bold flex items-center justify-center">
      {num}
    </span>
    <p className="text-sm text-muted-foreground leading-relaxed">{text}</p>
  </div>
);

const StatCard = ({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
}) => (
  <div className="bg-card border border-border rounded-xl p-4 flex gap-3 items-start">
    <div className="p-2 bg-secondary rounded-lg text-purple-400">{icon}</div>
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-lg font-bold text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  </div>
);

const PostCard = ({
  post,
  onCreateReels,
  btnLabel,
  btnEmoji,
}: {
  post: IGPost;
  onCreateReels: Props['onCreateReels'];
  btnLabel: string;
  btnEmoji: string;
}) => (
  <div className="bg-card border border-border rounded-xl overflow-hidden flex flex-col">
    <div className="relative aspect-square bg-secondary">
      {post.thumbnailUrl ? (
        <img
          src={post.thumbnailUrl}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
          <Image size={32} />
        </div>
      )}
      <span className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-black/70 text-foreground">
        {mediaIcon(post.mediaType)}
        {mediaLabel(post.mediaType)}
      </span>
    </div>
    <div className="p-3 flex flex-col gap-2 flex-1">
      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
        {post.caption || '(sem legenda)'}
      </p>
      <div className="flex gap-3 text-xs">
        <span className={`font-semibold ${engColor(post.engagementRate)}`}>
          {post.engagementRate.toFixed(1)}% eng
        </span>
        <span className="text-muted-foreground">{post.saves} saves</span>
      </div>
      <button
        onClick={() =>
          onCreateReels({
            title: post.caption.substring(0, 60) || 'Sem título',
            hook: post.caption.substring(0, 120) || '',
          })
        }
        className="mt-auto w-full py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-foreground text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
      >
        <span>{btnEmoji}</span> {btnLabel}
      </button>
    </div>
  </div>
);

export default function InstagramAnalytics({ onCreateReels, onCreateCarousel, onCreateScript }: Props) {
  const [status, setStatus] = useState<IGStatus | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [posts, setPosts] = useState<IGPost[]>([]);

  const [checkedActions, setCheckedActions] = useState<Record<number, boolean>>({});

  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingConnect, setLoadingConnect] = useState(false);
  const [loadingSync, setLoadingSync] = useState(false);
  const [loadingAnalyze, setLoadingAnalyze] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const res = await fetch(`${API}/api/instagram/status`);
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({ connected: false });
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  const fetchAnalysis = useCallback(async () => {
    setLoadingAnalysis(true);
    try {
      const res = await fetch(`${API}/api/instagram/analysis`);
      if (res.ok) {
        const data = await res.json();
        setAnalysis(data);
      }
    } catch {
      // no saved analysis yet
    } finally {
      setLoadingAnalysis(false);
    }
  }, []);

  const fetchPosts = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/instagram/posts`);
      if (res.ok) {
        const data = await res.json();
        setPosts(Array.isArray(data) ? data : []);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchAnalysis();
    fetchPosts();
  }, [fetchStatus, fetchAnalysis, fetchPosts]);

  async function handleConnect() {
    setLoadingConnect(true);
    try {
      const res = await fetch(`${API}/api/instagram/connect-url`);
      const data = await res.json();
      if (data.url) {
        window.open(data.url, '_blank');
      } else {
        toast.error('Não foi possível obter o link de conexão.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao buscar URL de conexão.');
    } finally {
      setLoadingConnect(false);
    }
  }

  async function handleSync() {
    setLoadingSync(true);
    try {
      const res = await fetch(`${API}/api/instagram/sync`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        toast.success(`${data.count} posts sincronizados!`);
        await fetchPosts();
        await fetchStatus();
      } else {
        toast.error(data.error || 'Sincronização falhou.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao sincronizar.');
    } finally {
      setLoadingSync(false);
    }
  }

  async function handleAnalyze() {
    setLoadingAnalyze(true);
    try {
      const res = await fetch(`${API}/api/instagram/analyze`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao analisar com IA.');
      setAnalysis(data);
      toast.success('Análise IA concluída!');
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao analisar com IA.');
    } finally {
      setLoadingAnalyze(false);
    }
  }

  async function handleDisconnect() {
    try {
      await fetch(`${API}/api/instagram/disconnect`, { method: 'DELETE' });
      setStatus({ connected: false });
      setAnalysis(null);
      setPosts([]);
      toast.success('Instagram desconectado.');
    } catch {
      toast.error('Erro ao desconectar.');
    }
  }

  type SortKey = 'engagement' | 'likes' | 'follows' | 'saves' | 'views' | 'comments' | 'recent';
  const [postSort, setPostSort] = useState<SortKey>('engagement');

  const sortFns: Record<SortKey, (a: IGPost, b: IGPost) => number> = {
    engagement: (a, b) => b.engagementRate - a.engagementRate,
    likes:      (a, b) => b.likes - a.likes,
    follows:    (a, b) => (b.follows || 0) - (a.follows || 0),
    saves:      (a, b) => b.saves - a.saves,
    views:      (a, b) => b.views - a.views,
    comments:   (a, b) => b.comments - a.comments,
    recent:     (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  };

  const sortedPosts = [...posts].sort(sortFns[postSort]);
  const maxEng = sortedPosts[0]?.engagementRate || 1;

  if (loadingStatus) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 size={28} className="animate-spin mr-2" />
        Carregando...
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Instagram size={22} className="text-pink-500" />
        <h2 className="text-xl font-bold text-foreground">Instagram Analytics</h2>
      </div>

      {/* ── Conexão ── */}
      {!status?.connected ? (
        <div className="bg-card border border-border rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-2 text-amber-400">
            <AlertCircle size={18} />
            <span className="font-semibold">Conta não conectada</span>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-semibold text-foreground">Como configurar:</p>
            <div className="space-y-3 pl-1">
              <SetupStep
                num={1}
                text={
                  <>
                    Acesse{' '}
                    <a
                      href="https://developers.facebook.com"
                      target="_blank"
                      rel="noreferrer"
                      className="text-purple-400 underline inline-flex items-center gap-0.5"
                    >
                      developers.facebook.com <ExternalLink size={11} />
                    </a>{' '}
                    → Criar App → Consumer
                  </>
                }
              />
              <SetupStep num={2} text='Adicione o produto "Instagram Graph API" ao seu app' />
              <SetupStep
                num={3}
                text="Em Configurações → Básico, copie o App ID e o App Secret"
              />
              <SetupStep
                num={4}
                text={
                  <>
                    No Railway, adicione as variáveis{' '}
                    <code className="bg-secondary px-1 py-0.5 rounded text-xs text-purple-300">
                      FACEBOOK_APP_ID
                    </code>{' '}
                    e{' '}
                    <code className="bg-secondary px-1 py-0.5 rounded text-xs text-purple-300">
                      FACEBOOK_APP_SECRET
                    </code>
                  </>
                }
              />
              <SetupStep
                num={5}
                text={
                  <>
                    No App, adicione{' '}
                    <code className="bg-secondary px-1 py-0.5 rounded text-xs text-purple-300 break-all">
                      https://vira-los-production.up.railway.app/api/instagram/callback
                    </code>{' '}
                    como Redirect URI válido
                  </>
                }
              />
              <SetupStep num={6} text='Clique em "Conectar Instagram" abaixo' />
            </div>
          </div>

          <button
            onClick={handleConnect}
            disabled={loadingConnect}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-foreground font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-60"
          >
            {loadingConnect ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Instagram size={18} />
            )}
            Conectar Instagram
          </button>
        </div>
      ) : (
        /* ── Conta conectada ── */
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              {status.profilePicture ? (
                <img
                  src={status.profilePicture}
                  alt={status.username}
                  className="w-12 h-12 rounded-full object-cover border-2 border-purple-500"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center">
                  <Instagram size={22} className="text-pink-500" />
                </div>
              )}
              <div>
                <p className="font-semibold text-foreground">@{status.username}</p>
                <p className="text-sm text-muted-foreground">
                  {status.followersCount !== undefined
                    ? `${formatFollowers(status.followersCount)} seguidores`
                    : ''}
                  {status.daysLeft !== undefined && (
                    <span
                      className={`ml-2 text-xs px-1.5 py-0.5 rounded font-medium ${
                        status.daysLeft === 0
                          ? 'bg-red-500/30 text-red-300'
                          : status.daysLeft < 7
                          ? 'bg-orange-500/20 text-orange-400'
                          : 'bg-green-500/20 text-green-400'
                      }`}
                    >
                      {status.daysLeft === 0 ? '⚠ token expirado' : `token: ${status.daysLeft}d`}
                    </span>
                  )}
                </p>
                {status.lastSync && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Último sync: {formatDate(status.lastSync)}
                  </p>
                )}
              </div>
            </div>

            {status.daysLeft === 0 && (
              <div className="w-full mt-2 px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
                <AlertCircle size={13} className="shrink-0" />
                Token expirado. Desconecte e reconecte para sincronizar novamente.
              </div>
            )}
            {status.daysLeft !== undefined && status.daysLeft > 0 && status.daysLeft <= 7 && (
              <div className="w-full mt-2 px-3 py-2 rounded-lg bg-orange-500/15 border border-orange-500/30 text-orange-300 text-xs flex items-center gap-2">
                <AlertCircle size={13} className="shrink-0" />
                Token expira em {status.daysLeft} dia{status.daysLeft !== 1 ? 's' : ''}. Reconecte em breve para não perder o acesso.
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleSync}
                disabled={loadingSync || status.daysLeft === 0}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary text-foreground text-sm font-medium transition-colors disabled:opacity-60"
              >
                {loadingSync ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                Sincronizar
              </button>
              <button
                onClick={handleAnalyze}
                disabled={loadingAnalyze}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-foreground text-sm font-medium transition-colors disabled:opacity-60"
              >
                {loadingAnalyze ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Sparkles size={14} />
                )}
                Analisar com IA
              </button>
              <button
                onClick={handleDisconnect}
                className="text-xs text-muted-foreground hover:text-red-400 transition-colors px-2 py-2"
              >
                Desconectar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Stats Cards ── */}
      {analysis && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Eng. médio"
            value={`${analysis.stats.avgEngagement.toFixed(2)}%`}
            icon={<TrendingUp size={16} />}
          />
          <StatCard
            label="Melhor formato"
            value={analysis.aiInsights.topFormat}
            sub={analysis.aiInsights.topFormatReason.substring(0, 40) + '…'}
            icon={<BarChart3 size={16} />}
          />
          <StatCard
            label="Posts analisados"
            value={String(analysis.stats.totalPosts)}
            sub={`${analysis.stats.reelsCount} reels · ${analysis.stats.carouselsCount} carrosseis`}
            icon={<Zap size={16} />}
          />
          <StatCard
            label="Saves médios"
            value={`${(
              (posts.reduce((s, p) => s + p.saves, 0) / (posts.length || 1))
            ).toFixed(0)}`}
            icon={<CheckCircle2 size={16} />}
          />
        </div>
      )}

      {/* ── Comparativo antes/depois ── */}
      {analysis && (() => {
        const prevRaw = localStorage.getItem('ig_prev_analysis');
        const prev = prevRaw ? JSON.parse(prevRaw) : null;
        const current = {
          date: analysis.generatedAt,
          avgEng: analysis.stats.avgEngagement,
          avgSaves: posts.length ? posts.reduce((s, p) => s + p.saves, 0) / posts.length : 0,
          avgShares: posts.length ? posts.reduce((s, p) => s + (p.shares || 0), 0) / posts.length : 0,
        };

        // Salva análise atual como "anterior" para próxima comparação
        if (!prev || prev.date !== current.date) {
          if (prev) localStorage.setItem('ig_prev_analysis', JSON.stringify(current));
          else localStorage.setItem('ig_prev_analysis', JSON.stringify(current));
        }

        if (prev && prev.date !== current.date) {
          const diff = (curr: number, old: number) => {
            const d = curr - old;
            return d > 0 ? `+${d.toFixed(1)}` : d.toFixed(1);
          };
          return (
            <div className="bg-card border border-border rounded-2xl p-4 space-y-2">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5">
                <TrendingUp size={12} /> Evolução desde última análise
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Engajamento</p>
                  <p className={`text-sm font-bold ${current.avgEng >= prev.avgEng ? 'text-green-500' : 'text-red-500'}`}>
                    {diff(current.avgEng, prev.avgEng)}%
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Saves médio</p>
                  <p className={`text-sm font-bold ${current.avgSaves >= prev.avgSaves ? 'text-green-500' : 'text-red-500'}`}>
                    {diff(current.avgSaves, prev.avgSaves)}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Shares médio</p>
                  <p className={`text-sm font-bold ${current.avgShares >= prev.avgShares ? 'text-green-500' : 'text-red-500'}`}>
                    {diff(current.avgShares, prev.avgShares)}
                  </p>
                </div>
              </div>
            </div>
          );
        }
        return null;
      })()}

      {/* ── IA Insights ── */}
      {loadingAnalysis && !analysis && (
        <div className="flex items-center gap-2 text-muted-foreground py-6 justify-center">
          <Loader2 size={18} className="animate-spin" />
          Carregando análise...
        </div>
      )}

      {analysis?.aiInsights && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-5">
          <div className="flex items-center gap-2 text-purple-400 font-semibold">
            <Sparkles size={16} />
            Insights da IA
          </div>

          <p className="text-sm text-foreground leading-relaxed">{analysis.aiInsights.summary}</p>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-secondary/50 rounded-xl p-4 space-y-1">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                Padrão de Hook
              </p>
              <p className="text-sm text-foreground">{analysis.aiInsights.hookPattern}</p>
            </div>
            <div className="bg-secondary/50 rounded-xl p-4 space-y-1">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                Melhor horário
              </p>
              <p className="text-sm text-foreground">{analysis.aiInsights.bestPostingInsight}</p>
            </div>
            {analysis.aiInsights.reelsOpportunity && (
              <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-4 space-y-1">
                <p className="text-xs text-purple-400 font-medium uppercase tracking-wide flex items-center gap-1.5">
                  <Video size={12} /> Oportunidade de Reels
                </p>
                <p className="text-sm text-foreground">{analysis.aiInsights.reelsOpportunity}</p>
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {onCreateCarousel && (
                    <button
                      onClick={() => onCreateCarousel(
                        'Oportunidade de Reels',
                        analysis.aiInsights.reelsOpportunity || ''
                      )}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition-colors"
                    >
                      <Layers size={11} /> Gerar Carrossel
                    </button>
                  )}
                  {onCreateScript && (
                    <button
                      onClick={() => onCreateScript(
                        analysis.aiInsights.reelsOpportunity || '',
                        'Reels baseado em análise de performance'
                      )}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
                    >
                      <Sparkles size={11} /> Gerar Roteiro
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Padrões */}
          {analysis.aiInsights.patterns.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Padrões</p>
              <div className="space-y-2">
                {analysis.aiInsights.patterns.map((p, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 bg-secondary/40 rounded-lg px-4 py-3"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">{p.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>
                    </div>
                    <span
                      className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${impactBadge(
                        p.impact
                      )}`}
                    >
                      {p.impact}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ações prioritárias — checklist */}
          {analysis.aiInsights.actionPriority.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                  Checklist semanal — {Object.values(checkedActions).filter(Boolean).length}/{analysis.aiInsights.actionPriority.length} feitas
                </p>
                {Object.values(checkedActions).filter(Boolean).length > 0 && (
                  <button
                    onClick={() => setCheckedActions({})}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >Resetar</button>
                )}
              </div>
              <div className="space-y-2">
                {analysis.aiInsights.actionPriority.map((a, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 bg-secondary/40 rounded-lg px-4 py-3"
                  >
                    <button
                      onClick={() => setCheckedActions(prev => ({ ...prev, [i]: !prev[i] }))}
                      className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors mt-0.5 ${
                        checkedActions[i]
                          ? 'bg-green-500 border-green-500 text-white'
                          : 'border-border hover:border-purple-400'
                      }`}
                    >
                      {checkedActions[i] && <CheckCircle2 size={12} />}
                    </button>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">{a.action}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{a.why}</p>
                      <div className="flex gap-1.5 mt-2 flex-wrap">
                        {onCreateCarousel && (
                          <button
                            onClick={() => onCreateCarousel(a.action, a.why)}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 active:bg-purple-500 text-white text-[10px] font-semibold transition-colors"
                          >
                            <Layers size={10} /> Gerar Carrossel
                          </button>
                        )}
                        {onCreateScript && (
                          <button
                            onClick={() => onCreateScript(a.action, a.action)}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-500 text-white text-[10px] font-semibold transition-colors"
                          >
                            <Sparkles size={10} /> Gerar Roteiro
                          </button>
                        )}
                      </div>
                    </div>
                    <span
                      className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${urgencyBadge(
                        a.urgency
                      )}`}
                    >
                      {a.urgency}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Candidatos a Reels ── */}
      {analysis?.signals.reelCandidates?.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Video size={16} className="text-purple-400" />
            <h3 className="font-semibold text-foreground">Converter para Reels</h3>
            <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full">
              {analysis.signals.reelCandidates.length}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {analysis.signals.reelCandidates.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onCreateReels={onCreateReels}
                btnLabel="Criar Reels"
                btnEmoji="🎬"
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Vale refazer ── */}
      {analysis?.signals.redoCandidates?.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <RefreshCw size={16} className="text-amber-400" />
            <h3 className="font-semibold text-foreground">Vale refazer</h3>
            <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">
              {analysis.signals.redoCandidates.length}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {analysis.signals.redoCandidates.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onCreateReels={onCreateReels}
                btnLabel="Refazer"
                btnEmoji="♻️"
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Lista de todos os posts ── */}
      {sortedPosts.length > 0 && (
        {/* CTA Templates */}
        {analysis && (
          <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5">
              <Zap size={12} /> Templates de CTA — copie e use
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { label: 'Save (início)', text: '💾 Salva esse post pra consultar depois — você vai precisar' },
                { label: 'Save (final)', text: '↗️ Salva e manda pra alguém que precisa saber disso' },
                { label: 'Share', text: '📲 Manda pra aquele amigo que vive errando nisso' },
                { label: 'Comentário', text: '💬 Comenta "EU" que te mando o guia completo' },
                { label: 'Save educativo', text: '📌 Guarda esse post — é o tipo de conteúdo que você vai querer rever' },
                { label: 'Share + Save', text: '🔥 Salva pra você + compartilha pra ajudar alguém' },
              ].map((cta, i) => (
                <button
                  key={i}
                  onClick={() => {
                    navigator.clipboard.writeText(cta.text);
                    toast.success('CTA copiado!');
                  }}
                  className="text-left bg-secondary/50 hover:bg-secondary active:bg-secondary rounded-lg px-3 py-2 transition-colors group"
                >
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase">{cta.label}</p>
                  <p className="text-xs text-foreground mt-0.5">{cta.text}</p>
                  <p className="text-[9px] text-purple-400 opacity-0 group-hover:opacity-100 mt-1 transition-opacity">Clique para copiar</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Dica: Score antes de postar */}
        {analysis && (
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle size={16} className="text-blue-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">Antes de postar, use o Viral Score</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                A análise mostrou que seus posts não têm CTA de save/share efetivo. Vá na aba <strong>Avaliar</strong> e cole seu roteiro para verificar se o hook, CTA e emoção estão otimizados antes de publicar.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <BarChart3 size={16} className="text-muted-foreground" />
            <h3 className="font-semibold text-foreground">Todos os posts</h3>
            <span className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded-full">
              {sortedPosts.length}
            </span>
          </div>
          <div className="flex gap-1 flex-wrap">
            {([
              ['engagement', 'Engajamento'],
              ['likes', 'Curtidas'],
              ['follows', 'Seguidores'],
              ['saves', 'Salvos'],
              ['views', 'Views'],
              ['comments', 'Comentários'],
              ['recent', 'Recentes'],
            ] as [SortKey, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setPostSort(key)}
                className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
                  postSort === key
                    ? 'bg-purple-600 text-white'
                    : 'bg-secondary text-muted-foreground hover:bg-border active:bg-border'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sortedPosts.map((post) => {
              const barWidth = Math.max(2, (post.engagementRate / maxEng) * 100);
              return (
                <div
                  key={post.id}
                  className="bg-card border border-border rounded-xl overflow-hidden flex gap-3 p-3"
                >
                  <div className="relative w-16 h-16 flex-shrink-0 rounded-lg overflow-hidden bg-secondary">
                    {post.thumbnailUrl ? (
                      <img
                        src={post.thumbnailUrl}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <Image size={20} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="flex items-center gap-0.5 text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                        {mediaIcon(post.mediaType)}
                        <span className="ml-0.5">{mediaLabel(post.mediaType)}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">{formatDate(post.timestamp)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {post.caption || '(sem legenda)'}
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${engBg(post.engagementRate)}`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                      <span className={`text-xs font-semibold flex-shrink-0 ${engColor(post.engagementRate)}`}>
                        {post.engagementRate.toFixed(1)}%
                      </span>
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {post.saves} saves
                      </span>
                      {post.follows > 0 && (
                        <span className="text-xs text-green-500 font-semibold flex-shrink-0">
                          +{post.follows} seg
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>❤️ {post.likes}</span>
                      <span>💬 {post.comments}</span>
                      <span>👁 {post.views}</span>
                      {post.shares > 0 && <span>↗ {post.shares}</span>}
                    </div>
                  </div>
                  <a
                    href={post.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="self-start text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                  >
                    <ExternalLink size={13} />
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Estado vazio */}
      {status?.connected && posts.length === 0 && !loadingAnalysis && (
        <div className="text-center py-12 text-muted-foreground space-y-2">
          <Instagram size={36} className="mx-auto opacity-30" />
          <p className="text-sm">Nenhum post encontrado. Clique em Sincronizar para buscar.</p>
        </div>
      )}
    </div>
  );
}
