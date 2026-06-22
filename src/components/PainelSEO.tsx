import React, { useState } from 'react';
import {
  BarChart3, CheckCircle2, Clock, Circle, FileText, Target,
  TrendingUp, Calendar, Settings, ExternalLink, Plus, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useLivingDoc, DocActions, TextInput, SuggestionModal } from './livingDoc';

type Status = 'done' | 'wip' | 'todo';
function statusOf(raw: string): Status {
  const s = (raw || '').toLowerCase();
  if (s.includes('conclu') || s.includes('publicad') || s.includes('verificad') || s.includes('instalad') || s.includes('plugad') || s === 'pronto') return 'done';
  if (s.includes('andamento')) return 'wip';
  return 'todo';
}
const STATUS_STYLE: Record<Status, string> = {
  done: 'bg-green-500/15 text-green-400 border-green-500/30',
  wip: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  todo: 'bg-secondary text-muted-foreground border-border',
};
const StatusBadge = ({ label }: { label: string }) => (
  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${STATUS_STYLE[statusOf(label)]}`}>{label}</span>
);
const StatusIcon = ({ s }: { s: Status }) =>
  s === 'done' ? <CheckCircle2 size={16} className="text-green-400 shrink-0" /> :
  s === 'wip' ? <Clock size={16} className="text-blue-400 shrink-0" /> :
  <Circle size={16} className="text-muted-foreground shrink-0" />;

const DEFAULT_SEO = {
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

const kdiColor = (k: number) => (k < 15 ? 'text-green-400' : k < 30 ? 'text-yellow-400' : 'text-orange-400');
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

// Editor genérico de lista de objetos (campos como inputs + add/remover)
function ObjListEditor<T extends Record<string, any>>({ items, fields, onChange, blank }: {
  items: T[]; fields: { key: keyof T; ph: string }[]; onChange: (v: T[]) => void; blank: T;
}) {
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex gap-1.5 items-center">
          {fields.map((f) => (
            <input key={String(f.key)} value={String(it[f.key] ?? '')} placeholder={f.ph}
              onChange={(e) => { const n = [...items]; n[i] = { ...n[i], [f.key]: e.target.value }; onChange(n); }}
              className="flex-1 min-w-0 bg-secondary border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500" />
          ))}
          <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-300 shrink-0"><Trash2 size={13} /></button>
        </div>
      ))}
      <button onClick={() => onChange([...items, clone(blank)])} className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300"><Plus size={12} /> adicionar</button>
    </div>
  );
}

export default function PainelSEO() {
  const { data, save, suggest } = useLivingDoc<typeof DEFAULT_SEO>('seo', DEFAULT_SEO);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<typeof DEFAULT_SEO>(DEFAULT_SEO);
  const [suggesting, setSuggesting] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; resumo: string; suggestion: typeof DEFAULT_SEO | null }>({ open: false, resumo: '', suggestion: null });
  const [mes, setMes] = useState<1 | 2 | 3>(1);

  const seo = editing ? draft : data;
  const set = (patch: Partial<typeof DEFAULT_SEO>) => setDraft((d) => ({ ...d, ...patch }));

  const publicados = seo.calendario.filter((c) => statusOf(c.status) === 'done').length;
  const fasesDone = seo.fases.filter((f) => statusOf(f.status) === 'done').length;

  async function handleSuggest() {
    setSuggesting(true);
    try {
      const { suggestion, resumo } = await suggest(data);
      setModal({ open: true, resumo, suggestion });
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao sugerir');
    } finally {
      setSuggesting(false);
    }
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2"><BarChart3 size={22} className="text-emerald-400" /><h2 className="text-xl font-bold text-foreground">SEO / Tráfego Orgânico</h2></div>
        <DocActions
          editing={editing} suggesting={suggesting}
          onEdit={() => { setDraft(clone(data)); setEditing(true); }}
          onSave={() => { save(draft); setEditing(false); }}
          onCancel={() => setEditing(false)}
          onSuggest={handleSuggest}
        />
      </div>

      {/* Objetivo + diagnóstico */}
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-5">
        {editing ? <TextInput value={seo.objetivo} onChange={(v) => set({ objetivo: v })} /> : <p className="text-sm text-foreground font-medium mb-3">{seo.objetivo}</p>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
          {(['organico', 'custoLeadPago', 'oportunidade'] as const).map((k, idx) => (
            <div key={k} className="bg-card border border-border rounded-xl p-3">
              <p className="text-xs text-muted-foreground">{['Orgânico hoje', 'Custo lead pago', 'Oportunidade'][idx]}</p>
              {editing
                ? <TextInput value={seo.diagnostico[k]} onChange={(v) => set({ diagnostico: { ...seo.diagnostico, [k]: v } })} />
                : <p className={`text-sm font-semibold mt-1 ${k === 'oportunidade' ? 'text-emerald-400' : 'text-foreground'}`}>{seo.diagnostico[k]}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* Roadmap */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4"><TrendingUp size={18} className="text-purple-400" /><h3 className="font-semibold text-foreground">Roadmap</h3><span className="text-xs text-muted-foreground">({fasesDone}/{seo.fases.length} fases)</span></div>
        {editing ? (
          <ObjListEditor items={seo.fases} onChange={(v) => set({ fases: v })} blank={{ n: '', nome: '', status: 'Pendente' } as any}
            fields={[{ key: 'n', ph: '#' }, { key: 'nome', ph: 'nome da fase' }, { key: 'status', ph: 'status' }]} />
        ) : (
          <div className="space-y-2">{seo.fases.map((f) => (
            <div key={f.n} className="flex items-center gap-3 py-1.5"><StatusIcon s={statusOf(f.status)} /><span className="text-xs text-muted-foreground w-12 shrink-0">Fase {f.n}</span><span className="text-sm text-foreground flex-1">{f.nome}</span><StatusBadge label={f.status} /></div>
          ))}</div>
        )}
      </div>

      {/* Entregáveis */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4"><FileText size={18} className="text-blue-400" /><h3 className="font-semibold text-foreground">Ativos produzidos</h3><span className="text-xs text-muted-foreground">(o que você já fez)</span></div>
        {editing ? (
          <ObjListEditor items={seo.entregaveis} onChange={(v) => set({ entregaveis: v })} blank={{ tipo: 'Artigo', nome: '', status: 'Planejado' } as any}
            fields={[{ key: 'tipo', ph: 'tipo' }, { key: 'nome', ph: 'nome' }, { key: 'status', ph: 'status' }]} />
        ) : (
          <div className="space-y-2">{seo.entregaveis.map((e, i) => (
            <div key={i} className="flex items-center gap-3 py-1.5"><StatusIcon s={statusOf(e.status)} /><span className="text-xs text-muted-foreground w-24 shrink-0">{e.tipo}</span><span className="text-sm text-foreground flex-1">{e.nome}</span><StatusBadge label={e.status} /></div>
          ))}</div>
        )}
      </div>

      {/* Quick wins + Infra */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4"><Target size={18} className="text-cyan-400" /><h3 className="font-semibold text-foreground">Quick wins (volume × KDI)</h3></div>
          {editing ? (
            <ObjListEditor items={seo.quickWins} onChange={(v) => set({ quickWins: v })} blank={{ kw: '', vol: 0, kdi: 0 } as any}
              fields={[{ key: 'kw', ph: 'palavra-chave' }, { key: 'vol', ph: 'vol' }, { key: 'kdi', ph: 'kdi' }]} />
          ) : (
            <div className="space-y-2">{seo.quickWins.map((k) => (
              <div key={k.kw} className="flex items-center gap-2 text-sm"><span className="flex-1 text-foreground truncate">{k.kw}</span><span className="text-xs text-muted-foreground">{Number(k.vol).toLocaleString('pt-BR')}/mês</span><span className={`text-xs font-bold w-14 text-right ${kdiColor(Number(k.kdi))}`}>KDI {k.kdi}</span></div>
            ))}</div>
          )}
        </div>
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4"><Settings size={18} className="text-muted-foreground" /><h3 className="font-semibold text-foreground">Infraestrutura</h3></div>
          {editing ? (
            <ObjListEditor items={seo.infra} onChange={(v) => set({ infra: v })} blank={{ item: '', status: 'Pendente' } as any}
              fields={[{ key: 'item', ph: 'item' }, { key: 'status', ph: 'status' }]} />
          ) : (
            <div className="space-y-2">{seo.infra.map((i) => (
              <div key={i.item} className="flex items-center gap-3 py-1"><StatusIcon s={statusOf(i.status)} /><span className="text-sm text-foreground flex-1">{i.item}</span><StatusBadge label={i.status} /></div>
            ))}</div>
          )}
        </div>
      </div>

      {/* Calendário */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-2"><Calendar size={18} className="text-pink-400" /><h3 className="font-semibold text-foreground">Calendário editorial</h3><span className="text-xs text-muted-foreground">({publicados}/{seo.calendario.length} publicados)</span></div>
          {!editing && <div className="flex gap-1">{([1, 2, 3] as const).map((m) => (
            <button key={m} onClick={() => setMes(m)} className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${mes === m ? 'bg-purple-600 text-white' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>Mês {m}</button>
          ))}</div>}
        </div>
        {editing ? (
          <ObjListEditor items={seo.calendario} onChange={(v) => set({ calendario: v })} blank={{ mes: 1, titulo: '', status: 'Planejado' } as any}
            fields={[{ key: 'mes', ph: 'mês' }, { key: 'titulo', ph: 'título do post' }, { key: 'status', ph: 'status' }]} />
        ) : (
          <div className="space-y-2">{seo.calendario.filter((c) => Number(c.mes) === mes).map((c, i) => (
            <div key={i} className="flex items-center gap-3 py-1.5"><StatusIcon s={statusOf(c.status)} /><span className="text-sm text-foreground flex-1">{c.titulo}</span><StatusBadge label={c.status} /></div>
          ))}</div>
        )}
      </div>

      <a href="https://fabriciomoura.com/calculadora-de-imc-e-calorias" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300"><ExternalLink size={14} /> Ver calculadora publicada</a>

      <SuggestionModal
        open={modal.open}
        resumo={modal.resumo}
        onApply={() => { if (modal.suggestion) save(modal.suggestion); setModal({ open: false, resumo: '', suggestion: null }); }}
        onDiscard={() => setModal({ open: false, resumo: '', suggestion: null })}
      />
    </div>
  );
}
