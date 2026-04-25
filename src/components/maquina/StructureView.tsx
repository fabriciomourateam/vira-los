/**
 * StructureView.tsx — Etapa 3 do pipeline editorial v4.
 * Mostra a espinha dorsal (Hook/Mecanismo/Prova/Aplicação/Direção) e exige
 * aprovação antes de gerar o HTML.
 */

import React from 'react';
import { Loader2, ArrowLeft, CheckCircle, Wand2 } from 'lucide-react';

interface StructureViewProps {
  headline: string;
  structure: string;
  loading: boolean;
  onApprove: () => void;
  onBack: () => void;
}

export default function StructureView({
  headline, structure, loading, onApprove, onBack,
}: StructureViewProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg bg-secondary hover:bg-border transition-colors"
            title="Voltar para headlines"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <h3 className="text-sm font-bold">Espinha dorsal</h3>
          <span className="text-[11px] text-muted-foreground ml-auto">Etapa 3/4</span>
        </div>

        <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/30">
          <div className="text-[10px] uppercase tracking-wider text-orange-400 font-bold mb-1">
            Headline escolhida
          </div>
          <div className="text-sm text-foreground leading-snug">{headline}</div>
        </div>

        <div className="p-3 rounded-lg bg-secondary/60 border border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2">
            Estrutura narrativa
          </div>
          <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed text-foreground/90">
            {structure}
          </pre>
        </div>

        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <CheckCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-amber-200/80 leading-snug">
            Revise a estrutura antes de gerar o HTML. Validação editorial 7-parâmetros é executada
            automaticamente pela Máquina antes do render.
          </p>
        </div>
      </div>

      <button
        onClick={onApprove}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/30 disabled:cursor-not-allowed text-white font-bold transition-colors"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
        {loading ? 'Gerando HTML... (pode levar 30-60s)' : 'Aprovar estrutura → gerar HTML do carrossel'}
      </button>
    </div>
  );
}
