# mLabs — agendamento automático (setup)

O ViralOS agenda carrosséis/reels no mLabs dirigindo um Chrome headless e replicando o
fluxo real do app (`/files/ingest` → `PUT` no S3 → `POST /schedules` com todas as datas de
uma vez). Mapeado a partir do HAR do fluxo de agendamento.

## 1. Secrets (Fly) — nunca commitar

```bash
fly secrets set MLABS_EMAIL='fabriciohermes@gmail.com' -a vira-los
fly secrets set MLABS_PASSWORD='...'                    -a vira-los
```

> Conta **dedicada** de automação (sub-usuário sacrificial). Não use a conta principal.

### Browserless (OPCIONAL)

O servidor já vem com Chromium + Playwright, então por padrão ele **lança o Chrome local** —
zero infra extra. Só configure um Browserless separado se quiser isolar o navegador:

```bash
fly secrets set BROWSERLESS_WS_URL='ws://viralos-browserless.internal:3000' -a vira-los
fly secrets set BROWSERLESS_TOKEN='...' -a vira-los   # se o seu Browserless exigir token
```

Sem `BROWSERLESS_WS_URL`, usa o Chromium local. Com, conecta no remoto (Playwright protocol,
com fallback CDP).

## 2. Primeira vez: semear sessão + calibrar

O login do mLabs tem **captcha**, que bloqueia login 100% headless. Por isso a sessão é
**semeada uma vez** a partir de um login manual e depois renovada sozinha (`persistent:true`).

### 2a. Semear a sessão (cookies do seu login)

1. Logue no mLabs no seu navegador (conta dedicada).
2. Exporte o `storageState` (DevTools → Application → Cookies, ou a extensão "EditThisCookie",
   ou rode `playwright codegen --save-storage`).
3. Mande pro ViralOS:

```bash
curl -X POST https://vira-los.fly.dev/api/mlabs/session \
  -H 'content-type: application/json' \
  -d @storageState.json
```

### 2b. Calibrar (aprende perfil, canais e auth do app real)

```bash
curl -X POST https://vira-los.fly.dev/api/mlabs/calibrate
```

Isso abre o app logado, observa as chamadas reais e grava nas settings: `profileId`,
`channelSourceIds` (as plataformas que você posta) e `ownerId`. Confere com:

```bash
curl https://vira-los.fly.dev/api/mlabs/settings
```

## 3. Agendar

```bash
# carrossel em 4 datas (usa as datas padrão se não mandar "dates")
curl -X POST https://vira-los.fly.dev/api/mlabs/schedule \
  -H 'content-type: application/json' \
  -d '{"contentType":"carousel","contentId":"carousel_..._testo-baixa"}'

# datas/horas próprias (hora local SP, AAAA-MM-DDTHH:MM)
curl -X POST https://vira-los.fly.dev/api/mlabs/schedule \
  -H 'content-type: application/json' \
  -d '{"contentType":"carousel","contentId":"...","dates":["2026-06-29T11:00","2026-09-29T11:00","2026-12-29T11:00","2027-03-29T11:00"]}'
```

Reel: primeiro suba o `.mp4` editado, depois agende:

```bash
curl -X POST https://vira-los.fly.dev/api/mlabs/upload-reel/REEL_ID -F video=@reel.mp4
curl -X POST https://vira-los.fly.dev/api/mlabs/schedule \
  -H 'content-type: application/json' -d '{"contentType":"reel","contentId":"REEL_ID"}'
```

## 4. Ver o que foi agendado

```bash
curl https://vira-los.fly.dev/api/mlabs/agendados
```

Cada envio fica registrado (conteúdo, datas, status `agendado`/`erro`). O mLabs é quem
publica nas datas — nada roda do nosso lado na hora do post.

## Configuração das datas padrão e auto-postagem

`PUT /api/mlabs/settings` aceita:

| campo | o quê |
|-------|-------|
| `defaultTime` | hora SP padrão, ex. `"11:00"` |
| `dateOffsetsMonths` | offsets em meses a partir de amanhã, ex. `[0,3,6,9]` → amanhã, +3, +6, +9 |
| `autoScheduleCarousel` | `true` = todo carrossel gerado é agendado automaticamente |
| `channelSourceIds` / `profileId` | sobrescreve o que a calibração achou |

## Notas

- Sessão expirou (captcha de novo)? Refaça o passo **2a**.
- O id numérico da mídia vem da resposta do `/files/ingest`. O HAR sanitizado não trazia os
  corpos de resposta; o serviço cobre os nomes de campo prováveis (`id`/`mediaId`/`imageId`)
  e a calibração/1º agendamento confirmam o certo. Se o 1º agendamento acusar "não achei o id",
  me manda a mensagem de erro que eu fecho o mapeamento.
