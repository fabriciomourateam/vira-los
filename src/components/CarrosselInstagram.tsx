import React, { useState, useRef, useEffect } from 'react';
import { HexColorPicker } from 'react-colorful';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Loader2, Sparkles, Download, RefreshCw, ChevronLeft, ChevronRight,
  Palette, Type, Hash, Layers, Mic2, Copy, Check, FileText, Image,
  Trash2, Clock, FolderOpen, Edit3, Eye,
} from 'lucide-react';
import CarouselEditor from './CarouselEditor';

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
  roteiro: string;
  layoutStyle: 'editorial' | 'clean';
}

interface CarouselResult {
  html: string;
  legenda: string;
  topic: string;
  folderName: string;
  numSlides: number;
  screenshots: string[];
  redditTrendsUsed: number;
  unsplashImagesUsed: number;
}

// ─── Cores do projeto (tokens do index.css) + neutros escuros para fundo ─────

const PROJECT_SWATCHES = [
  { hex: '#F97316', label: 'Laranja' },
  { hex: '#34D399', label: 'Esmeralda' },
  { hex: '#FDE047', label: 'Amarelo' },
  { hex: '#3B82F6', label: 'Azul' },
  { hex: '#7C3AED', label: 'Roxo' },
  { hex: '#F87171', label: 'Rosa' },
  { hex: '#B078FF', label: 'Lilás' },
  { hex: '#5197b5', label: 'Ciano' },
  { hex: '#292A25', label: 'Escuro' },
  { hex: '#0f172a', label: 'Noite' },
  { hex: '#1e293b', label: 'Ardósia' },
  { hex: '#18181b', label: 'Zinc' },
];

// ─── Sub-componente: seletor de cor drag + presets + hex ─────────────────────

function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function isValidHex(s: string) {
    return /^#[0-9A-Fa-f]{6}$/.test(s);
  }

  function handleHexInput(raw: string) {
    const cleaned = raw.startsWith('#') ? raw : `#${raw}`;
    onChange(cleaned);
  }

  const safeValue = isValidHex(value) ? value : '#888888';

  return (
    <div ref={containerRef} className="rounded-xl border border-border bg-background p-3 space-y-2.5 relative">
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">{label}</span>

      {/* Botão de preview + input hex */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          title="Abrir seletor"
          className="w-9 h-9 rounded-lg border-2 border-border shadow-sm shrink-0 transition-transform hover:scale-105"
          style={{ backgroundColor: safeValue }}
        />
        <input
          type="text"
          value={value}
          maxLength={7}
          onChange={e => handleHexInput(e.target.value)}
          spellCheck={false}
          className="flex-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/50"
          placeholder="#000000"
        />
      </div>

      {/* Picker de arrastar (react-colorful) */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl border border-border bg-card shadow-xl p-3 space-y-3"
          >
            {/* Gradiente de arrastar */}
            <HexColorPicker color={safeValue} onChange={onChange} style={{ width: '100%', height: 180 }} />

            {/* Presets do projeto */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {PROJECT_SWATCHES.map(s => (
                <button
                  key={s.hex}
                  type="button"
                  title={s.label}
                  onClick={() => { onChange(s.hex); setOpen(false); }}
                  className={`w-6 h-6 rounded-md border-2 transition-transform hover:scale-110 ${value === s.hex ? 'border-foreground scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: s.hex }}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
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
  roteiro: '',
  layoutStyle: 'editorial',
};

// ─── Prévia de cores ──────────────────────────────────────────────────────────

function SlidePreview({
  bgColor, primaryColor, accentColor, fontFamily,
}: {
  bgColor: string; primaryColor: string; accentColor: string; fontFamily: string;
}) {
  return (
    <div
      className="relative rounded-xl overflow-hidden shadow-lg select-none"
      style={{ background: bgColor, aspectRatio: '4/5', fontFamily: `'${fontFamily}', sans-serif` }}
    >
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.65) 60%, rgba(0,0,0,0.85) 100%)' }} />
      <div className="absolute top-0 left-0 right-0 flex justify-between items-center px-3 py-2 z-10">
        <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.5)' }}>{fontFamily}</span>
        <div className="w-3 h-3 rounded-full" style={{ background: primaryColor }} />
      </div>
      <div className="absolute bottom-0 left-0 right-0 p-3 z-10 space-y-1.5">
        <div className="text-[11px] font-black uppercase leading-tight" style={{ color: '#ffffff', textShadow: '1px 1px 6px rgba(0,0,0,0.8)' }}>
          TÍTULO DO <span style={{ color: primaryColor }}>SLIDE</span>
        </div>
        <div className="text-[9px] leading-snug" style={{ color: 'rgba(255,255,255,0.7)' }}>Subtítulo com informações de apoio</div>
        <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: accentColor }}>• Destaque do conteúdo</div>
        <div className="flex items-center justify-between pt-1 mt-1 border-t" style={{ borderColor: 'rgba(255,255,255,0.15)' }}>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full" style={{ background: primaryColor }} />
            <span className="text-[8px]" style={{ color: 'rgba(255,255,255,0.5)' }}>@seucanal</span>
          </div>
          <span className="text-[8px]" style={{ color: 'rgba(255,255,255,0.3)' }}>1/7</span>
        </div>
      </div>
    </div>
  );
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface SavedCarousel {
  id: string;
  topic: string;
  folderName: string;
  numSlides: number;
  screenshots: string[];
  legenda: string;
  config: CarouselConfig;
  created_at: string;
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface CarrosselInstagramProps {
  prefillScript?: string;
  prefillTopic?: string;
}

export default function CarrosselInstagram({ prefillScript, prefillTopic }: CarrosselInstagramProps = {}) {
  const [config, setConfig] = useState<CarouselConfig>(DEFAULT_CONFIG);
  const [configReady, setConfigReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CarouselResult | null>(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [copied, setCopied] = useState(false);
  const [savedCarousels, setSavedCarousels] = useState<SavedCarousel[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const saveConfigTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Carrega config e histórico do servidor na montagem
  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/carousel/config`).then(r => r.json()).catch(() => ({})),
      fetch(`${API}/api/carousel/saved`).then(r => r.json()).catch(() => []),
    ]).then(([cfg, saved]) => {
      if (cfg && Object.keys(cfg).filter(k => k !== 'updated_at').length > 0) {
        setConfig(prev => ({ ...DEFAULT_CONFIG, ...prev, ...cfg }));
      }
      setSavedCarousels(Array.isArray(saved) ? saved : []);
      setConfigReady(true);
    });
  }, []);

  // Auto-fill de props externas (prefillTopic, prefillScript)
  useEffect(() => {
    if (prefillTopic) setConfig(prev => ({ ...prev, topic: prefillTopic }));
    if (prefillScript) setConfig(prev => ({ ...prev, roteiro: prefillScript }));
  }, [prefillScript, prefillTopic]);

  // Salva config no servidor com debounce de 800ms
  useEffect(() => {
    if (!configReady) return;
    if (saveConfigTimer.current) clearTimeout(saveConfigTimer.current);
    saveConfigTimer.current = setTimeout(() => {
      fetch(`${API}/api/carousel/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      }).catch(() => {});
    }, 800);
    return () => { if (saveConfigTimer.current) clearTimeout(saveConfigTimer.current); };
  }, [config, configReady]);

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

      // Salva no histórico do servidor
      const carouselId = `c_${Date.now()}`;
      fetch(`${API}/api/carousel/saved`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: carouselId,
          topic: data.topic,
          folderName: data.folderName,
          numSlides: data.numSlides,
          screenshots: data.screenshots,
          legenda: data.legenda,
          config: { ...config },
        }),
      }).then(() => fetch(`${API}/api/carousel/saved`).then(r => r.json()))
        .then(saved => setSavedCarousels(Array.isArray(saved) ? saved : []))
        .catch(() => {});

      const pngCount = data.screenshots?.length || 0;
      toast.success(pngCount > 0
        ? `${data.numSlides} slides gerados com ${pngCount} PNGs!`
        : `Carrossel gerado (HTML). Screenshots indisponíveis no servidor.`
      );
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteSaved(id: string) {
    await fetch(`${API}/api/carousel/saved/${id}`, { method: 'DELETE' });
    setSavedCarousels(prev => prev.filter(c => c.id !== id));
  }

  function handleLoadConfig(saved: SavedCarousel) {
    setConfig({ ...DEFAULT_CONFIG, ...saved.config });
    toast.success(`Config "${saved.topic}" carregada`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleDownloadHTML() {
    if (!result) return;
    const blob = new Blob([result.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `carrossel-${result.topic.replace(/\s+/g, '-').toLowerCase()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleDownloadPNG(filename: string) {
    const url = `${API}/output/${result!.folderName}/${filename}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    a.click();
  }

  async function handleCopyLegenda() {
    if (!result?.legenda) return;
    await navigator.clipboard.writeText(result.legenda);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Slides para preview: PNGs se disponíveis, senão extrai do HTML
  const hasPNGs = (result?.screenshots?.length ?? 0) > 0;

  function extractSlides(html: string): string[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const slides = Array.from(doc.querySelectorAll('.slide, .slide-editorial'));
    if (!slides.length) return [html];
    const head = doc.head.innerHTML;
    return slides.map(slide =>
      `<!DOCTYPE html><html><head>${head}</head><body style="margin:0;padding:0;overflow:hidden;">${slide.outerHTML}</body></html>`
    );
  }

  const htmlSlides = result && !hasPNGs ? extractSlides(result.html) : [];
  const totalSlides = hasPNGs
    ? result!.screenshots.length
    : htmlSlides.length;

  return (
    <div className="space-y-6">

      {/* Cabeçalho */}
      <div>
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-500" />
          Gerador de Carrossel para Instagram
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Crie carrosseis profissionais com IA. Personaliza cor, fonte e estilo.
        </p>
      </div>

      {/* Banner: roteiro prefilled via props */}
      {config.roteiro && prefillScript && (
        <div className="rounded-xl border border-purple-500/40 bg-purple-500/10 p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-purple-300">
            <FileText className="w-4 h-4 shrink-0" />
            <span>Script do Analisador carregado — o carrossel usará este conteúdo.</span>
          </div>
          <button
            onClick={() => set('roteiro', '')}
            className="text-xs text-muted-foreground hover:text-foreground underline shrink-0"
          >
            Remover
          </button>
        </div>
      )}

      {/* Formulário */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-5">

        {/* Layout Style */}
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-2">
            <Palette className="w-3.5 h-3.5" /> Layout
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => set('layoutStyle', 'editorial')}
              className={`flex flex-col items-center gap-1.5 rounded-xl border-2 px-4 py-3 transition-all ${
                config.layoutStyle === 'editorial'
                  ? 'border-purple-500 bg-purple-500/10 text-purple-400'
                  : 'border-border bg-secondary text-muted-foreground hover:border-border/80'
              }`}
            >
              <Layers className="w-5 h-5" />
              <span className="text-xs font-bold">Editorial</span>
              <span className="text-[10px] opacity-70">Investigativo com header</span>
            </button>
            <button
              type="button"
              onClick={() => set('layoutStyle', 'clean')}
              className={`flex flex-col items-center gap-1.5 rounded-xl border-2 px-4 py-3 transition-all ${
                config.layoutStyle === 'clean'
                  ? 'border-purple-500 bg-purple-500/10 text-purple-400'
                  : 'border-border bg-secondary text-muted-foreground hover:border-border/80'
              }`}
            >
              <Image className="w-5 h-5" />
              <span className="text-xs font-bold">Clean / Minimal</span>
              <span className="text-[10px] opacity-70">Dark + badge + foto card</span>
            </button>
          </div>
        </div>

        {/* Tema */}
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ColorPicker label="Cor Principal"   value={config.primaryColor} onChange={v => set('primaryColor', v)} />
            <ColorPicker label="Cor de Destaque" value={config.accentColor}  onChange={v => set('accentColor', v)} />
            <ColorPicker label="Fundo Slides"    value={config.bgColor}      onChange={v => set('bgColor', v)} />
          </div>
        </div>

        {/* Prévia Visual das Cores */}
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-2">
            <Eye className="w-3.5 h-3.5" /> Prévia das Cores
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <SlidePreview
              bgColor={config.bgColor}
              primaryColor={config.primaryColor}
              accentColor={config.accentColor}
              fontFamily={config.fontFamily}
            />
            {/* Variante: slide editorial (sem foto de fundo) */}
            <div
              className="relative rounded-xl overflow-hidden shadow-lg select-none"
              style={{ background: config.bgColor, aspectRatio: '4/5', fontFamily: `'${config.fontFamily}', sans-serif` }}
            >
              <div className="absolute inset-0 p-3 flex flex-col justify-center gap-1.5">
                <div className="w-1/3 h-0.5 rounded-full" style={{ background: config.primaryColor }} />
                <div className="text-[10px] font-black uppercase leading-tight" style={{ color: config.primaryColor }}>
                  Slide Editorial
                </div>
                <div className="space-y-1 mt-1">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="flex items-start gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full mt-0.5 shrink-0" style={{ background: config.accentColor }} />
                      <div className="h-1.5 rounded-full flex-1" style={{ background: 'rgba(255,255,255,0.15)' }} />
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-[8px] font-bold uppercase tracking-widest" style={{ color: config.accentColor }}>
                  {config.fontFamily}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Fonte + Tom + Slides */}
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
              {FONT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
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
              {TONE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
              <Layers className="w-3.5 h-3.5" /> Nº de Slides
            </label>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="range" min={5} max={10}
                value={config.numSlides}
                onChange={e => set('numSlides', Number(e.target.value))}
                className="flex-1 accent-purple-500"
              />
              <span className="text-sm font-bold w-5 text-center text-foreground">{config.numSlides}</span>
            </div>
          </div>
        </div>

        {/* Roteiro (opcional) */}
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
            <FileText className="w-3.5 h-3.5" /> Roteiro / Script
            <span className="normal-case font-normal text-[10px] ml-1">(opcional — IA distribui seu conteúdo pelos slides)</span>
          </label>
          <textarea
            value={config.roteiro}
            onChange={e => set('roteiro', e.target.value)}
            placeholder={'Cole aqui seu roteiro ou pontos que quer cobrir.\nEx:\nGancho: "Você está errando no treino e nem sabe"\nPonto 1: treinar sem planejamento\nPonto 2: ignorar recuperação\nPonto 3: não medir progresso\nCTA: salve esse post'}
            rows={5}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-none placeholder:text-muted-foreground/50"
          />
          {config.roteiro.trim() && (
            <p className="text-[10px] text-purple-500 mt-1 flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> A IA vai distribuir seu roteiro pelos {config.numSlides} slides
            </p>
          )}
        </div>

        {/* Botões gerar + restaurar */}
        <div className="flex gap-2">
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 transition-colors"
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Gerando carrossel…</>
            ) : (
              <><Sparkles className="w-4 h-4" /> Gerar Carrossel</>
            )}
          </button>
          <button
            type="button"
            onClick={() => setConfig(DEFAULT_CONFIG)}
            title="Restaurar configurações padrão"
            className="px-3 rounded-xl border border-border bg-secondary text-muted-foreground hover:text-foreground transition-colors text-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Resultado */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="space-y-4"
          >
            {/* ── Preview de slides ── */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">

              {/* Barra */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-wrap gap-2">
                <div>
                  <span className="text-sm font-semibold text-foreground">{result.topic}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {totalSlides} slide{totalSlides !== 1 ? 's' : ''}
                    {hasPNGs && ` · ${result.screenshots.length} PNGs`}
                    {result.unsplashImagesUsed > 0 && ` · ${result.unsplashImagesUsed} imgs Unsplash`}
                    {result.redditTrendsUsed > 0 && ` · ${result.redditTrendsUsed} trends Reddit`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleGenerate}
                    disabled={loading}
                    title="Regenerar"
                    className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setEditorOpen(o => !o)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      editorOpen
                        ? 'bg-purple-600 text-white hover:bg-purple-500'
                        : 'bg-secondary hover:bg-border text-foreground'
                    }`}
                  >
                    <Edit3 className="w-3.5 h-3.5" /> Editar
                  </button>
                  <button
                    onClick={handleDownloadHTML}
                    title="Baixar HTML"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:bg-border text-foreground text-xs font-semibold transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5" /> HTML
                  </button>
                  {hasPNGs && (
                    <button
                      onClick={() => result.screenshots.forEach(f => handleDownloadPNG(f))}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" /> Baixar PNGs
                    </button>
                  )}
                </div>
              </div>

              {/* Navegação */}
              <div className="p-4">
                {totalSlides > 1 && (
                  <div className="flex items-center justify-center gap-3 mb-3">
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
                  <div className="flex justify-center gap-1.5 mb-4 flex-wrap">
                    {Array.from({ length: totalSlides }).map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setCurrentSlide(i)}
                        className={`w-2 h-2 rounded-full transition-colors ${i === currentSlide ? 'bg-purple-500' : 'bg-border hover:bg-purple-300'}`}
                      />
                    ))}
                  </div>
                )}

                {/* Preview: PNG ou iframe */}
                <div className="flex justify-center">
                  <div className="rounded-xl overflow-hidden border border-border shadow-lg" style={{ width: '100%', maxWidth: 360 }}>
                    {hasPNGs ? (
                      /* PNG real do servidor */
                      <div style={{ position: 'relative', paddingBottom: '125%' }}>
                        <img
                          key={currentSlide}
                          src={`${API}/output/${result.folderName}/${result.screenshots[currentSlide]}`}
                          alt={`Slide ${currentSlide + 1}`}
                          style={{
                            position: 'absolute', top: 0, left: 0,
                            width: '100%', height: '100%',
                            objectFit: 'cover',
                          }}
                        />
                        {/* Botão download individual */}
                        <button
                          onClick={() => handleDownloadPNG(result.screenshots[currentSlide])}
                          className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-white transition-colors"
                          title="Baixar este slide"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      /* Fallback: iframe HTML */
                      <div style={{ position: 'relative', paddingBottom: '125%' }}>
                        <iframe
                          key={currentSlide}
                          srcDoc={htmlSlides[currentSlide]}
                          sandbox="allow-scripts allow-same-origin"
                          style={{
                            position: 'absolute', top: 0, left: 0,
                            width: '1080px', height: '1350px', border: 'none',
                            transform: `scale(${360 / 1080})`,
                            transformOrigin: 'top left',
                          }}
                          title={`Slide ${currentSlide + 1}`}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Editor de Slides ── */}
            {editorOpen && (
              <CarouselEditor
                html={result.html}
                folderName={result.folderName}
                topic={result.topic}
                numSlides={result.numSlides}
                legenda={result.legenda}
                config={config as Record<string, unknown>}
                onScreenshotsUpdated={(screenshots) => {
                  setResult(prev => prev ? { ...prev, screenshots } : prev);
                  setCurrentSlide(0);
                }}
                onTemplateSaved={() => {
                  fetch(`${API}/api/carousel/saved`)
                    .then(r => r.json())
                    .then(saved => setSavedCarousels(Array.isArray(saved) ? saved : []))
                    .catch(() => {});
                }}
              />
            )}

            {/* ── Legenda ── */}
            {result.legenda && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <FileText className="w-4 h-4 text-purple-500" /> Legenda
                  </span>
                  <button
                    onClick={handleCopyLegenda}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:bg-border text-foreground text-xs font-semibold transition-colors"
                  >
                    {copied ? <><Check className="w-3.5 h-3.5 text-emerald-500" /> Copiado!</> : <><Copy className="w-3.5 h-3.5" /> Copiar</>}
                  </button>
                </div>
                <pre className="p-4 text-sm text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed">
                  {result.legenda}
                </pre>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Carrosseis Salvos ── */}
      {savedCarousels.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">Carrosseis Salvos</span>
            <span className="text-xs text-muted-foreground">({savedCarousels.length})</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {savedCarousels.map(saved => {
              const thumb = saved.screenshots?.[0]
                ? `${API}/output/${saved.folderName}/${saved.screenshots[0]}`
                : null;
              const date = new Date(saved.created_at).toLocaleDateString('pt-BR', {
                day: '2-digit', month: '2-digit', year: '2-digit',
                hour: '2-digit', minute: '2-digit',
              });
              return (
                <div key={saved.id} className="rounded-xl border border-border bg-card overflow-hidden group">
                  <div className="relative aspect-[4/5] bg-secondary overflow-hidden">
                    {thumb ? (
                      <img src={thumb} alt={saved.topic} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <FolderOpen className="w-8 h-8 opacity-30" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <button
                        onClick={() => handleLoadConfig(saved)}
                        className="px-3 py-1.5 bg-white text-black rounded-lg text-xs font-bold hover:bg-gray-100 transition-colors"
                      >
                        Carregar config
                      </button>
                    </div>
                  </div>
                  <div className="p-3 space-y-1.5">
                    <p className="text-xs font-semibold text-foreground line-clamp-2">{saved.topic}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">{saved.numSlides} slides · {date}</span>
                      <div className="flex items-center gap-1">
                        <a
                          href={`${API}/output/${saved.folderName}/carrossel.html`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                          title="Abrir HTML"
                        >
                          <FileText className="w-3.5 h-3.5" />
                        </a>
                        <button
                          onClick={() => handleDeleteSaved(saved.id)}
                          className="p-1 rounded text-muted-foreground hover:text-red-500 transition-colors"
                          title="Excluir"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
