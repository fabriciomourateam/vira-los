/**
 * viralScoreService.js
 * Avalia o potencial viral de scripts de carrossel ou Reels do Instagram.
 *
 * Critérios (pesos):
 *   hook          30% — primeiras palavras/segundos param o scroll?
 *   curiosity     20% — lacunas de curiosidade que puxam para o próximo slide/segundo?
 *   emotion       20% — emoção central clara e mantida do início ao fim?
 *   cta           15% — call-to-action específico, posicionado e atrelado ao conteúdo?
 *   format        15% — formato viral comprovado (lista, revelação, mito-busting...)?
 */

const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function scoreScript(script, type = 'carousel') {
  if (!script || !script.trim()) throw new Error('Script vazio.');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada.');

  const typeLabel = type === 'carousel' ? 'carrossel para Instagram' : 'roteiro de Reels';

  const prompt = `Analise este script de ${typeLabel} e avalie cada critério com rigor:

---
${script.trim()}
---

Critérios:

1. HOOK (peso 30%): As primeiras palavras/segundos param o scroll? Há número específico, promessa clara ou dor real? Gera curiosidade imediata?

2. CURIOSITY GAPS (peso 20%): Há lacunas de curiosidade que forçam continuar? Cada seção puxa para a próxima? O espectador/leitor precisa seguir para obter a resposta?

3. EMOÇÃO CENTRAL (peso 20%): Há uma emoção dominante (medo de perder, curiosidade, surpresa, urgência, aspiração)? É mantida do início ao fim?

4. CTA (peso 15%): O call-to-action é específico? Está atrelado ao conteúdo? Pede ação concreta (comentar X, salvar para Y, seguir por Z)?

5. FORMATO VIRAL (peso 15%): Segue padrão comprovado (lista numerada, revelação, mito-busting, antes-depois)? A estrutura facilita compartilhamento?

Responda SOMENTE com o JSON abaixo — sem markdown, sem texto extra:

{
  "scores": {
    "hook": {
      "score": <0-10>,
      "titulo": "<1-3 palavras que resumem o hook atual>",
      "feedback": "<o que funciona e o que falta — 1 frase direta>",
      "trecho_original": "<copie EXATAMENTE o trecho do script original que corresponde ao hook — primeiras linhas/palavras>",
      "reescrita": "<versão melhorada do hook — mesmo comprimento e formato do original>"
    },
    "curiosity": {
      "score": <0-10>,
      "feedback": "<onde os gaps existem e onde faltam — 1 frase>",
      "trecho_original": "<copie EXATAMENTE o trecho do script onde o curiosity gap deveria estar ou está fraco>",
      "reescrita": "<versão melhorada desse trecho com curiosity gap inserido>"
    },
    "emotion": {
      "score": <0-10>,
      "emocao_detectada": "<medo|curiosidade|urgência|surpresa|aspiração|fraca/mista>",
      "feedback": "<se a emoção é clara e consistente — 1 frase>",
      "trecho_original": "<copie EXATAMENTE o trecho onde a emoção está fraca ou ausente>",
      "reescrita": "<versão do mesmo trecho com a emoção amplificada>"
    },
    "cta": {
      "score": <0-10>,
      "feedback": "<se o CTA existe, está no lugar certo, e pede ação específica>",
      "trecho_original": "<copie EXATAMENTE o trecho de CTA atual do script, ou as últimas linhas se não houver>",
      "reescrita": "<CTA melhorado — substitui diretamente o trecho original>"
    },
    "format": {
      "score": <0-10>,
      "formato_detectado": "<lista|revelação|mito-busting|antes-depois|tutorial|indefinido>",
      "feedback": "<se o formato está funcionando — 1 frase>",
      "trecho_original": "<copie EXATAMENTE o trecho onde o formato precisa de ajuste>",
      "reescrita": "<mesmo trecho reestruturado no formato viral recomendado>"
    }
  },
  "overall": <número: hook*0.30 + curiosity*0.20 + emotion*0.20 + cta*0.15 + format*0.15, arredondado para 1 decimal>,
  "veredicto": "<Viral|Alto potencial|Médio|Fraco>",
  "veredicto_motivo": "<1 frase: razão específica deste veredicto>",
  "top3_melhorias": [
    "<melhoria prioritária 1 — ação concreta>",
    "<melhoria prioritária 2>",
    "<melhoria prioritária 3>"
  ]
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1600,
    system: 'Você é um analista especialista em viralidade de conteúdo para Instagram e TikTok. Avalia scripts com critérios objetivos e dá feedback direto, acionável e sem elogios vagos. Sua resposta é SEMPRE um JSON válido e nada mais.',
    messages: [{ role: 'user', content: prompt }],
  });

  const text = (response.content[0]?.text || '').trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Resposta inválida do modelo — tente novamente.');

  return JSON.parse(jsonMatch[0]);
}

module.exports = { scoreScript };
