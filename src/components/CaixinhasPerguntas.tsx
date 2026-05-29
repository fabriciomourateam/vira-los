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
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

type QaPair = { pergunta: string; resposta: string; tema?: string };
type QaSet = { id: string; pairs: QaPair[]; note?: string; niche?: string; created_at?: string };

export default function CaixinhasPerguntas() {
  const [note, setNote] = useState('');
  const [count, setCount] = useState(6);
  const [loading, setLoading] = useState(false);
  const [pairs, setPairs] = useState<QaPair[]>([]);
  const [needsSync, setNeedsSync] = useState(false);
  const [history, setHistory] = useState<QaSet[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/qa-stickers`);
      const data = await r.json();
      setHistory(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

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
              <div className="flex items-start gap-2 pt-2 border-t border-border">
                <span className="text-[10px] font-bold text-emerald-500 mt-1 shrink-0 w-16">RESPOSTA</span>
                <p className="flex-1 text-sm text-muted-foreground">{p.resposta}</p>
                <button onClick={() => copy(p.resposta, `a${i}`)} className="shrink-0 p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="Copiar resposta">
                  {copied === `a${i}` ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
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
                      <p className="text-muted-foreground mt-0.5">{p.resposta}</p>
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
