/**
 * roteiristaService.js
 * Roteirista de Reels: parte da TRANSCRIÇÃO de um vídeo viral + nicho + estilo e
 * devolve um roteiro adaptado pro nicho do criador, usando um framework de gancho
 * de alta retenção (pattern interrupt / tensão cognitiva / contraste / número que
 * choca / identidade).
 *
 * Diferente do aiRoteiroService (que parte de um TEMA digitado), aqui a fonte é a
 * estrutura de um vídeo que já viralizou — adaptamos a ESTRUTURA, não o assunto.
 */

const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db/database');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildProfileSection(p) {
  if (!p || typeof p !== 'object') return '';
  const l = [];
  if (p.handle)      l.push(`Handle: @${String(p.handle).replace('@', '')}`);
  if (p.niche)       l.push(`Nicho: ${p.niche}`);
  if (p.audience)    l.push(`Audiência: ${p.audience}`);
  if (p.expressions) l.push(`Expressões características: ${p.expressions}`);
  if (p.exampleCopy) l.push(`Exemplo de copy do criador:\n${p.exampleCopy}`);
  return l.length ? `━━━ PERFIL DO CRIADOR (use a linguagem e o tom dele) ━━━\n${l.join('\n')}\n\n` : '';
}

/**
 * @param {Object} params
 * @param {string} params.transcricao    - Transcrição do vídeo viral (obrigatório)
 * @param {string} [params.nicho]        - Nicho alvo (default: ideas_config)
 * @param {string} [params.estilo]       - Tom/estilo (ex: provocativo, técnico)
 * @param {string} [params.assinatura]   - Bordão/assinatura do criador
 * @param {Object} [params.creatorProfile]
 * @returns {Promise<{ roteiro: string }>}
 */
async function gerarRoteirista({ transcricao, nicho, estilo, assinatura, creatorProfile } = {}) {
  if (!transcricao || !String(transcricao).trim()) {
    throw new Error('Cole a transcrição do vídeo viral.');
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada.');

  const ideas = db.getIdeasConfig() || {};
  const nicheStr = (nicho && nicho.trim()) || creatorProfile?.niche || ideas.niche || 'fitness / nutrição esportiva';
  const profileSection = buildProfileSection(creatorProfile);

  const userPrompt = `${profileSection}NICHO ALVO: ${nicheStr}
${estilo ? `ESTILO/TOM: ${estilo}` : ''}
${assinatura ? `ASSINATURA/BORDÃO do criador: ${assinatura}` : ''}

TRANSCRIÇÃO DO VÍDEO QUE VIRALIZOU (referência de ESTRUTURA, não de assunto):
"""
${String(transcricao).trim()}
"""

Siga estes 4 passos internamente e entregue SÓ o resultado final do PASSO 4:

PASSO 1 — ANALISAR: identifique por que esse vídeo prende — qual gancho usou, como
sustenta a retenção (quebras de padrão, viradas, loops abertos) e qual o CTA.
Extraia a ESTRUTURA e o mecanismo psicológico, não o assunto.

PASSO 2 — GANCHO: reescreva o gancho (0–3s) pro nicho usando a técnica MAIS forte
entre (escolha 1 ou 2, não force todas):
- Pattern interrupt: quebra de expectativa, algo inesperado logo de cara
- Tensão cognitiva: abre um loop/curiosidade que só fecha no fim do vídeo
- Contraste: antes×depois, mito×verdade, "todo mundo faz X"×"o certo é Y"
- Número que choca: dado específico e surpreendente
- Identidade: chama direto o tipo de pessoa ("se você é X e sente Y...")

PASSO 3 — ADAPTAR: transponha toda a estrutura pro nicho ${nicheStr}, com conteúdo
REAL e específico (nada genérico). Mantenha o ritmo e as quebras que faziam o
original reter. Use a voz/expressões do criador.

PASSO 4 — SAÍDA: retorne APENAS no formato abaixo, sem introdução nem comentários:

🎬 ABERTURA (cena/visual):
[o que aparece na tela nos primeiros segundos]

⚡ GANCHO (0–3s) — técnica: [nome da técnica usada]:
[frase exata de fala]
TEXTO NA TELA: [EM CAIXA ALTA]

🔧 DESENVOLVIMENTO:
[0:04] [fala]
[0:12] [fala + quebra de padrão]
[0:25] [fala]
[0:40] [fala / fechamento do conteúdo]

📈 VIRADA (clímax — o maior valor / a sacada):
[o ponto mais forte do vídeo]

🎯 CTA:
[frase exata pros últimos segundos — comentar/salvar/seguir com motivo concreto]

🖊️ LEGENDA:
[legenda pronta pro post, terminando com 1 pergunta que gera comentário]`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    system: 'Você é um roteirista especialista em Reels virais. Adapta a ESTRUTURA de vídeos que viralizaram pro nicho do criador. Retorna APENAS o roteiro no template solicitado — sem disclaimers, sem explicações, sem texto fora do template.',
    messages: [{ role: 'user', content: userPrompt }],
  });

  const roteiro = (response.content[0]?.text || '').trim();
  if (!roteiro) throw new Error('A IA não retornou roteiro válido.');
  return { roteiro };
}

module.exports = { gerarRoteirista };
