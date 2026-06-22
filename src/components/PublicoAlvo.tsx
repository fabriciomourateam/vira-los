import React, { useState } from 'react';
import { toast } from 'sonner';
import {
  Target, Users, AlertTriangle, Heart, ShieldQuestion, MessageSquare,
  Check, X, Tag, DollarSign, Flame,
} from 'lucide-react';
import { useLivingDoc, DocActions, StrListEditor, TextInput, SuggestionModal } from './livingDoc';

/**
 * PublicoAlvo — Painel editável do ICP (comprador-meta) do Fabricio Moura.
 * Dados vêm do backend (documento vivo); o objeto abaixo é só o default inicial.
 */
const DEFAULT_ICP = {
  stats: { clientes: 773, homens: 485, homensPct: 63, mulheresPct: 37, idadeMedia: 33, seguidoresMulheresPct: 63 },
  avatar:
    'Homem de 25 a 40 anos (idade média 33) que quer shape forte / corpo definido e ' +
    'desconfia que o problema é hormonal (testo baixa, cortisol, insulina) — ou quer usar ' +
    'protocolo (TRT, GLP-1) com segurança. Já tentou treino e dieta e sente que falta a peça ' +
    'técnica/hormonal. Busca autoridade confiável. É ELE quem paga o ticket de R$1.800-4.200.',
  dores: [
    'Estagnou mesmo treinando pesado',
    'Cansaço, libido e energia em baixa',
    'Medo de fazer protocolo (TRT/GLP-1) errado',
    'Excesso de informação contraditória e perigosa na internet',
  ],
  desejos: ['Shape forte e definido', 'Energia e disposição de volta', 'Clareza técnica — entender o que está acontecendo', 'Alguém que entende de hormônio E de treino'],
  objecoes: ['"Será que é seguro?"', '"Serve pro meu caso?"', '"Já tentei e não deu certo"', 'Preço (na verdade é posicionamento/autoridade, não preço)'],
  faca: ['Curiosidade / contra-intuição no gancho', 'Tecnicidade traduzida pro leigo', 'Promessa do shape ligada à técnica', 'CTA pra seguir, natural', 'Falar "você" (seu, sua, te)', 'Português coloquial: "falso magro", "durão", "queima de gordura"'],
  naoFaca: ['Gancho morno e óbvio', 'Jargão técnico sem explicar', 'Promessa milagrosa com prazo', 'Forçar venda no meio de funil', 'Clichê de IA "não é X, é Y"', 'Jargão gringo: "skinny fat", "shredded", "fat loss" · e "tu/teu/ti"'],
  keywords: ['testosterona / TRT', 'GLP-1 / ozempic', 'cortisol alto', 'resistência à insulina', 'anabolizantes', 'ganhar massa', 'perder gordura', 'shape definido'],
  oferta: { produto: 'Consultoria Online (alto ticket)', ticket: 'R$1.800 – 4.200', funil: 'Reels (gera demanda) → Stories + Bio (captura) → WhatsApp (converte)' },
};

const Card = ({ icon, title, accent, children }: { icon: React.ReactNode; title: string; accent: string; children: React.ReactNode }) => (
  <div className="bg-card border border-border rounded-2xl p-5">
    <div className="flex items-center gap-2 mb-3"><span className={accent}>{icon}</span><h3 className="font-semibold text-foreground">{title}</h3></div>
    {children}
  </div>
);

const Bullets = ({ items, marker }: { items: string[]; marker: React.ReactNode }) => (
  <ul className="space-y-2">
    {items.map((it, i) => (
      <li key={i} className="flex gap-2 text-sm text-muted-foreground leading-relaxed"><span className="shrink-0 mt-0.5">{marker}</span><span>{it}</span></li>
    ))}
  </ul>
);

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

export default function PublicoAlvo() {
  const { data, save, suggest } = useLivingDoc<typeof DEFAULT_ICP>('publico', DEFAULT_ICP);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<typeof DEFAULT_ICP>(DEFAULT_ICP);
  const [suggesting, setSuggesting] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; resumo: string; suggestion: typeof DEFAULT_ICP | null }>({ open: false, resumo: '', suggestion: null });

  const icp = editing ? draft : data;
  const set = (patch: Partial<typeof DEFAULT_ICP>) => setDraft((d) => ({ ...d, ...patch }));

  async function handleSuggest() {
    setSuggesting(true);
    try {
      const { suggestion, resumo } = await suggest(data);
      setModal({ open: true, resumo, suggestion });
    } catch (e: any) {
      toast?.error?.(e?.message);
    } finally {
      setSuggesting(false);
    }
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2"><Target size={22} className="text-purple-400" /><h2 className="text-xl font-bold text-foreground">Público-Alvo (ICP)</h2></div>
        <DocActions
          editing={editing} suggesting={suggesting}
          onEdit={() => { setDraft(clone(data)); setEditing(true); }}
          onSave={() => { save(draft); setEditing(false); }}
          onCancel={() => setEditing(false)}
          onSuggest={handleSuggest}
        />
      </div>

      {/* Verdade dos dados */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3 text-amber-400"><AlertTriangle size={18} /><h3 className="font-semibold">A verdade dos dados (a regra que manda em tudo)</h3></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
          <div className="bg-card border border-border rounded-xl p-4 text-center"><p className="text-3xl font-bold text-foreground">{icp.stats.clientes}</p><p className="text-xs text-muted-foreground mt-1">pacientes (base real)</p></div>
          <div className="bg-card border border-border rounded-xl p-4 text-center"><p className="text-3xl font-bold text-purple-400">{icp.stats.homensPct}%</p><p className="text-xs text-muted-foreground mt-1">{icp.stats.homens} compradores são <b>homens</b></p></div>
          <div className="bg-card border border-border rounded-xl p-4 text-center"><p className="text-3xl font-bold text-foreground">{icp.stats.idadeMedia}</p><p className="text-xs text-muted-foreground mt-1">idade média do comprador</p></div>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Quem <b className="text-foreground">segue</b> (~{icp.stats.seguidoresMulheresPct}% mulheres) e quem <b className="text-foreground">compra</b> ({icp.stats.homensPct}% homens) são quase invertidos.
          O conteúdo mira o <b className="text-foreground">comprador</b>: homem 25-40. KPI = <b className="text-foreground">homem certo alcançado → DM/consultoria</b>.
        </p>
      </div>

      {/* Avatar */}
      <Card icon={<Users size={18} />} title="O Avatar (comprador-meta)" accent="text-purple-400">
        {editing ? <TextInput value={icp.avatar} area onChange={(v) => set({ avatar: v })} /> : <p className="text-sm text-muted-foreground leading-relaxed">{icp.avatar}</p>}
      </Card>

      {/* Dores / Desejos / Objeções */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card icon={<Flame size={18} />} title="Dores" accent="text-red-400">
          {editing ? <StrListEditor items={icp.dores} onChange={(v) => set({ dores: v })} /> : <Bullets items={icp.dores} marker={<span className="text-red-400">•</span>} />}
        </Card>
        <Card icon={<Heart size={18} />} title="Desejos" accent="text-green-400">
          {editing ? <StrListEditor items={icp.desejos} onChange={(v) => set({ desejos: v })} /> : <Bullets items={icp.desejos} marker={<span className="text-green-400">•</span>} />}
        </Card>
        <Card icon={<ShieldQuestion size={18} />} title="Objeções" accent="text-yellow-400">
          {editing ? <StrListEditor items={icp.objecoes} onChange={(v) => set({ objecoes: v })} /> : <Bullets items={icp.objecoes} marker={<span className="text-yellow-400">•</span>} />}
        </Card>
      </div>

      {/* Linguagem */}
      <Card icon={<MessageSquare size={18} />} title="Como falar com ele (tom de voz)" accent="text-blue-400">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <p className="text-xs font-semibold text-green-400 mb-2 uppercase tracking-wide">Faça</p>
            {editing ? <StrListEditor items={icp.faca} onChange={(v) => set({ faca: v })} /> : <Bullets items={icp.faca} marker={<Check size={14} className="text-green-400" />} />}
          </div>
          <div>
            <p className="text-xs font-semibold text-red-400 mb-2 uppercase tracking-wide">Não faça</p>
            {editing ? <StrListEditor items={icp.naoFaca} onChange={(v) => set({ naoFaca: v })} /> : <Bullets items={icp.naoFaca} marker={<X size={14} className="text-red-400" />} />}
          </div>
        </div>
      </Card>

      {/* Keywords + Oferta */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card icon={<Tag size={18} />} title="Temas / palavras-chave do nicho" accent="text-cyan-400">
          {editing ? <StrListEditor items={icp.keywords} onChange={(v) => set({ keywords: v })} /> : (
            <div className="flex flex-wrap gap-2">{icp.keywords.map((k) => <span key={k} className="px-2.5 py-1 rounded-full bg-secondary text-xs text-foreground border border-border">{k}</span>)}</div>
          )}
        </Card>
        <Card icon={<DollarSign size={18} />} title="Destino da conversão" accent="text-emerald-400">
          {editing ? (
            <div className="space-y-2">
              <TextInput value={icp.oferta.produto} onChange={(v) => set({ oferta: { ...icp.oferta, produto: v } })} />
              <TextInput value={icp.oferta.ticket} onChange={(v) => set({ oferta: { ...icp.oferta, ticket: v } })} />
              <TextInput value={icp.oferta.funil} onChange={(v) => set({ oferta: { ...icp.oferta, funil: v } })} />
            </div>
          ) : (
            <>
              <p className="text-sm text-foreground font-medium">{icp.oferta.produto}</p>
              <p className="text-2xl font-bold text-emerald-400 mt-1">{icp.oferta.ticket}</p>
              <p className="text-xs text-muted-foreground mt-3 leading-relaxed"><b className="text-foreground">Funil:</b> {icp.oferta.funil}</p>
            </>
          )}
        </Card>
      </div>

      <SuggestionModal
        open={modal.open}
        resumo={modal.resumo}
        onApply={() => { if (modal.suggestion) save(modal.suggestion); setModal({ open: false, resumo: '', suggestion: null }); }}
        onDiscard={() => setModal({ open: false, resumo: '', suggestion: null })}
      />
    </div>
  );
}
