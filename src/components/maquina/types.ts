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
}

export interface HeadlinesResult {
  /** "Triagem: ..." — 1 frase com o ângulo central extraído (formato v4) */
  triagem: string | null;
  /** Mercado | Cases | Notícias | Cultura | Produto */
  eixo: string | null;
  /** Topo | Meio | Fundo */
  funil: string | null;
  items: ParsedHeadline[];
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

/**
 * Extrai a saída da Etapa 2 do system prompt v4 (linhas 262-293):
 *   1. **Triagem:** ...
 *   2. **Eixo:** ... · **Funil:** ...
 *   3. Tabela markdown | # | Headline | Gatilho |
 *   4. Fecho "Escolhe 1-10..."
 */
export function parseHeadlines(markdown: string): HeadlinesResult {
  // Triagem
  const triagemMatch = markdown.match(/\*\*Triagem:\*\*\s*([^\n]+)/i);
  const triagem = triagemMatch ? triagemMatch[1].trim() : null;

  // Eixo + Funil (na mesma linha, separados por ·)
  const eixoMatch = markdown.match(/\*\*Eixo:\*\*\s*([^·\n]+)/i);
  const funilMatch = markdown.match(/\*\*Funil:\*\*\s*([^\n·]+)/i);
  const eixo = eixoMatch ? eixoMatch[1].trim() : null;
  const funil = funilMatch ? funilMatch[1].trim() : null;

  // Tabela
  const items: ParsedHeadline[] = [];
  const lines = markdown.split('\n').filter(l => l.trim().startsWith('|'));
  for (const line of lines) {
    const cols = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cols.length < 2) continue;
    const num = parseInt(cols[0], 10);
    if (Number.isNaN(num) || num < 1 || num > 10) continue;
    items.push({
      num,
      text: cols[1] || '',
      trigger: cols[2] || '',
    });
  }
  items.sort((a, b) => a.num - b.num);

  return { triagem, eixo, funil, items };
}
