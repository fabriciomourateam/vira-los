/**
 * storySequenceService.js
 * Gera sequência de 5 Instagram Stories para promover um carrossel.
 *
 * Estrutura da sequência:
 *   Story 1 — Gancho/Provocação      → para o scroll com a emoção do carrossel
 *   Story 2 — Agitação do problema   → o espectador se identifica
 *   Story 3 — Preview parcial        → 1 revelação sem entregar tudo
 *   Story 4 — Curiosity gap          → cria urgência para ver o carrossel
 *   Story 5 — CTA direto             → direciona para o post
 */

const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function generateStorySequence(carouselScript, instagramHandle = '') {
  if (!carouselScript?.trim()) throw new Error('Script do carrossel é obrigatório.');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada.');

  const handle = instagramHandle
    ? `@${instagramHandle.replace('@', '')}`
    : '@seucanal';

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1800,
    system: 'Você é um estrategista de Stories para Instagram. Cria sequências de 5 stories com curiosidade progressiva que direcionam para o post principal. Direto, sem elogios, sem explicações. Responde APENAS JSON válido.',
    messages: [{
      role: 'user',
      content: `SCRIPT DO CARROSSEL:
${carouselScript.trim()}

Crie uma sequência estratégica de 5 Instagram Stories para promover este carrossel (handle: ${handle}).

Regras:
- Story 1: Gancho — mesma emoção do carrossel, para o scroll
- Story 2: Agitação — o espectador se identifica com o problema
- Story 3: Preview — entrega 1 revelação real, sem dar tudo
- Story 4: Curiosity gap — cria urgência para ver o post
- Story 5: CTA — direciona explicitamente para o carrossel

Para cada story: texto curto (impacto visual), sticker interativo (enquete, pergunta ou contagem), instrução visual clara.

Responda SOMENTE com este JSON (sem markdown):

{
  "stories": [
    {
      "numero": 1,
      "tipo": "gancho",
      "duracao_seg": <3-7>,
      "fundo": "<instrução: ex. 'fundo preto liso' | 'gradiente roxo-escuro' | 'foto do reel'>",
      "texto_principal": "<CAIXA ALTA · máx 6 palavras · impacto máximo>",
      "texto_secundario": "<1 frase de apoio — tom direto, lowercase>",
      "sticker": {
        "tipo": "<enquete|pergunta|contagem_regressiva|nenhum>",
        "pergunta_ou_label": "<texto da enquete/pergunta>",
        "opcoes": ["<opção A>", "<opção B>"]
      },
      "emoji_sugerido": "<1-2 emojis que reforçam a mensagem>",
      "dica_visual": "<instrução rápida de produção: fonte, posição, cor do texto>",
      "copy_legenda": "<texto para digitar como legenda do story — máx 80 chars>"
    }
  ],
  "sequencia_resumo": "<1 frase descrevendo a narrativa dos 5 stories>",
  "hashtags": ["#tag1", "#tag2", "#tag3"],
  "melhor_horario_postar": "<ex: Terça-Quinta, 19h-21h>"
}`,
    }],
  });

  const text = (response.content[0]?.text || '').trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Resposta inválida do modelo — tente novamente.');

  return JSON.parse(jsonMatch[0]);
}

module.exports = { generateStorySequence };
