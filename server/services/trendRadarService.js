/**
 * trendRadarService.js
 * Radar de tendências virais por nicho.
 *
 * Fluxo:
 *   1. Identifica subreddits relevantes para o nicho
 *   2. Busca top posts da semana via API pública do Reddit (sem auth)
 *   3. Claude Sonnet analisa e seleciona as 5 melhores oportunidades de conteúdo
 *   4. Retorna oportunidades com: título viral, hook de reels, pontos-chave, score viral
 */

const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Mapeamento nicho → subreddits ────────────────────────────────────────────

const NICHE_MAP = {
  'fitness': ['Fitness', 'bodybuilding', 'xxfitness', 'loseit', 'gainit', 'weightroom', 'running'],
  'saúde': ['Health', 'nutrition', 'Supplements', 'sleep', 'longevity', 'HealthyFood'],
  'hormônios': ['Testosterone', 'TRT', 'hormones', 'PCOS', 'Nootropics', 'Biohacking'],
  'finanças': ['personalfinance', 'financialindependence', 'investing', 'Frugal', 'stocks', 'ValueInvesting'],
  'negócios': ['Entrepreneur', 'smallbusiness', 'startups', 'marketing', 'digitalnomad', 'freelance'],
  'inteligência artificial': ['artificial', 'ChatGPT', 'OpenAI', 'MachineLearning', 'singularity', 'LocalLLaMA'],
  'lifestyle': ['selfimprovement', 'productivity', 'minimalism', 'LifeAdvice', 'socialskills'],
  'nutrição': ['nutrition', 'EatCheapAndHealthy', 'veganfitness', 'carnivore', 'intermittentfasting', 'keto'],
  'desenvolvimento pessoal': ['selfimprovement', 'getdisciplined', 'productivity', 'DecidingToBeBetter', 'stoicism'],
  'marketing digital': ['marketing', 'socialmedia', 'SEO', 'content_marketing', 'PPC', 'growthhacking'],
  'empreendedorismo': ['Entrepreneur', 'startups', 'SideProject', 'smallbusiness', 'passive_income'],
  'saúde mental': ['mentalhealth', 'Anxiety', 'depression', 'psychology', 'mindfulness', 'meditation'],
};

const DEFAULT_SUBREDDITS = ['selfimprovement', 'Entrepreneur', 'productivity', 'marketing', 'LifeAdvice'];

function resolveSubreddits(niche) {
  const lower = niche.toLowerCase();
  // Busca exata primeiro
  for (const [key, subs] of Object.entries(NICHE_MAP)) {
    if (lower === key) return subs;
  }
  // Busca parcial
  for (const [key, subs] of Object.entries(NICHE_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return subs;
  }
  return DEFAULT_SUBREDDITS;
}

// ─── Busca Reddit (API pública, sem auth) ─────────────────────────────────────

async function fetchRedditTrends(subreddits) {
  const targets = subreddits.slice(0, 6);
  const requests = targets.map(sub =>
    axios.get(`https://www.reddit.com/r/${sub}/top.json`, {
      params: { t: 'week', limit: 10 },
      headers: { 'User-Agent': 'ViralOS/1.0 (trend-radar)' },
      timeout: 10000,
    }).catch(() => null)
  );

  const responses = await Promise.all(requests);
  const results = [];

  for (const res of responses) {
    if (!res) continue;
    const posts = res.data?.data?.children || [];
    for (const p of posts) {
      const d = p.data;
      if (!d?.title || d.score < 50 || d.stickied) continue;
      results.push({
        title:     String(d.title).substring(0, 250),
        score:     d.score || 0,
        comments:  d.num_comments || 0,
        subreddit: d.subreddit || sub,
        selftext:  (d.selftext || '').substring(0, 400),
        url:       d.url || '',
      });
    }
  }

  return results
    .sort((a, b) => (b.score + b.comments * 3) - (a.score + a.comments * 3))
    .slice(0, 18);
}

// ─── Análise Claude ───────────────────────────────────────────────────────────

async function analyzeOpportunities(trends, niche) {
  const trendsText = trends.map((t, i) =>
    `${i + 1}. [r/${t.subreddit} · ↑${t.score} · 💬${t.comments}]\n   "${t.title}"${
      t.selftext ? `\n   Contexto: ${t.selftext.substring(0, 200)}` : ''
    }`
  ).join('\n\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2200,
    system: 'Você é um estrategista de conteúdo viral para Instagram e TikTok. Identifica padrões de engajamento em tendências online e transforma em oportunidades concretas de conteúdo meio de funil — conteúdo que gera curiosidade, entrega valor técnico e provoca comentário ou salvamento. Sua resposta é APENAS JSON válido.',
    messages: [{
      role: 'user',
      content: `Nicho do criador: "${niche}"

Trending topics desta semana (Reddit):

${trendsText}

Selecione as 5 MELHORES oportunidades de conteúdo viral para o nicho "${niche}". Priorize:
- Temas que geram curiosidade ou medo de perder (FOMO)
- Tópicos com alto número de comentários (indica debate/dor real)
- Conteúdo adaptável para lista, revelação ou mito-busting
- Ângulos que o público "${niche}" ainda não viu demais

Responda SOMENTE com este JSON (sem markdown, sem texto extra):

{
  "oportunidades": [
    {
      "id": 1,
      "titulo_viral": "<título de capa — máx 8 palavras, CAIXA ALTA, promessa ou número específico>",
      "tema": "<tema em 1 linha direta>",
      "fonte": "r/<subreddit>",
      "angulo_viral": "<como adaptar para o nicho em 1 frase — o que torna único>",
      "formato": "<lista|revelação|mito-busting|antes-depois|tutorial|investigativo>",
      "emocao": "<curiosidade|medo|urgência|surpresa|aspiração>",
      "hook_reels": "<gancho exato para abrir um Reels — 1-2 frases diretas, fala natural, sem saudação>",
      "pontos_chave": ["<ponto 1 concreto>", "<ponto 2>", "<ponto 3>", "<ponto 4 se houver>"],
      "score_viral": <1-10>,
      "por_que_funciona": "<razão específica do potencial viral — 1 frase>"
    }
  ],
  "resumo_semana": "<1 frase: o que domina as conversas neste nicho esta semana>",
  "nicho_processado": "${niche}"
}`,
    }],
  });

  const text = (response.content[0]?.text || '').trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Resposta inválida do Claude.');
  return JSON.parse(jsonMatch[0]);
}

// ─── Função principal ──────────────────────────────────────────────────────────

async function getTrendRadar(niche) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada.');
  if (!niche?.trim()) throw new Error('Nicho é obrigatório.');

  const subreddits = resolveSubreddits(niche.trim());
  const trends = await fetchRedditTrends(subreddits);

  if (!trends.length) {
    throw new Error('Sem tendências encontradas para este nicho. Tente reformular ou aguarde alguns minutos.');
  }

  const result = await analyzeOpportunities(trends, niche.trim());

  return {
    ...result,
    subredditsConsultados: subreddits.slice(0, 6),
    totalPostsAnalisados:  trends.length,
    updatedAt:             new Date().toISOString(),
  };
}

module.exports = { getTrendRadar, NICHE_MAP };
