/**
 * HeadlinesPicker.tsx — Etapa 2 do pipeline editorial v4.
 * Exibe 10 headlines (5 IC + 5 NM) numa tabela e aceita comandos textuais
 * (escolher 1-10, "refazer headlines", "ajusta a 3", "mistura 2 com 7").
 */

import React, { useState } from 'react';
import { Loader2, RefreshCw, ArrowLeft, ArrowRight, MessageSquare } from 'lucide-react';
import { ParsedHeadline } from './types';

interface HeadlinesPickerProps {
  rawMarkdown: string;
  parsed: ParsedHeadline[];
  loading: boolean;
  onPick: (headline: ParsedHeadline) => void;
  onRegenerate: () => void;
  onCommand: (command: string) => void;
  onBack: () => void;
}

export default function HeadlinesPicker({
  rawMarkdown, parsed, loading, onPick, onRegenerate, onCommand, onBack,
}: HeadlinesPickerProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [command, setCommand] = useState('');

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
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
        selected
          ? 'bg-orange-500/15 border-orange-500/40'
          : 'bg-secondary border-border hover:border-foreground/20'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className={`text-[10px] font-mono font-bold w-5 shrink-0 mt-0.5 ${selected ? 'text-orange-400' : 'text-muted-foreground'}`}>
          {String(h.num).padStart(2, '0')}
        </span>
        <div className="flex-1 min-w-0">
          <p className={`text-xs leading-snug ${selected ? 'text-foreground' : 'text-foreground/90'}`}>{h.text}</p>
          {h.trigger && (
            <p className="text-[10px] text-muted-foreground mt-1 italic">↳ {h.trigger}</p>
          )}
        </div>
      </div>
    </button>
  );
}
