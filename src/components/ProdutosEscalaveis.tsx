import React, { useState } from 'react';
import { ChevronDown, ChevronRight, DollarSign, Layers, Crown, MessageCircle, BookOpen, Monitor, ArrowRight, Star, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const easing = [0.25, 0.1, 0.25, 1] as const;

interface Product {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ComponentType<any>;
  badge: string;
  badgeColor: string;
  priceRange: string;
  priority: 'principal' | 'secundaria';
  fluxo: string[];
  tickets: { price: string; period: string }[];
  insights: string[];
}

const products: Product[] = [
  {
    id: 'consultoria',
    title: 'Consultoria Online Escalável',
    subtitle: 'Modelo principal de monetização — alto ticket, menos leads, mais lucro',
    icon: Crown,
    badge: 'PRINCIPAL',
    badgeColor: 'bg-orange-500',
    priceRange: 'R$ 497 a R$ 997',
    priority: 'principal',
    fluxo: [
      'Mensagem de boas-vindas',
      'Anamnese',
      'Entrega de Protocolo',
      'Orientações de como utilizar o protocolo e o atendimento',
      'Suporte para dúvidas em horário comercial',
      'Contato ativo semanal, quinzenal ou mensal',
    ],
    tickets: [
      { price: 'R$ 997', period: 'Trimestral' },
      { price: 'R$ 697', period: 'Trimestral' },
      { price: 'R$ 597', period: 'Trimestral' },
      { price: 'R$ 497', period: 'Trimestral' },
      { price: 'R$ 497', period: 'Semestral' },
      { price: 'R$ 497', period: 'Anual' },
    ],
    insights: [
      'Vale a pena cobrar mais caro e com menos leads fazer mais dinheiro',
      'O problema nunca é preço — é posicionamento e autoridade',
      'Escala vem do volume de demanda gerada pelos Reels, não do preço baixo',
    ],
  },
  {
    id: 'plataforma',
    title: 'Plataforma Estilo "Netflix"',
    subtitle: 'Recorrência mensal — complementar, não é tão eficiente sozinha',
    icon: Monitor,
    badge: 'SECUNDÁRIA',
    badgeColor: 'bg-muted-foreground',
    priceRange: 'R$ 297 a R$ 397',
    priority: 'secundaria',
    fluxo: [
      'Mensagem de boas-vindas',
      'Acessos (login e senha)',
      'Módulo de "Comece Por Aqui"',
      'Protocolo de treino gravado em formato de aulas e dieta com explicação em aulas com arquivos anexados',
      'Suporte para dúvidas em horário comercial',
      'Contato ativo opcional',
    ],
    tickets: [
      { price: 'R$ 297', period: 'Mensal' },
      { price: 'R$ 347', period: 'Mensal' },
      { price: 'R$ 397', period: 'Mensal' },
    ],
    insights: [
      'Não é tão eficiente quanto consultoria — menor ticket, maior churn',
      'Funciona como porta de entrada ou upsell para consultoria',
      'Bom para monetizar audiência que não compraria consultoria',
    ],
  },
];

export default function ProdutosEscalaveis() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ consultoria: true });

  const toggle = (id: string) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <section>
        <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight mb-1">💰 Produtos Escaláveis</h2>
        <p className="text-muted-foreground text-xs sm:text-sm hidden sm:block">Formatos de entrega e precificação para faturar R$50k-100k/mês orgânico</p>
      </section>

      {/* Funil Alicerce */}
      <div className="bg-foreground text-background p-6 rounded-2xl" style={{ boxShadow: 'var(--shadow-layered)' }}>
        <h3 className="font-extrabold text-xl mb-1 tracking-tight">FUNIL ALICERCE</h3>
        <p className="text-sm opacity-70 mb-4">Como faturar R$50k/mês a 100k/mês (no mínimo) — 100% Orgânico</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { step: '1', label: 'Geração de Demanda', desc: 'Reels meio de funil viral → alcance + seguidores', color: 'bg-orange-500/20 text-orange-300' },
            { step: '2', label: 'Captura da Demanda', desc: 'Stories + Bio → lead qualificado para WhatsApp', color: 'bg-emerald-500/20 text-emerald-300' },
          ].map(item => (
            <div key={item.step} className={`${item.color} p-4 rounded-xl`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-6 h-6 rounded-full bg-background/20 flex items-center justify-center text-xs font-extrabold">{item.step}</span>
                <span className="font-bold text-sm">{item.label}</span>
              </div>
              <p className="text-xs opacity-80">{item.desc}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-2">
          {[
            { icon: '👁️', label: 'Alcance/Visualizações' },
            { icon: '🤝', label: 'Identificação, Conexão, Interação' },
            { icon: '➕', label: 'Seguir' },
            { icon: '📚', label: 'Doutrinar/Evangelizar' },
            { icon: '🎯', label: 'Captura do Lead' },
            { icon: '💰', label: 'Conversão $$' },
          ].map((step, idx) => (
            <div key={idx} className="flex items-center gap-3 bg-background/5 px-4 py-2 rounded-lg">
              <span>{step.icon}</span>
              <span className="text-sm font-medium">{step.label}</span>
              {idx < 5 && <ArrowRight size={12} className="ml-auto opacity-30" />}
            </div>
          ))}
        </div>
      </div>

      {/* Products */}
      {products.map(product => {
        const Icon = product.icon;
        const isOpen = expanded[product.id];
        return (
          <div key={product.id} className="bg-card rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--shadow-layered)' }}>
            <button onClick={() => toggle(product.id)} className="w-full p-5 flex items-center justify-between hover:bg-secondary/50 transition-colors">
              <div className="flex items-center gap-4">
                <div className={`p-2 rounded-xl ${product.priority === 'principal' ? 'bg-orange-500' : 'bg-muted-foreground'} text-white shrink-0`}>
                  <Icon size={20} />
                </div>
                <div className="text-left">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-sm">{product.title}</h3>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full text-white ${product.badgeColor}`}>{product.badge}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{product.subtitle}</p>
                </div>
              </div>
              {isOpen ? <ChevronDown size={18} className="text-muted-foreground" /> : <ChevronRight size={18} className="text-muted-foreground" />}
            </button>

            <AnimatePresence>
              {isOpen && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: easing }}>
                  <div className="px-5 pb-5 space-y-5">
                    {/* Price */}
                    <div className="flex items-center gap-2 p-3 bg-secondary rounded-xl">
                      <DollarSign size={18} className="text-emerald-500" />
                      <span className="text-sm font-bold">Faixa de Preço:</span>
                      <span className="text-sm font-extrabold text-emerald-600">{product.priceRange}</span>
                    </div>

                    {/* Fluxo */}
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Layers size={16} className="text-muted-foreground" />
                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Fluxo de Entrega</h4>
                      </div>
                      <div className="space-y-2">
                        {product.fluxo.map((item, idx) => (
                          <div key={idx} className="flex items-start gap-3 p-2.5 bg-secondary rounded-lg">
                            <span className="w-5 h-5 rounded-full bg-foreground/10 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">{idx + 1}</span>
                            <span className="text-sm">{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Tickets */}
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <DollarSign size={16} className="text-muted-foreground" />
                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Opções de Ticket</h4>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {product.tickets.map((t, idx) => (
                          <div key={idx} className="p-3 bg-secondary rounded-xl text-center">
                            <p className="text-lg font-extrabold">{t.price}</p>
                            <p className="text-xs text-muted-foreground">{t.period}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Insights */}
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Star size={16} className="text-orange-500" />
                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Insights</h4>
                      </div>
                      <div className="space-y-2">
                        {product.insights.map((insight, idx) => (
                          <div key={idx} className="flex items-start gap-2 text-sm">
                            <AlertCircle size={14} className="text-orange-500 shrink-0 mt-0.5" />
                            <span className="text-muted-foreground">{insight}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      {/* Strategy Card */}
      <div className="bg-card rounded-2xl p-6" style={{ boxShadow: 'var(--shadow-layered)' }}>
        <h3 className="font-bold text-sm uppercase tracking-wider mb-4">🎯 Estratégia de Captação — Onde Focar</h3>
        <div className="space-y-3">
          {[
            { canal: 'Reels (Meio de Funil)', eficacia: 'O 80/20', desc: 'Melhor CTA para ganhar seguidores. Viraliza "eu", gera conexão e autoridade.', pct: 80, color: 'bg-orange-500' },
            { canal: 'Bio', eficacia: 'Melhor Lead', desc: 'O lead que vem da bio é o mais qualificado — já pesquisou, já decidiu.', pct: 70, color: 'bg-emerald-500' },
            { canal: 'Stories', eficacia: 'Captura + Nutrição', desc: 'Melhor para capturar demanda e nutrir leads já captados. Não é para viralizar.', pct: 55, color: 'bg-blue-500' },
            { canal: 'Carrossel', eficacia: 'Volume (Não é 80/20)', desc: 'Viraliza texto, não viraliza "eu". Bom para dar volume, difícil converter lead.', pct: 30, color: 'bg-muted-foreground' },
          ].map((item, idx) => (
            <div key={idx} className="p-4 bg-secondary rounded-xl">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold">{item.canal}</span>
                <span className="text-xs font-bold text-muted-foreground">{item.eficacia}</span>
              </div>
              <p className="text-xs text-muted-foreground mb-2">{item.desc}</p>
              <div className="h-1.5 bg-border rounded-full overflow-hidden">
                <div className={`h-full ${item.color} rounded-full transition-all`} style={{ width: `${item.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
