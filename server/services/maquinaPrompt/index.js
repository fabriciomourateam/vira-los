/**
 * maquinaPrompt/index.js
 * Carrega os 7 docs da metodologia BrandsDecoded e monta 4 cache blocks
 * para usar com a Anthropic Prompt Caching API (até 4 ephemeral breakpoints).
 *
 * Os docs são copiados literais da proposta original (pasta deste módulo):
 *   01-system-v4.md           → BLOCO 1, 3, 4, 7 do system prompt v4
 *   02-banco-de-headlines.md  → 56 hooks comprovados (+10k likes)
 *   03-design-system.md       → CSS template + tipografia
 *   04-principios-design.md   → hierarquia visual em 3 níveis + geração de paleta
 *   05-referencias.md         → carrosséis BrandsDecoded inteiros (few-shot)
 *   06-manual-qualidade.md    → 7 parâmetros editoriais + 5 testes finais
 *   07-filtro-editorial.md    → palavras/construções proibidas (anti-AI slop)
 *
 * Cada bloco precisa ter ≥ 1024 tokens (Sonnet) — todos cumprem com folga.
 */

const fs = require('fs');
const path = require('path');

const DIR = __dirname;

function read(name) {
  return fs.readFileSync(path.join(DIR, name), 'utf8');
}

const v4              = read('01-system-v4.md');
const bancoHeadlines  = read('02-banco-de-headlines.md');
const designSystemMd  = read('03-design-system.md');
const principiosMd    = read('04-principios-design.md');
const referenciasMd   = read('05-referencias.md');
const manualQualMd    = read('06-manual-qualidade.md');
const filtroEditMd    = read('07-filtro-editorial.md');
const fmteamMd        = read('08-fmteam.md');

// ── Bloco 1: identidade + comportamento + fluxo + anti-AI slop (BLOCOs 1/3/4/7 do v4)
// Mantém o v4 inteiro porque os blocos ficam interdependentes — separá-los quebraria
// referências internas ("ver Bloco 5") que o agente usa.
const identidadeFluxo = v4;

// ── Bloco 2: engine de headlines (banco de 56 hooks comprovados)
const engineHeadlines = `### [brandsdecoded-banco-de-headlines.md]\n\n${bancoHeadlines}`;

// ── Bloco 3: design system + princípios visuais + referências (few-shot de qualidade)
const designSystem = [
  '### [brandsdecoded-design-system.md]',
  designSystemMd,
  '',
  '### [brandsdecoded-principios-design.md]',
  principiosMd,
  '',
  '### [brandsdecoded-referencias.md]',
  referenciasMd,
].join('\n\n');

// ── Bloco 4: validação editorial (7 parâmetros + filtro anti-AI slop)
const qualidadeFiltro = [
  '### [brandsdecoded-manual-de-qualidade.md]',
  manualQualMd,
  '',
  '### [brandsdecoded-filtro-editorial.md]',
  filtroEditMd,
].join('\n\n');

const SYSTEM_BLOCKS = {
  identidadeFluxo,
  engineHeadlines,
  designSystem,
  qualidadeFiltro,
};

// Template adicional opcional (não-cacheado — pequeno, só anexado quando selecionado).
// Usar apenas se o usuário escolher template === 'fmteam' no briefing.
const FMTEAM_OVERRIDE = `### [fmteam-template-override]

${fmteamMd}`;

// Helper: monta o array de blocos com cache_control para a API Anthropic.
// Use diretamente no campo `system` da chamada messages.create().
//
// `template` opcional:
//   - 'brandsdecoded' (default) → usa apenas os 4 blocos cacheados padrão
//   - 'fmteam'                  → anexa o guia fmteam como 5º bloco (sem cache,
//     pois é override visual pequeno e cache breakpoints estão limitados a 4)
function buildSystemForAnthropic(template = 'brandsdecoded') {
  const blocks = [
    { type: 'text', text: SYSTEM_BLOCKS.identidadeFluxo, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: SYSTEM_BLOCKS.engineHeadlines, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: SYSTEM_BLOCKS.designSystem,    cache_control: { type: 'ephemeral' } },
    { type: 'text', text: SYSTEM_BLOCKS.qualidadeFiltro, cache_control: { type: 'ephemeral' } },
  ];
  if (template === 'fmteam') {
    blocks.push({ type: 'text', text: FMTEAM_OVERRIDE });
  }
  return blocks;
}

module.exports = { SYSTEM_BLOCKS, FMTEAM_OVERRIDE, buildSystemForAnthropic };
