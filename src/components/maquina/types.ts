/**
 * types.ts — interfaces compartilhadas pelos componentes da Máquina.
 */

export type EstiloVisual = 'classico' | 'moderno' | 'minimalista' | 'bold';
export type TipoCarrossel = 'tendencia' | 'tese' | 'case' | 'previsao';
export type SlidesCount = 5 | 7 | 9 | 12;
export type Stage = 'briefing' | 'headlines' | 'structure' | 'preview' | 'export';

export interface Briefing {
  tema: string;
  nicho: string;
  marca: string;
  handle: string;
  cor: string;
  estilo: EstiloVisual;
  tipo: TipoCarrossel;
  cta: string;
  slides: SlidesCount;
  imagensPedidas: number;
}

export interface ParsedHeadline {
  num: number;
  text: string;
  trigger: string;
  score: number | null;
  recommended: boolean;
}

export interface HeadlinesResult {
  items: ParsedHeadline[];
  recommendedNum: number | null;
  recommendedReason: string | null;
}

export const initialBriefing: Briefing = {
  tema: '',
  nicho: 'Consultoria Esportiva',
  marca: '',
  handle: '@fabriciomourateam',
  cor: '',
  estilo: 'moderno',
  tipo: 'tese',
  cta: 'Comenta SHAPE e me segue para mais conteúdos como esse',
  slides: 9,
  imagensPedidas: 4,
};

export const ESTILOS: { id: EstiloVisual; label: string; desc: string }[] = [
  { id: 'classico',     label: 'Clássico',    desc: 'Sóbrio, jornalístico. Serif nas headlines.' },
  { id: 'moderno',      label: 'Moderno',     desc: 'Variação visual. Cards e img-boxes. Sans condensada.' },
  { id: 'minimalista',  label: 'Minimalista', desc: 'Maioria light. Mais espaço branco. Body 42px.' },
  { id: 'bold',         label: 'Bold',        desc: 'Maioria dark. Headlines 96px. Números decorativos.' },
];

export const TIPOS: { id: TipoCarrossel; label: string; arc: string }[] = [
  { id: 'tendencia', label: 'Tendência Interpretada', arc: 'Hook → Contexto → Mudança → Impacto → Ação → CTA' },
  { id: 'tese',      label: 'Tese Contraintuitiva',   arc: 'Crença → Dados que desafiam → Verdade → Modelo → Aplicação → CTA' },
  { id: 'case',      label: 'Case / Benchmark',       arc: 'Resultado → Quem fez → Como → Princípio → Replicar → CTA' },
  { id: 'previsao',  label: 'Previsão / Futuro',      arc: 'Sinais fracos → Padrão → Direção → Quem ganha → Ações → CTA' },
];

export const SLIDES_OPTIONS: SlidesCount[] = [5, 7, 9, 12];

/** Extrai linhas de tabela markdown 10x4 (#, headline, gatilho, score) + bloco "Recomendada" */
export function parseHeadlines(markdown: string): HeadlinesResult {
  const items: ParsedHeadline[] = [];
  const lines = markdown.split('\n').filter(l => l.trim().startsWith('|'));
  for (const line of lines) {
    const cols = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cols.length < 2) continue;
    const num = parseInt(cols[0], 10);
    if (Number.isNaN(num) || num < 1 || num > 10) continue;
    const scoreRaw = (cols[3] || '').trim();
    const recommended = scoreRaw.includes('⭐') || scoreRaw.toLowerCase().includes('star');
    const scoreMatch = scoreRaw.match(/(\d+(?:\.\d+)?)/);
    items.push({
      num,
      text: cols[1] || '',
      trigger: cols[2] || '',
      score: scoreMatch ? parseFloat(scoreMatch[1]) : null,
      recommended,
    });
  }
  items.sort((a, b) => a.num - b.num);

  // Bloco "Recomendada: #N — motivo"
  const recoMatch = markdown.match(/\*?\*?Recomendada:?\s*#?\s*(\d+)\*?\*?\s*[—–-]?\s*([^\n]*)/i);
  let recommendedNum: number | null = null;
  let recommendedReason: string | null = null;
  if (recoMatch) {
    recommendedNum = parseInt(recoMatch[1], 10);
    recommendedReason = (recoMatch[2] || '').trim() || null;
  }

  // Se nenhuma headline foi marcada com ⭐ mas veio "Recomendada", marca via fallback
  if (recommendedNum && !items.some((i) => i.recommended)) {
    const target = items.find((i) => i.num === recommendedNum);
    if (target) target.recommended = true;
  }
  // Caso contrário, deduz a recomendada da que tem ⭐
  if (!recommendedNum) {
    const starred = items.find((i) => i.recommended);
    if (starred) recommendedNum = starred.num;
  }

  return { items, recommendedNum, recommendedReason };
}
