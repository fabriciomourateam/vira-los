/**
 * aiRoteiroService.js
 * Gera roteiros de Reels prontos para gravar baseados no framework
 * "Meio de Funil Viral" — Gancho → Desenvolvimento → CTA.
 *
 * Usa claude-sonnet-4-6 com max_tokens: 900.
 */

const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Monta a seção de perfil do criador, se fornecida.
 * @param {Object|undefined} creatorProfile
 * @returns {string}
 */
function buildCreatorProfileSection(creatorProfile) {
  if (!creatorProfile || typeof creatorProfile !== 'object') return '';

  const lines = ['━━━ PERFIL DO CRIADOR (adapte linguagem, expressões e tom) ━━━'];

  if (creatorProfile.handle)      lines.push(`Handle: @${String(creatorProfile.handle).replace('@', '')}`);
  if (creatorProfile.niche)       lines.push(`Nicho: ${creatorProfile.niche}`);
  if (creatorProfile.audience)    lines.push(`Audiência: ${creatorProfile.audience}`);
  if (creatorProfile.expressions) lines.push(`Expressões características: ${creatorProfile.expressions}`);
  if (creatorProfile.exampleCopy) lines.push(`Exemplo de copy do criador:\n${creatorProfile.exampleCopy}`);

  lines.push('');
  return lines.join('\n');
}

/**
 * Gera o roteiro de Reels.
 *
 * @param {Object} params
 * @param {string}  params.tema          - Assunto do vídeo (obrigatório)
 * @param {string}  [params.formato]     - Tipo de formato (ex: "lista de 3 sinais", "mito-busting")
 * @param {string}  [params.tom]         - Estilo (ex: "provocativo", "técnico", "coloquial")
 * @param {string}  [params.publicoAlvo] - Quem vai assistir
 * @param {Object}  [params.creatorProfile] - { handle, niche, audience, expressions, exampleCopy }
 * @returns {Promise<{ roteiro: string }>}
 */
async function gerarRoteiro({ tema, formato, tom, publicoAlvo, creatorProfile } = {}) {
  if (!tema || !String(tema).trim()) throw new Error('O campo "tema" é obrigatório.');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada.');

  const formatoStr     = formato     ? `Formato: ${formato}`          : 'Formato: livre (escolha o mais viral para o tema)';
  const tomStr         = tom         ? `Tom: ${tom}`                  : 'Tom: direto e impactante';
  const publicoStr     = publicoAlvo ? `Público-alvo: ${publicoAlvo}` : '';
  const profileSection = buildCreatorProfileSection(creatorProfile);

  const userPrompt = `${profileSection}Tema do vídeo: ${String(tema).trim()}
${formatoStr}
${tomStr}
${publicoStr ? publicoStr + '\n' : ''}
━━━ FRAMEWORK "MEIO DE FUNIL VIRAL" — ANATOMIA OBRIGATÓRIA ━━━

GANCHO (0–4s):
- Para o scroll IMEDIATAMENTE
- Inclui: visual da cena + frase verbal exata + texto na tela em CAIXA ALTA
- Gancho emocional: escolha UMA de — curiosidade | medo | urgência

DESENVOLVIMENTO (5–60s):
- Dinamismo total: quebre o padrão a cada 10–15 segundos
- Equilíbrio: entretenimento + técnica/valor real
- Cada corte ou virada mantém o espectador na tela

CTA (distribuído em início, meio e final):
- Comentar: peça para comentar a letra/palavra X
- Seguir: argumento concreto de por que seguir
- Salvar: motivo específico para salvar este vídeo

━━━ FORMATO DE SAÍDA OBRIGATÓRIO ━━━
Retorne APENAS o roteiro no formato abaixo, sem introdução, sem disclaimers, sem texto fora do template:

ABERTURA (câmera mostra):
[cena]

TEXTO NA TELA:
[CAIXA ALTA]

FALA — GANCHO (0-4s):
[frase exata]

FALA — DESENVOLVIMENTO:
[12s]: [frase]
[25s]: [frase]
[40s]: [frase]
[55s]: [fechamento]

QUEBRA DE PADRÃO (~30s):
[ação específica]

CTA FINAL:
[frase exata para os últimos 5s]

TOM: [emoção central e por que retém]`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 900,
    system: 'Você é um roteirista especialista em Reels meio de funil viral. Escreve roteiros diretos, prontos para gravar. Não usa disclaimers, explicações ou comentários — retorna APENAS o roteiro, no template solicitado, sem nenhum texto extra.',
    messages: [{ role: 'user', content: userPrompt }],
  });

  const roteiro = (response.content[0]?.text || '').trim();
  if (!roteiro) throw new Error('Claude não retornou roteiro válido.');

  return { roteiro };
}

module.exports = { gerarRoteiro };
