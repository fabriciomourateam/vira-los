/**
 * HeadlinesPicker.tsx — Etapa 2 do pipeline editorial v4.
 * Exibe 10 headlines (5 IC + 5 NM) numa tabela e aceita comandos textuais
 * (escolher 1-10, "refazer headlines", "ajusta a 3", "mistura 2 com 7").
 */

import React, { useState, useEffect } from 'react';
import { Loader2, RefreshCw, ArrowLeft, ArrowRight, MessageSquare, Star, Sparkles } from 'lucide-react';
import { ParsedHeadline } from './types';

interface HeadlinesPickerProps {
  rawMarkdown: string;
  parsed: ParsedHeadline[];
  recommendedNum: number | null;
  recommendedReason: string | null;
  loading: boolean;
  onPick: (headline: ParsedHeadline) => void;
  onRegenerate: () => void;
  onCommand: (command: string) => void;
  onBack: () => void;
}

export default function HeadlinesPicker({
  rawMarkdown, parsed, recommendedNum, recommendedReason, loading, onPick, onRegenerate, onCommand, onBack,
}: HeadlinesPickerProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [command, setCommand] = useState('');

  // Pré-seleciona a recomendada quando a tabela chega
  useEffect(() => {
    if (selected === null && recommendedNum !== null) setSelected(recommendedNum);
  }, [recommendedNum]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmitCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;
    onCommand(command.trim());
    setCommand('');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg bg-secondary hover:bg-border transition-colors"
            title="Voltar para briefing"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <h3 className="text-sm font-bold">Escolha 1 das 10 headlines</h3>
          <span className="text-[11px] text-muted-foreground ml-auto">Etapa 2/4</span>
          <button
            onClick={onRegenerate}
            disabled={loading}
            className="p-1.5 rounded-lg bg-secondary hover:bg-border disabled:opacity-50 transition-colors"
            title="Refazer headlines"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
        </div>

        {recommendedNum !== null && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-violet-500/10 border border-violet-500/30">
            <Sparkles className="w-3.5 h-3.5 text-violet-400 mt-0.5 shrink-0" />
            <div className="text-[11px] leading-snug">
              <span className="font-bold text-violet-300">Máquina recomenda #{recommendedNum}</span>
              {recommendedReason && (
                <span className="text-violet-200/80"> — {recommendedReason}</span>
              )}
            </div>
          </div>
        )}

        {parsed.length > 0 ? (
          <div className="space-y-1.5">
            {parsed.map((h) => (
              <HeadlineRow
                key={h.num}
                h={h}
                selected={selected === h.num}
                onSelect={() => setSelected(h.num)}
              />
            ))}
          </div>
        ) : (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">A tabela não foi parseada. Mostrar markdown bruto.</summary>
            <pre className="mt-2 p-2 bg-secondary rounded text-[10px] whitespace-pre-wrap">{rawMarkdown}</pre>
          </details>
        )}

        <form onSubmit={handleSubmitCommand} className="flex gap-2 pt-2 border-t border-border/50">
          <MessageSquare className="w-4 h-4 text-muted-foreground self-center shrink-0" />
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder='ex: "ajusta a 3 mais provocativa", "mistura 2 com 7", "refazer headlines"'
            className="flex-1 p-2 rounded-lg border border-border bg-secondary text-xs focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || !command.trim()}
            className="px-3 py-2 rounded-lg bg-secondary hover:bg-border disabled:opacity-50 text-xs font-bold transition-colors"
          >
            Enviar
          </button>
        </form>
      </div>

      <button
        onClick={() => {
          const h = parsed.find((x) => x.num === selected);
          if (h) onPick(h);
        }}
        disabled={selected === null || loading}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/30 disabled:cursor-not-allowed text-white font-bold transition-colors"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
        {selected !== null ? `Usar headline ${selected} → gerar espinha dorsal` : 'Selecione uma headline'}
      </button>
    </div>
  );
}

function HeadlineRow({
  h, selected, onSelect,
}: { h: ParsedHeadline; selected: boolean; onSelect: () => void }) {
  // Aviso visual quando excede 120 chars (limite definido no prompt)
  const tooLong = h.text.length > 120;

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-2.5 rounded-lg border transition-colors relative ${
        selected
          ? 'bg-orange-500/15 border-orange-500/40'
          : h.recommended
            ? 'bg-violet-500/10 border-violet-500/30 hover:border-violet-500/50'
            : 'bg-secondary border-border hover:border-foreground/20'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className={`text-[10px] font-mono font-bold w-5 shrink-0 mt-0.5 ${selected ? 'text-orange-400' : 'text-muted-foreground'}`}>
          {String(h.num).padStart(2, '0')}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <p className={`flex-1 text-xs leading-snug ${selected ? 'text-foreground' : 'text-foreground/90'}`}>{h.text}</p>
            {h.score !== null && (
              <span
                className={`shrink-0 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
                  h.recommended
                    ? 'bg-violet-500/20 text-violet-300'
                    : h.score >= 8
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : h.score >= 6
                        ? 'bg-amber-500/15 text-amber-300'
                        : 'bg-secondary text-muted-foreground'
                }`}
                title={h.recommended ? 'Recomendada pela Máquina' : `Potencial viral: ${h.score}/10`}
              >
                {h.recommended && <Star className="w-2.5 h-2.5 fill-current" />}
                {h.score}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {h.trigger && (
              <p className="text-[10px] text-muted-foreground italic">↳ {h.trigger}</p>
            )}
            {tooLong && (
              <span className="text-[9px] text-amber-400 uppercase tracking-wider font-bold">
                {h.text.length} chars (longo)
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
