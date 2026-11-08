import { useEffect, useRef, useState } from 'react';
import { Play, Pause, X } from 'lucide-react';

export interface TeleprompterState {
  open: boolean;
  scriptId: string | null;
  title: string;
  speed: number;
  fontSize: number;
  countdownDuration: number;
  mirrored: boolean;
  playing: boolean;
}

export const initialTeleprompterState: TeleprompterState = {
  open: false,
  scriptId: null,
  title: '',
  speed: 32,
  fontSize: 34,
  countdownDuration: 3,
  mirrored: false,
  playing: false,
};

export function TeleprompterOverlay({
  open,
  title,
  text,
  speed,
  fontSize,
  countdownDuration,
  mirrored,
  playing,
  onClose,
  onTogglePlaying,
  onSpeedChange,
  onFontSizeChange,
  onCountdownDurationChange,
  onToggleMirror,
}: {
  open: boolean;
  title: string;
  text: string;
  speed: number;
  fontSize: number;
  countdownDuration: number;
  mirrored: boolean;
  playing: boolean;
  onClose: () => void;
  onTogglePlaying: () => void;
  onSpeedChange: (value: number) => void;
  onFontSizeChange: (value: number) => void;
  onCountdownDurationChange: (value: number) => void;
  onToggleMirror: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const [countdownValue, setCountdownValue] = useState<number | null>(null);

  const clearCountdown = () => {
    if (countdownTimerRef.current !== null) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setCountdownValue(null);
  };

  const handlePlayPause = () => {
    if (countdownValue !== null) {
      clearCountdown();
      return;
    }

    if (playing) {
      onTogglePlaying();
      return;
    }

    if (countdownDuration <= 0) {
      onTogglePlaying();
      return;
    }

    setCountdownValue(countdownDuration);
    countdownTimerRef.current = window.setInterval(() => {
      setCountdownValue((current) => {
        if (current === null) return null;
        if (current <= 1) {
          if (countdownTimerRef.current !== null) {
            window.clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
          }
          onTogglePlaying();
          return null;
        }
        return current - 1;
      });
    }, 1000);
  };

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.code === 'Space') {
        event.preventDefault();
        handlePlayPause();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, handlePlayPause]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) clearCountdown();
  }, [open]);

  useEffect(() => {
    if (!open || !scrollRef.current) return;
    clearCountdown();
    scrollRef.current.scrollTop = 0;
  }, [open, text]);

  useEffect(() => {
    if (!open || !playing || !scrollRef.current) return;

    const element = scrollRef.current;
    const interval = window.setInterval(() => {
      element.scrollTop += speed / 12;
    }, 40);

    return () => window.clearInterval(interval);
  }, [open, playing, speed]);

  useEffect(() => () => clearCountdown(), []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black text-white">
      <div className="flex h-full flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-black/90 px-4 py-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">Teleprompter</p>
            <h2 className="text-sm font-semibold sm:text-base">{title}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handlePlayPause}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-bold text-black transition-opacity hover:opacity-90"
            >
              {playing ? <Pause size={15} /> : <Play size={15} />}
              {countdownValue !== null ? 'Cancelar contagem' : playing ? 'Pausar' : 'Iniciar'}
            </button>
            <button
              onClick={onToggleMirror}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                mirrored ? 'border-blue-400 bg-blue-500/20 text-blue-100' : 'border-white/15 text-white/80 hover:border-white/30'
              }`}
            >
              Espelhar
            </button>
            <button
              onClick={() => {
                if (scrollRef.current) scrollRef.current.scrollTop = 0;
              }}
              className="rounded-lg border border-white/15 px-3 py-2 text-sm font-semibold text-white/80 transition-colors hover:border-white/30"
            >
              Reiniciar
            </button>
            <button
              onClick={() => {
                clearCountdown();
                onClose();
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm font-semibold text-white/80 transition-colors hover:border-white/30"
            >
              <X size={15} />
              Fechar
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 border-b border-white/10 bg-zinc-950 px-4 py-3 sm:grid-cols-3">
          <label className="space-y-2">
            <span className="block text-xs font-bold uppercase tracking-[0.2em] text-white/50">Velocidade</span>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="10"
                max="80"
                value={speed}
                onChange={(e) => onSpeedChange(Number(e.target.value))}
                className="w-full accent-white"
              />
              <span className="w-12 text-right text-sm font-semibold">{speed}</span>
            </div>
          </label>
          <label className="space-y-2">
            <span className="block text-xs font-bold uppercase tracking-[0.2em] text-white/50">Fonte</span>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="24"
                max="64"
                value={fontSize}
                onChange={(e) => onFontSizeChange(Number(e.target.value))}
                className="w-full accent-white"
              />
              <span className="w-12 text-right text-sm font-semibold">{fontSize}</span>
            </div>
          </label>
          <label className="space-y-2">
            <span className="block text-xs font-bold uppercase tracking-[0.2em] text-white/50">Contagem</span>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="5"
                value={countdownDuration}
                onChange={(e) => onCountdownDurationChange(Number(e.target.value))}
                className="w-full accent-white"
              />
              <span className="w-12 text-right text-sm font-semibold">{countdownDuration}s</span>
            </div>
          </label>
        </div>

        <div ref={scrollRef} className="relative flex-1 overflow-y-auto bg-black px-4 py-10 sm:px-8">
          {countdownValue !== null && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/60">
              <div className="rounded-full border border-white/15 bg-white/10 px-10 py-8 text-center backdrop-blur-sm">
                <p className="text-xs font-bold uppercase tracking-[0.3em] text-white/60">Preparar</p>
                <p className="mt-2 text-7xl font-black tabular-nums sm:text-8xl">{countdownValue}</p>
              </div>
            </div>
          )}
          <div
            className={`mx-auto max-w-4xl whitespace-pre-wrap text-center font-semibold leading-[1.9] tracking-[0.01em] text-white ${
              mirrored ? '-scale-x-100 transform' : ''
            }`}
            style={{ fontSize: `${fontSize}px` }}
          >
            {text || 'Adicione um roteiro final para usar o teleprompter.'}
          </div>
        </div>
      </div>
    </div>
  );
}
