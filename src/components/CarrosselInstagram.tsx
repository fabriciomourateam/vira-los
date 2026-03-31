import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Loader2, Sparkles, Download, RefreshCw, ChevronLeft, ChevronRight,
  Image, Palette, Type, Hash, Layers, Mic2,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface CarouselConfig {
  topic: string;
  niche: string;
  primaryColor: string;
  accentColor: string;
  bgColor: string;
  fontFamily: string;
  instagramHandle: string;
  numSlides: number;
  contentTone: string;
}

interface CarouselResult {
  html: string;
  topic: string;
  numSlides: number;
  redditTrendsUsed: number;
  unsplashImagesUsed: number;
}

// ─── Opções ───────────────────────────────────────────────────────────────────

const TONE_OPTIONS = [
  { value: 'investigativo',  label: 'Investigativo' },
  { value: 'provocativo',    label: 'Provocativo' },
  { value: 'educativo',      label: 'Educativo' },
  { value: 'motivacional',   label: 'Motivacional' },
  { value: 'informativo',    label: 'Informativo' },
];

const FONT_OPTIONS = [
  'Raleway', 'Montserrat', 'Poppins', 'Inter', 'Oswald', 'Playfair Display',
];

const DEFAULT_CONFIG: CarouselConfig = {
  topic: '',
  niche: 'Inteligência Artificial',
  primaryColor: '#B078FF',
  accentColor: '#5197b5',
  bgColor: '#292A25',
  fontFamily: 'Raleway',
  instagramHandle: '',
  numSlides: 7,
  contentTone: 'investigativo',
};

// ─── Componente ───────────────────────────────────────────────────────────────

export default function CarrosselInstagram() {
  const [config, setConfig] = useState<CarouselConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CarouselResult | null>(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const iframeRefs = useRef<(HTMLIFrameElement | null)[]>([]);

  function set<K extends keyof CarouselConfig>(key: K, value: CarouselConfig[K]) {
    setConfig(prev => ({ ...prev, [key]: value }));
  }

  async function handleGenerate() {
    if (!config.topic.trim()) {
      toast.error('Informe o tema do carrossel');
      return;
    }
    setLoading(true);
    setResult(null);
    setCurrentSlide(0);
    try {
      const res = await fetch(`${API}/api/carousel/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao gerar carrossel');
      setResult(data);
      toast.success(`Carrossel gerado com ${data.numSlides} slides!`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleDownload() {
    if (!result) return;
    const blob = new Blob([result.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `carrossel-${result.topic.replace(/\s+/g, '-').toLowerCase()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Extrai os N slides do HTML gerado separando por id="slide-N"
  function extractSlides(html: string): string[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const slides = Array.from(doc.querySelectorAll('.slide'));
    if (!slides.length) return [html];

    // Extrai estilos globais (head) para incluir em cada iframe
    const head = doc.head.innerHTML;
    return slides.map(slide => {
      return `<!DOCTYPE html><html><head>${head}</head><body style="margin:0;padding:0;">${slide.outerHTML}</body></html>`;
    });
  }

  const slides = result ? extractSlides(result.html) : [];
  const totalSlides = slides.length;

  return (
    <div className="space-y-6">

      {/* Cabeçalho */}
      <div>
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-500" />
          Gerador de Carrossel para Instagram
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Crie carrosseis profissionais com IA personalizando cor, fonte e estilo.
        </p>
      </div>

      {/* Formulário */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-5">

        {/* Tema — obrigatório */}
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
            <Hash className="w-3.5 h-3.5" /> Tema / Assunto *
          </label>
          <input
            type="text"
            value={config.topic}
            onChange={e => set('topic', e.target.value)}
            placeholder="Ex: IA generativa está matando empregos criativos"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
          />
        </div>

        {/* Nicho + Handle */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">
              Nicho / Área
            </label>
            <input
              type="text"
              value={config.niche}
              onChange={e => set('niche', e.target.value)}
              placeholder="Inteligência Artificial"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
              <Mic2 className="w-3.5 h-3.5" /> Handle do Instagram
            </label>
            <input
              type="text"
              value={config.instagramHandle}
              onChange={e => set('instagramHandle', e.target.value)}
              placeholder="@seucanal"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            />
          </div>
        </div>

        {/* Cores */}
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-2">
            <Palette className="w-3.5 h-3.5" /> Paleta de Cores
          </label>
          <div className="grid grid-cols-3 gap-3">
            {(
              [
                { key: 'primaryColor', label: 'Cor Principal' },
                { key: 'accentColor',  label: 'Cor de Destaque' },
                { key: 'bgColor',      label: 'Fundo Slides' },
              ] as { key: keyof CarouselConfig; label: string }[]
            ).map(({ key, label }) => (
              <div key={key} className="flex flex-col items-center gap-1.5">
                <div
                  className="w-10 h-10 rounded-full border-2 border-border shadow cursor-pointer overflow-hidden relative"
                  style={{ backgroundColor: config[key] as string }}
                >
                  <input
                    type="color"
                    value={config[key] as string}
                    onChange={e => set(key, e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                </div>
                <span className="text-xs text-muted-foreground text-center leading-tight">{label}</span>
                <span className="text-xs font-mono text-foreground/60">{config[key] as string}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Fonte + Tom + Nº de Slides */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
              <Type className="w-3.5 h-3.5" /> Fonte
            </label>
            <select
              value={config.fontFamily}
              onChange={e => set('fontFamily', e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            >
              {FONT_OPTIONS.map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
              <Image className="w-3.5 h-3.5" /> Tom
            </label>
            <select
              value={config.contentTone}
              onChange={e => set('contentTone', e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            >
              {TONE_OPTIONS.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
              <Layers className="w-3.5 h-3.5" /> Nº de Slides
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={5}
                max={10}
                value={config.numSlides}
                onChange={e => set('numSlides', Number(e.target.value))}
                className="flex-1 accent-purple-500"
              />
              <span className="text-sm font-bold w-5 text-center text-foreground">{config.numSlides}</span>
            </div>
          </div>
        </div>

        {/* Botão gerar */}
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 transition-colors"
        >
          {loading ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Gerando carrossel…</>
          ) : (
            <><Sparkles className="w-4 h-4" /> Gerar Carrossel</>
          )}
        </button>
      </div>

      {/* Preview */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="rounded-xl border border-border bg-card overflow-hidden"
          >
            {/* Barra de preview */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div>
                <span className="text-sm font-semibold text-foreground">{result.topic}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {totalSlides} slide{totalSlides !== 1 ? 's' : ''}
                  {result.unsplashImagesUsed > 0 && ` · ${result.unsplashImagesUsed} imagens Unsplash`}
                  {result.redditTrendsUsed > 0 && ` · ${result.redditTrendsUsed} tendências Reddit`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleGenerate}
                  disabled={loading}
                  title="Regenerar"
                  className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  onClick={handleDownload}
                  title="Baixar HTML"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> Baixar HTML
                </button>
              </div>
            </div>

            {/* Slide viewer */}
            <div className="p-4">
              {/* Navegação */}
              {totalSlides > 1 && (
                <div className="flex items-center justify-center gap-3 mb-4">
                  <button
                    onClick={() => setCurrentSlide(s => Math.max(0, s - 1))}
                    disabled={currentSlide === 0}
                    className="p-1 rounded-lg hover:bg-secondary disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <span className="text-sm text-muted-foreground">
                    Slide {currentSlide + 1} / {totalSlides}
                  </span>
                  <button
                    onClick={() => setCurrentSlide(s => Math.min(totalSlides - 1, s + 1))}
                    disabled={currentSlide === totalSlides - 1}
                    className="p-1 rounded-lg hover:bg-secondary disabled:opacity-30 transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              )}

              {/* Dots */}
              {totalSlides > 1 && (
                <div className="flex justify-center gap-1.5 mb-4">
                  {Array.from({ length: totalSlides }).map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setCurrentSlide(i)}
                      className={`w-2 h-2 rounded-full transition-colors ${i === currentSlide ? 'bg-purple-500' : 'bg-border hover:bg-purple-300'}`}
                    />
                  ))}
                </div>
              )}

              {/* iframe do slide atual */}
              <div className="flex justify-center">
                <div
                  className="rounded-xl overflow-hidden border border-border shadow-lg"
                  style={{ width: '100%', maxWidth: 360 }}
                >
                  <div style={{ position: 'relative', paddingBottom: '125%' /* 1080/1350 = 80% → 125% */ }}>
                    <iframe
                      ref={el => { iframeRefs.current[currentSlide] = el; }}
                      key={currentSlide}
                      srcDoc={slides[currentSlide]}
                      sandbox="allow-scripts allow-same-origin"
                      style={{
                        position: 'absolute',
                        top: 0, left: 0,
                        width: '1080px',
                        height: '1350px',
                        border: 'none',
                        transform: `scale(${360 / 1080})`,
                        transformOrigin: 'top left',
                      }}
                      title={`Slide ${currentSlide + 1}`}
                    />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
