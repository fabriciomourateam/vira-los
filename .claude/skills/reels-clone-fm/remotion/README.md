# Remotion — reel F1 (yap selfie)

Composição `Reel2` (1080x1920, 25 fps), dirigida por dados:
- `src/data/plano.json`: frases (`fala`, `headline`, `estilo` sans|serif|cta, `punch`, `de`/`ate` em s)
- `src/data/words.json`: palavras com tempo (legenda palavra a palavra, serifa, y≈83%)
- `src/data/config.json`: `video` (em `public/`), `audioSeparado` (false = usa o áudio do vídeo), `duracaoS`

Os três JSON e o `public/base.mp4` são gerados por `../scripts/montar_reel.py`.
Os JSON commitados são o exemplo validado (reel "3 perguntas", 21/11/2026); `roteiro_exemplo.json` é a entrada dele.

```bash
npm ci
CHROME_BIN=/opt/pw-browsers/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell \
  npx remotion render src/index.ts Reel2 out/reel.mp4 --codec h264 --concurrency 2 --gl=swangle
```

Fontes vêm do npm (`@fontsource/*`), sem Google Fonts. **Nunca commitar vídeo/áudio** (`public/`, `out/`): o repo é público.
