/**
 * reelOrigin — etiqueta de ORIGEM de um reel, pra o Fabricio saber de onde veio
 * cada um sem depender da cor do vídeo:
 *   🟡 queue → roteiro MEU (fila calibrada no feed)
 *   🤖 ia    → gerado pela IA (reserva, quando a fila está vazia)
 *   📤 ready → vídeo PRONTO que ele mesmo subiu (o app só agenda, não recolore)
 *
 * `source` vem do reel (db): 'queue' | 'daily' | 'ready'. O calendário manda
 * `origin` já resolvido ('queue' | 'ia' | 'ready').
 */
import React from 'react';

export type ReelOrigin = 'queue' | 'ia' | 'ready';

// Aceita tanto o `source` cru do reel quanto o `origin` já resolvido.
export function reelOrigin(sourceOrOrigin?: string | null): ReelOrigin {
  const s = String(sourceOrOrigin || '').toLowerCase();
  if (s === 'ready') return 'ready';
  if (s === 'queue') return 'queue';
  return 'ia'; // 'daily', vazio, ou qualquer outro → IA
}

const META: Record<ReelOrigin, { emoji: string; label: string; cls: string }> = {
  queue: { emoji: '🟡', label: 'Meu roteiro', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30' },
  ia:    { emoji: '🤖', label: 'IA',          cls: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30' },
  ready: { emoji: '📤', label: 'Pronto',      cls: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400 border border-fuchsia-500/30' },
};

export function originMeta(sourceOrOrigin?: string | null) {
  return META[reelOrigin(sourceOrOrigin)];
}

// Badge pronto pra usar em qualquer lista de reels.
export function OriginBadge({ source, compact = false }: { source?: string | null; compact?: boolean }) {
  const m = originMeta(source);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none ${m.cls}`}
      title={`Origem: ${m.label}`}
    >
      <span>{m.emoji}</span>{!compact && <span>{m.label}</span>}
    </span>
  );
}
