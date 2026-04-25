# Template `fmteam` — Fabricio Moura (Consultoria Esportiva)

**Versão 2.0 — guia complementar aos arquivos BrandsDecoded.**

Quando o usuário escolher `template: fmteam` no briefing, este guia **substitui** o design system padrão (mantendo a metodologia editorial BrandsDecoded — headlines, espinha, validação, anti-AI slop). É APENAS uma calibração visual.

---

## 1. IDENTIDADE FIXA (nunca alterar)

| Elemento | Valor |
|---|---|
| Fonte headline | Barlow Condensed 800/900 |
| Fonte body | Plus Jakarta Sans 400/700/800 |
| Cor primária | `#FFC300` (amarelo dourado) |
| Cor escura | `#B8860B` |
| Cor clara | `#FFD54F` |
| Gradiente da marca | `linear-gradient(165deg, #B8860B 0%, #FFC300 50%, #FFD54F 100%)` |
| Handle | @fabriciomourateam |
| Nicho | Consultoria Esportiva |

**Cores dos fundos de slides:** podem variar por tema. O padrão alternado dark/light é referência, não regra rígida.

---

## 2. ELEMENTOS FIXOS EM TODOS OS SLIDES

Estes elementos aparecem **sempre**, em todos os slides:

- **Accent bar superior**: barra de 7px de altura no topo do slide com o gradiente da marca (`linear-gradient(90deg, #B8860B, #FFC300, #FFD54F)`).
- **Brand bar**: logo abaixo da accent bar, em texto pequeno tracking-wide:
  - À esquerda: `@FABRICIOMOURATEAM` (uppercase, font-size ~13px, cor `rgba(255,255,255,0.5)` no dark / `#666` no light)
  - À direita: `2026` (mesma fonte/cor)
  - **NUNCA escreva "Powered by Content Machine"**, **NUNCA escreva "Powered by"** — apenas o handle e o ano.
- **Progress bar inferior**: barra fina (~3px) no rodapé com fill em `#FFC300` proporcional ao slide atual (`{slide_atual}/{total}` no canto direito do rodapé, mesma fonte da brand bar).
- **Sem swipe arrow.** Não inclua hint "deslize", setas ou ícones de navegação no template.

---

## 3. CAPA (Slide 1) — sempre

- **Foto de fundo full-bleed** relacionada ao tema do carrossel — usar placeholder `PEXELS:query-em-ingles` (orientation portrait).
- **Gradiente escuro de baixo pra cima** sobre a foto, garantindo contraste do texto:
  ```
  linear-gradient(180deg, transparent 0%, transparent 30%, rgba(0,0,0,0.4) 55%, rgba(0,0,0,0.92) 100%)
  ```
- **Profile badge no terço inferior** (acima da headline):
  - Avatar circular com **anel gradiente Instagram**: `conic-gradient(from 45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888, #f09433)` ou `linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)` aplicado em `padding: 3px` ao redor de `<img src="{{AVATAR_B64}}">`.
  - Ao lado do avatar: nome **`Fabricio Moura`** em branco (Plus Jakarta Sans 700, ~26px) + **selo verificado azul** (SVG inline do check verificado do Twitter/X).
  - Abaixo do nome: `@fabriciomourateam` em branco com 60% opacity (~20px).
- **Headline** logo abaixo do badge, **uppercase**, Barlow Condensed 800, tamanhos generosos (90–110px), **palavras-chave em `#FFC300`** (use `<em style="color:#FFC300;font-style:normal;">PALAVRA</em>`).

### SVG do selo verificado (use literal no HTML)

```html
<svg width="28" height="28" viewBox="0 0 24 24" fill="#1D9BF0" style="display:inline-block;vertical-align:middle;margin-left:4px;">
  <path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"/>
</svg>
```

---

## 4. SLIDES INTERNOS — layout flexível

Cada slide recebe o layout que ficar **mais bonito para aquele conteúdo específico**. Não existe sequência obrigatória.

**Opções de layout** (escolha o melhor por slide):

| Layout | Quando usar |
|---|---|
| **img-box no topo + texto abaixo** | Slide com menos texto, espaço sobrando. Img-box é landscape com border-radius generoso (~24px), altura ~40% do slide. |
| **Texto puro (sem img-box)** | Slide denso, muito conteúdo. Headline + 2-3 parágrafos com frase-chave em **bold branco**. |
| **Tabela de dados** | Comparações com 3+ itens. Bordas finas em `rgba(255,255,255,0.1)` (dark) ou `rgba(0,0,0,0.1)` (light). Header em `#FFC300`. |
| **Big stat + label** | Um único número protagonista (Barlow 200–280px) + label curta abaixo. |
| **Arrow rows** | Lista de 2-3 pontos sequenciais. Cada linha começa com `→` em `#FFC300`, depois trecho em **bold** + complemento em peso 400. |

**Estrutura textual de cada slide interno:**

1. **Tag de seção** acima da headline: caps minúsculo tracking ~3px, font-size ~14px, cor `#FFC300` (ex: `O PARADOXO`, `COMO FUNCIONA`, `O PRÉ-REQUISITO`).
2. **Headline** Barlow Condensed 800, uppercase, ~85–105px, com 1 palavra em `#FFC300` ou com ponto final em `#FFC300` (ex: `O SENSO COMUM ESTÁ <em>ERRADO.</em>`).
3. **Body**: Plus Jakarta Sans 400, ~26–30px, line-height 1.4. Cor do body em `rgba(255,255,255,0.62)` no dark / `#3a3a3a` no light. Frase-chave em **bold branco** (dark) ou **bold preto** (light).
4. **Número decorativo gigante** no canto inferior direito: Barlow Condensed 800, ~360px, cor `rgba(255,195,0,0.08)` (quase transparente, atrás do conteúdo). Mostra o número do slide.

**Fotos**: buscar via Pexels com query relacionada ao tema do slide. **Landscape para img-box** (orientação landscape), **portrait para fundo full-bleed** com overlay.

---

## 5. SLIDE CTA (último slide) — sempre

- **Fundo**: fundo do CTA via `background-image: url('{{CTABG_B64}}')` (asset embutido — foto do Fabricio).
- **Overlay dark progressivo de cima pra baixo**:
  ```
  linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.55) 60%, rgba(0,0,0,0.92) 100%)
  ```
- **Frase-ponte** logo acima do CTA, conectando o conteúdo do carrossel ao convite. Plus Jakarta Sans 400, ~28px, branco com ~70% opacity. Frase-chave em `bold branco`.
- **CTA principal** em duas linhas:
  - Linha 1 (pergunta): `QUAL É A SUA <em style="color:#FFC300;">ESTRATÉGIA?</em>` (Barlow Condensed 800, ~92px, uppercase). A última palavra OU a palavra-pergunta em `#FFC300`.
- **CTA box** com borda dourada sutil:
  ```
  border: 1.5px solid rgba(255,195,0,0.55);
  border-radius: 16px;
  padding: 28px 36px;
  ```
  Conteúdo:
  - Linha pequena no topo: `Comenta a palavra abaixo:` (Plus Jakarta Sans 400, ~22px, `rgba(255,255,255,0.72)`).
  - **Keyword grande**: a palavra do CTA em Barlow Condensed 800, uppercase, ~88px, cor `#FFC300` (ex: `SHAPE`).
  - Linha pequena abaixo: `e me segue para mais conteúdos.` (Plus Jakarta Sans 400, ~20px, `rgba(255,255,255,0.72)`).
- **Rodapé do CTA**: foto circular pequena do Fabricio com **anel Instagram** (mesmo estilo da capa) + texto `@fabriciomourateam · Consultoria Esportiva` em `rgba(255,255,255,0.6)`, ~18px.

---

## 6. CHECKLIST OBRIGATÓRIO (auto-validar antes de retornar HTML)

- [ ] Brand bar tem APENAS `@fabriciomourateam` + `2026` — **sem** "Powered by"
- [ ] Accent bar de 7px no topo de TODOS os slides
- [ ] Progress bar no rodapé de TODOS os slides com fill em `#FFC300`
- [ ] Capa tem profile badge com avatar + anel Instagram + nome + check verificado azul
- [ ] CTA usa o asset `{{CTABG_B64}}` como fundo
- [ ] CTA tem rodapé com mini-avatar do Fabricio com anel Instagram
- [ ] Cor primária `#FFC300` aplicada em palavras-chave da capa, tags de seção, headlines internas, número do CTA
- [ ] Sem swipe arrow / hint de "deslize"
- [ ] Slides 1080×1350 nativos (sem transform/scale)
- [ ] Fontes embutidas via `@font-face` com placeholders `{{BARLOW_B64}}` / `{{PJS400_B64}}` / `{{PJS700_B64}}` / `{{PJS800_B64}}`

---

## 7. O QUE PODE VARIAR ENTRE CARROSSÉIS

- Número de slides (5/7/9/12 conforme tema)
- Cores dos fundos dos slides internos (alternar dark/cream/yellow conforme couber melhor)
- Presença ou não de img-box por slide
- Layout de cada slide (tabela / big stat / arrow rows / texto puro / img-box+texto)
- Queries das fotos do Pexels
- Headline e copy (sempre seguindo metodologia BrandsDecoded — headlines, espinha, validação 7-parâmetros, anti-AI slop)

## O QUE NUNCA MUDA

- Fontes Barlow Condensed (headline) + Plus Jakarta Sans (body)
- Cor primária `#FFC300`
- Brand bar `@fabriciomourateam` + `2026` (nunca "Powered by")
- Profile badge da capa (avatar + anel Instagram + check verificado)
- Fundo do CTA (`{{CTABG_B64}}`)
- Rodapé do CTA com mini-avatar
- Accent bar de 7px no topo
- Progress bar com fill `#FFC300` no rodapé
