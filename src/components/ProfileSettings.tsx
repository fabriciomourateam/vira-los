import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { User, X, CheckCircle2 } from 'lucide-react';
import { useCreatorProfile, type CreatorProfile } from '@/hooks/useCreatorProfile';

// ─── Opções de tom de voz ─────────────────────────────────────────────────────

const TONE_OPTIONS: string[] = [
  'direto',
  'técnico',
  'coloquial',
  'provocativo',
  'educativo',
  'científico',
  'motivacional',
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProfileSettingsProps {
  open: boolean;
  onClose: () => void;
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function ProfileSettings({ open, onClose }: ProfileSettingsProps) {
  const [profile, setProfile, isConfigured] = useCreatorProfile();

  // Estado local de edição — inicializado/sincronizado quando o painel abre
  const [draft, setDraft] = useState<CreatorProfile>(profile);

  useEffect(() => {
    if (open) {
      setDraft(profile);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function set<K extends keyof CreatorProfile>(key: K, value: CreatorProfile[K]) {
    setDraft(prev => ({ ...prev, [key]: value }));
  }

  function toggleTone(keyword: string) {
    setDraft(prev => {
      const already = prev.toneKeywords.includes(keyword);
      return {
        ...prev,
        toneKeywords: already
          ? prev.toneKeywords.filter(k => k !== keyword)
          : [...prev.toneKeywords, keyword],
      };
    });
  }

  function handleSave() {
    setProfile(draft);
    toast.success('Perfil salvo!');
    onClose();
  }

  // Fecha ao pressionar Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Overlay escuro */}
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Painel lateral deslizante pela direita */}
          <motion.div
            key="panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-md flex flex-col bg-card border-l border-border shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Perfil do Criador"
          >
            {/* Cabeçalho */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-purple-500" />
                <h2 className="text-base font-bold text-foreground">Perfil do Criador</h2>
                {isConfigured && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/40 border border-emerald-300 dark:border-emerald-700 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="w-3 h-3" />
                    Perfil ativo
                  </span>
                )}
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Corpo com scroll */}
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

              {/* Handle */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
                  Handle do canal
                </label>
                <input
                  type="text"
                  value={draft.handle}
                  onChange={e => set('handle', e.target.value)}
                  placeholder="@seucanal"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                />
              </div>

              {/* Nicho */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
                  Nicho principal
                </label>
                <input
                  type="text"
                  value={draft.niche}
                  onChange={e => set('niche', e.target.value)}
                  placeholder="Ex: fitness, hormônios, IA, investimentos…"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                />
              </div>

              {/* Público-alvo */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
                  Público-alvo
                </label>
                <input
                  type="text"
                  value={draft.audience}
                  onChange={e => set('audience', e.target.value)}
                  placeholder="Ex: homens 25-45 que treinam"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                />
              </div>

              {/* Tom de voz (checkboxes) */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">
                  Tom de voz
                </label>
                <div className="flex flex-wrap gap-2">
                  {TONE_OPTIONS.map(keyword => {
                    const active = draft.toneKeywords.includes(keyword);
                    return (
                      <button
                        key={keyword}
                        type="button"
                        onClick={() => toggleTone(keyword)}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                          active
                            ? 'bg-purple-600 border-purple-600 text-white'
                            : 'bg-background border-border text-muted-foreground hover:border-purple-400 hover:text-foreground'
                        }`}
                      >
                        {keyword}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Expressões típicas */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
                  Expressões que você usa
                </label>
                <textarea
                  value={draft.expressions}
                  onChange={e => set('expressions', e.target.value)}
                  placeholder={`Ex: "galera", "olha que loucura", "fica esperto", "sério isso"…`}
                  rows={3}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-none"
                />
              </div>

              {/* Exemplo de copy */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
                  Exemplo de copy seu
                </label>
                <p className="text-xs text-muted-foreground mb-1.5">
                  Cole uma legenda ou copy que você já escreveu — o Claude aprende seu estilo.
                </p>
                <textarea
                  value={draft.exampleCopy}
                  onChange={e => set('exampleCopy', e.target.value)}
                  placeholder="Cole aqui uma legenda, thread ou copy que você escreveu…"
                  rows={6}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-none"
                />
              </div>
            </div>

            {/* Rodapé */}
            <div className="shrink-0 px-5 py-4 border-t border-border bg-card">
              <button
                onClick={handleSave}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold py-2.5 text-sm transition-colors"
              >
                <User className="w-4 h-4" />
                Salvar Perfil
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
