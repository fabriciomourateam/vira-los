import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Pencil, Save, X, Sparkles, Loader2, Check, Plus, Trash2 } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/**
 * Hook de documento vivo: carrega o override salvo (ou usa o default do front),
 * salva edições e pede sugestões de atualização à IA.
 */
export function useLivingDoc<T>(id: string, fallback: T) {
  const [data, setData] = useState<T>(fallback);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/docs/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d === 'object') setData(d as T); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [id]);

  const save = useCallback(async (next: T) => {
    setData(next);
    try {
      await fetch(`${API}/api/docs/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
      });
      toast.success('Salvo!');
    } catch {
      toast.error('Falha ao salvar.');
    }
  }, [id]);

  const suggest = useCallback(async (current: T): Promise<{ suggestion: T; resumo: string }> => {
    const r = await fetch(`${API}/api/docs/${id}/suggest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erro ao sugerir');
    return { suggestion: d.suggestion as T, resumo: d.resumo || '' };
  }, [id]);

  return { data, setData, save, loaded, suggest };
}

// Barra de ações: Editar / Salvar / Cancelar + Sugerir com IA
export function DocActions({ editing, onEdit, onSave, onCancel, onSuggest, suggesting }: {
  editing: boolean; onEdit: () => void; onSave: () => void; onCancel: () => void;
  onSuggest: () => void; suggesting: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onSuggest}
        disabled={suggesting}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition-colors disabled:opacity-60"
        title="A IA analisa e propõe atualizações"
      >
        {suggesting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Sugerir com IA
      </button>
      {editing ? (
        <>
          <button onClick={onSave} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-semibold"><Save size={13} /> Salvar</button>
          <button onClick={onCancel} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground text-xs font-medium"><X size={13} /> Cancelar</button>
        </>
      ) : (
        <button onClick={onEdit} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:text-foreground text-muted-foreground text-xs font-medium"><Pencil size={13} /> Editar</button>
      )}
    </div>
  );
}

// Editor de lista de strings (add/editar/remover)
export function StrListEditor({ items, onChange, placeholder }: { items: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex gap-1.5">
          <input
            value={it}
            placeholder={placeholder}
            onChange={(e) => { const n = [...items]; n[i] = e.target.value; onChange(n); }}
            className="flex-1 bg-secondary border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
          <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-300 px-1"><Trash2 size={13} /></button>
        </div>
      ))}
      <button onClick={() => onChange([...items, ''])} className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300"><Plus size={12} /> adicionar</button>
    </div>
  );
}

export function TextInput({ value, onChange, area }: { value: string; onChange: (v: string) => void; area?: boolean }) {
  const cls = 'w-full bg-secondary border border-border rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500';
  return area
    ? <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={4} className={cls} />
    : <input value={value} onChange={(e) => onChange(e.target.value)} className={cls} />;
}

// Modal de sugestão da IA: mostra o resumo e deixa aplicar ou descartar
export function SuggestionModal({ open, resumo, onApply, onDiscard }: {
  open: boolean; resumo: string; onApply: () => void; onDiscard: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onDiscard}>
      <div className="bg-card border border-border rounded-2xl p-5 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3"><Sparkles size={18} className="text-purple-400" /><h3 className="font-semibold text-foreground">Sugestão da IA</h3></div>
        <div className="bg-background border border-border rounded-lg p-3 text-sm text-muted-foreground whitespace-pre-wrap max-h-72 overflow-auto mb-4">
          {resumo || 'A IA propôs uma versão atualizada do painel.'}
        </div>
        <p className="text-xs text-muted-foreground mb-3">Aplicar vai substituir o conteúdo do painel pela versão sugerida (você ainda pode editar e salvar depois).</p>
        <div className="flex gap-2 justify-end">
          <button onClick={onDiscard} className="px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground text-sm">Descartar</button>
          <button onClick={onApply} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-semibold"><Check size={14} /> Aplicar</button>
        </div>
      </div>
    </div>
  );
}
