# Rubrica de decupagem de reel (por vídeo)

Objetivo: entender 100% o FORMATO de edição/gravação do reel, pra virar uma skill que reproduz esse formato
com um clone IA (Fabricio, treinador, vendendo consultoria/mentoria). Não é sobre o conteúdo do criador;
é sobre COMO o vídeo é feito e POR QUE cada escolha funciona.

## Material disponível na pasta do vídeo (já gerado)
- video.mp4, audio.wav (16 kHz mono; pode não existir se o vídeo veio sem áudio)
- meta.json (duração, resolução, fps), cuts.json (cortes com score: <0.4 = jump cut/zoom, >=0.4 = troca de cena)
- sheet_planos.jpg (1 frame no meio de cada plano, com "Pn de-até s"), sheet_1s.jpg (1 frame/s, com "Ns")
- frames/plano###.jpg e frames/s###.jpg (360px de largura)
- transcript.json (Whisper, segmentos + palavras com tempo)
- audio.json: energia a cada 50 ms (energia_50ms_db), picos_candidatos_sfx (t, db, salto_db, durante_fala),
  trechos_sem_fala (silencio vs som_sem_fala), piso_db_durante_fala (> -35 dB sugere trilha por baixo), fala (ppm, pausas)

## Ferramentas pra aprofundar (use à vontade, sempre com saída dentro da pasta do vídeo/zoom/)
- Frame em alta: ffmpeg -v error -ss T -i video.mp4 -frames:v 1 zoom/f_T.jpg (sem scale, 720/1080 px) — pra ler fonte/cor/tamanho do texto
- Animação: ffmpeg -v error -ss T -t 0.8 -i video.mp4 -vf "fps=15,scale=360:-2,tile=6x2" -frames:v 1 zoom/anim_T.jpg — pra ver como o texto/imagem ENTRA (pop/scale, fade, slide, typewriter, sem animação) e se há zoom/shake
- Cor: python3 com PIL pra medir média/saturação/temperatura de alguns frames (R-B médio etc.)
- SFX: os picos não identificam o tipo. Cruze o tempo de cada pico com cortes (cuts.json), entrada de headline/imagem (frames) e palavras (transcript).
  Pico colado (<0.25 s) num corte/entrada de elemento = SFX de transição/entrada provável. Pra caracterizar, recorte 0.4 s em volta
  (numpy FFT no audio.wav): ruído largo subindo/descendo ~0.2-0.5 s = whoosh; transiente curtíssimo agudo = pop/click/tick;
  tonal com cauda = ding/chime; grave forte = impacto/boom. Diga o grau de confiança. Também confira se há música por baixo
  (piso de energia nas pausas/som_sem_fala) e se ela muda/para em algum momento (ex.: virada, CTA).

## Entregável: escreva <pasta do vídeo>/DECUPAGEM.md com estas seções (em português, objetivo, com tempos em segundos)
1. Ficha — duração, resolução, nicho/tema, tipo (storytelling pessoal, dica/tutorial, educativo, venda), objetivo do vídeo.
2. Roteiro e copy — transcrição dividida em blocos com tempo (GANCHO 0-3 s, contexto, conflito/virada, prova/resultado, lição, CTA);
   tipo de gancho (número/resultado, confissão, pergunta, contraste, polêmica); tamanho das frases; palavras por minuto; pausas; tom/energia;
   o que faz o espectador ficar até o fim (open loops, "e quer saber?", etc.). Cite as frases-chave literais.
3. Câmera e gravação — selfie na mão vs tripé; distância e enquadramento (close/médio, onde fica o rosto na tela: terço superior/centro);
   altura e ângulo; olhar (lente?); movimento (tremor de mão, respiração, enquadramento muda entre planos?); postura (sentado/em pé);
   ambiente/fundo (o que aparece, desfoque, profundidade); luz (janela, ring light, quente/fria, lado); figurino; objetos na mão; gestos.
4. Cortes e ritmo — nº de planos, duração média/mín/máx, padrão (jump cut a cada frase? punch-in/zoom alternado entre planos — compare o
   tamanho do rosto entre planos vizinhos), trechos longos sem corte e por quê, cortes que removem respiração/pausa, trocas de cena/B-roll.
5. Texto na tela — (a) HEADLINE/título de bloco: posição exata, fonte (serifa/sem serifa, peso, itálico), caixa, cor, contorno/sombra/caixa
   de fundo, tamanho relativo, nº de linhas, emoji, com que frequência troca, se troca junto com o corte, se resume ou repete a fala,
   lista TODAS com tempo. (b) LEGENDA da fala: existe? palavra-a-palavra/karaokê ou frase? posição, fonte, cor, destaque de palavra-chave.
   (c) CTA/elementos fixos (ex.: "Segue para continuar acompanhando"). (d) Quando NÃO tem texto e por quê.
6. Imagens e overlays — lista com tempo: o que é (foto real, print, logo, sticker, memoji, vídeo B-roll, ícone), posição, tamanho
   (% da tela), duração, como entra/sai, qual palavra da fala dispara, e se substitui o rosto (tela cheia) ou fica em cima (inset).
7. Áudio e SFX — tabela de SFX prováveis (tempo, tipo, confiança, o que acontece na imagem naquele momento); música de fundo
   (tem? volume relativo, estilo provável, muda onde?); silêncios intencionais; momentos SEM SFX (ex.: trechos emocionais).
8. Cor e acabamento — temperatura, contraste, saturação, look (natural de celular vs color grade), grão, nitidez, consistência.
9. Animações/motion — como headlines/legendas/imagens entram (pop com escala, fade, slide, typewriter), velocidade, zoom digital,
   shake, transições entre planos (corte seco vs transição).
10. O que NÃO tem — o que esse formato evita de propósito (ex.: vinheta, logo, música alta, B-roll de banco, transições chamativas).
11. Regras extraídas — 10 a 20 regras "SE/QUANDO … ENTÃO …" reaproveitáveis, cada uma com o tempo que a comprova.
