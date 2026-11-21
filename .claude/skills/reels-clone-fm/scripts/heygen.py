#!/usr/bin/env python3
"""Gera o vídeo do clone do Fabricio no HeyGen (avatar de foto + voz clonada dele).

Chave: env HEYGEN_API_KEY ou arquivo ~/.heygen/key (NUNCA commitar).
A API é cobrada numa carteira em USD à parte do plano do site (recarga mínima US$ 5).
Rede: liberar api.heygen.com, upload.heygen.com, files2.heygen.ai, resource2.heygen.ai.

Uso:
  python3 -I heygen.py --listar                         # avatares/looks e vozes da conta
  python3 -I heygen.py --texto roteiro.txt saida.mp4     # voz clonada do HeyGen lê o texto (PADRÃO)
  python3 -I heygen.py --audio voz.wav saida.mp4         # usa um áudio pronto (ex.: voz F do voz.py)
  opções: --look ID  --voz ID  --sem-avatar-iv  --titulo "..."
Saída: o mp4 cru do HeyGen (9:16, 720x1280). Depois: montar_reel.py.
"""
import argparse, json, os, sys, time, urllib.request

# Validado 21/11/2026: avatar de FOTO "Consultoria Esportiva FMTeam" (criado pelo site com a
# foto do vídeo de 43 s) + voz que o HeyGen clonou dele. Foi o que aprovou ("ficou muito bom").
LOOK_PADRAO = "38c2485afd8543d4aefb2762b4cffbf8"
VOZ_PADRAO = "7b825d5b33a44813a80b6ae192269ce9"
API = "https://api.heygen.com"


def chave():
    k = os.environ.get("HEYGEN_API_KEY") or open(os.path.expanduser("~/.heygen/key")).read().strip()
    return k


def req(method, url, body=None, ctype="application/json", raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    r = urllib.request.Request(url, data=data, method=method,
                               headers={"X-Api-Key": chave(), "Content-Type": ctype, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=300) as f:
            return json.loads(f.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"HeyGen {e.code}: {e.read().decode()[:500]}")


def listar():
    g = req("GET", f"{API}/v2/avatar_group.list?include_public=false")["data"]["avatar_group_list"]
    for x in g:
        print(f"[grupo] {x['id']}  {x['name']}  tipo={x['group_type']}  voz_padrão={x.get('default_voice_id')}")
        for a in req("GET", f"{API}/v2/avatar_group/{x['id']}/avatars")["data"]["avatar_list"]:
            print(f"    look {a.get('id') or a.get('avatar_id')}  {a.get('name') or a.get('avatar_name')}")
    print("saldo API:", req("GET", f"{API}/v3/users/me")["data"].get("wallet"))


def subir_audio(path):
    ct = "audio/mpeg" if path.lower().endswith(".mp3") else "audio/x-wav"
    d = req("POST", "https://upload.heygen.com/v1/asset", ctype=ct, raw=open(path, "rb").read())["data"]
    return d["id"]


def gerar(a):
    char = {"type": "talking_photo", "talking_photo_id": a.look}
    if not a.sem_avatar_iv:
        char["use_avatar_iv_model"] = True
    if a.audio:
        voice = {"type": "audio", "audio_asset_id": subir_audio(a.audio)}
    else:
        voice = {"type": "text", "voice_id": a.voz, "input_text": open(a.texto).read().strip()}
    body = {"title": a.titulo, "dimension": {"width": 720, "height": 1280},
            "video_inputs": [{"character": char, "voice": voice}]}
    r = req("POST", f"{API}/v2/video/generate", body)
    if r.get("error"):
        sys.exit(f"erro: {r['error']}")
    vid = r["data"]["video_id"]
    print("video_id", vid, flush=True)
    while True:
        time.sleep(20)
        d = req("GET", f"{API}/v3/videos/{vid}")["data"]
        print(time.strftime("%H:%M:%S"), d["status"], flush=True)
        if d["status"] == "completed":
            urllib.request.urlretrieve(d["video_url"], a.saida)
            print("ok", a.saida, d.get("duration"), "s")
            return
        if d["status"] in ("failed", "error"):
            sys.exit(f"falhou: {d}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--listar", action="store_true")
    p.add_argument("--texto"); p.add_argument("--audio"); p.add_argument("saida", nargs="?")
    p.add_argument("--look", default=LOOK_PADRAO); p.add_argument("--voz", default=VOZ_PADRAO)
    p.add_argument("--sem-avatar-iv", action="store_true"); p.add_argument("--titulo", default="reel clone FM")
    a = p.parse_args()
    if a.listar:
        listar()
    elif (a.texto or a.audio) and a.saida:
        gerar(a)
    else:
        p.print_help()
