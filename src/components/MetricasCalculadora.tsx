import React, { useState, useEffect } from 'react';
import { Calculator, TrendingUp, Eye, Users, Award, AlertTriangle, CheckCircle2, Timer } from 'lucide-react';
import { motion } from 'framer-motion';

interface MetricsState {
  views: string;
  nonFollowerViews: string;
  newFollowers: string;
  retention4s: string;
  retention10s: string;
}

const GOLD_STANDARD = 0.40; // 0.40% conversion rate

export default function MetricasCalculadora() {
  const [metrics, setMetrics] = useState<MetricsState>({
    views: '',
    nonFollowerViews: '',
    newFollowers: '',
    retention4s: '',
    retention10s: '',
  });

  useEffect(() => {
    const saved = localStorage.getItem('viral-os-metrics');
    if (saved) {
      try { setMetrics(JSON.parse(saved)); } catch {}
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('viral-os-metrics', JSON.stringify(metrics));
  }, [metrics]);

  const update = (field: keyof MetricsState, value: string) => {
    setMetrics(prev => ({ ...prev, [field]: value }));
  };

  const views = parseFloat(metrics.views) || 0;
  const nonFollowerViews = parseFloat(metrics.nonFollowerViews) || 0;
  const newFollowers = parseFloat(metrics.newFollowers) || 0;
  const retention4s = parseFloat(metrics.retention4s) || 0;
  const retention10s = parseFloat(metrics.retention10s) || 0;

  const nonFollowerPct = views > 0 ? ((nonFollowerViews / views) * 100) : 0;
  const conversionRate = views > 0 ? ((newFollowers / views) * 100) : 0;
  const isAboveGold = conversionRate >= GOLD_STANDARD;
  const followersNeededForGold = views > 0 ? Math.ceil(views * GOLD_STANDARD / 100) : 0;

  const retention4sOk = retention4s >= 50;
  const retention10sOk = retention10s >= 50;

  return (
    <div className="space-y-6">
      {/* Header */}
      <section>
        <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight mb-1">📊 Métricas & Calculadora</h2>
        <p className="text-muted-foreground text-xs sm:text-sm hidden sm:block">Analise a performance dos seus Reels com foco em meio de funil viral</p>
      </section>

      {/* Retention Benchmarks */}
      <div className="bg-foreground text-background p-6 rounded-2xl" style={{ boxShadow: 'var(--shadow-layered)' }}>
        <div className="flex items-center gap-2 mb-4">
          <Timer size={20} />
          <h3 className="font-bold text-lg">Benchmarks de Retenção</h3>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-background/10 p-4 rounded-xl">
            <p className="text-sm font-semibold mb-1">Primeiros 4 segundos</p>
            <p className="text-3xl font-extrabold">≥ 50%</p>
            <p className="text-xs opacity-60 mt-1">Necessário para alcançar o máximo de pessoas</p>
          </div>
          <div className="bg-background/10 p-4 rounded-xl">
            <p className="text-sm font-semibold mb-1">Primeiros 10 segundos</p>
            <p className="text-3xl font-extrabold">≥ 50%</p>
            <p className="text-xs opacity-60 mt-1">Tende a viralizar se mantiver essa retenção</p>
          </div>
        </div>
      </div>

      {/* Calculator */}
      <div className="bg-card rounded-2xl p-6" style={{ boxShadow: 'var(--shadow-layered)' }}>
        <div className="flex items-center gap-2 mb-6">
          <Calculator size={20} className="text-orange-500" />
          <h3 className="font-bold text-sm uppercase tracking-wider">Calculadora de Performance do Reel</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <InputField
            label="Total de Views"
            icon={<Eye size={16} />}
            value={metrics.views}
            onChange={(v) => update('views', v)}
            placeholder="Ex: 50000"
          />
          <InputField
            label="Views de Não Seguidores"
            icon={<Users size={16} />}
            value={metrics.nonFollowerViews}
            onChange={(v) => update('nonFollowerViews', v)}
            placeholder="Ex: 40000"
          />
          <InputField
            label="Novos Seguidores Gerados"
            icon={<TrendingUp size={16} />}
            value={metrics.newFollowers}
            onChange={(v) => update('newFollowers', v)}
            placeholder="Ex: 200"
          />
          <InputField
            label="Retenção 4s (%)"
            icon={<Timer size={16} />}
            value={metrics.retention4s}
            onChange={(v) => update('retention4s', v)}
            placeholder="Ex: 55"
          />
          <InputField
            label="Retenção 10s (%)"
            icon={<Timer size={16} />}
            value={metrics.retention10s}
            onChange={(v) => update('retention10s', v)}
            placeholder="Ex: 48"
          />
        </div>

        {/* Results */}
        {views > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <div className="h-px bg-border" />
            <h4 className="font-bold text-sm uppercase tracking-wider text-muted-foreground">Resultados</h4>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Non-follower % */}
              <ResultCard
                label="Alcance Não Seguidores"
                value={`${nonFollowerPct.toFixed(1)}%`}
                sublabel={`${nonFollowerViews.toLocaleString()} de ${views.toLocaleString()}`}
                good={nonFollowerPct >= 50}
                tip="Quanto maior, melhor. Foco principal de otimização."
              />

              {/* Conversion Rate */}
              <ResultCard
                label="Taxa de Conversão"
                value={`${conversionRate.toFixed(2)}%`}
                sublabel={`${newFollowers.toLocaleString()} seguidores de ${views.toLocaleString()} views`}
                good={isAboveGold}
                tip={`Padrão ouro: ≥ ${GOLD_STANDARD}%`}
              />

              {/* Gold Standard Gap */}
              <div className={`p-4 rounded-xl border-2 ${isAboveGold ? 'border-emerald-500/30 bg-emerald-50' : 'border-orange-500/30 bg-orange-50'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <Award size={16} className={isAboveGold ? 'text-emerald-600' : 'text-orange-600'} />
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Padrão Ouro</span>
                </div>
                {isAboveGold ? (
                  <div>
                    <div className="flex items-center gap-1 text-emerald-700">
                      <CheckCircle2 size={18} />
                      <span className="font-extrabold text-lg">Acima do padrão!</span>
                    </div>
                    <p className="text-xs text-emerald-600 mt-1">
                      Você está {((conversionRate - GOLD_STANDARD) / GOLD_STANDARD * 100).toFixed(0)}% acima do padrão ouro
                    </p>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-1 text-orange-700">
                      <AlertTriangle size={18} />
                      <span className="font-extrabold text-lg">Abaixo do padrão</span>
                    </div>
                    <p className="text-xs text-orange-600 mt-1">
                      Faltam <strong>{(followersNeededForGold - newFollowers).toLocaleString()}</strong> seguidores para atingir 0,40%
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Retention Analysis */}
            {(retention4s > 0 || retention10s > 0) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                {retention4s > 0 && (
                  <RetentionCard
                    label="Retenção 4s"
                    value={retention4s}
                    ok={retention4sOk}
                    message={retention4sOk ? 'Alcance máximo ativado!' : 'Abaixo de 50% — otimize o gancho inicial'}
                  />
                )}
                {retention10s > 0 && (
                  <RetentionCard
                    label="Retenção 10s"
                    value={retention10s}
                    ok={retention10sOk}
                    message={retention10sOk ? 'Tendência a viralizar!' : 'Abaixo de 50% — melhore os primeiros 10 segundos'}
                  />
                )}
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* Key Insights */}
      <div className="bg-card rounded-2xl p-6" style={{ boxShadow: 'var(--shadow-layered)' }}>
        <h3 className="font-bold text-sm uppercase tracking-wider mb-4">💡 Otimização — Foco Meio de Funil</h3>
        <div className="space-y-3">
          {[
            { icon: '🎯', title: 'Maior Otimização', desc: 'Maximizar visualizações para NÃO seguidores. Esse é o KPI principal.' },
            { icon: '🎬', title: 'Melhor CTA para Seguir', desc: 'Nos próprios Reels. É onde o lead quente está assistindo.' },
            { icon: '📱', title: 'Melhor Captura', desc: 'Stories + Bio. O melhor lead vem da bio.' },
            { icon: '📝', title: 'Carrossel', desc: 'Bom para volume, mas viraliza texto, não viraliza "eu". Não é o 80/20.' },
            { icon: '⚡', title: 'O 80/20', desc: 'Reels de meio de funil viral. Concentre 80% do esforço aqui.' },
          ].map((insight, idx) => (
            <div key={idx} className="flex gap-3 items-start p-3 bg-secondary rounded-xl">
              <span className="text-lg">{insight.icon}</span>
              <div>
                <p className="text-sm font-bold">{insight.title}</p>
                <p className="text-xs text-muted-foreground">{insight.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InputField({ label, icon, value, onChange, placeholder }: {
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
        {icon} {label}
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-foreground/10 transition-all placeholder:text-muted-foreground/40"
      />
    </div>
  );
}

function ResultCard({ label, value, sublabel, good, tip }: {
  label: string; value: string; sublabel: string; good: boolean; tip: string;
}) {
  return (
    <div className="p-4 bg-secondary rounded-xl">
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <p className={`text-2xl font-extrabold ${good ? 'text-emerald-600' : 'text-orange-600'}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sublabel}</p>
      <p className="text-[10px] text-muted-foreground/60 mt-1 italic">{tip}</p>
    </div>
  );
}

function RetentionCard({ label, value, ok, message }: {
  label: string; value: number; ok: boolean; message: string;
}) {
  return (
    <div className={`p-4 rounded-xl border-2 ${ok ? 'border-emerald-500/30 bg-emerald-50' : 'border-red-500/20 bg-red-50'}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
        {ok ? <CheckCircle2 size={16} className="text-emerald-600" /> : <AlertTriangle size={16} className="text-red-500" />}
      </div>
      <p className={`text-2xl font-extrabold ${ok ? 'text-emerald-700' : 'text-red-600'}`}>{value}%</p>
      <p className={`text-xs mt-1 ${ok ? 'text-emerald-600' : 'text-red-500'}`}>{message}</p>
    </div>
  );
}
