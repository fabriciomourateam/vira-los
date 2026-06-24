import React, { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  CalendarClock, Sparkles, Loader2, Image as ImageIcon, Film, ExternalLink,
  Play, Copy, ChevronDown, ChevronUp, AlertTriangle,
} from 'lucide-react';
import { TeleprompterOverlay, TeleprompterState, initialTeleprompterState } from './Teleprompter';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface Reel {
  id: string; title: string; teleprompter?: string; legendaPost?: string;
  hook?: { fala?: string; legenda?: string }; cta?: { palavra_chave?: string };
  // Formato curto (7s): vídeo + frase de tela + "leia a legenda"
  tipo?: string; duration?: number;
  fraseTela?: string; videoSugerido?: string; promptsVideo?: { heygen?: string; broll?: string }; ctaTela?: string; ctaTelaTiming?: string;
}
interface Carousel {
  id: string; topic: string; folderName: string; numSlides: number;
  screenshots?: string[]; legenda?: string;
}
interface Batch {
  id: string; date: string; status: 'done' | 'partial' | 'error'; trigger?: string;
  photoSource?: string; themes: { id: string; topic: string }[];
  carousels: Carousel[]; reels: Reel[]; errors?: string[];
}
interface DailyState { generating: boolean; startedAt?: string; lastError?: string; }

const STATUS_BADGE: Record<string, string> = {
  done: 'bg-green-500/15 text-green-400 border-green-500/30',
  partial: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  error: 'bg-red-500/15 text-red-400 border-red-500/30',
};

function copy(text: string) {
  navigator.clipboard.writeText(text).then(() => toast.success('Copiado!'));
}

export default function ConteudoDiario() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [state, setState] = useState<DailyState>({ generating: false });
  const [loading, setLoading] = useState(true);
  const [openCaption, setOpenCaption] = useState<Record<string, boolean>>({});
  const [tp, setTp] = useState<TeleprompterState>(initialTeleprompterState);
  const [tpText, setTpText] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/daily-content`);
      if (res.ok) {
        const data = await res.json();
        setBatches(data.batches || []);
        setState(data.state || { generating: false });
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

  // Enquanto gera, faz polling a cada 6s e para quando terminar
  useEffect(() => {
    if (state.generating && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        const stillGen = await fetchData();
        if (!stillGen && pollRef.current) {
          clearInterval(pollRef.current); pollRef.current = null;
          toast.success('Conteúdo do dia gerado!');
        }
      }, 6000);
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [state.generating, fetchData]);

  async function handleGenerate() {
    try {
      const res = await fetch(`${API}/api/daily-content/generate`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao iniciar.');
      setState({ generating: true });
      toast.info('Gerando 2 carrosséis + 2 reels... leva alguns minutos.');
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao gerar.');
    }
  }

  function openTeleprompter(reel: Reel) {
    if (!reel.teleprompter) { toast.error('Esse reel não tem roteiro de teleprompter.'); return; }
    setTpText(reel.teleprompter);
    setTp({ ...initialTeleprompterState, open: true, title: reel.title || 'Reel', playing: false });
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground"><Loader2 size={26} className="animate-spin mr-2" /> Carregando...</div>;
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <CalendarClock size={22} className="text-purple-400" />
          <h2 className="text-xl font-bold text-foreground">Conteúdo Diário</h2>
        </div>
        <button
          onClick={handleGenerate}
          disabled={state.generating}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-foreground text-sm font-semibold transition-colors disabled:opacity-60"
        >
          {state.generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {state.generating ? 'Gerando...' : 'Gerar agora'}
        </button>
      </div>

      <p className="text-sm text-muted-foreground">
        Todo dia às <b className="text-foreground">09h (Brasília)</b> o viralos gera 2 carrosséis de temas
        diferentes (template fmteam, mirando o homem 25-40) + 1 modelo de reel por tema, com teleprompter pronto.
        Sem repetir temas das últimas 2 semanas.
      </p>

      {batches.length === 0 && !state.generating && (
        <div className="bg-card border border-border rounded-2xl p-6 text-center text-muted-foreground">
          Nada gerado ainda. Clique em <b className="text-foreground">Gerar agora</b> ou espere a rotina das 09h.
        </div>
      )}

      {batches.map((b) => (
        <div key={b.id} className="bg-card border border-border rounded-2xl p-5 space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground">{new Date(b.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_BADGE[b.status] || ''}`}>{b.status}</span>
            {b.trigger === 'cron' && <span className="text-xs text-muted-foreground">(automático)</span>}
            {b.photoSource && <span className="text-xs text-muted-foreground">· fotos: {b.photoSource}</span>}
          </div>

          {b.errors && b.errors.length > 0 && (
            <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-2">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {b.errors.join(' · ')}
            </div>
          )}

          {/* Carrosséis */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {b.carousels.map((c) => {
              const thumb = c.screenshots && c.screenshots.length > 0 ? `${API}/output/${c.folderName}/${c.screenshots[0]}` : null;
              const open = openCaption[c.id];
              return (
                <div key={c.id} className="border border-border rounded-xl overflow-hidden bg-secondary/30">
                  <div className="flex gap-3 p-3">
                    <div className="w-20 h-24 shrink-0 rounded-lg overflow-hidden bg-secondary flex items-center justify-center">
                      {thumb ? <img src={thumb} alt={c.topic} className="w-full h-full object-cover" /> : <ImageIcon size={20} className="text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 text-xs text-purple-400 mb-1"><ImageIcon size={13} /> Carrossel · {c.numSlides} slides</div>
                      <p className="text-sm font-medium text-foreground line-clamp-2">{c.topic}</p>
                      <div className="flex gap-3 mt-2">
                        <a href={`${API}/output/${c.folderName}/carrossel.html`} target="_blank" rel="noreferrer" className="text-xs text-purple-400 hover:text-purple-300 inline-flex items-center gap-1"><ExternalLink size={12} /> Abrir</a>
                        {c.legenda && (
                          <button onClick={() => setOpenCaption((s) => ({ ...s, [c.id]: !s[c.id] }))} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                            Legenda {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  {open && c.legenda && (
                    <div className="px-3 pb-3">
                      <div className="bg-background border border-border rounded-lg p-2 text-xs text-muted-foreground whitespace-pre-wrap max-h-40 overflow-auto">{c.legenda}</div>
                      <button onClick={() => copy(c.legenda!)} className="mt-1.5 text-xs text-purple-400 inline-flex items-center gap-1"><Copy size={11} /> Copiar legenda</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Reels */}
          {b.reels.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {b.reels.map((r) => (
                <div key={r.id} className="border border-border rounded-xl p-3 bg-secondary/30">
                  <div className="flex items-center gap-1.5 text-xs text-pink-400 mb-1">
                    <Film size={13} /> {r.tipo === 'short' ? `Reel curto · ${r.duration || 7}s` : 'Modelo de Reel'}
                  </div>
                  <p className="text-sm font-medium text-foreground line-clamp-2">{r.title}</p>
                  {r.tipo === 'short' ? (
                    <>
                      {r.fraseTela && (
                        <p className="text-xs text-foreground mt-1.5 font-medium">📱 Frase na tela: <span className="text-muted-foreground font-normal">"{r.fraseTela}"</span></p>
                      )}
                      {r.videoSugerido && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">🎬 Vídeo: {r.videoSugerido}</p>
                      )}
                      <p className="text-[11px] text-muted-foreground mt-1">⏱️ {r.ctaTelaTiming || '4-5s'}: {r.ctaTela || '👇 LEIA A LEGENDA'}</p>
                    </>
                  ) : (
                    r.hook?.legenda && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">Hook: {r.hook.legenda}</p>
                  )}
                  <div className="flex gap-3 mt-2 flex-wrap">
                    {r.tipo !== 'short' && r.teleprompter && (
                      <button onClick={() => openTeleprompter(r)} className="text-xs font-medium text-foreground bg-pink-600 hover:bg-pink-500 px-2.5 py-1 rounded-lg inline-flex items-center gap-1 transition-colors"><Play size={12} /> Teleprompter</button>
                    )}
                    {r.promptsVideo?.heygen && <button onClick={() => copy(r.promptsVideo!.heygen!)} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><Copy size={11} /> Prompt HeyGen</button>}
                    {r.promptsVideo?.broll && <button onClick={() => copy(r.promptsVideo!.broll!)} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><Copy size={11} /> Prompt B-roll</button>}
                    {r.legendaPost && <button onClick={() => copy(r.legendaPost!)} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><Copy size={11} /> Copiar legenda</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <TeleprompterOverlay
        open={tp.open}
        title={tp.title}
        text={tpText}
        speed={tp.speed}
        fontSize={tp.fontSize}
        countdownDuration={tp.countdownDuration}
        mirrored={tp.mirrored}
        playing={tp.playing}
        onClose={() => setTp((s) => ({ ...s, open: false, playing: false }))}
        onTogglePlaying={() => setTp((s) => ({ ...s, playing: !s.playing }))}
        onSpeedChange={(speed) => setTp((s) => ({ ...s, speed }))}
        onFontSizeChange={(fontSize) => setTp((s) => ({ ...s, fontSize }))}
        onCountdownDurationChange={(countdownDuration) => setTp((s) => ({ ...s, countdownDuration }))}
        onToggleMirror={() => setTp((s) => ({ ...s, mirrored: !s.mirrored }))}
      />
    </div>
  );
}
