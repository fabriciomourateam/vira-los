import React, { useState } from 'react';
import { Bot, Search, Play, Calendar, AlertTriangle, Check, Loader2, Zap } from 'lucide-react';

const TikTokIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.26 8.26 0 004.83 1.56V6.8a4.85 4.85 0 01-1.06-.11z"/>
  </svg>
);

const PLATFORMS = [
  { id: 'tiktok',    label: 'TikTok',    icon: <TikTokIcon size={15} /> },
  { id: 'instagram', label: 'Instagram', icon: <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg> },
  { id: 'youtube',   label: 'YouTube',   icon: <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor"><path d="M22.54 6.42a2.78 2.78 0 00-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46A2.78 2.78 0 001.46 6.42 29 29 0 001 12a29 29 0 00.46 5.58 2.78 2.78 0 001.95 1.96C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 001.95-1.96A29 29 0 0023 12a29 29 0 00-.46-5.58z"/><polygon fill="white" points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02"/></svg> },
] as const;

type PlatformId = 'tiktok' | 'instagram' | 'youtube';
type Frequency = 'daily' | 'specific';

export default function AgenteAutonomo() {
  const [keyword, setKeyword] = useState('testosterona');
  const [platforms, setPlatforms] = useState<PlatformId[]>(['tiktok', 'instagram', 'youtube']);
  const [frequency, setFrequency] = useState<Frequency>('daily');
  const [hour, setHour] = useState(7);
  const [minute, setMinute] = useState(0);
  const [saved, setSaved] = useState(false);
  const [running, setRunning] = useState(false);

  function togglePlatform(id: PlatformId) {
    setPlatforms((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  async function handleRun() {
    if (!keyword.trim() || platforms.length === 0) return;
    setRunning(true);
    await new Promise((r) => setTimeout(r, 1500));
    setRunning(false);
  }

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="flex items-start gap-4">
        <div className="w-12 h-12 bg-orange-50 rounded-2xl flex items-center justify-center shrink-0">
          <Bot size={24} className="text-orange-500" />
        </div>
        <div>
          <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight">Agente Autônomo</h2>
          <p className="text-muted-foreground text-xs sm:text-sm mt-0.5">
            Segue o roteiro Vira-Los automaticamente
          </p>
        </div>
      </section>

      {/* Config card */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-5" style={{ boxShadow: 'var(--shadow-layered)' }}>
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Configuração da Pesquisa</h3>

        {/* Keyword */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground">Palavra-chave</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="Ex: testosterona, treino, emagrecimento"
              className="w-full bg-secondary border border-border rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 transition-all"
            />
          </div>
        </div>

        {/* Platforms */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground">Plataformas</label>
          <div className="grid grid-cols-3 gap-2">
            {PLATFORMS.map((p) => {
              const active = platforms.includes(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => togglePlatform(p.id)}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                    active
                      ? 'bg-foreground text-background border-transparent'
                      : 'bg-secondary text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground'
                  }`}
                >
                  {p.icon}
                  <span className="hidden sm:inline">{p.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Run button */}
        <div className="flex gap-2">
          <button
            onClick={handleRun}
            disabled={running || !keyword.trim() || platforms.length === 0}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-orange-500 text-white rounded-xl text-sm font-bold hover:bg-orange-600 disabled:opacity-50 transition-all"
          >
            {running ? (
              <><Loader2 size={16} className="animate-spin" /> Pesquisando...</>
            ) : (
              <><Play size={16} /> Iniciar Pesquisa</>
            )}
          </button>
          <button
            className="p-3 bg-secondary border border-border rounded-xl text-muted-foreground hover:text-foreground transition-colors"
            title="Ver histórico"
          >
            <Calendar size={18} />
          </button>
        </div>
      </div>

      {/* Schedule card */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-4" style={{ boxShadow: 'var(--shadow-card)' }}>
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Agendamento Automático</h3>

        {/* Frequency */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground">Frequência</label>
          <div className="grid grid-cols-2 gap-2">
            {([['daily', 'Todo dia'], ['specific', 'Dias específicos']] as [Frequency, string][]).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setFrequency(val)}
                className={`py-2.5 rounded-xl text-sm font-bold border transition-all ${
                  frequency === val
                    ? 'bg-foreground text-background border-transparent'
                    : 'bg-secondary text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Time */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground">Horário (Brasília)</label>
          <div className="flex items-center gap-2">
            <select
              value={hour}
              onChange={(e) => setHour(Number(e.target.value))}
              className="w-20 bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-center focus:outline-none focus:ring-2 focus:ring-foreground/10"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
              ))}
            </select>
            <span className="font-bold text-muted-foreground">:</span>
            <select
              value={minute}
              onChange={(e) => setMinute(Number(e.target.value))}
              className="w-20 bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-center focus:outline-none focus:ring-2 focus:ring-foreground/10"
            >
              {[0, 15, 30, 45].map((m) => (
                <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
              ))}
            </select>

            <button
              onClick={handleSave}
              className={`ml-auto flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
                saved
                  ? 'bg-emerald-500 text-white'
                  : 'bg-foreground text-background hover:opacity-90'
              }`}
            >
              {saved ? <><Check size={15} /> Salvo</> : 'Salvar'}
            </button>
          </div>
        </div>

        {/* Warning */}
        <div className="flex items-start gap-2 p-3 bg-orange-50 border border-orange-100 rounded-xl">
          <AlertTriangle size={14} className="text-orange-500 shrink-0 mt-0.5" />
          <p className="text-xs text-orange-700">O PC (ou servidor) precisa estar ligado no horário agendado.</p>
        </div>
      </div>

      {/* How it works */}
      <div className="p-5 bg-foreground text-background rounded-2xl space-y-3" style={{ boxShadow: 'var(--shadow-layered)' }}>
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-orange-400" />
          <span className="text-xs font-bold uppercase tracking-widest">Como funciona</span>
        </div>
        <div className="grid sm:grid-cols-3 gap-3 text-xs text-background/70">
          <div className="space-y-1">
            <p className="font-semibold text-background">① Pesquisa</p>
            <p>Busca vídeos virais da palavra-chave nas plataformas selecionadas com filtros do Roteiro</p>
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-background">② Análise</p>
            <p>Identifica formatos virais (lista, revelação, medo, antes/depois) e pontua alinhamento ao nicho</p>
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-background">③ Entrega</p>
            <p>Salva os melhores na aba Pesquisa → IA Viral para você adaptar e gravar</p>
          </div>
        </div>
      </div>
    </div>
  );
}
