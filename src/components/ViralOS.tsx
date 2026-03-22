import React, { useState, useEffect } from 'react';
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
  Calculator,
  ShoppingBag,
  Calendar,
  BookOpen,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Toaster, toast } from 'sonner';
import MetricasCalculadora from './MetricasCalculadora';
import ProdutosEscalaveis from './ProdutosEscalaveis';
import Agendador from './Agendador';
import PesquisaConteudo from './PesquisaConteudo';
import AgenteAutonomo from './AgenteAutonomo';
import { Bot } from 'lucide-react';

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

const initialState: AppState = {
  checkedItems: {},
  inputs: {},
  expandedSections: { passo1: true },
  expandedItems: {},
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

export default function ViralOS() {
  const [activeTab, setActiveTab] = useState<TabId>('roteiro');
  const [state, setState] = useState<AppState>(initialState);

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

  const handleAgenteUseInRoteiro = ({ references }: { references: string }) => {
    setState((prev) => ({
      ...prev,
      inputs: { ...prev.inputs, '1.5': references },
      checkedItems: { ...prev.checkedItems, '1.5': true },
      expandedSections: { ...prev.expandedSections, passo1: true, passo2: true },
      expandedItems: { ...prev.expandedItems, '1.5': true },
    }));
    setActiveTab('roteiro');
    toast.success('Referências adicionadas ao Roteiro — passo 1.5!');
  };

  const totalTasks = roteiro.reduce((acc, s) => acc + s.itens.length, 0);
  const completedTasks = Object.values(state.checkedItems).filter(Boolean).length;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const getSectionProgress = (section: RoteiroSection) => {
    const done = section.itens.filter((i) => state.checkedItems[i.id]).length;
    return { done, total: section.itens.length, pct: Math.round((done / section.itens.length) * 100) };
  };

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
        {activeTab === 'pesquisa'  && <PesquisaConteudo />}
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
                                  <textarea
                                    value={state.inputs[item.id] || ''}
                                    onChange={(e) => handleInputChange(item.id, e.target.value)}
                                    placeholder={item.placeholder}
                                    className="mt-3 w-full bg-secondary border border-border rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 transition-all min-h-[80px] resize-none placeholder:text-muted-foreground/50"
                                  />
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
    </div>
  );
}
