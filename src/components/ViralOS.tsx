import React, { useState, useEffect, useRef } from 'react';
import {
  Check,
  ChevronRight,
  ChevronDown,
  Search,
  Video,
  Edit3,
  BarChart3,
  Repeat,
  Target,
  Zap,
  Trash2,
  Info,
  Copy,
  Play,
  Pause,
  Calculator,
  ShoppingBag,
  Calendar,
  BookOpen,
  Bot,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Toaster, toast } from 'sonner';
import MetricasCalculadora from './MetricasCalculadora';
import ProdutosEscalaveis from './ProdutosEscalaveis';
import Agendador from './Agendador';
import PesquisaConteudo from './PesquisaConteudo';
import AgenteAutonomo from './AgenteAutonomo';

type TabId = 'roteiro' | 'metricas' | 'produtos' | 'agendador' | 'pesquisa' | 'agente';

const tabs: { id: TabId; label: string; icon: React.ComponentType<any> }[] = [
  { id: 'roteiro',   label: 'Roteiro',   icon: Zap },
  { id: 'metricas',  label: 'Métricas',  icon: Calculator },
  { id: 'produtos',  label: 'Produtos',  icon: ShoppingBag },
  { id: 'agendador', label: 'Agendar',   icon: Calendar },
  { id: 'pesquisa',  label: 'Pesquisa',  icon: BookOpen },
  { id: 'agente',    label: 'Agente',    icon: Bot },
];

const easing = [0.25, 0.1, 0.25, 1] as const;

interface RoteiroItem {
  id: string;
  titulo: string;
  subitens?: string[];
  hasInput?: boolean;
  placeholder?: string;
}

interface RoteiroSection {
  id: string;
  icon: React.ComponentType<any>;
  titulo: string;
  accent: string;
  bg: string;
  itens: RoteiroItem[];
}

interface AppState {
  checkedItems: Record<string, boolean>;
  inputs: Record<string, string>;
  expandedSections: Record<string, boolean>;
  expandedItems: Record<string, boolean>;
}

interface TeleprompterState {
  open: boolean;
  scriptId: string | null;
  title: string;
  speed: number;
  fontSize: number;
  countdownDuration: number;
  mirrored: boolean;
  playing: boolean;
}

const initialState: AppState = {
  checkedItems: {},
  inputs: {},
  expandedSections: { passo1: true },
  expandedItems: {},
};

const initialTeleprompterState: TeleprompterState = {
  open: false,
  scriptId: null,
  title: '',
  speed: 32,
  fontSize: 34,
  countdownDuration: 3,
  mirrored: false,
  playing: false,
};

const roteiro: RoteiroSection[] = [
  {
    id: 'passo1',
    icon: Search,
    titulo: '01. PESQUISA DE CAMPO',
    accent: 'text-orange-500',
    bg: 'bg-orange-500',
    itens: [
      {
        id: '1.1',
        titulo: 'Escolha 1 palavra-chave do seu nicho',
        subitens: ['testosterona', 'TRT', 'GLP-1', 'anabolizantes', 'hormônios', 'shape definido', 'ganhar massa', 'perder gordura', 'cortisol alto', 'resistência insulina'],
      },
      {
        id: '1.2',
        titulo: 'Pesquise no TikTok',
        subitens: ['Digite a palavra-chave em PORTUGUÊS', 'Para conteúdo gringo: pesquise em INGLÊS ou RUSSO (ex: "testosterone", "тестостерон")', 'Clique em "Filtros"'],
      },
      {
        id: '1.3',
        titulo: 'Aplique os filtros corretos',
        subitens: ['Ordenar por: CONTAGEM DE CURTIDA (mais curtida = mais views)', 'Data de publicação: ESSE MÊS (não pegar vídeo antigo)'],
      },
      {
        id: '1.4',
        titulo: 'Encontre vídeos MEIO DE FUNIL',
        subitens: ['Duração: 50s a 1min20', 'Formato: pessoa falando + técnica + entretenimento', 'Salve 5-10 vídeos viralizados', 'Anote os FORMATOS que se repetem'],
      },
      {
        id: '1.5',
        titulo: 'Seleção de Referências (5-10 vídeos)',
        hasInput: true,
        placeholder: 'Cole os links ou temas dos vídeos encontrados aqui...',
      },
    ],
  },
  {
    id: 'passo2',
    icon: Video,
    titulo: '02. DEFINIÇÃO DE FORMATOS',
    accent: 'text-emerald-500',
    bg: 'bg-emerald-500',
    itens: [
      {
        id: '2.1',
        titulo: 'Identifique os 2 formatos mais virais',
        subitens: ['Ex: "3 sinais que sua testosterona está baixa"', 'Ex: "O que ninguém te conta sobre TRT"', 'Ex: "Antes e depois de otimizar hormônios"'],
      },
      {
        id: '2.2',
        titulo: 'Adapte para o SEU nicho',
        subitens: ['Ex: "3 mistakes killing your testosterone" → "3 erros que matam sua testosterona"', 'Mantenha a ESTRUTURA, mude o CONTEÚDO para sua expertise'],
      },
      {
        id: '2.3',
        titulo: 'FORMATO A (Obrigatório)',
        hasInput: true,
        placeholder: 'Ex: Lista de 3 sinais...',
      },
      {
        id: '2.4',
        titulo: 'FORMATO B (Obrigatório)',
        hasInput: true,
        placeholder: 'Ex: O que ninguém te conta sobre...',
      },
    ],
  },
  {
    id: 'passo3',
    icon: Edit3,
    titulo: '03. ROTEIRIZA / GRAVA / EDITA / POSTA',
    accent: 'text-blue-500',
    bg: 'bg-blue-500',
    itens: [
      {
        id: '3.1',
        titulo: 'ROTEIRIZA - Anatomia do Vídeo',
        subitens: [
          '✅ GANCHO (2-4s): Visual + auditivo + textual + verbal',
          '✅ DESENVOLVIMENTO (40-60s): Dinamismo + quebras de padrão',
          '✅ CTA (começo/meio/final): Comentar, seguir, compartilhar',
          '✅ EMOÇÃO CENTRAL: Curiosidade, surpresa, medo, urgência',
          '✅ ENTRETENIMENTO + TÉCNICA: Distrair + ser útil',
        ],
      },
      {
        id: '3.1.a',
        titulo: 'ROTEIRO FINAL A (Pronto para gravar)',
        hasInput: true,
        placeholder: 'Gancho, desenvolvimento e CTA final do Roteiro Pronto 1...',
      },
      {
        id: '3.1.b',
        titulo: 'ROTEIRO FINAL B (Pronto para gravar)',
        hasInput: true,
        placeholder: 'Gancho, desenvolvimento e CTA final do Roteiro Pronto 2...',
      },
      {
        id: '3.2',
        titulo: 'GRAVA',
        subitens: ['Cenário com mudança visual (quebra de padrão)', 'Tom de voz variado (não monótono)', 'Duração: 50seg a 1min20'],
      },
      {
        id: '3.3',
        titulo: 'EDITA',
        subitens: ['Transição vs corte seco (ritmo)', 'Zoom in/out, imagens de apoio', 'Efeito sonoro (pausa, som alto)', 'Texto na tela (frase provocativa no gancho)'],
      },
      {
        id: '3.4',
        titulo: 'POSTA',
        subitens: ['Identifique o melhor horário no painel profissional', 'Poste ANTES do horário de pico', 'Caption com CTA para keyword do funil de DM', 'Caixinha nos stories sobre o tema'],
      },
    ],
  },
  {
    id: 'passo4',
    icon: BarChart3,
    titulo: '04. ANÁLISE E OTIMIZAÇÃO',
    accent: 'text-purple-500',
    bg: 'bg-purple-500',
    itens: [
      {
        id: '4.1',
        titulo: 'Poste 10 vídeos de cada formato (total: 20)',
        subitens: ['Formato A: 10 posts', 'Formato B: 10 posts'],
      },
      {
        id: '4.2',
        titulo: 'Analise as métricas após os 20 posts',
        subitens: ['Qual formato teve MAIS VIEWS de não seguidores?', 'Qual GANHOU MAIS SEGUIDORES?', 'Retenção acima de 70% nos primeiros 3s?', 'Melhor ENGAJAMENTO (comentários, compartilhamentos, salvos)?'],
      },
      {
        id: '4.3',
        titulo: 'Elege o CAMPEÃO',
        subitens: ['O formato vencedor vira seu PADRÃO', 'Continue postando esse formato'],
      },
      {
        id: '4.4',
        titulo: 'Traz OUTRO FORMATO para disputar',
        subitens: ['Volta ao PASSO 1: pesquisa novo formato viral', 'Teste A/B contínuo: sempre 2 formatos rodando', 'Repete o ciclo infinitamente'],
      },
      {
        id: '4.5',
        titulo: 'Veredito do Campeão',
        hasInput: true,
        placeholder: 'Qual formato performou melhor e por quê?',
      },
    ],
  },
  {
    id: 'bonus',
    icon: Repeat,
    titulo: '05. CICLO CONTÍNUO',
    accent: 'text-rose-400',
    bg: 'bg-rose-400',
    itens: [
      {
        id: 'b.1',
        titulo: 'Meta de alta performance',
        subitens: ['+50k novos seguidores/mês', '1-2 vídeos/semana com +10k seguidores', 'Viralização = NÃO seguidores + seguidores orgânicos'],
      },
      {
        id: 'b.2',
        titulo: 'Regra de ouro',
        subitens: ['80% da performance é o GANCHO', 'Acima de 70% de retenção nos 3s = viral', 'Se o vídeo é ÚTIL = alto potencial viral'],
      },
      {
        id: 'b.3',
        titulo: 'Stories NÃO é prioridade para viralização',
        subitens: ['Stories ganha relevância DEPOIS da captura', 'Use stories para nutrir leads já captados'],
      },
    ],
  },
];

const keywords = [
  'testosterona / testosterone / тестостерон',
  'TRT / testosterone replacement',
  'GLP-1 / ozempic / semaglutide',
  'anabolizantes / steroids / стероиды',
  'hormônios / hormones / гормоны',
  'shape definido / shredded physique',
  'ganhar massa / build muscle',
  'perder gordura / fat loss',
  'cortisol alto / high cortisol',
  'resistência insulina / insulin resistance',
];

const roteiroFinalIds = new Set(['3.1.a', '3.1.b']);
const gravacaoChecklist = [
  'Gancho forte nos primeiros 3 segundos',
  'Desenvolvimento com ritmo e quebras de padrão',
  'CTA final claro',
  'Texto de apoio na tela',
  'Emoção central definida',
  'Cenário ou enquadramento com contraste visual',
];

function extractScriptField(text: string, labels: string[]) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(new RegExp(`${escaped}:\\s*(.+)`));
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return '';
}

function parseDetailedScript(text: string) {
  return [
    { label: 'Abertura visual', value: extractScriptField(text, ['Abertura visual']) },
    { label: 'Texto na tela', value: extractScriptField(text, ['Texto na tela']) },
    { label: 'Gancho verbal', value: extractScriptField(text, ['Gancho verbal', 'Gancho']) },
    { label: 'Frase 1', value: extractScriptField(text, ['Frase 1']) },
    { label: 'Frase 2', value: extractScriptField(text, ['Frase 2']) },
    { label: 'Frase 3', value: extractScriptField(text, ['Frase 3']) },
    { label: 'Quebra de padrão', value: extractScriptField(text, ['Quebra de padrao', 'Quebra de padrão']) },
    { label: 'Desenvolvimento', value: extractScriptField(text, ['Desenvolvimento']) },
    { label: 'CTA final', value: extractScriptField(text, ['CTA final']) },
    { label: 'Tom / emoção', value: extractScriptField(text, ['Tom / emocao', 'Tom / emoção']) },
  ].filter((item) => item.value);
}

function TeleprompterOverlay({
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

        <div className="grid gap-4 border-b border-white/10 bg-zinc-950 px-4 py-3 sm:grid-cols-3">
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

export default function ViralOS() {
  const [activeTab, setActiveTab] = useState<TabId>('roteiro');
  const [state, setState] = useState<AppState>(initialState);
  const [teleprompter, setTeleprompter] = useState<TeleprompterState>(initialTeleprompterState);

  useEffect(() => {
    const saved = localStorage.getItem('viral-os-data');
    if (saved) {
      try {
        setState(JSON.parse(saved));
      } catch {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('viral-os-data', JSON.stringify(state));
  }, [state]);

  const toggleCheck = (id: string) => {
    setState((prev) => ({
      ...prev,
      checkedItems: { ...prev.checkedItems, [id]: !prev.checkedItems[id] },
    }));
  };

  const handleInputChange = (id: string, value: string) => {
    setState((prev) => ({
      ...prev,
      inputs: { ...prev.inputs, [id]: value },
    }));
  };

  const copyInputValue = async (id: string, label: string) => {
    const value = state.inputs[id] || '';
    if (!value.trim()) {
      toast.error(`${label} ainda está vazio.`);
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copiado!`, { duration: 1500 });
    } catch {
      toast.error(`Nao foi possivel copiar ${label.toLowerCase()}.`);
    }
  };

  const openTeleprompter = (id: string, title: string) => {
    const value = state.inputs[id] || '';
    if (!value.trim()) {
      toast.error(`Preencha ${title} antes de abrir o teleprompter.`);
      return;
    }

    setTeleprompter((prev) => ({
      ...prev,
      open: true,
      scriptId: id,
      title,
      playing: false,
    }));
  };

  const closeTeleprompter = () => {
    setTeleprompter((prev) => ({ ...prev, open: false, playing: false, scriptId: null, title: '' }));
  };

  const toggleSection = (id: string) => {
    setState((prev) => ({
      ...prev,
      expandedSections: { ...prev.expandedSections, [id]: !prev.expandedSections[id] },
    }));
  };

  const toggleItem = (id: string) => {
    setState((prev) => ({
      ...prev,
      expandedItems: { ...prev.expandedItems, [id]: !prev.expandedItems[id] },
    }));
  };

  const resetProgress = () => {
    if (confirm('Deseja resetar todo o progresso e anotações?')) {
      setState(initialState);
    }
  };

  const handleAgenteUseInRoteiro = ({
    references,
    formatA,
    formatB,
    script1,
    script2,
  }: {
    references: string;
    formatA?: string;
    formatB?: string;
    script1?: string;
    script2?: string;
  }) => {
    const hasFormats = Boolean(formatA || formatB);
    const hasScripts = Boolean(script1 || script2);
    setState((prev) => ({
      ...prev,
      inputs: {
        ...prev.inputs,
        '1.5': references,
        ...(formatA ? { '2.3': formatA } : {}),
        ...(formatB ? { '2.4': formatB } : {}),
        ...(script1 ? { '3.1.a': script1 } : {}),
        ...(script2 ? { '3.1.b': script2 } : {}),
      },
      checkedItems: {
        ...prev.checkedItems,
        '1.5': true,
        ...(formatA ? { '2.3': true } : {}),
        ...(formatB ? { '2.4': true } : {}),
        ...(script1 ? { '3.1.a': true } : {}),
        ...(script2 ? { '3.1.b': true } : {}),
      },
      expandedSections: { ...prev.expandedSections, passo1: true, passo2: true, ...(hasScripts ? { passo3: true } : {}) },
      expandedItems: {
        ...prev.expandedItems,
        '1.5': true,
        ...(formatA ? { '2.3': true } : {}),
        ...(formatB ? { '2.4': true } : {}),
        ...(script1 ? { '3.1.a': true } : {}),
        ...(script2 ? { '3.1.b': true } : {}),
      },
    }));
    setActiveTab('roteiro');
    toast.success(
      hasScripts
        ? 'Dossie aplicado no roteiro: referencias, formatos e roteiros finais preenchidos.'
        : hasFormats
        ? 'Dossie aplicado no roteiro: referencias em 1.5 e formatos em 2.3/2.4.'
        : 'Referencias aplicadas no roteiro no passo 1.5.'
    );
  };

  const totalTasks = roteiro.reduce((acc, s) => acc + s.itens.length, 0);
  const completedTasks = Object.values(state.checkedItems).filter(Boolean).length;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const getSectionProgress = (section: RoteiroSection) => {
    const done = section.itens.filter((i) => state.checkedItems[i.id]).length;
    return { done, total: section.itens.length, pct: Math.round((done / section.itens.length) * 100) };
  };

  const teleprompterText = teleprompter.scriptId ? state.inputs[teleprompter.scriptId] || '' : '';

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      <Toaster position="bottom-center" richColors />
      {/* Header */}
      <header className="sticky top-0 z-30 bg-card/80 backdrop-blur-md border-b border-border">
        <div className="max-w-3xl mx-auto px-4 h-14 sm:h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 sm:w-8 sm:h-8 bg-foreground rounded-lg flex items-center justify-center">
              <Zap size={16} className="text-background" />
            </div>
            <span className="font-extrabold tracking-tight text-sm uppercase">
              ViralOS <span className="hidden sm:inline text-muted-foreground font-medium">v2.0</span>
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            {activeTab === 'roteiro' && (
              <div className="flex items-center gap-2 bg-secondary px-2.5 sm:px-3 py-1.5 rounded-full">
                <div className="w-16 sm:w-24 h-1.5 bg-border rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-foreground rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.5, ease: easing }}
                  />
                </div>
                <span className="text-xs font-mono font-bold tabular-nums">{progress}%</span>
              </div>
            )}
            <button
              onClick={resetProgress}
              className="p-2 text-muted-foreground hover:text-destructive transition-colors"
              title="Resetar Progresso"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
        {/* Tab Bar — ícone+label no desktop, só ícone no mobile */}
        <div className="max-w-3xl mx-auto flex">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                title={tab.label}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold uppercase tracking-wider transition-all border-b-2 ${
                  isActive
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground/70'
                }`}
              >
                <Icon size={15} />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-3 sm:px-4 pt-5 sm:pt-8">
        {activeTab === 'metricas'  && <MetricasCalculadora />}
        {activeTab === 'produtos'  && <ProdutosEscalaveis />}
        {activeTab === 'agendador' && <Agendador />}
        {activeTab === 'pesquisa'  && <PesquisaConteudo onUseInRoteiro={handleAgenteUseInRoteiro} />}
        {activeTab === 'agente'    && <AgenteAutonomo onUseInRoteiro={handleAgenteUseInRoteiro} />}
        {activeTab === 'roteiro' && (<>
        <section className="mb-10">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-2 text-balance">
            Roteiro de Viralização
          </h1>
          <p className="text-muted-foreground text-xs sm:text-sm mb-4 sm:mb-6 hidden sm:block">
            Meio de Funil Viral — Estratégia Completa de Alta Performance
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-card rounded-2xl flex gap-4 items-start" style={{ boxShadow: 'var(--shadow-card)' }}>
              <div className="p-2 bg-orange-50 rounded-lg text-orange-600 shrink-0">
                <Target size={20} />
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Meta Mensal</h3>
                <p className="text-sm font-semibold">+50k Seguidores Orgânicos</p>
              </div>
            </div>
            <div className="p-4 bg-card rounded-2xl flex gap-4 items-start" style={{ boxShadow: 'var(--shadow-card)' }}>
              <div className="p-2 bg-blue-50 rounded-lg text-blue-600 shrink-0">
                <Info size={20} />
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Fórmula Viral</h3>
                <p className="text-sm font-semibold">Entretenimento + Técnica</p>
              </div>
            </div>
          </div>
        </section>

        {/* Formula Card */}
        <section className="mb-10 p-6 rounded-2xl bg-foreground text-background" style={{ boxShadow: 'var(--shadow-layered)' }}>
          <h3 className="font-bold text-lg mb-3">⚡ Fórmula do Meio de Funil Viral</h3>
          <div className="bg-background/10 p-4 rounded-xl">
            <p className="text-center text-xl font-extrabold mb-4 tracking-tight">
              ENTRETENIMENTO + TÉCNICA = VIRALIZAÇÃO
            </p>
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="font-semibold mb-1">Entretenimento (Distração):</p>
                <p className="opacity-75">Curiosidade, susto, indignação, medo → abstrair da realidade e prender atenção</p>
              </div>
              <div>
                <p className="font-semibold mb-1">Técnica (Utilidade):</p>
                <p className="opacity-75">Visão técnica + promessa do produto → "já me segue pra chegar num shape forte"</p>
              </div>
            </div>
            <p className="text-center mt-4 text-sm font-semibold opacity-75">⏱️ Duração ideal: 50seg a 1min20</p>
          </div>
        </section>

        {/* Steps */}
        <div className="space-y-6">
          {roteiro.map((section) => {
            const sp = getSectionProgress(section);
            return (
              <div
                key={section.id}
                className="bg-card rounded-2xl overflow-hidden transition-all"
                style={{ boxShadow: 'var(--shadow-layered)' }}
              >
                <button
                  onClick={() => toggleSection(section.id)}
                  className="w-full flex items-center justify-between p-5 hover:bg-secondary/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-xl ${section.bg} text-white shrink-0`}>
                      <section.icon size={20} />
                    </div>
                    <div className="text-left">
                      <h2 className="font-bold text-sm tracking-wide">{section.titulo}</h2>
                      <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                        {sp.done}/{sp.total} concluído ({sp.pct}%)
                      </p>
                    </div>
                  </div>
                  {state.expandedSections[section.id] ? (
                    <ChevronDown size={18} className="text-muted-foreground" />
                  ) : (
                    <ChevronRight size={18} className="text-muted-foreground" />
                  )}
                </button>

                <AnimatePresence>
                  {state.expandedSections[section.id] && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: easing }}
                    >
                      <div className="px-5 pb-5 space-y-4">
                        {section.itens.map((item) => (
                          <div key={item.id} className="group">
                            <div className="flex items-start gap-3">
                              <button
                                onClick={() => toggleCheck(item.id)}
                                className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all shrink-0 ${
                                  state.checkedItems[item.id]
                                    ? `${section.bg} border-transparent`
                                    : 'border-border group-hover:border-muted-foreground'
                                }`}
                              >
                                {state.checkedItems[item.id] && (
                                  <Check size={14} className="text-white" strokeWidth={3} />
                                )}
                              </button>
                              <div className="flex-1 min-w-0">
                                <button
                                  onClick={() => item.subitens && toggleItem(item.id)}
                                  className={`text-left w-full flex items-center justify-between gap-2 text-sm font-semibold transition-opacity ${
                                    state.checkedItems[item.id] ? 'opacity-40 line-through' : 'opacity-100'
                                  }`}
                                >
                                  <span>{item.titulo}</span>
                                  {item.subitens && (
                                    state.expandedItems[item.id] ? (
                                      <ChevronDown size={14} className="text-muted-foreground shrink-0" />
                                    ) : (
                                      <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                                    )
                                  )}
                                </button>

                                <AnimatePresence>
                                  {item.subitens && state.expandedItems[item.id] && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: 'auto', opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={{ duration: 0.15, ease: easing }}
                                    >
                                      <div className="mt-2 flex flex-wrap gap-2">
                                        {item.subitens.map((sub, idx) => (
                                          <span
                                            key={idx}
                                            className="text-[11px] font-medium px-2 py-1 bg-secondary text-muted-foreground rounded-md"
                                          >
                                            {sub}
                                          </span>
                                        ))}
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>

                                {item.hasInput && (
                                  <div className="mt-3 space-y-3">
                                    {roteiroFinalIds.has(item.id) && (
                                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2">
                                        <div>
                                          <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Area de Gravacao</p>
                                          <p className="text-xs text-blue-700/80">Script final pronto para copiar, ajustar e gravar.</p>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                          <button
                                            onClick={() => openTeleprompter(item.id, item.titulo)}
                                            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:border-blue-300 transition-colors"
                                            title={`Abrir ${item.titulo} no teleprompter`}
                                          >
                                            <Play size={12} />
                                            Teleprompter
                                          </button>
                                          <button
                                            onClick={() => copyInputValue(item.id, item.titulo)}
                                            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:border-blue-300 transition-colors"
                                            title={`Copiar ${item.titulo}`}
                                          >
                                            <Copy size={12} />
                                            Copiar roteiro
                                          </button>
                                        </div>
                                      </div>
                                    )}

                                    <textarea
                                      value={state.inputs[item.id] || ''}
                                      onChange={(e) => handleInputChange(item.id, e.target.value)}
                                      placeholder={item.placeholder}
                                      className={`w-full bg-secondary border border-border rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 transition-all resize-none placeholder:text-muted-foreground/50 ${
                                        roteiroFinalIds.has(item.id) ? 'min-h-[180px] font-medium leading-relaxed' : 'min-h-[80px]'
                                      }`}
                                    />

                                    {roteiroFinalIds.has(item.id) && (
                                      <div className="rounded-xl bg-secondary/70 p-3">
                                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Checklist de Gravacao</p>
                                        <div className="grid gap-2 sm:grid-cols-2">
                                          {gravacaoChecklist.map((check, idx) => (
                                            <div key={idx} className="flex items-center gap-2 text-xs text-muted-foreground">
                                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-background border border-border">
                                                <Check size={11} className="text-blue-500" />
                                              </span>
                                              <span>{check}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {roteiroFinalIds.has(item.id) && parseDetailedScript(state.inputs[item.id] || '').length > 0 && (
                                      <div className="rounded-xl border border-border bg-card p-3">
                                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Fala por etapa</p>
                                        <div className="space-y-2">
                                          {parseDetailedScript(state.inputs[item.id] || '').map((stage) => (
                                            <div key={stage.label} className="rounded-lg bg-secondary/70 p-2.5">
                                              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{stage.label}</p>
                                              <p className="mt-1 text-sm text-foreground">{stage.value}</p>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        {/* Keywords */}
        <section className="mt-10 p-6 bg-card rounded-2xl" style={{ boxShadow: 'var(--shadow-layered)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Search size={18} className="text-blue-500" />
            <h3 className="text-sm font-bold uppercase tracking-wider">Palavras-chave para pesquisar</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {keywords.map((kw, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-2 bg-secondary px-3 py-2 rounded-lg text-xs font-medium text-muted-foreground group"
              >
                <span>{kw}</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(kw.split(' / ')[0]);
                    toast.success('Copiado!', { duration: 1500 });
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                  title="Copiar"
                >
                  <Copy size={12} />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-10 p-6 bg-foreground rounded-2xl text-background">
          <div className="flex items-center gap-2 mb-4">
            <Repeat size={18} className="text-emerald-400" />
            <span className="text-xs font-bold uppercase tracking-widest">Ciclo Contínuo</span>
          </div>
          <p className="text-background/60 text-sm leading-relaxed">
            A viralização não é um evento único, é um processo de{' '}
            <span className="text-background font-medium">iteração</span>. Se o vídeo não performou, o problema está
            no <span className="text-emerald-400 font-medium underline underline-offset-4">Gancho (primeiros 3s)</span>.
            Analise, ajuste e repita.
          </p>
        </footer>
        </>)}
      </main>
      <TeleprompterOverlay
        open={teleprompter.open}
        title={teleprompter.title}
        text={teleprompterText}
        speed={teleprompter.speed}
        fontSize={teleprompter.fontSize}
        countdownDuration={teleprompter.countdownDuration}
        mirrored={teleprompter.mirrored}
        playing={teleprompter.playing}
        onClose={closeTeleprompter}
        onTogglePlaying={() => setTeleprompter((prev) => ({ ...prev, playing: !prev.playing }))}
        onSpeedChange={(value) => setTeleprompter((prev) => ({ ...prev, speed: value }))}
        onFontSizeChange={(value) => setTeleprompter((prev) => ({ ...prev, fontSize: value }))}
        onCountdownDurationChange={(value) => setTeleprompter((prev) => ({ ...prev, countdownDuration: value }))}
        onToggleMirror={() => setTeleprompter((prev) => ({ ...prev, mirrored: !prev.mirrored }))}
      />
    </div>
  );
}
