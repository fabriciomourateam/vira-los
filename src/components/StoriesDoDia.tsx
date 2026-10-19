import React, { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Download, ExternalLink, ChevronDown, ChevronLeft, ChevronRight, Smartphone, AlertCircle } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

type StoryMode = 'valor' | 'engajamento' | 'oferta' | 'prova' | 'conexao';

interface StoryBatch {
  id: string;
  date: string;
  mode: StoryMode;
  topic: string;
  folderName: string;
  screenshots: string[];
  resumo: string;
  ctaKeyword: string | null;
  status: 'done' | 'error';
  error?: string;
  schedule?: { ok: boolean; when?: string; error?: string } | null;
  created_at: string;
}

interface StoriesResponse {
  batches: StoryBatch[];
  state?: { generating: boolean };
}

const MODE_STYLE: Record<StoryMode, { label: string; cls: string }> = {
  valor:       { label: 'Valor',       cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  engajamento: { label: 'Engajamento', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  oferta:      { label: 'Oferta',      cls: 'bg-green-500/15 text-green-400 border-green-500/30' },
  prova:       { label: 'Prova',       cls: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  conexao:     { label: 'Conexão',     cls: 'bg-secondary text-muted-foreground border-border' },
};

const POLL_MS = 5000;
const POLL_MAX_MS = 3 * 60 * 1000;

const imgUrl = (b: StoryBatch, file: string) => `${API}/output/${b.folderName}/${file}`;
const ts = (b: StoryBatch) => new Date(b.created_at).getTime() || 0;

function ModeBadge({ mode }: { mode: StoryMode }) {
  const s = MODE_STYLE[mode] ?? MODE_STYLE.conexao;
  return <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${s.cls}`}>{s.label}</span>;
}

async function downloadImage(url: string, name: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

function StoryStrip({ batch }: { batch: StoryBatch }) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * 480, behavior: 'smooth' });

  const openAll = () => {
    batch.screenshots.forEach(f => window.open(imgUrl(batch, f), '_blank', 'noopener'));
  };
  const downloadAll = async () => {
    for (const f of batch.screenshots) {
      await downloadImage(imgUrl(batch, f), `${batch.folderName}-${f}`);
      await new Promise(r => setTimeout(r, 250));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button onClick={downloadAll} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-secondary border border-border hover:bg-secondary/70 transition-colors">
          <Download className="w-3.5 h-3.5" /> Baixar todas
        </button>
        <button onClick={openAll} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-secondary border border-border hover:bg-secondary/70 transition-colors">
          <ExternalLink className="w-3.5 h-3.5" /> Abrir todas
        </button>
      </div>
      <div className="relative">
        <button onClick={() => scroll(-1)} aria-label="Anterior" className="hidden sm:flex absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 items-center justify-center rounded-full bg-background/80 border border-border shadow">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div ref={ref} className="flex gap-3 overflow-x-auto pb-2 snap-x px-1">
          {batch.screenshots.map((f, i) => {
            const url = imgUrl(batch, f);
            return (
              <div key={f} className="shrink-0 snap-start space-y-1.5">
                <img src={url} alt={`Story ${i + 1}`} loading="lazy" style={{ height: 420, aspectRatio: '9 / 16' }} className="rounded-xl border border-border object-cover bg-secondary" />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Story {i + 1}</span>
                  <button onClick={() => downloadImage(url, `${batch.folderName}-${f}`)} className="inline-flex items-center gap-1 hover:text-foreground transition-colors" title="Baixar">
                    <Download className="w-3.5 h-3.5" /> Baixar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <button onClick={() => scroll(1)} aria-label="Próximo" className="hidden sm:flex absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 items-center justify-center rounded-full bg-background/80 border border-border shadow">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function BatchMeta({ batch }: { batch: StoryBatch }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <ModeBadge mode={batch.mode} />
        {batch.ctaKeyword && (
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-secondary border border-border">CTA: {batch.ctaKeyword}</span>
        )}
        <span className="text-xs text-muted-foreground">{batch.date}</span>
      </div>
      <h3 className="text-base font-semibold text-foreground">{batch.topic}</h3>
      {batch.resumo && <p className="text-sm text-muted-foreground">{batch.resumo}</p>}
      {batch.schedule && (
        batch.schedule.ok
          ? <p className="text-xs text-green-400">✓ Agendado no mLabs{batch.schedule.when ? ` p/ ${batch.schedule.when.replace('T', ' ')} (SP)` : ''}</p>
          : <p className="text-xs text-amber-400">Agendamento no mLabs falhou — pack pronto pra postar manual. {batch.schedule.error}</p>
      )}
    </div>
  );
}

export default function StoriesDoDia() {
  const [batches, setBatches] = useState<StoryBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  const fetchStories = useCallback(async (): Promise<StoriesResponse> => {
    const res = await fetch(`${API}/api/stories`);
    if (!res.ok) throw new Error(`Erro ${res.status} ao carregar stories`);
    const data = (await res.json()) as StoriesResponse;
    return { batches: [...(data.batches ?? [])].sort((a, b) => ts(b) - ts(a)), state: data.state };
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    fetchStories()
      .then(d => { if (aliveRef.current) { setBatches(d.batches); setGenerating(!!d.state?.generating); } })
      .catch(e => { if (aliveRef.current) setLoadError(e instanceof Error ? e.message : 'Erro ao carregar'); })
      .finally(() => { if (aliveRef.current) setLoading(false); });
    return () => { aliveRef.current = false; if (pollRef.current) clearTimeout(pollRef.current); };
  }, [fetchStories]);

  const generate = async () => {
    if (generating) return;
    const lastKnown = batches.length ? ts(batches[0]) : 0;
    setGenerating(true);
    try {
      const res = await fetch(`${API}/api/stories/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'manual' }),
      });
      if (!res.ok) throw new Error(`Erro ${res.status} ao iniciar geração`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao iniciar geração');
      setGenerating(false);
      return;
    }

    const startedAt = Date.now();
    const tick = async () => {
      if (!aliveRef.current) return;
      try {
        const d = await fetchStories();
        const fresh = d.batches.find(b => ts(b) > lastKnown);
        if (fresh && (fresh.status === 'done' || fresh.status === 'error' || d.state?.generating === false)) {
          setBatches(d.batches);
          setGenerating(false);
          if (fresh.status === 'error') toast.error(fresh.error || 'Erro ao gerar o pack de stories', { duration: 8000 });
          else toast.success('Pack gerado');
          return;
        }
      } catch {
        // falha transitória: continua tentando até o timeout
      }
      if (Date.now() - startedAt > POLL_MAX_MS) {
        setGenerating(false);
        toast.error('A geração demorou mais que o esperado. Atualize em instantes.');
        return;
      }
      pollRef.current = setTimeout(tick, POLL_MS);
    };
    pollRef.current = setTimeout(tick, POLL_MS);
  };

  const today = batches[0];
  const history = batches.slice(1);

  return (
    <div className="space-y-5">
      <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2"><Smartphone className="w-5 h-5" /> Stories do dia</h2>
            <p className="text-sm text-muted-foreground mt-1">Gera e agenda sozinho no mLabs todo dia. Dá pra baixar e postar manual também.</p>
            <p className="text-xs text-muted-foreground mt-1">Os stories de engajamento e oferta pedem pra pessoa RESPONDER, e a resposta cai na sua DM.</p>
          </div>
          <button
            onClick={generate}
            disabled={generating}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {generating ? 'Gerando...' : 'Gerar agora'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-4"><Loader2 className="w-4 h-4 animate-spin" /> Carregando stories...</div>
      )}

      {!loading && loadError && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-card border border-border rounded-2xl p-4">
          <AlertCircle className="w-4 h-4" /> {loadError}
        </div>
      )}

      {!loading && !loadError && batches.length === 0 && (
        <div className="bg-card border border-border rounded-2xl p-8 text-center text-sm text-muted-foreground">
          Nenhum story gerado ainda. Clica em Gerar agora.
        </div>
      )}

      {today && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <BatchMeta batch={today} />
          {today.status === 'error'
            ? <div className="flex items-center gap-2 text-sm text-red-400"><AlertCircle className="w-4 h-4" /> {today.error || 'Falha ao gerar este pack.'}</div>
            : <StoryStrip batch={today} />}
        </div>
      )}

      {history.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <button onClick={() => setShowHistory(s => !s)} className="w-full flex items-center justify-between text-sm font-semibold text-foreground">
            Histórico ({history.length})
            <ChevronDown className={`w-4 h-4 transition-transform ${showHistory ? 'rotate-180' : ''}`} />
          </button>
          {showHistory && (
            <div className="mt-4 space-y-3">
              {history.map(b => (
                <div key={b.id} className="border border-border rounded-xl p-3 space-y-3">
                  <button onClick={() => setOpenId(openId === b.id ? null : b.id)} className="w-full flex flex-wrap items-center gap-2 text-left">
                    <ModeBadge mode={b.mode} />
                    <span className="text-sm text-foreground flex-1 min-w-0 truncate">{b.topic}</span>
                    <span className="text-xs text-muted-foreground">{b.date}</span>
                    {b.status === 'error' && <span className="text-xs text-red-400">erro</span>}
                  </button>
                  {openId === b.id && (
                    <>
                      <BatchMeta batch={b} />
                      {b.status === 'done' && <StoryStrip batch={b} />}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
