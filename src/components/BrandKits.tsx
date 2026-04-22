/**
 * BrandKits.tsx — Gestão de Brand Kits
 * Crie, edite e organize identidades de marca para usar no Studio de Criação
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Plus, Edit3, Trash2, Check, X, Palette, Type, Target,
  Briefcase, Loader2, Save, ChevronDown, ChevronUp, Sparkles,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface BrandKit {
  id: string;
  name: string;
  brandName: string;
  industry: string;
  contentTone: string;
  designStyle: string;
  fontStyle: string;
  targetAudience: string;
  aboutProduct: string;
  differentiator: string;
  palette: string[];
  instagramHandle: string;
  logoUrl: string;
  examples: string;
  created_at: string;
  updated_at: string;
}

const DESIGN_STYLES = [
  'Moderno e Minimalista',
  'Chamativo e Colorido',
  'Corporativo e Sério',
  'Pessoal e Artístico',
  'Tech e Futurista',
  'Retrô e Vintage',
  'Clean e Profissional',
];

const CONTENT_TONES = [
  'Profissional e autoritário',
  'Bem-humorado e casual',
  'Inspiracional e motivacional',
  'Educativo e didático',
  'Urgente e direto',
  'Empático e acolhedor',
];

const FONT_STYLES = [
  'Sans-Serif Moderna',
  'Serifada Clássica',
  'Amigável e Arredondada',
  'Técnica e Monospace',
  'Retrô e Display',
];

const DEFAULT_PALETTES = [
  ['#6366f1', '#8b5cf6', '#ffffff', '#1e1e2e'],
  ['#f59e0b', '#ef4444', '#ffffff', '#1a1a1a'],
  ['#10b981', '#059669', '#ffffff', '#0f172a'],
  ['#3b82f6', '#60a5fa', '#ffffff', '#0f0f1a'],
  ['#ec4899', '#f43f5e', '#ffffff', '#1a0f1a'],
];

// ─── Formulário de Brand Kit ──────────────────────────────────────────────────

const emptyForm = {
  name: '',
  brandName: '',
  industry: '',
  contentTone: 'Profissional e autoritário',
  designStyle: 'Moderno e Minimalista',
  fontStyle: 'Sans-Serif Moderna',
  targetAudience: '',
  aboutProduct: '',
  differentiator: '',
  palette: ['#6366f1', '#8b5cf6', '#ffffff', '#1e1e2e'] as string[],
  instagramHandle: '',
  logoUrl: '',
  examples: '',
};

interface FormData extends typeof emptyForm {}

interface KitFormProps {
  initial?: Partial<FormData>;
  onSave: (data: FormData) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}

function KitForm({ initial, onSave, onCancel, saving }: KitFormProps) {
  const [form, setForm] = useState<FormData>({ ...emptyForm, ...initial });
  const [expanded, setExpanded] = useState({ brand: true, visual: false, strategy: false });

  function set(field: keyof FormData, value: any) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function setPaletteColor(index: number, color: string) {
    const p = [...form.palette];
    p[index] = color;
    set('palette', p);
  }

  function addPaletteColor() {
    if (form.palette.length < 6) set('palette', [...form.palette, '#ffffff']);
  }

  function removePaletteColor(index: number) {
    if (form.palette.length > 2) set('palette', form.palette.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Nome do brand kit é obrigatório'); return; }
    await onSave(form);
  }

  const Section = ({ id, label, icon: Icon, children }: any) => (
    <div className="border border-white/5 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(prev => ({ ...prev, [id]: !prev[id as keyof typeof expanded] }))}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-white/70">
          <Icon className="w-4 h-4" /> {label}
        </span>
        {expanded[id as keyof typeof expanded]
          ? <ChevronUp className="w-4 h-4 text-white/30" />
          : <ChevronDown className="w-4 h-4 text-white/30" />
        }
      </button>
      <AnimatePresence>
        {expanded[id as keyof typeof expanded] && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-4 pb-4 space-y-3 border-t border-white/5"
          >
            <div className="pt-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  const Field = ({ label, required, children }: any) => (
    <div className="space-y-1">
      <label className="text-xs text-white/50 font-medium">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );

  const inputCls = "w-full bg-white/5 border border-white/10 text-white/80 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500/50 placeholder-white/25";
  const selectCls = "w-full bg-[#0f0f13] border border-white/10 text-white/80 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500/50";

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Section id="brand" label="Identidade da Marca" icon={Briefcase}>
        <div className="space-y-3">
          <Field label="Nome do Brand Kit" required>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ex: Clínica Saúde Total" className={inputCls} />
          </Field>
          <Field label="Nome da Marca / Empresa">
            <input value={form.brandName} onChange={e => set('brandName', e.target.value)} placeholder="Ex: Saúde Total" className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Setor de Atuação">
              <input value={form.industry} onChange={e => set('industry', e.target.value)} placeholder="Ex: Saúde, Fitness" className={inputCls} />
            </Field>
            <Field label="Handle Instagram">
              <input value={form.instagramHandle} onChange={e => set('instagramHandle', e.target.value)} placeholder="@suamarca" className={inputCls} />
            </Field>
          </div>
          <Field label="Sobre o produto/serviço">
            <textarea value={form.aboutProduct} onChange={e => set('aboutProduct', e.target.value)} placeholder="Descreva o que é o seu produto ou serviço em detalhes..." rows={2} className={`${inputCls} resize-none`} />
          </Field>
          <Field label="Diferencial único">
            <input value={form.differentiator} onChange={e => set('differentiator', e.target.value)} placeholder="O que te torna único? Seu 'superpoder'..." className={inputCls} />
          </Field>
        </div>
      </Section>

      <Section id="visual" label="Estilo Visual" icon={Palette}>
        <div className="space-y-3">
          <Field label="Paleta de Cores">
            <div className="flex flex-wrap gap-2 items-center">
              {form.palette.map((color, i) => (
                <div key={i} className="relative group">
                  <input
                    type="color"
                    value={color}
                    onChange={e => setPaletteColor(i, e.target.value)}
                    className="w-8 h-8 rounded-lg cursor-pointer border border-white/10 bg-transparent p-0.5"
                    title={color}
                  />
                  {form.palette.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removePaletteColor(i)}
                      className="absolute -top-1 -right-1 hidden group-hover:flex w-3.5 h-3.5 rounded-full bg-red-500 items-center justify-center"
                    >
                      <X className="w-2 h-2 text-white" />
                    </button>
                  )}
                </div>
              ))}
              {form.palette.length < 6 && (
                <button type="button" onClick={addPaletteColor} className="w-8 h-8 rounded-lg border border-dashed border-white/20 flex items-center justify-center text-white/30 hover:text-white/60 hover:border-white/40 transition-colors">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex gap-2 mt-2 flex-wrap">
              {DEFAULT_PALETTES.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => set('palette', p)}
                  className="flex gap-0.5 rounded overflow-hidden border border-white/10 hover:border-violet-500/50 transition-colors"
                  title="Usar paleta"
                >
                  {p.map((c, j) => (
                    <div key={j} style={{ backgroundColor: c }} className="w-4 h-4" />
                  ))}
                </button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Estilo Visual">
              <select value={form.designStyle} onChange={e => set('designStyle', e.target.value)} className={selectCls}>
                {DESIGN_STYLES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Estilo de Fonte">
              <select value={form.fontStyle} onChange={e => set('fontStyle', e.target.value)} className={selectCls}>
                {FONT_STYLES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
        </div>
      </Section>

      <Section id="strategy" label="Estratégia de Conteúdo" icon={Target}>
        <div className="space-y-3">
          <Field label="Tom de Voz">
            <select value={form.contentTone} onChange={e => set('contentTone', e.target.value)} className={selectCls}>
              {CONTENT_TONES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Público-Alvo">
            <textarea value={form.targetAudience} onChange={e => set('targetAudience', e.target.value)} placeholder="Descreva quem é o seu público ideal, seus interesses, dores e desejos..." rows={2} className={`${inputCls} resize-none`} />
          </Field>
          <Field label="Exemplos e Referências">
            <textarea value={form.examples} onChange={e => set('examples', e.target.value)} placeholder="URLs ou descrições de marcas/criadores que admira como referência..." rows={2} className={`${inputCls} resize-none`} />
          </Field>
        </div>
      </Section>

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="flex-1 py-2 rounded-xl border border-white/10 text-white/50 hover:text-white/80 text-sm transition-colors">
          Cancelar
        </button>
        <button type="submit" disabled={saving} className="flex-1 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar Brand Kit
        </button>
      </div>
    </form>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function BrandKits() {
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadKits(); }, []);

  async function loadKits() {
    try {
      const r = await fetch(`${API}/api/brand-kits`);
      if (r.ok) setKits(await r.json());
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(data: FormData) {
    setSaving(true);
    try {
      const r = await fetch(`${API}/api/brand-kits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error();
      const kit = await r.json();
      setKits(prev => [kit, ...prev]);
      setCreating(false);
      toast.success('Brand kit criado!');
    } catch {
      toast.error('Erro ao criar brand kit');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: string, data: FormData) {
    setSaving(true);
    try {
      const r = await fetch(`${API}/api/brand-kits/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error();
      setKits(prev => prev.map(k => k.id === id ? { ...k, ...data } : k));
      setEditingId(null);
      toast.success('Brand kit atualizado!');
    } catch {
      toast.error('Erro ao atualizar brand kit');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Excluir este brand kit?')) return;
    try {
      await fetch(`${API}/api/brand-kits/${id}`, { method: 'DELETE' });
      setKits(prev => prev.filter(k => k.id !== id));
      toast.success('Brand kit excluído');
    } catch {
      toast.error('Erro ao excluir');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-160px)] bg-[#0f0f13] rounded-xl border border-white/5 p-6">
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">Brand Kits</h2>
          <p className="text-xs text-white/40 mt-0.5">Identidades de marca para o Studio de Criação</p>
        </div>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Novo Brand Kit
          </button>
        )}
      </div>

      {/* Formulário de criação */}
      <AnimatePresence>
        {creating && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-white/3 border border-violet-500/20 rounded-xl p-4"
          >
            <p className="text-sm font-medium text-white/70 mb-4">Novo Brand Kit</p>
            <KitForm onSave={handleCreate} onCancel={() => setCreating(false)} saving={saving} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lista de kits */}
      {kits.length === 0 && !creating ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-white/20" />
          </div>
          <p className="text-white/40 text-sm">Nenhum brand kit criado ainda</p>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> Criar primeiro brand kit
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {kits.map(kit => (
            <motion.div
              key={kit.id}
              layout
              className="bg-white/3 border border-white/5 rounded-xl overflow-hidden"
            >
              {editingId === kit.id ? (
                <div className="p-4">
                  <p className="text-sm font-medium text-white/70 mb-4">Editar Brand Kit</p>
                  <KitForm
                    initial={kit}
                    onSave={(data) => handleUpdate(kit.id, data)}
                    onCancel={() => setEditingId(null)}
                    saving={saving}
                  />
                </div>
              ) : (
                <div className="flex items-start gap-4 p-4">
                  {/* Paleta de cores */}
                  <div className="flex gap-1 shrink-0 mt-0.5">
                    {(kit.palette || []).slice(0, 4).map((color, i) => (
                      <div
                        key={i}
                        style={{ backgroundColor: color }}
                        className="w-5 h-5 rounded-md border border-white/10"
                      />
                    ))}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-white truncate">{kit.name}</h3>
                      {kit.instagramHandle && (
                        <span className="text-xs text-white/30">@{kit.instagramHandle.replace('@', '')}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {kit.industry && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-white/5 text-white/40 rounded">{kit.industry}</span>
                      )}
                      {kit.designStyle && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-violet-500/10 text-violet-400 rounded">{kit.designStyle}</span>
                      )}
                      {kit.contentTone && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded">{kit.contentTone}</span>
                      )}
                    </div>
                    {kit.aboutProduct && (
                      <p className="text-xs text-white/30 mt-1.5 line-clamp-1">{kit.aboutProduct}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditingId(kit.id)}
                      className="p-1.5 text-white/30 hover:text-white/70 hover:bg-white/5 rounded-lg transition-colors"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(kit.id)}
                      className="p-1.5 text-white/30 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
    </div>
  );
}
