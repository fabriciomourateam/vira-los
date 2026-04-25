/**
 * Maquina.tsx — Orquestrador da Máquina de Carrosséis (modo BrandsDecoded).
 *
 * Pipeline editorial em 4 etapas (ver server/services/maquinaPrompt/01-system-v4.md):
 *   1. Briefing      → BriefingForm
 *   2. Headlines     → HeadlinesPicker (10 opções, 5 IC + 5 NM)
 *   3. Espinha       → StructureView (Hook/Mecanismo/Prova/Aplicação/Direção)
 *   4. Preview/Export→ HtmlPreview (edit + Pexels + PNG/ZIP)
 *
 * + HistoricoSidebar com archive reversível, clone como base, abrir/excluir.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import BriefingForm from './maquina/BriefingForm';
import HeadlinesPicker from './maquina/HeadlinesPicker';
import StructureView from './maquina/StructureView';
import HtmlPreview from './maquina/HtmlPreview';
import HistoricoSidebar from './maquina/HistoricoSidebar';
import {
  Briefing,
  initialBriefing,
  parseHeadlines,
  ParsedHeadline,
  Stage,
} from './maquina/types';
import { maquinaApi, MaquinaCarrossel } from '@/lib/maquinaApi';

export interface MaquinaInitialIdea {
  title?: string;
  topic?: string;
  hook?: string;
  niche?: string;
  cta?: string;
  numSlides?: number;
}

interface MaquinaProps {
  initialIdea?: MaquinaInitialIdea | null;
  onClearInitialIdea?: () => void;
}

export default function Maquina({ initialIdea, onClearInitialIdea }: MaquinaProps) {
  const [stage, setStage] = useState<Stage>('briefing');
  const [briefing, setBriefing] = useState<Briefing>(initialBriefing);

  // Etapa 2 — headlines
  const [headlinesRaw, setHeadlinesRaw] = useState('');
  const [headlinesParsed, setHeadlinesParsed] = useState<ParsedHeadline[]>([]);
  const [recommendedNum, setRecommendedNum] = useState<number | null>(null);
  const [recommendedReason, setRecommendedReason] = useState<string | null>(null);
  const [headlineEscolhida, setHeadlineEscolhida] = useState<ParsedHeadline | null>(null);

  // Etapa 3 — estrutura
  const [estrutura, setEstrutura] = useState('');

  // Etapa 4 — html
  const [html, setHtml] = useState('');

  // Loading flags por etapa
  const [loadingHeadlines, setLoadingHeadlines] = useState(false);
  const [loadingStructure, setLoadingStructure] = useState(false);
  const [loadingHtml, setLoadingHtml] = useState(false);
  const [saving, setSaving] = useState(false);

  // Histórico
  const [historico, setHistorico] = useState<MaquinaCarrossel[]>([]);
  const [historicoLoading, setHistoricoLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // ── Prefill quando vem com `initialIdea` (do IdeasGenerator) ───────────────
  useEffect(() => {
    if (!initialIdea) return;
    const tema = [initialIdea.title, initialIdea.hook].filter(Boolean).join(' — ');
    setBriefing((b) => ({
      ...b,
      tema: tema || b.tema,
      nicho: initialIdea.niche || b.nicho,
      cta: initialIdea.cta || b.cta,
      slides: ((initialIdea.numSlides && [5, 7, 9, 12].includes(initialIdea.numSlides)
        ? initialIdea.numSlides
        : b.slides) as 5 | 7 | 9 | 12),
    }));
    onClearInitialIdea?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialIdea]);

  // ── Carrega histórico no mount ─────────────────────────────────────────────
  const refreshHistorico = useCallback(async () => {
    setHistoricoLoading(true);
    try {
      const items = await maquinaApi.list();
      setHistorico(items);
    } catch (e) {
      // Silencioso — provavelmente backend offline
    } finally {
      setHistoricoLoading(false);
    }
  }, []);

  useEffect(() => { refreshHistorico(); }, [refreshHistorico]);

  // ── Etapa 2: gerar 10 headlines ────────────────────────────────────────────
  const handleGenerateHeadlines = async () => {
    setLoadingHeadlines(true);
    try {
      const data = await maquinaApi.headlines(briefing.tema, briefing.nicho);
      setHeadlinesRaw(data.headlines);
      const result = parseHeadlines(data.headlines);
      setHeadlinesParsed(result.items);
      setRecommendedNum(result.recommendedNum);
      setRecommendedReason(result.recommendedReason);
      setStage('headlines');
    } catch (e) {
      toast.error(`Erro nas headlines: ${(e as Error).message}`);
    } finally {
      setLoadingHeadlines(false);
    }
  };

  const handleRegenerateHeadlines = () => handleGenerateHeadlines();

  const handleHeadlineCommand = async (command: string) => {
    // Mantém histórico de conversa para o Claude entender o ajuste
    setLoadingHeadlines(true);
    try {
      const tema = `${briefing.tema}\n\nHeadlines anteriores:\n${headlinesRaw}\n\nComando: ${command}`;
      const data = await maquinaApi.headlines(tema, briefing.nicho);
      setHeadlinesRaw(data.headlines);
      const result = parseHeadlines(data.headlines);
      setHeadlinesParsed(result.items);
      setRecommendedNum(result.recommendedNum);
      setRecommendedReason(result.recommendedReason);
    } catch (e) {
      toast.error(`Erro: ${(e as Error).message}`);
    } finally {
      setLoadingHeadlines(false);
    }
  };

  // ── Etapa 3: espinha dorsal ────────────────────────────────────────────────
  const handlePickHeadline = async (h: ParsedHeadline) => {
    setHeadlineEscolhida(h);
    setLoadingStructure(true);
    setStage('structure');
    try {
      const data = await maquinaApi.structure(h.text, briefing.tema);
      setEstrutura(data.structure);
    } catch (e) {
      toast.error(`Erro na estrutura: ${(e as Error).message}`);
    } finally {
      setLoadingStructure(false);
    }
  };

  // ── Etapa 4: HTML ──────────────────────────────────────────────────────────
  const handleApproveStructure = async () => {
    if (!headlineEscolhida) return;
    setLoadingHtml(true);
    try {
      const conversationHistory = [
        { role: 'user' as const,      content: `Tema: ${briefing.tema}` },
        { role: 'assistant' as const, content: headlinesRaw },
        { role: 'user' as const,      content: `Escolhi a headline: ${headlineEscolhida.text}` },
        { role: 'assistant' as const, content: estrutura },
        { role: 'user' as const,      content: 'Aprovado. Gera o HTML do carrossel.' },
      ];
      const data = await maquinaApi.generate({
        tema: briefing.tema,
        headline: headlineEscolhida.text,
        cta: briefing.cta,
        slides: briefing.slides,
        nicho: briefing.nicho,
        conversationHistory,
      });
      setHtml(data.html);
      setStage('preview');
    } catch (e) {
      toast.error(`Erro no HTML: ${(e as Error).message}`);
    } finally {
      setLoadingHtml(false);
    }
  };

  // ── Salvar / atualizar no histórico ────────────────────────────────────────
  const handleSave = async (currentHtml: string) => {
    setSaving(true);
    try {
      const payload = {
        briefing,
        headlines: headlinesRaw,
        headlineEscolhida: headlineEscolhida?.text || null,
        estrutura,
        html: currentHtml,
        status: 'rendered' as const,
        title: headlineEscolhida?.text?.slice(0, 80) || briefing.tema.slice(0, 80),
      };
      if (editingId) {
        await maquinaApi.patch(editingId, payload);
        toast.success('Carrossel atualizado');
      } else {
        const saved = await maquinaApi.save(payload);
        setEditingId(saved.id);
        toast.success('Carrossel salvo no histórico');
      }
      refreshHistorico();
    } catch (e) {
      toast.error(`Erro ao salvar: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  // ── Ações do histórico ─────────────────────────────────────────────────────
  const handleOpenHistorico = (item: MaquinaCarrossel) => {
    setBriefing({ ...initialBriefing, ...(item.briefing || {}) } as Briefing);
    const md = typeof item.headlines === 'string' ? item.headlines : '';
    setHeadlinesRaw(md);
    const result = md ? parseHeadlines(md) : { items: [], recommendedNum: null, recommendedReason: null };
    setHeadlinesParsed(result.items);
    setRecommendedNum(result.recommendedNum);
    setRecommendedReason(result.recommendedReason);
    if (item.headlineEscolhida) {
      setHeadlineEscolhida({ num: 0, text: item.headlineEscolhida, trigger: '', score: null, recommended: false });
    }
    setEstrutura(item.estrutura || '');
    setHtml(item.html || '');
    setEditingId(item.id);
    setStage(item.html ? 'preview' : item.estrutura ? 'structure' : 'briefing');
    toast.success('Carrossel carregado');
  };

  const handleCloneHistorico = (item: MaquinaCarrossel) => {
    setBriefing({ ...initialBriefing, ...(item.briefing || {}) } as Briefing);
    setHeadlinesRaw('');
    setHeadlinesParsed([]);
    setRecommendedNum(null);
    setRecommendedReason(null);
    setHeadlineEscolhida(null);
    setEstrutura('');
    setHtml('');
    setEditingId(null);
    setStage('briefing');
    toast.success('Briefing clonado — gere novas headlines');
  };

  const handleArchive = async (item: MaquinaCarrossel) => {
    await maquinaApi.patch(item.id, { archived: !item.archived });
    refreshHistorico();
  };

  const handleDelete = async (item: MaquinaCarrossel) => {
    if (!confirm(`Excluir "${item.title}"?`)) return;
    await maquinaApi.remove(item.id);
    if (editingId === item.id) setEditingId(null);
    refreshHistorico();
    toast.success('Excluído');
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
      <div>
        <StageBadge stage={stage} />

        {stage === 'briefing' && (
          <BriefingForm
            briefing={briefing}
            onChange={setBriefing}
            onSubmit={handleGenerateHeadlines}
            loading={loadingHeadlines}
          />
        )}

        {stage === 'headlines' && (
          <HeadlinesPicker
            rawMarkdown={headlinesRaw}
            parsed={headlinesParsed}
            recommendedNum={recommendedNum}
            recommendedReason={recommendedReason}
            loading={loadingHeadlines}
            onPick={handlePickHeadline}
            onRegenerate={handleRegenerateHeadlines}
            onCommand={handleHeadlineCommand}
            onBack={() => setStage('briefing')}
          />
        )}

        {stage === 'structure' && headlineEscolhida && (
          <StructureView
            headline={headlineEscolhida.text}
            structure={estrutura}
            loading={loadingHtml || loadingStructure}
            onApprove={handleApproveStructure}
            onBack={() => setStage('headlines')}
          />
        )}

        {stage === 'preview' && (
          <HtmlPreview
            html={html}
            onHtmlChange={setHtml}
            onBack={() => setStage('structure')}
            onSave={handleSave}
            saving={saving}
            briefingTitle={headlineEscolhida?.text || briefing.tema}
          />
        )}
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <HistoricoSidebar
          items={historico}
          loading={historicoLoading}
          onRefresh={refreshHistorico}
          onOpen={handleOpenHistorico}
          onClone={handleCloneHistorico}
          onArchiveToggle={handleArchive}
          onDelete={handleDelete}
        />
      </aside>
    </div>
  );
}

function StageBadge({ stage }: { stage: Stage }) {
  const labels: Record<Stage, string> = {
    briefing: '1. Briefing',
    headlines: '2. Headlines',
    structure: '3. Estrutura',
    preview: '4. Preview & Export',
    export: '4. Preview & Export',
  };
  return (
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
      <span className="text-orange-400 font-bold">Máquina BrandsDecoded</span>
      <span className="opacity-50">·</span>
      <span>{labels[stage]}</span>
    </div>
  );
}
