/**
 * studioService.js
 * Geração de designs (carrossel, story, post, banner, logo, thumbnail)
 * via Claude com streaming SSE.
 *
 * Formatos suportados: carousel | story | post | banner | logo | thumbnail
 * Contexto aceito: idea (ContentIdea) | trend (Oportunidade) | blank
 *
 * Cada formato tem:
 *  - Template CSS completo entregue ao Claude (Claude preenche conteúdo, não inventa estrutura)
 *  - Regras de escrita viral (derivadas do carouselService)
 *  - Estrutura de slides com papéis definidos (para carousel)
 */

const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const GOOGLE_FONTS = `https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Space+Grotesk:wght@400;500;600;700&family=Bebas+Neue&family=Oswald:wght@400;600;700&display=swap`;

// ─── Dimensões por formato ────────────────────────────────────────────────────

const FORMAT_DIMENSIONS = {
  carousel:  { width: 1080, height: 1080, label: 'Carrossel Instagram (1080×1080)' },
  story:     { width: 1080, height: 1920, label: 'Story Instagram (1080×1920)' },
  post:      { width: 1080, height: 1080, label: 'Post Instagram (1080×1080)' },
  banner:    { width: 1200, height: 628,  label: 'Banner Digital (1200×628)' },
  logo:      { width: 800,  height: 800,  label: 'Logo (800×800)' },
  thumbnail: { width: 1280, height: 720,  label: 'Thumbnail YouTube (1280×720)' },
};

// ─── Regras de escrita viral (baseadas no carouselService original) ───────────

const WRITING_RULES = `
━━━ REGRAS DE ESCRITA (obrigatórias) ━━━
- Linguagem direta, como alguém falando com um amigo inteligente
- Sem travessão no meio das frases
- Sem clichês ou frases genéricas ("Você sabia que...", "É muito importante...")
- Cada bloco de texto entrega um insight novo, nunca repete o anterior
- Tom provocador e inteligente, nunca agressivo
- Máximo 40 palavras por bloco de conteúdo principal
- Números específicos sempre ganham de afirmações vagas (ex: "37% das pessoas" > "muitas pessoas")
- Proibido: abertura genérica, frase motivacional vazia, pergunta retórica fraca`;

// ─── Estrutura viral de slides para carousel ──────────────────────────────────

function buildCarouselStructure(numSlides, dominantEmotion, handleAt) {
  const emo = (dominantEmotion || 'curiosidade').toUpperCase();
  const n = Math.min(10, Math.max(5, Number(numSlides) || 7));

  const HOOK       = (i) => `SLIDE ${i} — CAPA/HOOK: número específico, promessa clara ou dor real no título. Proibido: frase motivacional, abertura genérica.`;
  const QUEBRA     = (i) => `SLIDE ${i} — QUEBRA DE EXPECTATIVA: contradiga a crença mais comum do nicho. Termine com frase que cria lacuna para o próximo slide.`;
  const AMPLI      = (i, s='') => `SLIDE ${i} — AMPLIFICAÇÃO${s}: comportamento incoerente que a maioria tem + consequência real e específica de continuar assim.`;
  const REVELACAO  = (i, s='') => `SLIDE ${i} — REVELAÇÃO${s}: insight central que reframe tudo + metáfora simples que qualquer pessoa entende em 3 segundos.`;
  const CONSEQUENCIA = (i) => `SLIDE ${i} — CONSEQUÊNCIA: custo real e específico de ignorar — use dados, prazo ou comparação concreta. Sem generalização.`;
  const FRASE      = (i) => `SLIDE ${i} — FRASE DE IMPACTO: uma única ideia curta que sintetize a emoção dominante (${dominantEmotion}). Sem explicação.`;
  const CTA        = (i) => `SLIDE ${i} — CTA: ação concreta atrelada ao tema. Peça comentar uma palavra-chave + seguir ${handleAt || '@seucanal'}. Não use CTA genérico.`;

  let structure = `\n━━━ ESTRUTURA DOS ${n} SLIDES (emoção dominante: ${emo}) ━━━\n\n`;

  if (n <= 5) {
    structure += [HOOK(1), QUEBRA(2), `SLIDE 3 — AMPLIFICAÇÃO + REVELAÇÃO: comportamento incoerente + insight central com metáfora simples.`, `SLIDE 4 — CONSEQUÊNCIA + FRASE FINAL: custo específico + frase curta que sintetize a emoção (${dominantEmotion}).`, CTA(5)].join('\n\n');
  } else if (n === 6) {
    structure += [HOOK(1), QUEBRA(2), AMPLI(3), REVELACAO(4), `SLIDE 5 — CONSEQUÊNCIA + FRASE FINAL: custo específico (dados/prazo) + frase que sintetize a emoção (${dominantEmotion}).`, CTA(6)].join('\n\n');
  } else if (n === 7) {
    structure += [HOOK(1), QUEBRA(2), AMPLI(3), REVELACAO(4), CONSEQUENCIA(5), FRASE(6), CTA(7)].join('\n\n');
  } else if (n === 8) {
    structure += [HOOK(1), QUEBRA(2), AMPLI(3,' pt.1'), AMPLI(4,' pt.2'), REVELACAO(5), CONSEQUENCIA(6), FRASE(7), CTA(8)].join('\n\n');
  } else {
    structure += [HOOK(1), QUEBRA(2), AMPLI(3,' pt.1'), AMPLI(4,' pt.2'), REVELACAO(5,' pt.1'), REVELACAO(6,' pt.2'), CONSEQUENCIA(7), FRASE(8), ...(n >= 10 ? [`SLIDE 9 — REFORÇO: dado extra ou exemplo real que solidifica a revelação.`] : []), CTA(n)].join('\n\n');
  }

  return structure;
}

// ─── Templates CSS + instruções por formato ──────────────────────────────────

function formatInstructions(format, brandKit, contextData) {
  const palette = brandKit?.palette || ['#6366f1', '#8b5cf6', '#1e1e2e', '#ffffff'];
  const [primary, accent, bg, text] = palette;
  const handle = brandKit?.instagramHandle ? `@${brandKit.instagramHandle.replace('@','')}` : '@seucanal';
  const brandName = brandKit?.brandName || brandKit?.name || '';
  const emotion = contextData?.emotion || contextData?.emocao || 'curiosidade';
  const numSlides = contextData?.numSlides || 7;

  switch (format) {

    // ── CARROSSEL ─────────────────────────────────────────────────────────────
    case 'carousel': return `
Gere ${numSlides} slides de carrossel para Instagram (1080×1080px cada).
Retorne APENAS HTML. Comece com <!DOCTYPE html>, sem markdown, sem code fences, sem texto fora do HTML.

━━━ REGRAS ABSOLUTAS ━━━
- Use EXATAMENTE as classes CSS do template abaixo
- Cada slide = um <div class="slide"> ou <div class="slide-editorial">
- TODOS os slides têm .top-header e .footer
- Substitua ${handle} onde aparecer o handle

━━━ HEADER (obrigatório em todos os slides) ━━━
<div class="top-header">
  <span>ViralOS Studio</span>
  <span>${handle}</span>
</div>

━━━ RODAPÉ (obrigatório em todos os slides) ━━━
Slides internos (2 a ${numSlides-1}): número N/${numSlides-2} no rodapé direito
Capa (slide 1) e CTA (slide ${numSlides}): sem número no rodapé direito

━━━ CSS TEMPLATE OBRIGATÓRIO ━━━
<link href="${GOOGLE_FONTS}" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }

  /* CAPA e CTA */
  .slide {
    width:1080px; height:1080px; position:relative; overflow:hidden;
    font-family:'Inter',sans-serif; color:#fff;
    display:flex; flex-direction:column; justify-content:flex-end;
    padding:60px 56px 80px;
    background: linear-gradient(135deg, ${bg} 0%, ${primary}cc 100%);
    page-break-after:always;
  }
  .slide-bg { position:absolute; top:0; left:0; width:100%; height:100%; background-size:cover; background-position:center; z-index:0; }
  .slide-overlay { position:absolute; top:0; left:0; width:100%; height:100%; background:linear-gradient(180deg,rgba(0,0,0,0) 0%,rgba(0,0,0,.88) 70%); z-index:1; }
  .slide-content { position:relative; z-index:2; width:100%; display:flex; flex-direction:column; gap:20px; }
  .title { font-family:'Bebas Neue',sans-serif; font-size:88px; line-height:.95; letter-spacing:-1px; color:#fff; text-transform:uppercase; }
  .title span.hl { color:${accent}; }
  .subtitle { font-size:28px; font-weight:400; color:rgba(255,255,255,.75); max-width:680px; line-height:1.4; }
  .cta-box { display:inline-flex; align-items:center; gap:12px; background:${accent}; padding:16px 32px; border-radius:8px; font-size:26px; font-weight:700; color:#fff; }

  /* SLIDES EDITORIAIS (conteúdo) */
  .slide-editorial {
    width:1080px; height:1080px; position:relative; overflow:hidden;
    font-family:'Inter',sans-serif; color:#fff;
    background:${bg};
    page-break-after:always;
  }
  .editorial-content { position:relative; z-index:2; padding:90px 64px 80px; height:100%; display:flex; flex-direction:column; justify-content:center; gap:28px; }
  .narrative-text { font-size:40px; font-weight:700; line-height:1.25; color:#fff; max-width:900px; }
  .narrative-text.secondary { font-size:30px; font-weight:400; color:rgba(255,255,255,.70); }
  .highlight { color:${accent}; }
  .highlight-box { background:${primary}33; border-left:6px solid ${accent}; padding:20px 28px; border-radius:0 12px 12px 0; font-size:30px; font-weight:600; color:#fff; max-width:880px; }
  .accent-bg { background:linear-gradient(135deg,${primary} 0%,${accent}99 100%); }

  /* HEADER TOPO */
  .top-header { position:absolute; top:0; left:0; right:0; display:flex; justify-content:space-between; align-items:center; padding:24px 40px; z-index:10; }
  .top-header span { font-family:'Space Grotesk',sans-serif; font-size:15px; font-weight:500; color:rgba(255,255,255,.5); letter-spacing:.5px; }

  /* RODAPÉ */
  .footer { position:absolute; bottom:0; left:0; right:0; display:flex; justify-content:space-between; align-items:center; padding:22px 40px; z-index:10; }
  .footer-left { display:flex; align-items:center; gap:10px; font-size:18px; font-weight:600; color:rgba(255,255,255,.6); }
  .footer-right { font-family:'Space Grotesk',sans-serif; font-size:18px; font-weight:700; color:rgba(255,255,255,.45); }
</style>

${buildCarouselStructure(numSlides, emotion, handle)}
${WRITING_RULES}`;

    // ── STORY ─────────────────────────────────────────────────────────────────
    case 'story': return `
Gere 1 Story para Instagram (1080×1920px).
Retorne APENAS HTML. Comece com <!DOCTYPE html>, sem markdown.

━━━ CSS TEMPLATE OBRIGATÓRIO ━━━
<link href="${GOOGLE_FONTS}" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1080px; height:1920px; overflow:hidden; }
  .story {
    width:1080px; height:1920px; position:relative; overflow:hidden;
    font-family:'Inter',sans-serif;
    background: linear-gradient(160deg, ${bg} 0%, ${primary} 50%, ${accent}88 100%);
    display:flex; flex-direction:column; justify-content:space-between;
    padding:80px 64px;
  }
  .story-top { display:flex; flex-direction:column; gap:16px; }
  .story-tag { font-family:'Space Grotesk',sans-serif; font-size:22px; font-weight:600; color:${accent}; letter-spacing:2px; text-transform:uppercase; }
  .story-title { font-family:'Bebas Neue',sans-serif; font-size:120px; line-height:.9; color:#fff; text-transform:uppercase; }
  .story-title span { color:${accent}; }
  .story-mid { display:flex; flex-direction:column; gap:24px; }
  .story-item { display:flex; align-items:flex-start; gap:20px; }
  .story-num { font-family:'Bebas Neue',sans-serif; font-size:72px; color:${accent}; line-height:1; }
  .story-text { font-size:34px; font-weight:600; color:rgba(255,255,255,.9); line-height:1.3; padding-top:8px; }
  .story-bottom { display:flex; flex-direction:column; gap:20px; align-items:center; }
  .story-cta { background:${accent}; color:#fff; font-size:30px; font-weight:700; padding:24px 56px; border-radius:100px; letter-spacing:.5px; }
  .story-handle { font-size:24px; color:rgba(255,255,255,.5); font-weight:500; }
  /* Formas decorativas */
  .shape { position:absolute; border-radius:50%; opacity:.12; }
  .shape-1 { width:500px; height:500px; background:${accent}; top:-150px; right:-150px; }
  .shape-2 { width:300px; height:300px; background:${primary}; bottom:200px; left:-100px; }
</style>

━━━ ESTRUTURA DO STORY ━━━
.story-top: tag do nicho + título impactante com palavra-chave em destaque (span)
.story-mid: 3 itens numerados com .story-num + .story-text — insights diretos e específicos
.story-bottom: botão CTA + handle
Adicione .shape-1 e .shape-2 como decoração de fundo.

${WRITING_RULES}`;

    // ── POST QUADRADO ─────────────────────────────────────────────────────────
    case 'post': return `
Gere 1 post quadrado para Instagram (1080×1080px).
Retorne APENAS HTML. Comece com <!DOCTYPE html>, sem markdown.

━━━ CSS TEMPLATE OBRIGATÓRIO ━━━
<link href="${GOOGLE_FONTS}" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1080px; height:1080px; overflow:hidden; }
  .post {
    width:1080px; height:1080px; position:relative; overflow:hidden;
    font-family:'Inter',sans-serif;
    background:${bg};
    display:flex; flex-direction:column;
    padding:72px;
  }
  .post-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:48px; }
  .post-brand { font-family:'Space Grotesk',sans-serif; font-size:22px; font-weight:700; color:${accent}; letter-spacing:1px; }
  .post-tag { font-size:18px; font-weight:500; color:rgba(255,255,255,.4); background:rgba(255,255,255,.06); padding:8px 18px; border-radius:100px; }
  .post-body { flex:1; display:flex; flex-direction:column; justify-content:center; gap:32px; }
  .post-eyebrow { font-size:20px; font-weight:600; color:${accent}; text-transform:uppercase; letter-spacing:2px; }
  .post-title { font-family:'Bebas Neue',sans-serif; font-size:96px; line-height:.92; color:#fff; text-transform:uppercase; }
  .post-title span { color:${accent}; }
  .post-desc { font-size:28px; font-weight:400; color:rgba(255,255,255,.65); line-height:1.5; max-width:800px; }
  .post-divider { width:80px; height:4px; background:${accent}; border-radius:2px; }
  .post-stat { font-family:'Bebas Neue',sans-serif; font-size:72px; color:${accent}; line-height:1; }
  .post-stat-label { font-size:22px; color:rgba(255,255,255,.5); font-weight:500; }
  .post-footer { display:flex; align-items:center; justify-content:space-between; margin-top:40px; }
  .post-handle { font-size:22px; font-weight:600; color:rgba(255,255,255,.45); }
  .post-cta { font-size:20px; font-weight:700; color:${accent}; display:flex; align-items:center; gap:8px; }
  /* Acento decorativo */
  .post-accent-bar { position:absolute; left:0; top:0; bottom:0; width:8px; background:linear-gradient(180deg,${accent},${primary}); }
</style>

━━━ ESTRUTURA DO POST ━━━
.post-header: marca/handle + tag do nicho
.post-body: eyebrow (categoria) + title (hook principal, CAIXA ALTA, até 8 palavras) + divider + desc (insight principal, 1-2 frases) + opcional: stat (número impactante + label)
.post-footer: handle + CTA texto ("Salva esse post →")
Adicione .post-accent-bar como elemento de design.

${WRITING_RULES}`;

    // ── BANNER ────────────────────────────────────────────────────────────────
    case 'banner': return `
Gere 1 banner digital (1200×628px) para uso em sites, LinkedIn e anúncios.
Retorne APENAS HTML. Comece com <!DOCTYPE html>, sem markdown.

━━━ CSS TEMPLATE OBRIGATÓRIO ━━━
<link href="${GOOGLE_FONTS}" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1200px; height:628px; overflow:hidden; }
  .banner {
    width:1200px; height:628px; position:relative; overflow:hidden;
    font-family:'Inter',sans-serif;
    background: linear-gradient(120deg, ${bg} 0%, ${bg} 55%, ${primary}44 100%);
    display:grid; grid-template-columns:1fr 420px; align-items:center;
    padding:60px 72px;
    gap:48px;
  }
  .banner-left { display:flex; flex-direction:column; gap:24px; }
  .banner-tag { font-size:16px; font-weight:700; color:${accent}; text-transform:uppercase; letter-spacing:2px; }
  .banner-title { font-family:'Bebas Neue',sans-serif; font-size:80px; line-height:.9; color:#fff; text-transform:uppercase; }
  .banner-title span { color:${accent}; }
  .banner-desc { font-size:22px; color:rgba(255,255,255,.65); line-height:1.5; max-width:580px; }
  .banner-cta { display:inline-flex; align-items:center; gap:12px; background:${accent}; color:#fff; font-size:20px; font-weight:700; padding:18px 36px; border-radius:8px; width:fit-content; }
  .banner-right { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:20px; }
  .banner-stat-box { text-align:center; }
  .banner-stat { font-family:'Bebas Neue',sans-serif; font-size:96px; color:${accent}; line-height:1; }
  .banner-stat-label { font-size:20px; color:rgba(255,255,255,.55); font-weight:500; }
  .banner-brand { font-size:18px; font-weight:600; color:rgba(255,255,255,.35); margin-top:auto; }
  /* Decoração */
  .banner-circle { position:absolute; right:-80px; top:-80px; width:380px; height:380px; background:${accent}11; border-radius:50%; border:2px solid ${accent}22; }
</style>

━━━ ESTRUTURA DO BANNER ━━━
.banner-left: tag (categoria) + title (promessa principal) + desc (benefício concreto) + cta-box (ação direta)
.banner-right: stat-box com número impactante + label + brand (logo/nome)
Adicione .banner-circle como decoração.
${brandName ? `Use "${brandName}" como nome da marca no banner.` : ''}

${WRITING_RULES}`;

    // ── LOGO ──────────────────────────────────────────────────────────────────
    case 'logo': return `
Gere 1 conceito de logo (800×800px) usando apenas HTML/CSS/SVG. Zero imagens externas.
Retorne APENAS HTML. Comece com <!DOCTYPE html>, sem markdown.

━━━ REGRAS DO LOGO ━━━
- Use SVG inline, formas CSS puras ou combinação dos dois
- O símbolo deve ser memorável e específico para o setor/nicho
- Tipografia: nome da marca em destaque com peso forte
- Cores: use a paleta do brand kit — primary=${primary}, accent=${accent}
- Fundo: ${bg} (cor escura da paleta) ou transparente
- O logo deve funcionar em fundo claro e escuro (use versão no fundo da paleta)

━━━ ESTRUTURA SUGERIDA ━━━
Container: 800×800px centralizado (display:flex, align-items:center, justify-content:center)
Símbolo: SVG ou formas CSS representando o setor (ex: saúde → coração/cruz, tech → chip/código, fitness → relâmpago)
Nome: fonte bold/black, 60-90px, cor branca ou accent
Tagline: fonte light, 24px, cor rgba(255,255,255,0.5) — opcional

━━━ CSS BASE ━━━
<link href="${GOOGLE_FONTS}" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:800px; height:800px; background:${bg}; display:flex; align-items:center; justify-content:center; }
  .logo-wrap { display:flex; flex-direction:column; align-items:center; gap:24px; }
  .logo-symbol { /* Defina o símbolo aqui com SVG inline ou CSS shapes */ }
  .logo-name { font-family:'Space Grotesk','Inter',sans-serif; font-weight:700; font-size:72px; color:#fff; letter-spacing:-1px; }
  .logo-name span { color:${accent}; }
  .logo-tagline { font-size:22px; color:rgba(255,255,255,.4); font-weight:400; letter-spacing:3px; text-transform:uppercase; }
</style>
${brandName ? `\nNome da marca: "${brandName}" — use exatamente este nome no logo.` : ''}`;

    // ── THUMBNAIL ─────────────────────────────────────────────────────────────
    case 'thumbnail': return `
Gere 1 thumbnail para YouTube (1280×720px). Extremamente chamativo — deve funcionar em 120px de largura.
Retorne APENAS HTML. Comece com <!DOCTYPE html>, sem markdown.

━━━ REGRAS ABSOLUTAS ━━━
- Título: máximo 6 palavras, fonte gigante (90-120px), CAIXA ALTA
- Contraste máximo — texto branco/amarelo em fundo escuro ou vice-versa
- Elemento visual de apoio (número grande, emoji, ícone SVG, seta, borda colorida)
- Leitura imediata: alguém passando pelos vídeos deve capturar o tema em 0.5 segundos

━━━ CSS TEMPLATE OBRIGATÓRIO ━━━
<link href="${GOOGLE_FONTS}" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1280px; height:720px; overflow:hidden; }
  .thumb {
    width:1280px; height:720px; position:relative; overflow:hidden;
    font-family:'Bebas Neue','Inter',sans-serif;
    background: linear-gradient(135deg, ${bg} 0%, ${primary} 100%);
    display:flex; align-items:center;
    padding:60px 80px;
    gap:60px;
  }
  .thumb-left { display:flex; flex-direction:column; gap:20px; flex:1; }
  .thumb-eyebrow { font-family:'Space Grotesk',sans-serif; font-size:24px; font-weight:700; color:${accent}; text-transform:uppercase; letter-spacing:2px; }
  .thumb-title { font-family:'Bebas Neue',sans-serif; font-size:116px; line-height:.88; color:#fff; text-transform:uppercase; }
  .thumb-title span.hl { color:${accent}; }
  .thumb-title span.bg { background:${accent}; padding:4px 20px; display:inline-block; }
  .thumb-sub { font-family:'Inter',sans-serif; font-size:32px; font-weight:600; color:rgba(255,255,255,.7); max-width:560px; line-height:1.3; }
  .thumb-right { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; }
  .thumb-big-num { font-family:'Bebas Neue',sans-serif; font-size:200px; color:${accent}; line-height:1; text-shadow: 6px 6px 0 rgba(0,0,0,.4); }
  .thumb-brand { font-family:'Space Grotesk',sans-serif; font-size:22px; font-weight:600; color:rgba(255,255,255,.4); }
  /* Decoração */
  .thumb-stripe { position:absolute; top:0; bottom:0; right:480px; width:8px; background:${accent}; opacity:.6; }
  .thumb-glow { position:absolute; right:0; top:0; width:600px; height:100%; background:radial-gradient(ellipse at right center, ${accent}22 0%, transparent 70%); }
</style>

━━━ ESTRUTURA DO THUMBNAIL ━━━
.thumb-left: eyebrow (categoria/canal) + title (3-6 palavras em CAIXA ALTA, palavra-chave em span.hl ou span.bg) + sub (benefício concreto)
.thumb-right: big-num (número impactante do conteúdo, ex: "5", "47%", "R$1k") + brand (${handle})
Adicione .thumb-stripe e .thumb-glow como decoração.
${brandName ? `Canal/marca: "${brandName}".` : ''}

${WRITING_RULES}`;

    default: return formatInstructions('post', brandKit, contextData);
  }
}

// ─── Build do contexto a partir de ideia ou trend ────────────────────────────

function buildContext(contextType, contextData) {
  if (contextType === 'idea' && contextData) {
    return `
━━━ CONTEXTO: IDEIA GERADA PELO VIRALОС ━━━
Título: "${contextData.title}"
Hook: "${contextData.hook}"
Formato: ${contextData.format} | Funil: ${contextData.funnelStage} | Emoção: ${contextData.emotion}
CTA: "${contextData.cta}"
Por que funciona: ${contextData.whyItWorks}
Viral Score: ${contextData.viralScore}/10
${contextData.slideOutline?.length ? `Estrutura sugerida:\n${contextData.slideOutline.map((s,i)=>`  ${i+1}. ${s}`).join('\n')}` : ''}

Use o hook, a emoção e o CTA desta ideia. Não invente — adapte o conteúdo existente para o design.`;
  }

  if (contextType === 'trend' && contextData) {
    return `
━━━ CONTEXTO: TREND DO RADAR VIRAL ━━━
Título viral: "${contextData.titulo_viral}"
Tema: ${contextData.tema} | Fonte: ${contextData.fonte}
Ângulo viral: ${contextData.angulo_viral}
Hook: "${contextData.hook_reels}"
Emoção: ${contextData.emocao}
Pontos-chave:
${(contextData.pontos_chave||[]).map(p=>`  • ${p}`).join('\n')}
Viral Score: ${contextData.score_viral}/10 — ${contextData.por_que_funciona}

Adapte este trend. Use o título viral, o hook e os pontos-chave como conteúdo real. Não generalize.`;
  }

  return '';
}

// ─── Build do contexto de Brand Kit ──────────────────────────────────────────

function buildBrandKitContext(brandKit) {
  if (!brandKit) return '';
  return `
━━━ BRAND KIT ━━━
Marca: ${brandKit.brandName || brandKit.name}${brandKit.industry ? ` (${brandKit.industry})` : ''}
Tom de voz: ${brandKit.contentTone || 'Profissional'}
Estilo visual: ${brandKit.designStyle || 'Moderno'}
Fonte: ${brandKit.fontStyle || 'Sans-serif moderna'}
Público: ${brandKit.targetAudience || '—'}
Produto/serviço: ${brandKit.aboutProduct || '—'}
Diferencial: ${brandKit.differentiator || '—'}
${brandKit.palette?.length ? `Paleta: ${brandKit.palette.join(', ')}` : ''}
${brandKit.instagramHandle ? `Handle: @${brandKit.instagramHandle.replace('@','')}` : ''}

Aplique as cores da paleta e o tom de voz em todo o design. Não use cores que não estejam na paleta.`;
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(format, brandKit, contextType, contextData) {
  return `Você é o Studio de Criação do ViralOS — gera designs profissionais HTML/CSS para criadores brasileiros.

## RESPOSTA OBRIGATÓRIA
Sempre responda nesta ordem exata:

1. Uma frase em pt-BR descrevendo o que foi criado (sem markdown)
2. Bloco HTML:
\`\`\`html
[HTML/CSS completo]
\`\`\`
3. **Legenda:** [legenda com emojis, tom do nicho, 3-5 linhas]
4. **Hashtags:** [15-20 hashtags sem #, separadas por espaço]

## INSTRUÇÕES TÉCNICAS
${formatInstructions(format, brandKit, contextData)}

${buildBrandKitContext(brandKit)}
${buildContext(contextType, contextData)}

## QUALIDADE OBRIGATÓRIA
- Sem placeholder genérico ("Título aqui", "Lorem ipsum") — use conteúdo real do contexto
- Sem JavaScript para renderizar — CSS puro apenas
- HTML standalone que funcione em iframe
- Retorne APENAS o bloco HTML completo dentro do code fence — sem texto extra dentro do HTML`;
}

// ─── Geração com streaming SSE ────────────────────────────────────────────────

async function generateDesignStream(res, { format, brandKit, contextType, contextData, messages, userMessage }) {
  const systemPrompt = buildSystemPrompt(format, brandKit, contextType, contextData);

  const claudeMessages = [
    ...messages.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let fullText = '';

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system: systemPrompt,
      messages: claudeMessages,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        const text = chunk.delta.text;
        fullText += text;
        res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
      }
    }

    const parsed = parseGeneratedContent(fullText);
    res.write(`data: ${JSON.stringify({ type: 'done', ...parsed, fullText })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
  } finally {
    res.end();
  }
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseGeneratedContent(text) {
  const htmlMatch = text.match(/```html\s*([\s\S]*?)```/i);
  const htmlContent = htmlMatch ? htmlMatch[1].trim() : null;

  const captionMatch = text.match(/\*\*Legenda:\*\*\s*([\s\S]*?)(?=\*\*Hashtags:|$)/i);
  const caption = captionMatch ? captionMatch[1].trim() : '';

  const hashtagsMatch = text.match(/\*\*Hashtags:\*\*\s*([\s\S]*?)$/i);
  const hashtags = (hashtagsMatch?.[1] || '')
    .split(/[\s,]+/)
    .map(h => h.replace(/^#/, '').trim())
    .filter(Boolean);

  const conversationText = text
    .replace(/```html[\s\S]*?```/gi, '✦ Design gerado')
    .replace(/\*\*Legenda:\*\*[\s\S]*?(?=\*\*Hashtags:|$)/gi, '')
    .replace(/\*\*Hashtags:\*\*[\s\S]*/gi, '')
    .trim();

  return { htmlContent, caption, hashtags, conversationText };
}

module.exports = { generateDesignStream, parseGeneratedContent, FORMAT_DIMENSIONS };
