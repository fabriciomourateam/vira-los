# Guia fmteam — Fabricio Moura (@fabriciomourateam)
Versão 3.0 — calibração visual para o template fmteam.

Quando o usuário escolher `template: fmteam` no briefing, este guia **substitui** o design system padrão (mantendo a metodologia editorial BrandsDecoded — headlines, espinha, validação, anti-AI slop).

---

## 1. IDENTIDADE FIXA

| Elemento | Valor |
|---|---|
| Fonte headline | Barlow Condensed 800 |
| Fonte body | Plus Jakarta Sans 400 (700 para `<strong>`/destaques) |
| Cor primária | `#FFC300` (amarelo dourado) |
| Cor escura | `#B8860B` |
| Cor clara | `#FFD54F` |
| Gradiente | `165deg, #B8860B → #FFC300 → #FFD54F` |
| Fundo dark | `#0A0A0A` |
| Fundo light | `#F5F0E0` |
| Handle | @fabriciomourateam |
| Nicho | Consultoria Esportiva |
| Ano brand bar | 2026 |

---

## 2. ELEMENTOS FIXOS EM TODOS OS SLIDES

- **Accent bar:** 7px no topo, gradiente `#B8860B → #FFC300 → #FFD54F`
- **Brand bar:** `@FABRICIOMOURATEAM` à esquerda + `2026` à direita — NADA mais
- **Progress bar:** rodapé; fill `#FFC300` nos slides dark, `#B8860B` nos light, `#fff` no gradient
- **SEM swipe arrow** em nenhum slide
- **SEM badge de tipo** (ANÁLISE, TENDÊNCIA etc.) em NENHUM slide, incluindo a capa

---

## 3. CAPA (Slide 1)

- Foto de fundo full-bleed **portrait** (Pexels, query temática)
- Overlay: `rgba(0,0,0,0.05) 0% → rgba(0,0,0,0.97) 100%`
- Badge Instagram no terço inferior antes da headline:
  - Foto circular com anel gradiente Instagram (laranja → rosa → roxo)
  - Nome "Fabricio Moura" + selo verificado azul (SVG inline)
  - Handle `@fabriciomourateam`
- **Headline:** Barlow Condensed 800, **80px**, letter-spacing -2.5px, uppercase, máx 12 palavras
  - 1–2 palavras-chave em `#FFC300` via `<em class="hl">`
  - Quebra de linha manual para isolar frase de efeito

---

## 4. SLIDES INTERNOS (2 ao penúltimo)

### Img-box — OBRIGATÓRIO em TODOS

- Topo do slide, altura **300px**, border-radius 20px
- Foto **landscape** via Pexels (query temática por slide, nunca repetida)
- Overlay sutil no rodapé da img-box: `rgba(0,0,0,0.2)`

### Headline interna — OBRIGATÓRIO

- Barlow Condensed 800, **88px**, letter-spacing **-3px**, line-height **0.92**
- Máximo **2 linhas**
- Palavra-chave principal sempre em `#FFC300` via `<em class="hl">`

Exemplos corretos:
```
<em class="hl">DÉFICIT</em><br>QUE SABOTA
PROTEÍNA:<br>O <em class="hl">CÁLCULO</em> MUDOU
SEM EXAME,<br>AJUSTE É <em class="hl">CHUTE</em>
```

### Body text

- Plus Jakarta Sans 400, **30px**, line-height 1.5
- Máximo **2 blocos** por slide
- Dark: `rgba(255,255,255,0.78)` | Light: `rgba(15,13,12,0.72)` | Gradient: `rgba(255,255,255,0.85)`

### Sequência de fundos (referência 9 slides)

| Slide | Fundo |
|---|---|
| 1 | Capa (foto full-bleed) |
| 2 | Dark `#0A0A0A` |
| 3 | Light `#F5F0E0` |
| 4 | Dark |
| 5 | Light |
| 6 | Dark |
| 7 | Light |
| 8 | Gradient `165deg, #B8860B → #FFC300 → #FFD54F` |
| 9 | CTA (foto full-bleed) |

Para outros números: dark/light alternando, gradient no penúltimo de conteúdo, CTA no último.

---

## 5. SLIDE CTA (último)

- Foto de fundo **portrait** via Pexels
- Overlay: `rgba(0,0,0,0.5) → rgba(0,0,0,0.93)`
- **Frase-ponte** específica ao tema (não genérica)
- CTA box: borda `rgba(255,195,0,0.35)`, fundo `rgba(0,0,0,0.3)`
  - "Comenta a palavra abaixo:" — 20px, `rgba(255,255,255,0.65)`
  - **KEYWORD** — Barlow Condensed 800, 72px, `#FFC300`
  - Benefício direto — 20px, `rgba(255,255,255,0.65)`
- Rodapé: foto circular com anel Instagram + `@fabriciomourateam · Consultoria Esportiva`

---

## 6. REGRAS ABSOLUTAS

1. Barlow Condensed 800 para TODAS as headlines
2. Plus Jakarta Sans para body (400 normal, 700 para strong)
3. Cor primária `#FFC300`
4. Badge Instagram na capa: foto + anel + verificado + handle
5. **SEM badge de tipo em NENHUM slide**
6. Headlines internas: 88px, máx 2 linhas, palavra-chave em amarelo — SEMPRE
7. Img-box em TODOS os slides internos (300px, landscape, border-radius 20px)
8. Brand bar: apenas `@FABRICIOMOURATEAM` + `2026`
9. Rodapé CTA: foto circular + `@fabriciomourateam · Consultoria Esportiva`
10. Fotos via Pexels — portrait para capa/CTA, landscape para internos
