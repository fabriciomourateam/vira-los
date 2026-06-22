import React, { useState } from 'react';
import {
  BarChart3, CheckCircle2, Clock, Circle, FileText, Target,
  TrendingUp, Calendar, Settings, ExternalLink,
} from 'lucide-react';

/**
 * PainelSEO — visão do projeto de SEO/orgânico do Fabricio (repo fabriciomoura-seo).
 * Espelha a fonte de verdade (data.js / Semrush, jun/2026). Serve pra conferir o
 * que já foi feito no tráfego orgânico e o que falta — sem precisar abrir o repo.
 */

type Status = 'done' | 'wip' | 'todo';

function statusOf(raw: string): Status {
  const s = raw.toLowerCase();
  if (s.includes('conclu') || s.includes('publicad') || s.includes('verificad') ||
      s.includes('instalad') || s.includes('plugad') || s === 'pronto') return 'done';
  if (s.includes('andamento')) return 'wip';
  return 'todo';
}

const STATUS_STYLE: Record<Status, string> = {
  done: 'bg-green-500/15 text-green-400 border-green-500/30',
  wip:  'bg-blue-500/15 text-blue-400 border-blue-500/30',
  todo: 'bg-secondary text-muted-foreground border-border',
};

const StatusBadge = ({ label }: { label: string }) => (
  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${STATUS_STYLE[statusOf(label)]}`}>
    {label}
  </span>
);

const StatusIcon = ({ s }: { s: Status }) =>
  s === 'done' ? <CheckCircle2 size={16} className="text-green-400 shrink-0" /> :
  s === 'wip'  ? <Clock size={16} className="text-blue-400 shrink-0" /> :
                 <Circle size={16} className="text-muted-foreground shrink-0" />;

const SEO = {
  objetivo: 'Dobrar o faturamento somando tráfego ORGÂNICO ao tráfego PAGO já existente',
  diagnostico: {
    organico: 'Praticamente ZERO (2 keywords de marca)',
    custoLeadPago: 'R$ 19,31 por conversa no WhatsApp',
    oportunidade: 'Canal orgânico 100% intocado — maior alavanca de margem (lead orgânico sai ~R$ 0)',
  },
  fases: [
    { n: 0, nome: 'Setup & diagnóstico', status: 'Concluída' },
    { n: 1, nome: 'Concorrentes & palavras-chave', status: 'Concluída' },
    { n: 2, nome: 'Calendário editorial 90 dias', status: 'Concluída' },
    { n: 3, nome: 'Análise do tráfego pago', status: 'Concluída' },
    { n: 4, nome: 'SEO técnico & on-page', status: 'Em andamento' },
    { n: 5, nome: 'Funil & projeção de faturamento', status: 'Pendente' },
    { n: 6, nome: 'Re-análise periódica', status: 'Agendável' },
  ],
  entregaveis: [
    { tipo: 'Ferramenta', nome: 'Calculadora de IMC e Gasto Calórico', status: 'Publicada + indexada' },
    { tipo: 'Artigo', nome: 'Creatina engorda?', status: 'Publicado' },
    { tipo: 'Artigo', nome: '6 alimentos ricos em fibras', status: 'Publicado' },
    { tipo: 'Artigo', nome: 'Déficit calórico', status: 'Publicado' },
    { tipo: 'Artigo', nome: 'Gordura visceral', status: 'Publicado' },
    { tipo: 'Artigo', nome: 'Cardápio para quem toma Mounjaro', status: 'Pronto — a publicar' },
    { tipo: 'Página', nome: 'Nutricionista Esportivo (quick win KDI 10)', status: 'Guia pronto — a montar' },
    { tipo: 'Página', nome: 'Nutricionista Online', status: 'Guia pronto — a montar' },
    { tipo: 'Estratégia', nome: 'Roadmap orgânico (varredura final)', status: 'Pronto' },
    { tipo: 'SEO técnico', nome: 'Disavow de backlinks tóxicos', status: 'Pronto — subir no GSC' },
  ],
  quickWins: [
    { kw: 'cardápio para quem toma mounjaro', kdi: 8, vol: 260 },
    { kw: 'nutricionista esportivo', kdi: 10, vol: 5400 },
    { kw: 'creatina engorda ou emagrece', kdi: 15, vol: 1900 },
    { kw: 'nutricionista esportiva', kdi: 16, vol: 1600 },
    { kw: 'nutricionista online', kdi: 28, vol: 6600 },
    { kw: 'arroz engorda', kdi: 30, vol: 6600 },
  ],
  calendario: [
    { mes: 1, titulo: 'Pode beber álcool tomando Mounjaro?', status: 'Planejado' },
    { mes: 1, titulo: 'Cardápio para quem toma Mounjaro', status: 'Planejado' },
    { mes: 1, titulo: 'Arroz engorda?', status: 'Planejado' },
    { mes: 1, titulo: '6 alimentos ricos em fibras', status: 'Publicado' },
    { mes: 1, titulo: 'Creatina engorda ou emagrece?', status: 'Planejado' },
    { mes: 1, titulo: 'Como funciona o nutricionista online', status: 'Planejado' },
    { mes: 2, titulo: 'Gordura visceral', status: 'Publicado' },
    { mes: 2, titulo: 'Nutricionista esportivo: o que faz', status: 'Planejado' },
    { mes: 2, titulo: 'Déficit calórico', status: 'Publicado' },
    { mes: 2, titulo: 'O que comer tomando Mounjaro', status: 'Planejado' },
    { mes: 2, titulo: 'Nutricionista pode receitar Mounjaro?', status: 'Planejado' },
    { mes: 2, titulo: 'Dieta da selva funciona?', status: 'Planejado' },
    { mes: 3, titulo: 'Quanto custa um nutricionista esportivo?', status: 'Planejado' },
    { mes: 3, titulo: 'Alimentação pós-treino para hipertrofia', status: 'Planejado' },
    { mes: 3, titulo: 'Recomposição corporal', status: 'Planejado' },
    { mes: 3, titulo: 'Melhor horário para se pesar', status: 'Planejado' },
    { mes: 3, titulo: 'Whey protein engorda?', status: 'Planejado' },
    { mes: 3, titulo: 'Nutricionista online vs presencial', status: 'Planejado' },
  ],
  infra: [
    { item: 'Google Search Console', status: 'Verificado' },
    { item: 'Rank Math SEO', status: 'Instalado e ativo' },
    { item: 'Google Site Kit', status: 'Plugado' },
    { item: 'Tema Astra (config por página)', status: 'Configurado' },
  ],
};

const kdiColor = (k: number) =>
  k < 15 ? 'text-green-400' : k < 30 ? 'text-yellow-400' : 'text-orange-400';

export default function PainelSEO() {
  const [mes, setMes] = useState<1 | 2 | 3>(1);
  const publicados = SEO.calendario.filter((c) => statusOf(c.status) === 'done').length;
  const fasesDone = SEO.fases.filter((f) => statusOf(f.status) === 'done').length;

  return (
    <div className="space-y-6 pb-10">
      <div className="flex items-center gap-2">
        <BarChart3 size={22} className="text-emerald-400" />
        <h2 className="text-xl font-bold text-foreground">SEO / Tráfego Orgânico</h2>
      </div>

      {/* Objetivo + diagnóstico */}
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-5">
        <p className="text-sm text-foreground font-medium mb-3">{SEO.objetivo}</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-card border border-border rounded-xl p-3">
            <p className="text-xs text-muted-foreground">Orgânico hoje</p>
            <p className="text-sm font-semibold text-foreground mt-1">{SEO.diagnostico.organico}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-3">
            <p className="text-xs text-muted-foreground">Custo lead pago</p>
            <p className="text-sm font-semibold text-foreground mt-1">{SEO.diagnostico.custoLeadPago}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-3">
            <p className="text-xs text-muted-foreground">Oportunidade</p>
            <p className="text-sm font-semibold text-emerald-400 mt-1">{SEO.diagnostico.oportunidade}</p>
          </div>
        </div>
      </div>

      {/* Roadmap de fases */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={18} className="text-purple-400" />
          <h3 className="font-semibold text-foreground">Roadmap</h3>
          <span className="text-xs text-muted-foreground">({fasesDone}/{SEO.fases.length} fases concluídas)</span>
        </div>
        <div className="space-y-2">
          {SEO.fases.map((f) => (
            <div key={f.n} className="flex items-center gap-3 py-1.5">
              <StatusIcon s={statusOf(f.status)} />
              <span className="text-xs text-muted-foreground w-12 shrink-0">Fase {f.n}</span>
              <span className="text-sm text-foreground flex-1">{f.nome}</span>
              <StatusBadge label={f.status} />
            </div>
          ))}
        </div>
      </div>

      {/* Entregáveis */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <FileText size={18} className="text-blue-400" />
          <h3 className="font-semibold text-foreground">Ativos produzidos</h3>
          <span className="text-xs text-muted-foreground">(o que você já fez)</span>
        </div>
        <div className="space-y-2">
          {SEO.entregaveis.map((e, i) => (
            <div key={i} className="flex items-center gap-3 py-1.5">
              <StatusIcon s={statusOf(e.status)} />
              <span className="text-xs text-muted-foreground w-24 shrink-0">{e.tipo}</span>
              <span className="text-sm text-foreground flex-1">{e.nome}</span>
              <StatusBadge label={e.status} />
            </div>
          ))}
        </div>
      </div>

      {/* Quick wins + Infra */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Target size={18} className="text-cyan-400" />
            <h3 className="font-semibold text-foreground">Quick wins (volume × KDI)</h3>
          </div>
          <div className="space-y-2">
            {SEO.quickWins.map((k) => (
              <div key={k.kw} className="flex items-center gap-2 text-sm">
                <span className="flex-1 text-foreground truncate">{k.kw}</span>
                <span className="text-xs text-muted-foreground">{k.vol.toLocaleString('pt-BR')}/mês</span>
                <span className={`text-xs font-bold w-14 text-right ${kdiColor(k.kdi)}`}>KDI {k.kdi}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Settings size={18} className="text-muted-foreground" />
            <h3 className="font-semibold text-foreground">Infraestrutura</h3>
          </div>
          <div className="space-y-2">
            {SEO.infra.map((i) => (
              <div key={i.item} className="flex items-center gap-3 py-1">
                <StatusIcon s={statusOf(i.status)} />
                <span className="text-sm text-foreground flex-1">{i.item}</span>
                <StatusBadge label={i.status} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Calendário editorial */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Calendar size={18} className="text-pink-400" />
            <h3 className="font-semibold text-foreground">Calendário editorial</h3>
            <span className="text-xs text-muted-foreground">({publicados}/{SEO.calendario.length} publicados)</span>
          </div>
          <div className="flex gap-1">
            {([1, 2, 3] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMes(m)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  mes === m ? 'bg-purple-600 text-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
              >
                Mês {m}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          {SEO.calendario.filter((c) => c.mes === mes).map((c, i) => (
            <div key={i} className="flex items-center gap-3 py-1.5">
              <StatusIcon s={statusOf(c.status)} />
              <span className="text-sm text-foreground flex-1">{c.titulo}</span>
              <StatusBadge label={c.status} />
            </div>
          ))}
        </div>
      </div>

      <a
        href="https://fabriciomoura.com/calculadora-de-imc-e-calorias"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300"
      >
        <ExternalLink size={14} /> Ver calculadora publicada
      </a>
    </div>
  );
}
