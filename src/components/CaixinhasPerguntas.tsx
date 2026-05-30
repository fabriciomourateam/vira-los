/**
 * CaixinhasPerguntas.tsx
 * Subtab "Caixinhas" dentro de Criar.
 * Gera pares pergunta+resposta a partir do Instagram REAL do usuário (posts que
 * mais engajam + nicho), pro sticker "Faça uma pergunta" do Stories — o criador
 * pergunta e responde ele mesmo, gerando engajamento. Meta: 3x/semana.
 */

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  MessageCircleQuestion, Loader2, Copy, CheckCircle2, Sparkles, Trash2, Save, RefreshCw,
  Settings2, RotateCcw, ChevronDown, ChevronUp, AlertTriangle, Eye,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

type QaPair = {
  pergunta: string;
  resposta?: string;        // fallback / template padrão (uma versão só)
  respostaCurta?: string;   // pro sticker do Stories — 1-3 frases
  respostaAudio?: string;   // roteiro pra áudio/Reels — com hook
  tema?: string;
};
type QaSet = { id: string; pairs: QaPair[]; note?: string; niche?: string; created_at?: string };
type Placeholder = { key: string; desc: string };

export default function CaixinhasPerguntas() {
  const [note, setNote] = useState('');
  const [count, setCount] = useState(6);
  const [loading, setLoading] = useState(false);
  const [pairs, setPairs] = useState<QaPair[]>([]);
  const [needsSync, setNeedsSync] = useState(false);
  const [history, setHistory] = useState<QaSet[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  // ─── Editor do prompt ───────────────────────────────────────────────────────
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptTpl, setPromptTpl] = useState('');
  const [promptSavedTpl, setPromptSavedTpl] = useState('');  // o que está no servidor agora
  const [promptDefault, setPromptDefault] = useState('');
  const [promptIsCustom, setPromptIsCustom] = useState(false);
  const [promptLoaded, setPromptLoaded] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const promptDirty = promptLoaded && promptTpl !== promptSavedTpl;

  // ─── Preview do prompt final (placeholders já substituídos) ────────────────
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewStats, setPreviewStats] = useState<Record<string, unknown> | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/qa-stickers`);
      const data = await r.json();
      setHistory(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
  }, []);

  const fetchPrompt = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/qa-stickers/prompt`);
      const data = await r.json();
      setPromptTpl(data.template || '');
      setPromptSavedTpl(data.template || '');
      setPromptDefault(data.default || '');
      setPromptIsCustom(!!data.isCustom);
      setPlaceholders(Array.isArray(data.placeholders) ? data.placeholders : []);
      setPromptLoaded(true);
    } catch { toast.error('Erro ao carregar prompt'); }
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);
  useEffect(() => { if (promptOpen && !promptLoaded) fetchPrompt(); }, [promptOpen, promptLoaded, fetchPrompt]);

  async function savePrompt() {
    if (!promptTpl.trim()) { toast.error('Template não pode ficar vazio'); return; }
    setPromptSaving(true);
    try {
      const r = await fetch(`${API}/api/qa-stickers/prompt`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: promptTpl }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Falha ao salvar');
      setPromptSavedTpl(promptTpl);
      setPromptIsCustom(promptTpl !== promptDefault);
      toast.success('Prompt salvo');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro');
    } finally { setPromptSaving(false); }
  }

  async function previewPrompt() {
    setPreviewLoading(true);
    try {
      const qs = new URLSearchParams({ note: note.trim(), count: String(count) });
      const r = await fetch(`${API}/api/qa-stickers/preview?${qs}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao gerar preview');
      setPreviewText(data.prompt || '');
      setPreviewStats(data.stats || null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro no preview');
    } finally { setPreviewLoading(false); }
  }

  async function resetPrompt() {
    if (!confirm('Voltar pro prompt padrão? Vai perder suas alterações salvas.')) return;
    setPromptSaving(true);
    try {
      const r = await fetch(`${API}/api/qa-stickers/prompt`, { method: 'DELETE' });
      const data = await r.json();
      const def = data.template || promptDefault;
      setPromptTpl(def);
      setPromptSavedTpl(def);
      setPromptIsCustom(false);
      toast.success('Prompt resetado pro padrão');
    } catch { toast.error('Erro ao resetar'); }
    finally { setPromptSaving(false); }
  }

  async function generate() {
    setLoading(true);
    setNeedsSync(false);
    try {
      const r = await fetch(`${API}/api/qa-stickers/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim(), count }),
      });
      const data = await r.json();
      if (r.status === 409) { setNeedsSync(true); throw new Error(data.error); }
      if (!r.ok) throw new Error(data.error || 'Falha ao gerar');
      setPairs(data.pairs || []);
      toast.success(`${data.pairs?.length || 0} caixinhas geradas`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro');
    } finally {
      setLoading(false);
    }
  }

  async function saveCurrent() {
    if (!pairs.length) return;
    try {
      const r = await fetch(`${API}/api/qa-stickers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairs, note: note.trim() }),
      });
      if (!r.ok) throw new Error('Falha ao salvar');
      await fetchHistory();
      toast.success('Salvo no histórico');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar');
    }
  }

  async function deleteSet(id: string) {
    if (!confirm('Excluir essa leva de caixinhas?')) return;
    try {
      await fetch(`${API}/api/qa-stickers/${id}`, { method: 'DELETE' });
      setHistory(prev => prev.filter(s => s.id !== id));
      toast.success('Excluído');
    } catch { toast.error('Erro ao excluir'); }
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1800);
    toast.success('Copiado');
  }

  return (
    <div className="space-y-5">
      <div className="text-center mb-2">
        <h2 className="text-xl sm:text-2xl font-extrabold flex items-center justify-center gap-2">
          <MessageCircleQuestion className="w-5 h-5 sm:w-6 sm:h-6 text-amber-500" />
          Caixinhas de Perguntas
        </h2>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Perguntas + respostas baseadas no que mais engaja no seu Instagram. Você pergunta e responde no Stories.
        </p>
      </div>

      {/* Editor do prompt (recolhível) */}
      <div className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: 'var(--shadow-card)' }}>
        <button
          onClick={() => setPromptOpen(o => !o)}
          className="w-full px-4 sm:px-5 py-3 flex items-center justify-between gap-2 text-left hover:bg-secondary/50 transition-colors"
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <Settings2 className="w-4 h-4 text-amber-500" />
            Editar prompt
            {promptIsCustom && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-semibold uppercase tracking-wider">custom</span>}
          </span>
          {promptOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {promptOpen && (
          <div className="px-4 sm:px-5 pb-4 sm:pb-5 space-y-3 border-t border-border">
            {!promptLoaded ? (
              <div className="py-6 flex items-center justify-center text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Carregando prompt...
              </div>
            ) : (
              <>
                <p className="text-[11px] text-muted-foreground mt-3">
                  Edite o template do prompt que vai pro Claude. Use os placeholders abaixo — eles são substituídos pelos dados reais do seu IG na hora de gerar.
                </p>
                <div className="rounded-lg bg-secondary/40 p-2.5 text-[11px] space-y-0.5">
                  {placeholders.map(p => (
                    <div key={p.key} className="flex items-start gap-2">
                      <code className="font-mono text-amber-600 font-semibold shrink-0">{`{{${p.key}}}`}</code>
                      <span className="text-muted-foreground">— {p.desc}</span>
                    </div>
                  ))}
                </div>
                <textarea
                  value={promptTpl}
                  onChange={e => setPromptTpl(e.target.value)}
                  rows={20}
                  spellCheck={false}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12.5px] font-mono leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                />
                <div className="flex items-start gap-2 rounded-md bg-amber-500/5 border border-amber-500/20 p-2.5 text-[11px] text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>Se você tirar a instrução de retornar JSON no final, as caixinhas vão quebrar — Claude precisa devolver no formato <code className="font-mono">{`{"pairs":[...]}`}</code>.</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={savePrompt}
                    disabled={promptSaving || !promptDirty}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold disabled:opacity-40 transition-colors"
                  >
                    {promptSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    Salvar
                  </button>
                  <button
                    onClick={previewPrompt}
                    disabled={previewLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold disabled:opacity-40 transition-colors"
                  >
                    {previewLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                    Ver prompt final
                  </button>
                  <button
                    onClick={resetPrompt}
                    disabled={promptSaving || !promptIsCustom}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary hover:bg-border text-foreground text-xs font-bold disabled:opacity-40 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" /> Restaurar padrão
                  </button>
                  {promptDirty && (
                    <span className="text-[11px] text-amber-600 flex items-center">não salvo</span>
                  )}
                </div>
                {previewText !== null && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
                        Prompt final (o que vai pro Claude)
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { navigator.clipboard.writeText(previewText); toast.success('Copiado'); }}
                          className="text-[10px] font-bold px-2 py-1 rounded bg-secondary hover:bg-border text-foreground flex items-center gap-1"
                        >
                          <Copy className="w-3 h-3" /> Copiar
                        </button>
                        <button
                          onClick={() => { setPreviewText(null); setPreviewStats(null); }}
                          className="text-[10px] font-bold px-2 py-1 rounded bg-secondary hover:bg-border text-muted-foreground"
                        >
                          Fechar
                        </button>
                      </div>
                    </div>
                    {previewStats && (
                      <div className="text-[10px] text-muted-foreground bg-secondary/40 rounded p-2 flex gap-3 flex-wrap">
                        <span>nicho: <strong>{String(previewStats.niche)}</strong></span>
                        <span>posts: <strong>{String(previewStats.postsUsados)}</strong></span>
                        <span>carrosséis: <strong>{String(previewStats.carrosseis)}</strong></span>
                        <span>análise IA: <strong>{previewStats.temAnalise ? 'sim' : 'não'}</strong></span>
                        <span>público: <strong>{previewStats.temPublico ? 'sim' : 'não'}</strong></span>
                      </div>
                    )}
                    <pre className="rounded-lg border border-border bg-background p-3 text-[11px] font-mono leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
                      {previewText}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Form */}
      <div className="rounded-2xl bg-card p-4 sm:p-5 space-y-4" style={{ boxShadow: 'var(--shadow-card)' }}>
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">
            Foco da semana (opcional)
          </label>
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && generate()}
            placeholder="ex: creatina, cutting, hormônios — deixe vazio pra usar os temas que mais engajam"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Quantidade: <span className="text-amber-500 font-bold">{count}</span>
          </label>
          <input type="range" min={3} max={10} value={count}
            onChange={e => setCount(Number(e.target.value))}
            className="flex-1 accent-amber-500" />
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
        >
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Gerando...</> : <><Sparkles className="w-4 h-4" /> Gerar caixinhas</>}
        </button>
        {needsSync && (
          <p className="text-[11px] text-amber-600 bg-amber-500/10 rounded-lg p-2.5">
            Você precisa conectar e sincronizar seu Instagram na aba <strong>Analytics</strong> primeiro — as caixinhas usam seus posts reais.
          </p>
        )}
      </div>

      {/* Resultado atual */}
      {pairs.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wide">
              {pairs.length} geradas
            </h3>
            <button onClick={saveCurrent}
              className="text-[11px] font-bold px-3 py-1.5 rounded-md bg-secondary hover:bg-border text-foreground flex items-center gap-1.5">
              <Save className="w-3 h-3" /> Salvar leva
            </button>
          </div>
          {pairs.map((p, i) => (
            <div key={i} className="rounded-xl bg-card p-3.5 space-y-2" style={{ boxShadow: 'var(--shadow-card)' }}>
              {p.tema && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-semibold uppercase tracking-wider">{p.tema}</span>}
              <div className="flex items-start gap-2">
                <span className="text-[10px] font-bold text-amber-500 mt-1 shrink-0 w-16">PERGUNTA</span>
                <p className="flex-1 text-sm font-semibold">{p.pergunta}</p>
                <button onClick={() => copy(p.pergunta, `q${i}`)} className="shrink-0 p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="Copiar pergunta">
                  {copied === `q${i}` ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              {(p.respostaCurta || p.resposta) && (
                <div className="flex items-start gap-2 pt-2 border-t border-border">
                  <span className="text-[10px] font-bold text-emerald-500 mt-1 shrink-0 w-16">{p.respostaAudio ? 'STICKER' : 'RESPOSTA'}</span>
                  <p className="flex-1 text-sm text-muted-foreground">{p.respostaCurta || p.resposta}</p>
                  <button onClick={() => copy(p.respostaCurta || p.resposta || '', `a${i}`)} className="shrink-0 p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="Copiar">
                    {copied === `a${i}` ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              )}
              {p.respostaAudio && (
                <div className="flex items-start gap-2 pt-2 border-t border-border">
                  <span className="text-[10px] font-bold text-sky-500 mt-1 shrink-0 w-16">ROTEIRO</span>
                  <p className="flex-1 text-sm text-muted-foreground whitespace-pre-wrap">{p.respostaAudio}</p>
                  <button onClick={() => copy(p.respostaAudio || '', `r${i}`)} className="shrink-0 p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="Copiar roteiro">
                    {copied === `r${i}` ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Histórico */}
      {history.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-2">
            Histórico ({history.length})
          </h3>
          <div className="space-y-2">
            {history.map(s => (
              <details key={s.id} className="rounded-xl bg-card p-3" style={{ boxShadow: 'var(--shadow-card)' }}>
                <summary className="cursor-pointer text-sm font-semibold flex items-center justify-between">
                  <span>{s.pairs.length} caixinhas{s.note ? ` · ${s.note}` : ''}</span>
                  <button onClick={(e) => { e.preventDefault(); deleteSet(s.id); }}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </summary>
                <div className="mt-2 space-y-2">
                  {s.pairs.map((p, i) => (
                    <div key={i} className="text-xs border-t border-border pt-2">
                      <p className="font-semibold">{p.pergunta}</p>
                      {(p.respostaCurta || p.resposta) && (
                        <p className="text-muted-foreground mt-0.5">
                          {p.respostaAudio && <span className="text-[9px] font-bold text-emerald-500 mr-1">STICKER:</span>}
                          {p.respostaCurta || p.resposta}
                        </p>
                      )}
                      {p.respostaAudio && (
                        <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap">
                          <span className="text-[9px] font-bold text-sky-500 mr-1">ROTEIRO:</span>
                          {p.respostaAudio}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
