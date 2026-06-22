/**
 * docs.js — Documentos vivos (painéis editáveis Público / SEO).
 *
 * GET  /api/docs/:id          → override salvo do usuário (ou null = usa default do front)
 * PUT  /api/docs/:id          → salva o documento editado
 * POST /api/docs/:id/suggest  → IA propõe uma versão atualizada + resumo das mudanças
 */

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ALLOWED = new Set(['publico', 'seo']);

const GUIDE = {
  publico:
    'Você é estrategista de marca do Fabricio Moura (nutrição/performance masculina). ' +
    'Este é o ICP (público-alvo) — comprador HOMEM 25-40. Atualize/refine mantendo EXATAMENTE a mesma ESTRUTURA de chaves do JSON recebido. ' +
    'Voz: treinador, português, "você" (nunca "tu"), sem clichê de IA "não é X, é Y". Mantenha por sintoma (ban-safe). ' +
    'Use os SINAIS de performance (se houver) pra priorizar dores/temas que estão engajando. Não invente números da base de clientes.',
  seo:
    'Você é estrategista de SEO/tráfego orgânico do Fabricio Moura. Este é o painel de progresso. ' +
    'Atualize/refine mantendo EXATAMENTE a mesma ESTRUTURA de chaves do JSON recebido. ' +
    'Não invente métricas; foque em refinar status, próximos passos, quick-wins e calendário com base no que já existe.',
};

router.get('/:id', (req, res) => {
  if (!ALLOWED.has(req.params.id)) return res.status(404).json({ error: 'doc inválido' });
  res.json(db.getDoc(req.params.id));
});

router.put('/:id', (req, res) => {
  if (!ALLOWED.has(req.params.id)) return res.status(404).json({ error: 'doc inválido' });
  if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'corpo inválido' });
  db.setDoc(req.params.id, req.body);
  res.json({ ok: true });
});

// Sinais de performance pra enriquecer a sugestão do Público (temas que engajam)
function instagramSignal() {
  const posts = db.getInstagramPosts() || [];
  if (!posts.length) return '';
  const top = [...posts]
    .sort((a, b) => ((b.saves || 0) * 4 + (b.shares || 0) * 3) - ((a.saves || 0) * 4 + (a.shares || 0) * 3))
    .slice(0, 8)
    .map((p) => `- saves ${p.saves || 0} / shares ${p.shares || 0}: "${(p.caption || '').replace(/\s+/g, ' ').slice(0, 90)}"`);
  return `\n\nSINAIS DE PERFORMANCE (posts que mais engajaram — use pra priorizar):\n${top.join('\n')}`;
}

router.post('/:id/suggest', async (req, res) => {
  const id = req.params.id;
  if (!ALLOWED.has(id)) return res.status(404).json({ error: 'doc inválido' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY não configurada' });

  const current = req.body?.current;
  if (!current || typeof current !== 'object') return res.status(400).json({ error: 'envie { current: <doc atual> }' });

  const signal = id === 'publico' ? instagramSignal() : '';
  const prompt = `${GUIDE[id]}

DOCUMENTO ATUAL (JSON):
${JSON.stringify(current, null, 2)}${signal}

Proponha uma versão ATUALIZADA. Responda APENAS com JSON válido, nada antes ou depois:
{
  "doc": { ...mesma estrutura do documento atual, com seus refinamentos... },
  "resumo": "2-4 bullets curtos do que você mudou e por quê (texto, use • )"
}`;

  try {
    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: 'Responde SEMPRE com JSON válido e nada mais.',
      messages: [{ role: 'user', content: prompt }],
    });
    const text = (r.content[0]?.text || '').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Resposta inválida da IA');
    const parsed = JSON.parse(match[0]);
    res.json({ suggestion: parsed.doc || parsed, resumo: parsed.resumo || '' });
  } catch (err) {
    const msg = err?.error?.error?.message || err?.message || 'Erro ao gerar sugestão';
    console.error('[Docs/Suggest]', msg);
    res.status(500).json({ error: msg });
  }
});

module.exports = router;
