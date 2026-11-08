/**
 * Roteirista.tsx
 * Subtab "Roteirista" em Criar.
 * Cola a transcrição de um vídeo que viralizou + nicho/estilo e gera um roteiro
 * de Reels adaptado pro nicho do criador, usando o framework de gancho de alta
 * retenção (pattern interrupt / tensão cognitiva / contraste / número / identidade).
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { PenLine, Loader2, Copy, CheckCircle2, Sparkles } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function Roteirista() {
  const [transcricao, setTranscricao] = useState('');
  const [nicho, setNicho] = useState('');
  const [estilo, setEstilo] = useState('');
  const [assinatura, setAssinatura] = useState('');
  const [loading, setLoading] = useState(false);
  const [roteiro, setRoteiro] = useState('');
  const [copied, setCopied] = useState(false);

  async function gerar() {
    if (!transcricao.trim()) {
      toast.error('Cole a transcrição do vídeo viral');
      return;
    }
    setLoading(true);
    setRoteiro('');
    try {
      const r = await fetch(`${API}/api/roteirista`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcricao: transcricao.trim(),
          nicho: nicho.trim(),
          estilo: estilo.trim(),
          assinatura: assinatura.trim(),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao gerar');
      setRoteiro(data.roteiro);
      toast.success('Roteiro gerado!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro');
    } finally {
      setLoading(false);
    }
  }

  function copy() {
    navigator.clipboard.writeText(roteiro);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
    toast.success('Roteiro copiado');
  }

  return (
    <div className="space-y-5">
      <div className="text-center mb-2">
        <h2 className="text-xl sm:text-2xl font-extrabold flex items-center justify-center gap-2">
          <PenLine className="w-5 h-5 sm:w-6 sm:h-6 text-blue-500" />
          Roteirista
        </h2>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Cole a transcrição de um vídeo que viralizou — adapto a estrutura dele pro seu nicho com gancho de alta retenção.
        </p>
      </div>

      <div className="rounded-2xl bg-card p-4 sm:p-5 space-y-4" style={{ boxShadow: 'var(--shadow-card)' }}>
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">
            Transcrição do vídeo viral *
          </label>
          <textarea
            value={transcricao}
            onChange={e => setTranscricao(e.target.value)}
            rows={7}
            placeholder="Cole aqui a transcrição (legenda automática / fala) do vídeo que você quer usar como referência de estrutura..."
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          />
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Nicho (opcional)</label>
            <input value={nicho} onChange={e => setNicho(e.target.value)}
              placeholder="usa o do perfil"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Estilo/tom (opcional)</label>
            <input value={estilo} onChange={e => setEstilo(e.target.value)}
              placeholder="ex: provocativo, técnico"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Bordão (opcional)</label>
            <input value={assinatura} onChange={e => setAssinatura(e.target.value)}
              placeholder="sua assinatura"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
          </div>
        </div>
        <button
          onClick={gerar}
          disabled={loading}
          className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
        >
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Gerando...</> : <><Sparkles className="w-4 h-4" /> Gerar roteiro</>}
        </button>
      </div>

      {roteiro && (
        <div className="rounded-2xl bg-card p-4 sm:p-5 space-y-3" style={{ boxShadow: 'var(--shadow-card)' }}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wide">Roteiro</h3>
            <button onClick={copy}
              className="text-[11px] font-bold px-3 py-1.5 rounded-md bg-secondary hover:bg-border text-foreground flex items-center gap-1.5">
              {copied ? <><CheckCircle2 className="w-3 h-3 text-emerald-500" /> Copiado</> : <><Copy className="w-3 h-3" /> Copiar</>}
            </button>
          </div>
          <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed text-foreground">{roteiro}</pre>
        </div>
      )}
    </div>
  );
}
