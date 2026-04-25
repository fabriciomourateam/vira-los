/**
 * BriefingForm.tsx — Etapa 1 do pipeline editorial v4.
 * Coleta os 7 campos obrigatórios + slides + imagens pedidas.
 */

import React from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import {
  Briefing,
  ESTILOS,
  TIPOS,
  SLIDES_OPTIONS,
  EstiloVisual,
  TipoCarrossel,
  SlidesCount,
} from './types';

interface BriefingFormProps {
  briefing: Briefing;
  onChange: (b: Briefing) => void;
  onSubmit: () => void;
  loading: boolean;
}

export default function BriefingForm({ briefing, onChange, onSubmit, loading }: BriefingFormProps) {
  const set = <K extends keyof Briefing>(key: K, value: Briefing[K]) =>
    onChange({ ...briefing, [key]: value });

  const canSubmit = briefing.tema.trim().length >= 10 && !loading;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4 text-orange-400" />
          <h3 className="text-sm font-bold">Briefing Criativo</h3>
          <span className="text-[11px] text-muted-foreground ml-auto">Etapa 1/4</span>
        </div>

        <Field label="Tema / insumo do carrossel">
          <textarea
            value={briefing.tema}
            onChange={(e) => set('tema', e.target.value)}
            placeholder="Ex: corredores que abandonaram bar pelo asfalto às 6h da manhã..."
            className="w-full min-h-[80px] p-2.5 rounded-lg border border-border bg-secondary text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-500/40"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Marca">
            <input
              value={briefing.marca}
              onChange={(e) => set('marca', e.target.value)}
              placeholder="Ex: Fabricio Moura"
              className="w-full p-2 rounded-lg border border-border bg-secondary text-sm focus:outline-none"
            />
          </Field>
          <Field label="@ do Instagram">
            <input
              value={briefing.handle}
              onChange={(e) => set('handle', e.target.value)}
              placeholder="@seuhandle"
              className="w-full p-2 rounded-lg border border-border bg-secondary text-sm focus:outline-none"
            />
          </Field>
          <Field label="Nicho">
            <input
              value={briefing.nicho}
              onChange={(e) => set('nicho', e.target.value)}
              placeholder="Ex: Fitness, Marketing Digital, Imobiliário"
              className="w-full p-2 rounded-lg border border-border bg-secondary text-sm focus:outline-none"
            />
          </Field>
          <Field label="Cor primária (hex ou descrição — vazio = sugestão por nicho)">
            <input
              value={briefing.cor}
              onChange={(e) => set('cor', e.target.value)}
              placeholder="#E8421A ou 'laranja vibrante'"
              className="w-full p-2 rounded-lg border border-border bg-secondary text-sm focus:outline-none"
            />
          </Field>
        </div>

        <Field label="Estilo visual">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {ESTILOS.map((e) => (
              <ChoiceCard
                key={e.id}
                active={briefing.estilo === e.id}
                onClick={() => set('estilo', e.id as EstiloVisual)}
                title={e.label}
                desc={e.desc}
              />
            ))}
          </div>
        </Field>

        <Field label="Tipo de carrossel (arco narrativo)">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {TIPOS.map((t) => (
              <ChoiceCard
                key={t.id}
                active={briefing.tipo === t.id}
                onClick={() => set('tipo', t.id as TipoCarrossel)}
                title={t.label}
                desc={t.arc}
              />
            ))}
          </div>
        </Field>

        <Field label="CTA do último slide">
          <input
            value={briefing.cta}
            onChange={(e) => set('cta', e.target.value)}
            placeholder="Comenta SHAPE, Salva esse post, Me segue..."
            className="w-full p-2 rounded-lg border border-border bg-secondary text-sm focus:outline-none"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantos slides">
            <div className="flex gap-1">
              {SLIDES_OPTIONS.map((n) => (
                <button
                  key={n}
                  onClick={() => set('slides', n as SlidesCount)}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${
                    briefing.slides === n
                      ? 'bg-orange-500/20 border border-orange-500/40 text-orange-300'
                      : 'bg-secondary border border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Quantos slides com imagem">
            <input
              type="number"
              min={0}
              max={briefing.slides}
              value={briefing.imagensPedidas}
              onChange={(e) => set('imagensPedidas', Math.max(0, Math.min(briefing.slides, parseInt(e.target.value) || 0)))}
              className="w-full p-2 rounded-lg border border-border bg-secondary text-sm focus:outline-none"
            />
          </Field>
        </div>
      </div>

      <button
        onClick={onSubmit}
        disabled={!canSubmit}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/30 disabled:cursor-not-allowed text-white font-bold transition-colors"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {loading ? 'Gerando 10 headlines...' : 'Gerar 10 headlines'}
      </button>
      {!canSubmit && !loading && (
        <p className="text-xs text-muted-foreground text-center">
          Tema precisa ter pelo menos 10 caracteres.
        </p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function ChoiceCard({
  active, onClick, title, desc,
}: { active: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-2.5 rounded-lg border transition-colors ${
        active
          ? 'bg-orange-500/15 border-orange-500/40 text-orange-300'
          : 'bg-secondary border-border text-muted-foreground hover:text-foreground hover:border-foreground/20'
      }`}
    >
      <div className="text-xs font-bold mb-0.5">{title}</div>
      <div className="text-[10px] leading-tight opacity-80">{desc}</div>
    </button>
  );
}
