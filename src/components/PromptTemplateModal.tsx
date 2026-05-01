import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { X, Plus, Trash2, Check, Zap, ZapOff, ChevronDown, ChevronUp, Copy } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface PromptTemplate {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface TemplatesState {
  activeId: string | null;
  templates: PromptTemplate[];
  baseTemplate: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

// ─── Variáveis disponíveis ────────────────────────────────────────────────────

const VARIABLE_TOKENS = [
  { token: '{{TOPIC}}',          desc: 'Tema do carrossel' },
  { token: '{{NICHE}}',          desc: 'Nicho / segmento' },
  { token: '{{TONE}}',           desc: 'Tom do conteúdo' },
  { token: '{{EMOTION}}',        desc: 'Emoção dominante' },
  { token: '{{HANDLE_AT}}',      desc: 'Handle com @ (ex: @FabricioMoura)' },
  { token: '{{HANDLE_UPPER}}',   desc: 'Handle em maiúsculas (ex: @FABRICIOMOURATEAM)' },
  { token: '{{DISPLAY_NAME}}',   desc: 'Nome de exibição do criador' },
  { token: '{{NUM_SLIDES}}',     desc: 'Total de slides' },
  { token: '{{TOTAL_CONTENT}}',  desc: 'Slides de conteúdo (total − 2)' },
  { token: '{{YEAR}}',           desc: 'Ano atual' },
  { token: '{{INSTRUCTIONS_BLOCK}}', desc: 'Bloco de diretrizes de conteúdo (auto)' },
  { token: '{{IMAGES_BLOCK}}',   desc: 'Bloco de URLs de imagens (auto)' },
  { token: '{{ROTEIRO_BLOCK}}',  desc: 'Bloco do roteiro do criador (auto)' },
  { token: '{{SLIDE_DISTRIBUTION}}', desc: 'Distribuição dos slides por tipo (auto)' },
  { token: '{{VIRAL_STRUCTURE}}', desc: 'Estrutura viral de conteúdo (auto)' },
];

// ─── Componente principal ─────────────────────────────────────────────────────

export default function PromptTemplateModal({ open, onClose }: Props) {
  const [state, setState] = useState<TemplatesState>({ activeId: null, templates: [], baseTemplate: '' });
  const [selectedId, setSelectedId] = useState<string | 'base'>('base');
  const [editedName, setEditedName] = useState('');
  const [editedContent, setEditedContent] = useState('');
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showVars, setShowVars] = useState(false);

  // Carrega templates da API
  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API}/api/carousel/fmteam-prompt-templates`);
      if (!res.ok) throw new Error('Erro ao carregar templates');
      const data: TemplatesState = await res.json();
      setState(data);
    } catch (err) {
      toast.error('Falha ao carregar templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchTemplates();
  }, [open, fetchTemplates]);

  // Quando muda seleção, carrega conteúdo no editor
  useEffect(() => {
    if (selectedId === 'base') {
      setEditedName('Base (padrão)');
      setEditedContent(state.baseTemplate);
      setHasUnsaved(false);
    } else {
      const tpl = state.templates.find(t => t.id === selectedId);
      if (tpl) {
        setEditedName(tpl.name);
        setEditedContent(tpl.content);
        setHasUnsaved(false);
      }
    }
  }, [selectedId, state]);

  // Fecha ao pressionar Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const isBase = selectedId === 'base';
  const selectedTemplate = isBase ? null : state.templates.find(t => t.id === selectedId) ?? null;
  const isActive = !isBase && state.activeId === selectedId;

  // ── Ações ──────────────────────────────────────────────────────────────────

  async function handleClone() {
    const contentToClone = isBase ? state.baseTemplate : (selectedTemplate?.content ?? state.baseTemplate);
    try {
      const res = await fetch(`${API}/api/carousel/fmteam-prompt-templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Cópia de ${isBase ? 'Base' : (selectedTemplate?.name ?? 'template')}`, content: contentToClone }),
      });
      if (!res.ok) throw new Error();
      const tpl: PromptTemplate = await res.json();
      await fetchTemplates();
      setSelectedId(tpl.id);
      toast.success('Template clonado');
    } catch {
      toast.error('Erro ao clonar template');
    }
  }

  async function handleSave() {
    if (isBase || !selectedTemplate) return;
    try {
      setSaving(true);
      const res = await fetch(`${API}/api/carousel/fmteam-prompt-templates/${selectedId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editedName, content: editedContent }),
      });
      if (!res.ok) throw new Error();
      await fetchTemplates();
      setHasUnsaved(false);
      toast.success('Template salvo');
    } catch {
      toast.error('Erro ao salvar template');
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate() {
    if (isBase || !selectedTemplate) return;
    try {
      const res = await fetch(`${API}/api/carousel/fmteam-prompt-templates/${selectedId}/activate`, { method: 'POST' });
      if (!res.ok) throw new Error();
      setState(s => ({ ...s, activeId: selectedId }));
      toast.success(`Template "${selectedTemplate.name}" ativado — será usado na próxima geração`);
    } catch {
      toast.error('Erro ao ativar template');
    }
  }

  async function handleDeactivate() {
    try {
      await fetch(`${API}/api/carousel/fmteam-prompt-templates/deactivate`, { method: 'POST' });
      setState(s => ({ ...s, activeId: null }));
      toast.success('Template desativado — usando prompt padrão');
    } catch {
      toast.error('Erro ao desativar template');
    }
  }

  async function handleDelete() {
    if (isBase || !selectedTemplate) return;
    if (!window.confirm(`Excluir template "${selectedTemplate.name}"?`)) return;
    try {
      await fetch(`${API}/api/carousel/fmteam-prompt-templates/${selectedId}`, { method: 'DELETE' });
      await fetchTemplates();
      setSelectedId('base');
      toast.success('Template excluído');
    } catch {
      toast.error('Erro ao excluir template');
    }
  }

  function handleContentChange(val: string) {
    setEditedContent(val);
    if (!isBase) setHasUnsaved(true);
  }

  function handleNameChange(val: string) {
    setEditedName(val);
    if (!isBase) setHasUnsaved(true);
  }

  function copyToken(token: string) {
    navigator.clipboard.writeText(token).then(() => toast.success(`${token} copiado`));
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-5xl h-[90vh] max-h-[800px] bg-background border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-foreground">Editor de Templates de Prompt</span>
            <span className="text-[10px] bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded-full font-semibold">fmteam</span>
            {state.activeId && (
              <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                template ativo
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body: sidebar + editor */}
        <div className="flex flex-1 min-h-0">

          {/* Sidebar */}
          <div className="w-56 shrink-0 border-r border-border flex flex-col bg-secondary/30">
            <div className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
              {/* Base entry */}
              <button
                onClick={() => setSelectedId('base')}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 ${
                  selectedId === 'base'
                    ? 'bg-border text-foreground'
                    : 'text-muted-foreground hover:bg-border/50 hover:text-foreground'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0" />
                <span className="truncate">Base (padrão)</span>
                <span className="ml-auto text-[9px] text-muted-foreground/60 shrink-0">read-only</span>
              </button>

              {/* Custom templates */}
              {state.templates.map(tpl => (
                <button
                  key={tpl.id}
                  onClick={() => setSelectedId(tpl.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 ${
                    selectedId === tpl.id
                      ? 'bg-border text-foreground'
                      : 'text-muted-foreground hover:bg-border/50 hover:text-foreground'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${state.activeId === tpl.id ? 'bg-emerald-400' : 'bg-muted-foreground/30'}`} />
                  <span className="truncate flex-1">{tpl.name}</span>
                  {state.activeId === tpl.id && (
                    <span className="shrink-0 text-[8px] text-emerald-400 font-bold">ATIVO</span>
                  )}
                </button>
              ))}

              {loading && (
                <div className="text-center py-2 text-[10px] text-muted-foreground">Carregando...</div>
              )}
            </div>

            {/* Clone button */}
            <div className="border-t border-border p-2">
              <button
                onClick={handleClone}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-secondary hover:bg-border text-xs font-semibold text-foreground transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {isBase ? 'Clonar base' : 'Clonar este'}
              </button>
            </div>
          </div>

          {/* Editor area */}
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            {/* Name field + toolbar */}
            <div className="px-4 pt-3 pb-2 border-b border-border shrink-0 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editedName}
                  onChange={e => handleNameChange(e.target.value)}
                  disabled={isBase}
                  placeholder="Nome do template"
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-yellow-500/50 transition-colors ${
                    isBase
                      ? 'border-border bg-secondary/50 text-muted-foreground cursor-not-allowed'
                      : 'border-border bg-background text-foreground'
                  }`}
                />
                {hasUnsaved && !isBase && (
                  <span className="text-[10px] text-yellow-400 shrink-0">alterações não salvas</span>
                )}
              </div>

              {/* Toolbar */}
              {!isBase && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleSave}
                    disabled={saving || !hasUnsaved}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors"
                  >
                    {saving ? 'Salvando...' : 'Salvar'}
                  </button>

                  {isActive ? (
                    <button
                      onClick={handleDeactivate}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 text-xs font-semibold transition-colors"
                    >
                      <ZapOff className="w-3 h-3" />
                      Desativar
                    </button>
                  ) : (
                    <button
                      onClick={handleActivate}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
                    >
                      <Zap className="w-3 h-3" />
                      Ativar
                    </button>
                  )}

                  <button
                    onClick={handleDelete}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 text-xs font-semibold transition-colors ml-auto"
                  >
                    <Trash2 className="w-3 h-3" />
                    Excluir
                  </button>
                </div>
              )}

              {isBase && (
                <div className="flex items-center gap-2">
                  <p className="text-[11px] text-muted-foreground flex-1">
                    Este é o prompt padrão — read-only. Clone para criar sua versão customizada.
                  </p>
                  <button
                    onClick={handleClone}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-600 hover:bg-yellow-500 text-white text-xs font-semibold transition-colors shrink-0"
                  >
                    <Copy className="w-3 h-3" />
                    Clonar
                  </button>
                </div>
              )}
            </div>

            {/* Textarea */}
            <div className="flex-1 min-h-0 p-3">
              <textarea
                value={editedContent}
                onChange={e => handleContentChange(e.target.value)}
                readOnly={isBase}
                spellCheck={false}
                className={`w-full h-full rounded-xl border p-3 text-xs font-mono leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-yellow-500/50 transition-colors ${
                  isBase
                    ? 'border-border bg-secondary/30 text-muted-foreground cursor-default'
                    : 'border-border bg-background text-foreground'
                }`}
              />
            </div>
          </div>
        </div>

        {/* Variáveis disponíveis — painel colapsável na base */}
        <div className="border-t border-border shrink-0">
          <button
            onClick={() => setShowVars(v => !v)}
            className="w-full flex items-center justify-between px-5 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>Variáveis disponíveis nos templates</span>
            {showVars ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {showVars && (
            <div className="px-5 pb-3 grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-40 overflow-y-auto">
              {VARIABLE_TOKENS.map(({ token, desc }) => (
                <button
                  key={token}
                  onClick={() => copyToken(token)}
                  title={`Clique para copiar: ${token}`}
                  className="text-left flex items-start gap-1.5 rounded-lg px-2 py-1.5 bg-secondary/50 hover:bg-secondary transition-colors group"
                >
                  <code className="text-[10px] font-mono text-yellow-400 shrink-0 group-hover:text-yellow-300 transition-colors leading-snug">{token}</code>
                  <span className="text-[9px] text-muted-foreground leading-snug">{desc}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
