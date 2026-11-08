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
  triagem: string | null;
  eixo: string | null;
  funil: string | null;
  loading: boolean;
  onPick: (headline: ParsedHeadline) => void;
  onRegenerate: () => void;
  onCommand: (command: string) => void;
  onBack: () => void;
}

export default function HeadlinesPicker({
  rawMarkdown, parsed, triagem, eixo, funil, loading, onPick, onRegenerate, onCommand, onBack,
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

        {(triagem || eixo || funil) && (
          <div className="space-y-1.5 p-2.5 rounded-lg bg-secondary/40 border border-border">
            {triagem && (
              <div className="text-[11px] leading-snug">
                <span className="text-[10px] uppercase tracking-wider text-orange-400 font-bold mr-2">Triagem</span>
                <span className="text-foreground/90">{triagem}</span>
              </div>
            )}
            {(eixo || funil) && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                {eixo && (
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mr-1.5">Eixo</span>
                    <span className="text-foreground/90">{eixo}</span>
                  </div>
                )}
                {funil && (
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mr-1.5">Funil</span>
                    <span className="text-foreground/90">{funil}</span>
                  </div>
                )}
              </div>
            )}
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
  // Tipo derivado do número conforme a metodologia v4 (linha 179-180 do system prompt):
  //   1-5  = Investigação Cultural (frase única ~20-24 palavras com dois-pontos)
  //   6-10 = Narrativa Magnética   (3 frases com ponto, até ~45 palavras)
  const tipo: 'IC' | 'NM' = h.num <= 5 ? 'IC' : 'NM';

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
        <div className="flex flex-col items-center w-7 shrink-0 mt-0.5">
          <span className={`text-[10px] font-mono font-bold ${selected ? 'text-orange-400' : 'text-muted-foreground'}`}>
            {String(h.num).padStart(2, '0')}
          </span>
          <span
            className={`text-[8px] font-mono font-bold mt-0.5 px-1 rounded ${
              tipo === 'IC' ? 'bg-sky-500/15 text-sky-300' : 'bg-fuchsia-500/15 text-fuchsia-300'
            }`}
            title={tipo === 'IC' ? 'Investigação Cultural — frase única ~20-24 palavras' : 'Narrativa Magnética — 3 frases até ~45 palavras'}
          >
            {tipo}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-xs leading-snug ${selected ? 'text-foreground' : 'text-foreground/90'}`}>{h.text}</p>
          {h.trigger && (
            <p className="text-[10px] text-muted-foreground italic mt-1">↳ {h.trigger}</p>
          )}
        </div>
      </div>
    </button>
  );
}
