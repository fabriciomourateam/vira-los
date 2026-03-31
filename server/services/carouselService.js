/**
 * carouselService.js
 * Gera carrosseis para Instagram usando Claude + Apify (Reddit) + Unsplash
 * Baseado no agente: https://gist.github.com/hudsonbrendon/384eb612d4e5cedf562ef88b2bc9ceec
 */

const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Busca tendências no Reddit via Apify ─────────────────────────────────────

async function fetchRedditTrends(topic) {
  const apiKey = process.env.APIFY_API_KEY;
  if (!apiKey) return [];

  try {
    const id = 'trudax~reddit-scraper-lite'.replace('/', '~');
    const url = `https://api.apify.com/v2/acts/${id}/run-sync-get-dataset-items?token=${apiKey}&timeout=60`;
    const response = await axios.post(url, {
      searches: [topic],
      type: 'posts',
      sort: 'hot',
      maxItems: 10,
    }, { timeout: 75000 });

    const items = Array.isArray(response.data) ? response.data : [];
    return items.slice(0, 5).map(p => ({
      title: String(p.title || '').substring(0, 200),
      score: p.score || 0,
      url: p.url || '',
    }));
  } catch (err) {
    console.error('[CarouselService/Reddit]', err.message);
    return [];
  }
}

// ─── Busca imagens no Unsplash ────────────────────────────────────────────────

async function fetchUnsplashImages(query, count = 10) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return [];

  try {
    const r = await axios.get('https://api.unsplash.com/search/photos', {
      params: { query, per_page: count, orientation: 'portrait' },
      headers: { Authorization: `Client-ID ${key}` },
      timeout: 10000,
    });
    return (r.data?.results || []).map(img => ({
      url: img.urls?.regular || img.urls?.small || '',
      alt: img.alt_description || query,
      credit: img.user?.name || '',
    }));
  } catch (err) {
    console.error('[CarouselService/Unsplash]', err.message);
    return [];
  }
}

// ─── Monta o prompt personalizado (baseado no gist) ───────────────────────────

function buildPrompt({ topic, niche, primaryColor, accentColor, bgColor, fontFamily, instagramHandle, numSlides, contentTone, redditTrends, unsplashImages }) {
  const handle = instagramHandle ? `@${instagramHandle.replace('@', '')}` : '@seucanal';
  const fontsLink = `https://fonts.googleapis.com/css2?family=${fontFamily.replace(/ /g, '+')}:wght@400;600;700;800&display=swap`;

  const trendsSection = redditTrends.length
    ? `\n## Tendências encontradas no Reddit sobre "${topic}":\n${redditTrends.map((t, i) => `${i + 1}. ${t.title} (${t.score} upvotes)`).join('\n')}`
    : '';

  const imagesSection = unsplashImages.length
    ? `\n## Imagens disponíveis do Unsplash (use as URLs diretamente no HTML):\n${unsplashImages.map((img, i) => `${i + 1}. ${img.url} — "${img.alt}" (foto de ${img.credit})`).join('\n')}`
    : '';

  return `Você é um agente especialista em criar carrosseis profissionais para Instagram.

Crie um carrossel completo sobre: **${topic}**
Nicho: ${niche}
Tom: ${contentTone}
Número de slides: ${numSlides} (incluindo capa e CTA final)
${trendsSection}
${imagesSection}

## Identidade Visual obrigatória:
- Cor principal: ${primaryColor}
- Cor de destaque: ${accentColor}
- Cor de fundo slides internos: ${bgColor}
- Tipografia: ${fontFamily} (do Google Fonts)
- Handle do Instagram: ${handle}

## Estrutura dos slides:

### Slide 1 — Capa
- Fundo: foto real (use URL do Unsplash se disponível, senão use um gradiente temático)
- Overlay escuro para legibilidade (rgba(0,0,0,0.55))
- Branding centralizado no topo: "${handle}" em ${primaryColor}
- Título provocador em CAIXA ALTA (máx 8 palavras), com 1-2 palavras destacadas em ${primaryColor}
- Subtítulo em 1-2 linhas
- Sem número de paginação

### Slides 2 a ${numSlides - 1} — Conteúdo (tom: ${contentTone})
- Fundo sólido ${bgColor}
- Foto contextual em posição variada (topo/meio/base) — tamanho menor (30-40% do slide)
- Texto grande (36-42px) preenchendo o espaço, máx 30 palavras
- Palavras-chave destacadas inline em ${primaryColor} ou ${accentColor}
- Número de slide no canto inferior direito
- Um único insight impactante por slide

### Slide ${numSlides} — CTA final
- Fundo: gradiente de ${bgColor} para tom mais escuro
- Chamada para salvar / compartilhar / seguir
- Handle ${handle} em destaque

## Regras de HTML:
- Cada slide: 1080×1350px, formato retrato
- Fonte: importar do Google Fonts: ${fontsLink}
- CSS inline dentro de cada <div class="slide">
- Gere UM único arquivo HTML com todos os slides empilhados verticalmente
- Cada slide deve ter class="slide" e id="slide-N" (N = número)
- Não use imagens externas além das URLs do Unsplash fornecidas
- Se não houver URLs do Unsplash, use gradientes CSS criativos no lugar das fotos

## Formato de resposta:
Retorne APENAS o código HTML completo, sem markdown, sem explicações.
Comece com <!DOCTYPE html> e termine com </html>.`;
}

// ─── Função principal ─────────────────────────────────────────────────────────

async function generateCarousel(config) {
  const {
    topic,
    niche = 'Inteligência Artificial',
    primaryColor = '#B078FF',
    accentColor = '#5197b5',
    bgColor = '#292A25',
    fontFamily = 'Raleway',
    instagramHandle = '',
    numSlides = 7,
    contentTone = 'investigativo',
  } = config;

  if (!topic || !topic.trim()) throw new Error('Tema obrigatório');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');

  // Coleta em paralelo (opcional — só roda se as chaves estiverem configuradas)
  const [redditTrends, unsplashImages] = await Promise.all([
    fetchRedditTrends(topic),
    fetchUnsplashImages(topic, numSlides),
  ]);

  const prompt = buildPrompt({
    topic: topic.trim(),
    niche,
    primaryColor,
    accentColor,
    bgColor,
    fontFamily,
    instagramHandle,
    numSlides: Math.min(10, Math.max(5, Number(numSlides))),
    contentTone,
    redditTrends,
    unsplashImages,
  });

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
  });

  const html = response.content[0]?.text?.trim() || '';
  if (!html.startsWith('<!DOCTYPE') && !html.startsWith('<html')) {
    throw new Error('Claude não retornou HTML válido');
  }

  return {
    html,
    topic: topic.trim(),
    numSlides: Math.min(10, Math.max(5, Number(numSlides))),
    redditTrendsUsed: redditTrends.length,
    unsplashImagesUsed: unsplashImages.length,
  };
}

module.exports = { generateCarousel };
