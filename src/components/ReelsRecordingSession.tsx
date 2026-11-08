/**
 * ReelsRecordingSession.tsx
 * Fila de gravação em batch + modo gravação fullscreen.
 *
 * Componentes:
 *  - SessionList    — lista de sessões salvas, cria nova, abre modo gravação
 *  - CreateSessionModal — checkbox list de reels salvos + nome da sessão
 *  - RecordingMode  — fullscreen: hook em destaque + teleprompter + nav + edit inline
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  X, Play, Pause, ChevronLeft, ChevronRight, Check, Save, Edit3,
  Plus, Mic, Trash2, RotateCcw, ListVideo, Loader2, MinusCircle,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export type SavedReel = {
  id: string;
  title?: string;
  carouselTopic?: string;
  duration: number;
  hook?: { fala?: string; tipo?: string; legenda?: string };
  body?: Array<{ fala?: string; legenda?: string; timestamp?: string }>;
  cta?: { fala?: string; palavra_chave?: string; legenda?: string };
  teleprompter?: string;
  formato?: string;
  emocao?: string;
};

export type RecordingSession = {
  id: string;
  name: string;
  reelIds: string[];
  recordedReelIds: string[];
  created_at?: string;
  updated_at?: string;
};

type SessionWithReels = RecordingSession & { reels: SavedReel[] };

// ─── Lista de sessões + botão de criar ───────────────────────────────────────

export function SessionList({ savedReels, onRefresh }: {
  savedReels: SavedReel[];
  onRefresh: () => void;
}) {
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [creating, setCreating] = useState(false);
  const [openSession, setOpenSession] = useState<SessionWithReels | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchSessions = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/reels/sessions`);
      const data = await r.json();
      setSessions(Array.isArray(data) ? data.filter((s: RecordingSession & { archived?: boolean }) => !s.archived) : []);
    } catch (err) {
      console.error('[Sessions] fetch error', err);
    }
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  async function handleOpen(sessionId: string) {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/reels/sessions/${sessionId}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao abrir sessão');
      setOpenSession(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao abrir sessão');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(sessionId: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('Excluir essa sessão? Os reels permanecem salvos.')) return;
    try {
      await fetch(`${API}/api/reels/sessions/${sessionId}`, { method: 'DELETE' });
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      toast.success('Sessão excluída');
    } catch {
      toast.error('Erro ao excluir');
    }
  }

  async function handleResetRecorded(sessionId: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('Resetar marcações de gravados nessa sessão?')) return;
    try {
      await fetch(`${API}/api/reels/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordedReelIds: [] }),
      });
      await fetchSessions();
      toast.success('Marcações resetadas');
    } catch {
      toast.error('Erro ao resetar');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <ListVideo className="w-4 h-4" /> Sessões de gravação
        </h3>
        <button
          onClick={() => setCreating(true)}
          disabled={savedReels.length === 0}
          className="text-[11px] font-bold px-3 py-1.5 rounded-md bg-rose-500 hover:bg-rose-600 text-white flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
          title={savedReels.length === 0 ? 'Crie reels primeiro' : 'Criar uma sessão de gravação em batch'}
        >
          <Plus className="w-3 h-3" /> Nova sessão
        </button>
      </div>

      {sessions.length === 0 ? (
        <p className="text-[11px] text-muted-foreground p-3 rounded-lg bg-card/50 border border-dashed border-border">
          Agrupe reels em uma "sessão" pra gravar todos de uma vez. Ex: 5-7 reels num figurino só, em sequência, com teleprompter focado.
        </p>
      ) : (
        <div className="space-y-2">
          {sessions.map(s => {
            const total = s.reelIds.length;
            const done = (s.recordedReelIds || []).length;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            return (
              <button
                key={s.id}
                onClick={() => handleOpen(s.id)}
                disabled={loading}
                className="w-full text-left p-3 rounded-xl bg-card hover:bg-secondary/50 transition-colors flex items-center gap-3 disabled:opacity-50"
                style={{ boxShadow: 'var(--shadow-card)' }}
              >
                <div className="shrink-0 w-10 h-10 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-500">
                  <Mic className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{s.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-[11px] text-muted-foreground">
                      {done}/{total} gravados
                    </p>
                    <div className="flex-1 h-1 rounded-full bg-secondary overflow-hidden max-w-32">
                      <div className="h-full bg-rose-500 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </div>
                {done > 0 && (
                  <button
                    onClick={(e) => handleResetRecorded(s.id, e)}
                    className="shrink-0 p-2 rounded-lg text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10"
                    title="Resetar marcações"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={(e) => handleDelete(s.id, e)}
                  className="shrink-0 p-2 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                  title="Excluir sessão"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </button>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {creating && (
          <CreateSessionModal
            savedReels={savedReels}
            onClose={() => setCreating(false)}
            onCreated={async () => {
              setCreating(false);
              await fetchSessions();
              toast.success('Sessão criada');
            }}
          />
        )}
        {openSession && (
          <RecordingMode
            session={openSession}
            onClose={() => { setOpenSession(null); fetchSessions(); onRefresh(); }}
            onUpdate={(updated) => setOpenSession(updated)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Modal de criação ────────────────────────────────────────────────────────

function CreateSessionModal({ savedReels, onClose, onCreated }: {
  savedReels: SavedReel[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const todayLabel = `Sessão ${new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')}`;
  const [name, setName] = useState(todayLabel);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleCreate() {
    if (selected.size === 0) {
      toast.error('Selecione pelo menos 1 reel');
      return;
    }
    setSaving(true);
    try {
      // Mantém a ordem em que estão na lista (mais recente primeiro = ordem natural)
      const reelIds = savedReels.filter(r => selected.has(r.id)).map(r => r.id);
      const r = await fetch(`${API}/api/reels/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || todayLabel, reelIds }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || 'Falha ao criar');
      }
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro');
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-card w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[85vh]"
      >
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="font-bold text-base">Nova sessão de gravação</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-3">
          <label className="block">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Nome da sessão</span>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full mt-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/50"
              placeholder={todayLabel}
            />
          </label>
          <p className="text-[11px] text-muted-foreground">
            Selecione os reels que vai gravar nesse bloco. A ordem segue a da lista.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-3 space-y-1.5">
          {savedReels.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">Nenhum reel salvo ainda.</p>
          ) : savedReels.map(r => {
            const isOn = selected.has(r.id);
            return (
              <button
                key={r.id}
                onClick={() => toggle(r.id)}
                className={`w-full flex items-center gap-3 p-2.5 rounded-lg transition-colors ${
                  isOn ? 'bg-rose-500/10 ring-1 ring-rose-500/40' : 'hover:bg-secondary/50'
                }`}
              >
                <div className={`shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center ${
                  isOn ? 'bg-rose-500 border-rose-500' : 'border-border'
                }`}>
                  {isOn && <Check className="w-3 h-3 text-white" />}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-semibold truncate">{r.title || r.carouselTopic || 'Sem título'}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {r.duration}s · {(r.body?.length || 0) + 2} segmentos
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="p-3 border-t border-border flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{selected.size} selecionado{selected.size !== 1 ? 's' : ''}</span>
          <button
            onClick={handleCreate}
            disabled={selected.size === 0 || saving}
            className="px-4 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-white font-bold text-sm flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Criar sessão
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Modo gravação (fullscreen) ──────────────────────────────────────────────

function RecordingMode({ session, onClose, onUpdate }: {
  session: SessionWithReels;
  onClose: () => void;
  onUpdate: (s: SessionWithReels) => void;
}) {
  const [index, setIndex] = useState(0);
  const reels = session.reels;
  const current = reels[index];

  const [speed, setSpeed] = useState(30);
  const [fontSize, setFontSize] = useState(56);
  const [running, setRunning] = useState(false);
  const [position, setPosition] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current?.teleprompter || '');
  const [savingDraft, setSavingDraft] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const recordedSet = new Set(session.recordedReelIds || []);

  // Quando troca de reel: reset scroll, sai de edit, atualiza draft
  useEffect(() => {
    setPosition(0);
    setRunning(false);
    setEditing(false);
    setDraft(current?.teleprompter || '');
  }, [index, current?.id, current?.teleprompter]);

  // Animação de scroll
  useEffect(() => {
    if (!running) return;
    let raf: number;
    let last = performance.now();
    const step = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      setPosition(p => {
        const max = (contentRef.current?.scrollHeight || 0) - (containerRef.current?.clientHeight || 0) / 2 + 200;
        const next = p + speed * dt;
        if (next >= max) { setRunning(false); return max; }
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [running, speed]);

  // Atalhos de teclado
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (editing) return; // não interfere quando editando texto
      if (e.code === 'Space') { e.preventDefault(); setRunning(r => !r); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); goNext(); }
      else if (e.code === 'ArrowLeft')  { e.preventDefault(); goPrev(); }
      else if (e.code === 'Escape')     { e.preventDefault(); onClose(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, index, reels.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function goNext() { setIndex(i => Math.min(reels.length - 1, i + 1)); }
  function goPrev() { setIndex(i => Math.max(0, i - 1)); }

  async function patchSession(update: Partial<RecordingSession>) {
    try {
      await fetch(`${API}/api/reels/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar');
    }
  }

  async function toggleRecorded() {
    if (!current) return;
    const next = new Set(recordedSet);
    if (next.has(current.id)) next.delete(current.id); else next.add(current.id);
    const newIds = Array.from(next);
    onUpdate({ ...session, recordedReelIds: newIds });
    await patchSession({ recordedReelIds: newIds });
    // Auto-avança se acabou de marcar e tem próximo
    if (!recordedSet.has(current.id) && index < reels.length - 1) {
      setTimeout(goNext, 250);
    }
  }

  async function removeFromSession() {
    if (!current) return;
    if (!confirm('Remover esse reel da sessão? Ele permanece salvo, só sai dessa fila.')) return;
    const newReelIds = session.reelIds.filter(id => id !== current.id);
    const newRecorded = (session.recordedReelIds || []).filter(id => id !== current.id);
    const newReels = reels.filter(r => r.id !== current.id);
    if (newReelIds.length === 0) {
      // sessão ficaria vazia — fecha
      await patchSession({ reelIds: newReelIds, recordedReelIds: newRecorded });
      toast.success('Reel removido — sessão vazia, fechando');
      onClose();
      return;
    }
    onUpdate({ ...session, reelIds: newReelIds, recordedReelIds: newRecorded, reels: newReels });
    await patchSession({ reelIds: newReelIds, recordedReelIds: newRecorded });
    setIndex(i => Math.min(i, newReels.length - 1));
    toast.success('Removido da sessão');
  }

  async function saveDraft() {
    if (!current || draft === current.teleprompter) { setEditing(false); return; }
    setSavingDraft(true);
    try {
      const r = await fetch(`${API}/api/reels/saved/${current.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teleprompter: draft }),
      });
      if (!r.ok) throw new Error('Falha ao salvar');
      const newReels = reels.map(rl => rl.id === current.id ? { ...rl, teleprompter: draft } : rl);
      onUpdate({ ...session, reels: newReels });
      setEditing(false);
      toast.success('Roteiro salvo');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSavingDraft(false);
    }
  }

  if (!current) {
    return (
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black flex items-center justify-center"
      >
        <div className="text-center text-white space-y-3">
          <p>Sessão sem reels.</p>
          <button onClick={onClose} className="px-4 py-2 bg-rose-500 rounded-lg">Fechar</button>
        </div>
      </motion.div>
    );
  }

  const isRecorded = recordedSet.has(current.id);
  const lines = (editing ? draft : current.teleprompter || '').split('\n');

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black flex flex-col"
    >
      {/* Header: progresso + título + close */}
      <div className="shrink-0 px-4 py-2.5 border-b border-white/10 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            {reels.map((r, i) => (
              <button
                key={r.id}
                onClick={() => setIndex(i)}
                className={`shrink-0 w-2 h-2 rounded-full transition-all ${
                  i === index
                    ? 'bg-rose-500 w-6'
                    : recordedSet.has(r.id)
                    ? 'bg-emerald-500'
                    : 'bg-white/20'
                }`}
                title={`${i + 1}. ${r.title || r.carouselTopic}`}
              />
            ))}
          </div>
          <p className="text-[10px] text-white/60 uppercase tracking-wider font-bold">
            {session.name} · {index + 1}/{reels.length} · {current.duration}s
          </p>
          <p className="text-sm text-white truncate">{current.title || current.carouselTopic}</p>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg text-white/70 hover:bg-white/10" title="Fechar (Esc)">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Hook em destaque */}
      {current.hook?.fala && !editing && (
        <div className="shrink-0 px-4 py-3 bg-rose-500/10 border-b border-rose-500/20">
          <p className="text-[10px] font-bold text-rose-400 uppercase tracking-wider mb-1">
            HOOK (0-3s){current.hook.tipo ? ` · ${current.hook.tipo}` : ''}
          </p>
          <p className="text-base sm:text-lg text-white font-bold leading-snug">"{current.hook.fala}"</p>
        </div>
      )}

      {/* Área principal: teleprompter ou textarea de edit */}
      {editing ? (
        <div className="flex-1 flex flex-col p-4 gap-3 bg-zinc-900">
          <p className="text-[10px] text-white/60 uppercase tracking-wider font-bold">
            Editando roteiro · {draft.length} caracteres
          </p>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="flex-1 w-full rounded-lg bg-black border border-white/20 text-white p-3 text-base font-sans leading-relaxed focus:outline-none focus:ring-2 focus:ring-rose-500/50 resize-none"
            autoFocus
          />
        </div>
      ) : (
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden relative"
          style={{ background: 'radial-gradient(ellipse at center, rgba(244,63,94,0.05) 0%, transparent 70%)' }}
        >
          <div
            ref={contentRef}
            style={{
              transform: `translateY(calc(50vh - ${position}px))`,
              fontSize: `${fontSize}px`,
              lineHeight: 1.4,
              padding: '0 6vw',
            }}
            className="text-white font-bold text-center transition-none"
          >
            {lines.map((line, i) => (
              <p key={i} className="mb-8">{line}</p>
            ))}
          </div>
          <div className="pointer-events-none absolute left-0 right-0 top-1/2 h-px bg-rose-500/40 -translate-y-1/2" />
        </div>
      )}

      {/* CTA palavra-chave */}
      {current.cta?.palavra_chave && !editing && (
        <div className="shrink-0 px-4 py-2 bg-emerald-500/10 border-t border-emerald-500/20 text-center">
          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">CTA: comente </span>
          <span className="text-sm font-extrabold text-emerald-300 tracking-widest">{current.cta.palavra_chave}</span>
        </div>
      )}

      {/* Controles */}
      <div className="shrink-0 px-3 py-3 border-t border-white/10 space-y-2.5 bg-black/60">
        {editing ? (
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => { setDraft(current.teleprompter || ''); setEditing(false); }}
              className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold"
            >
              Cancelar
            </button>
            <button
              onClick={saveDraft}
              disabled={savingDraft}
              className="px-3 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
            >
              {savingDraft ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Salvar
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setRunning(r => !r)}
                className="shrink-0 w-11 h-11 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center"
                title={running ? 'Pausar (espaço)' : 'Play (espaço)'}
              >
                {running ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 translate-x-0.5" />}
              </button>
              <button
                onClick={() => { setPosition(0); setRunning(true); }}
                className="shrink-0 px-2.5 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-bold"
                title="Reiniciar do começo"
              >
                ↺
              </button>
              <div className="flex-1 flex items-center gap-2 text-[10px] text-white/60">
                <span>Velocidade</span>
                <input
                  type="range" min={10} max={80} step={2}
                  value={speed} onChange={e => setSpeed(Number(e.target.value))}
                  className="flex-1 accent-rose-500"
                />
                <span className="w-8 text-right">{speed}</span>
                <span>Fonte</span>
                <input
                  type="range" min={32} max={96} step={2}
                  value={fontSize} onChange={e => setFontSize(Number(e.target.value))}
                  className="flex-1 accent-rose-500"
                />
                <span className="w-8 text-right">{fontSize}</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={goPrev}
                disabled={index === 0}
                className="shrink-0 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-1 disabled:opacity-30"
                title="Anterior (←)"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={toggleRecorded}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 ${
                  isRecorded
                    ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                    : 'bg-emerald-500 text-white hover:bg-emerald-600'
                }`}
              >
                <Check className="w-3.5 h-3.5" />
                {isRecorded ? 'Gravado ✓' : 'Marcar gravado'}
              </button>
              <button
                onClick={() => setEditing(true)}
                className="shrink-0 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-1.5"
                title="Editar roteiro"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={removeFromSession}
                className="shrink-0 px-3 py-2 rounded-lg bg-white/10 hover:bg-amber-500/20 text-white hover:text-amber-300 text-xs font-bold flex items-center gap-1.5"
                title="Remover desta sessão (não exclui o reel)"
              >
                <MinusCircle className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={goNext}
                disabled={index === reels.length - 1}
                className="shrink-0 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-1 disabled:opacity-30"
                title="Próximo (→)"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
