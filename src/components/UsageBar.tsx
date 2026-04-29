/**
 * UsageBar.tsx
 * Barra fina no topo mostrando gastos com Claude e economia gerada.
 * Clique abre modal com detalhamento por feature/mês.
 *
 * Backend: GET /api/usage/summary (server/routes/usage.js)
 * Tracking: server/services/usageTracker.js
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, X, DollarSign, Clock, BarChart3 } from 'lucide-react';

const API = (import.meta as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE
  || (typeof window !== 'undefined' && window.location?.hostname === 'localhost' ? 'http://localhost:3001' : '');

type CategoryStats = { brl: number; savedBrl: number; count: number; minSaved: number };

type UsageSummary = {
  total: CategoryStats;
  today: CategoryStats;
  thisMonth: CategoryStats;
  lastMonth: CategoryStats;
  byFeature: Record<string, CategoryStats>;
  byMonth: Record<string, CategoryStats>;
  config: {
    usdBrl: number;
    hourlyRateBrl: number;
    smGrossBrl: number;
    smDaysPerMonth: number;
    smHoursPerDay: number;
    timeSavedMin: Record<string, number>;
  };
};

const FEATURE_LABELS: Record<string, string> = {
  carousel: 'Carrosséis (Básico)',
  'regenerate-slide': 'Regenerar slide',
  legenda: 'Legenda',
  'maquina-headlines': 'Máquina · Headlines',
  'maquina-structure': 'Máquina · Estrutura',
  'maquina-html': 'Máquina · HTML',
  'maquina-full': 'Máquina · Completo',
  ideas: 'Gerador de ideias',
  'reels-analysis': 'Análise de reels',
  roteiro: 'Roteiros',
  'viral-score': 'Viral score',
  'trend-radar': 'Trend radar',
  'story-sequence': 'Story sequence',
  'instagram-analytics': 'Instagram analytics',
  agent: 'Agent',
  research: 'Research',
  schedule: 'Agendamento',
  unknown: 'Outros',
};

function formatBRL(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatHours(min: number): string {
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${m}min`;
}

export default function UsageBar() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [open, setOpen] = useState(false);

  async function refresh() {
    try {
      const res = await fetch(`${API}/api/usage/summary`);
      if (!res.ok) return;
      const data = await res.json();
      setSummary(data);
    } catch {
      // silencioso
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30_000); // atualiza a cada 30s
    return () => clearInterval(interval);
  }, []);

  if (!summary) return null;

  const monthDiff = summary.thisMonth.brl - summary.lastMonth.brl;
  const monthDiffPct = summary.lastMonth.brl > 0
    ? Math.round((monthDiff / summary.lastMonth.brl) * 100)
    : 0;

  return (
    <>
      <button
        onClick={() => { setOpen(true); refresh(); }}
        className="w-full bg-gradient-to-r from-amber-500/10 via-emerald-500/10 to-amber-500/10 border-b border-amber-500/20 hover:from-amber-500/15 hover:via-emerald-500/15 hover:to-amber-500/15 transition-colors"
        title="Clique para ver detalhamento de custos"
      >
        <div className="max-w-3xl mx-auto px-4 py-1.5 flex items-center justify-between text-[11px] sm:text-xs font-medium gap-3">
          <div className="flex items-center gap-3 sm:gap-5 overflow-x-auto whitespace-nowrap">
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <DollarSign className="w-3 h-3 shrink-0" />
              <span className="text-muted-foreground">Hoje:</span>
              <span className="font-bold">{formatBRL(summary.today.brl)}</span>
            </span>
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <span className="text-muted-foreground">Mês:</span>
              <span className="font-bold">{formatBRL(summary.thisMonth.brl)}</span>
            </span>
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="w-3 h-3 shrink-0" />
              <span className="text-muted-foreground">Economizou:</span>
              <span className="font-bold">{formatBRL(summary.thisMonth.savedBrl)}</span>
              <span className="text-muted-foreground hidden sm:inline">({formatHours(summary.thisMonth.minSaved)})</span>
            </span>
          </div>
          <span className="text-muted-foreground hidden sm:inline">{summary.thisMonth.count} usos · ver detalhes →</span>
          <span className="text-muted-foreground sm:hidden">↓</span>
        </div>
      </button>

      <AnimatePresence>
        {open && summary && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
              className="bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-card/90 backdrop-blur-md border-b border-border px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-amber-500" />
                  <h2 className="font-bold text-sm">Gastos & Economia com Claude</h2>
                </div>
                <button onClick={() => setOpen(false)} className="p-1 rounded-lg hover:bg-secondary">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-5">
                {/* Cards principais */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Card label="Hoje" value={formatBRL(summary.today.brl)} sub={`${summary.today.count} usos`} />
                  <Card label="Este mês" value={formatBRL(summary.thisMonth.brl)} sub={`${summary.thisMonth.count} usos`} accent />
                  <Card label="Mês passado" value={formatBRL(summary.lastMonth.brl)} sub={`${summary.lastMonth.count} usos`} />
                  <Card label="Total" value={formatBRL(summary.total.brl)} sub={`${summary.total.count} usos`} />
                </div>

                {/* Comparativo mês a mês */}
                <div className="rounded-xl border border-border bg-secondary/30 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Comparativo mês atual vs. anterior</div>
                  <div className="text-sm">
                    {summary.lastMonth.brl > 0 ? (
                      <span>
                        {monthDiff >= 0 ? '+' : ''}{formatBRL(monthDiff)} ({monthDiffPct >= 0 ? '+' : ''}{monthDiffPct}%) vs. mês passado
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Sem dados do mês passado ainda</span>
                    )}
                  </div>
                </div>

                {/* Economia */}
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-[10px] uppercase tracking-wider font-bold mb-2">
                    <TrendingUp className="w-3 h-3" />
                    Economia (vs. social media R$ {summary.config.smGrossBrl} bruto · R$ {summary.config.hourlyRateBrl}/h)
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] text-muted-foreground">Este mês</div>
                      <div className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">
                        {formatBRL(summary.thisMonth.savedBrl)}
                      </div>
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {formatHours(summary.thisMonth.minSaved)} economizados
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Total acumulado</div>
                      <div className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">
                        {formatBRL(summary.total.savedBrl)}
                      </div>
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {formatHours(summary.total.minSaved)} economizados
                      </div>
                    </div>
                  </div>
                </div>

                {/* Por feature */}
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-bold">Gastos por feature</div>
                  <div className="space-y-1">
                    {Object.entries(summary.byFeature)
                      .sort(([, a], [, b]) => b.brl - a.brl)
                      .map(([feature, stats]) => (
                        <div key={feature} className="flex items-center justify-between text-xs py-1.5 border-b border-border/40 last:border-0">
                          <div className="flex-1 truncate">
                            <span className="font-medium">{FEATURE_LABELS[feature] || feature}</span>
                            <span className="text-muted-foreground ml-2">{stats.count}×</span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-amber-600 dark:text-amber-400 font-mono text-[11px]">{formatBRL(stats.brl)}</span>
                            <span className="text-emerald-600 dark:text-emerald-400 font-mono text-[11px]">+{formatBRL(stats.savedBrl)}</span>
                          </div>
                        </div>
                      ))}
                    {Object.keys(summary.byFeature).length === 0 && (
                      <div className="text-xs text-muted-foreground py-3 text-center">Nenhum uso registrado ainda</div>
                    )}
                  </div>
                </div>

                {/* Por mês */}
                {Object.keys(summary.byMonth).length > 1 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-bold">Histórico mensal</div>
                    <div className="space-y-1">
                      {Object.entries(summary.byMonth)
                        .sort(([a], [b]) => b.localeCompare(a))
                        .map(([month, stats]) => {
                          const [y, m] = month.split('-');
                          const label = `${m}/${y}`;
                          return (
                            <div key={month} className="flex items-center justify-between text-xs py-1.5 border-b border-border/40 last:border-0">
                              <span className="font-medium">{label}</span>
                              <div className="flex items-center gap-3 shrink-0">
                                <span className="text-muted-foreground">{stats.count} usos</span>
                                <span className="text-amber-600 dark:text-amber-400 font-mono text-[11px]">{formatBRL(stats.brl)}</span>
                                <span className="text-emerald-600 dark:text-emerald-400 font-mono text-[11px]">+{formatBRL(stats.savedBrl)}</span>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

                {/* Footer config */}
                <div className="text-[10px] text-muted-foreground border-t border-border pt-3">
                  Cotação USD→BRL: R$ {summary.config.usdBrl.toFixed(2)} · Hora SM: R$ {summary.config.hourlyRateBrl}
                  ({summary.config.smDaysPerMonth} dias × {summary.config.smHoursPerDay}h/dia · R$ {summary.config.smGrossBrl} bruto).
                  Tempos por feature configurados em <code>server/services/usageTracker.js</code>.
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Card({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${accent ? 'border-amber-500/40 bg-amber-500/5' : 'border-border bg-secondary/30'}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-base font-extrabold mt-0.5 ${accent ? 'text-amber-600 dark:text-amber-400' : ''}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{sub}</div>
    </div>
  );
}
