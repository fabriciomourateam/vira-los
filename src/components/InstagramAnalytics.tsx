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
    baixo: 'bg-zinc-700 text-zinc-400 border border-zinc-600',
  };
  return map[impact];
}

function urgencyBadge(urgency: 'alta' | 'média' | 'baixa') {
  const map = {
    alta: 'bg-red-500/20 text-red-400 border border-red-500/30',
    média: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
    baixa: 'bg-zinc-700 text-zinc-400 border border-zinc-600',
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
    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white text-xs font-bold flex items-center justify-center">
      {num}
    </span>
    <p className="text-sm text-zinc-300 leading-relaxed">{text}</p>
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
  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex gap-3 items-start">
    <div className="p-2 bg-zinc-800 rounded-lg text-purple-400">{icon}</div>
    <div>
      <p className="text-xs text-zinc-500 mb-0.5">{label}</p>
      <p className="text-lg font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>}
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
  <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col">
    <div className="relative aspect-square bg-zinc-800">
      {post.thumbnailUrl ? (
        <img
          src={post.thumbnailUrl}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-zinc-600">
          <Image size={32} />
        </div>
      )}
      <span className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-black/70 text-white">
        {mediaIcon(post.mediaType)}
        {mediaLabel(post.mediaType)}
      </span>
    </div>
    <div className="p-3 flex flex-col gap-2 flex-1">
      <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
        {post.caption || '(sem legenda)'}
      </p>
      <div className="flex gap-3 text-xs">
        <span className={`font-semibold ${engColor(post.engagementRate)}`}>
          {post.engagementRate.toFixed(1)}% eng
        </span>
        <span className="text-zinc-500">{post.saves} saves</span>
      </div>
      <button
        onClick={() =>
          onCreateReels({
            title: post.caption.substring(0, 60) || 'Sem título',
            hook: post.caption.substring(0, 120) || '',
          })
        }
        className="mt-auto w-full py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
      >
        <span>{btnEmoji}</span> {btnLabel}
      </button>
    </div>
  </div>
);

export default function InstagramAnalytics({ onCreateReels }: Props) {
  const [status, setStatus] = useState<IGStatus | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [posts, setPosts] = useState<IGPost[]>([]);

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

  const sortedPosts = [...posts].sort((a, b) => b.engagementRate - a.engagementRate);
  const maxEng = sortedPosts[0]?.engagementRate || 1;

  if (loadingStatus) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-500">
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
        <h2 className="text-xl font-bold text-white">Instagram Analytics</h2>
      </div>

      {/* ── Conexão ── */}
      {!status?.connected ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-2 text-amber-400">
            <AlertCircle size={18} />
            <span className="font-semibold">Conta não conectada</span>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-semibold text-zinc-300">Como configurar:</p>
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
                    <code className="bg-zinc-800 px-1 py-0.5 rounded text-xs text-purple-300">
                      FACEBOOK_APP_ID
                    </code>{' '}
                    e{' '}
                    <code className="bg-zinc-800 px-1 py-0.5 rounded text-xs text-purple-300">
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
                    <code className="bg-zinc-800 px-1 py-0.5 rounded text-xs text-purple-300 break-all">
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
            className="w-full py-3 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-60"
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
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              {status.profilePicture ? (
                <img
                  src={status.profilePicture}
                  alt={status.username}
                  className="w-12 h-12 rounded-full object-cover border-2 border-purple-500"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center">
                  <Instagram size={22} className="text-pink-500" />
                </div>
              )}
              <div>
                <p className="font-semibold text-white">@{status.username}</p>
                <p className="text-sm text-zinc-400">
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
                  <p className="text-xs text-zinc-600 mt-0.5">
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
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-medium transition-colors disabled:opacity-60"
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
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors disabled:opacity-60"
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
                className="text-xs text-zinc-600 hover:text-red-400 transition-colors px-2 py-2"
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

      {/* ── IA Insights ── */}
      {loadingAnalysis && !analysis && (
        <div className="flex items-center gap-2 text-zinc-500 py-6 justify-center">
          <Loader2 size={18} className="animate-spin" />
          Carregando análise...
        </div>
      )}

      {analysis?.aiInsights && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-5">
          <div className="flex items-center gap-2 text-purple-400 font-semibold">
            <Sparkles size={16} />
            Insights da IA
          </div>

          <p className="text-sm text-zinc-300 leading-relaxed">{analysis.aiInsights.summary}</p>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-zinc-800/50 rounded-xl p-4 space-y-1">
              <p className="text-xs text-zinc-500 font-medium uppercase tracking-wide">
                Padrão de Hook
              </p>
              <p className="text-sm text-zinc-200">{analysis.aiInsights.hookPattern}</p>
            </div>
            <div className="bg-zinc-800/50 rounded-xl p-4 space-y-1">
              <p className="text-xs text-zinc-500 font-medium uppercase tracking-wide">
                Melhor horário
              </p>
              <p className="text-sm text-zinc-200">{analysis.aiInsights.bestPostingInsight}</p>
            </div>
          </div>

          {/* Padrões */}
          {analysis.aiInsights.patterns.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-500 font-medium uppercase tracking-wide">Padrões</p>
              <div className="space-y-2">
                {analysis.aiInsights.patterns.map((p, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 bg-zinc-800/40 rounded-lg px-4 py-3"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-medium text-white">{p.title}</p>
                      <p className="text-xs text-zinc-400 mt-0.5">{p.description}</p>
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

          {/* Ações prioritárias */}
          {analysis.aiInsights.actionPriority.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-500 font-medium uppercase tracking-wide">
                Ações prioritárias
              </p>
              <div className="space-y-2">
                {analysis.aiInsights.actionPriority.map((a, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 bg-zinc-800/40 rounded-lg px-4 py-3"
                  >
                    <ArrowRight size={14} className="text-purple-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-white">{a.action}</p>
                      <p className="text-xs text-zinc-400 mt-0.5">{a.why}</p>
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
            <h3 className="font-semibold text-white">Converter para Reels</h3>
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
            <h3 className="font-semibold text-white">Vale refazer</h3>
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
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <BarChart3 size={16} className="text-zinc-400" />
            <h3 className="font-semibold text-white">Todos os posts</h3>
            <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">
              {sortedPosts.length}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sortedPosts.map((post) => {
              const barWidth = Math.max(2, (post.engagementRate / maxEng) * 100);
              return (
                <div
                  key={post.id}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex gap-3 p-3"
                >
                  <div className="relative w-16 h-16 flex-shrink-0 rounded-lg overflow-hidden bg-zinc-800">
                    {post.thumbnailUrl ? (
                      <img
                        src={post.thumbnailUrl}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-600">
                        <Image size={20} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="flex items-center gap-0.5 text-xs text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">
                        {mediaIcon(post.mediaType)}
                        <span className="ml-0.5">{mediaLabel(post.mediaType)}</span>
                      </span>
                      <span className="text-xs text-zinc-600">{formatDate(post.timestamp)}</span>
                    </div>
                    <p className="text-xs text-zinc-400 truncate">
                      {post.caption || '(sem legenda)'}
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${engBg(post.engagementRate)}`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                      <span className={`text-xs font-semibold flex-shrink-0 ${engColor(post.engagementRate)}`}>
                        {post.engagementRate.toFixed(1)}%
                      </span>
                      <span className="text-xs text-zinc-600 flex-shrink-0">
                        {post.saves} saves
                      </span>
                    </div>
                  </div>
                  <a
                    href={post.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="self-start text-zinc-600 hover:text-zinc-300 transition-colors flex-shrink-0"
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
        <div className="text-center py-12 text-zinc-500 space-y-2">
          <Instagram size={36} className="mx-auto opacity-30" />
          <p className="text-sm">Nenhum post encontrado. Clique em Sincronizar para buscar.</p>
        </div>
      )}
    </div>
  );
}
