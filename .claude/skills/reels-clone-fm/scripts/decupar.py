#!/usr/bin/env python3
"""Decupagem técnica de reels (pré-análise pra Claude).

Uso:  python3 -I decupar.py links.txt OUT_DIR
  links.txt: 1 URL de reel por linha (ordem = mais recente primeiro).

Pra cada reel gera OUT_DIR/NN_<code>/:
  video.mp4          baixado via ViraLOS (/api/research/download-reel)
  audio.wav          16 kHz mono
  meta.json          duração, resolução, fps
  cuts.json          cortes de cena (tempo + score) e duração de cada plano
  frames/            1 frame por plano (meio do plano) + 1 frame a cada 1 s
  sheet_planos.jpg   contact sheet dos planos com timestamp
  sheet_1s.jpg       contact sheet 1 frame/s com timestamp
  transcript.json    Whisper: segmentos + palavras com tempo
  audio.json         energia a cada 50 ms, picos fora/sobre a fala (candidatos a SFX),
                     trechos sem fala com energia (candidatos a música/BG), silêncios,
                     ritmo de fala (palavras/min, pausas)
"""
import json, os, re, subprocess, sys, wave
import numpy as np

VIRALOS = "https://vira-los.fly.dev/api/research/download-reel"
_model = None


def sh(args, **kw):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kw)


def probe(path):
    out = sh(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", path]).stdout
    d = json.loads(out)
    v = next(s for s in d["streams"] if s["codec_type"] == "video")
    num, den = v.get("avg_frame_rate", "30/1").split("/")
    return {
        "duration": float(d["format"]["duration"]),
        "width": int(v["width"]), "height": int(v["height"]),
        "fps": round(float(num) / float(den or 1), 2),
        "has_audio": any(s["codec_type"] == "audio" for s in d["streams"]),
    }


def download(url, out):
    if os.path.exists(out) and os.path.getsize(out) > 0:
        return
    sh(["curl", "-sS", "-f", "-m", "240", "-G", VIRALOS, "--data-urlencode", f"url={url}", "-o", out])


def detect_cuts(video, thr=0.12):
    # score de cena do ffmpeg (0-1) em todos os frames; jump cut de talking head dá ~0.1-0.3,
    # troca de cena/B-roll dá >0.4. Guarda tudo >= thr com o score pra Claude julgar.
    p = subprocess.run(["ffmpeg", "-hide_banner", "-i", video, "-vf",
                        f"select='gte(scene,{thr})',metadata=print", "-an", "-f", "null", "-"],
                       capture_output=True, text=True)
    times = [float(t) for t in re.findall(r"pts_time:([\d.]+)", p.stderr)]
    scores = [float(s) for s in re.findall(r"lavfi\.scene_score=([\d.]+)", p.stderr)]
    out = []
    for t, sc in zip(times, scores):
        if out and t - out[-1]["t"] < 0.2:   # funde detecções coladas (transições)
            out[-1]["score"] = max(out[-1]["score"], round(sc, 2)); continue
        out.append({"t": round(t, 2), "score": round(sc, 2),
                    "tipo": "troca_de_cena" if sc >= 0.4 else "jump_cut_ou_zoom"})
    return out


def grab(video, t, out):
    sh(["ffmpeg", "-y", "-v", "error", "-ss", f"{t:.2f}", "-i", video, "-frames:v", "1",
        "-vf", "scale=360:-2", out])


def sheet(frames, labels, out, cols=6):
    from PIL import Image, ImageDraw
    ims = [Image.open(f) for f in frames]
    if not ims:
        return
    w, h = ims[0].size
    rows = (len(ims) + cols - 1) // cols
    S = Image.new("RGB", (cols * w, rows * h), "black")
    d = ImageDraw.Draw(S)
    for i, (im, lb) in enumerate(zip(ims, labels)):
        x, y = (i % cols) * w, (i // cols) * h
        S.paste(im.resize((w, h)), (x, y))
        d.rectangle([x, y, x + 8 * len(lb) + 8, y + 18], fill="black")
        d.text((x + 4, y + 3), lb, fill="yellow")
    S.save(out, quality=82)


def transcribe(wav):
    global _model
    from faster_whisper import WhisperModel
    if _model is None:
        _model = WhisperModel("large-v3-turbo", device="cpu", compute_type="int8",
                              download_root="/root/.cache/whisper")
    with wave.open(wav) as w:  # passa array (o decode por PyAV desta versão quebra)
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    segs, info = _model.transcribe(x, language="pt", word_timestamps=True, vad_filter=False)
    out = []
    for s in segs:
        out.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip(),
                    "words": [{"w": w.word.strip(), "s": round(w.start, 2), "e": round(w.end, 2)}
                              for w in (s.words or [])]})
    return out


def audio_analysis(wav, transcript, dur):
    with wave.open(wav) as w:
        sr = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    hop = int(sr * 0.05)
    n = len(x) // hop
    rms = np.array([np.sqrt(np.mean(x[i*hop:(i+1)*hop] ** 2) + 1e-12) for i in range(n)])
    db = 20 * np.log10(rms + 1e-9)
    t = np.arange(n) * 0.05
    words = [wd for s in transcript for wd in s["words"]]
    speech = np.zeros(n, bool)
    for wd in words:
        speech[int(wd["s"] / 0.05):int(wd["e"] / 0.05) + 1] = True
    # picos: subida brusca de energia vs. vizinhança (transientes = whoosh/pop/click/impacto)
    med = np.array([np.median(db[max(0, i-10):i+1]) for i in range(n)])
    rise = db - med
    peaks = []
    for i in range(1, n - 1):
        if rise[i] > 9 and db[i] > -35 and db[i] >= db[i-1] and db[i] >= db[i+1]:
            if peaks and t[i] - peaks[-1]["t"] < 0.3:
                continue
            peaks.append({"t": round(float(t[i]), 2), "db": round(float(db[i]), 1),
                          "salto_db": round(float(rise[i]), 1), "durante_fala": bool(speech[i])})
    # trechos sem fala: silêncio real vs. com som de fundo (música/ambiente)
    gaps, i = [], 0
    while i < n:
        if not speech[i]:
            j = i
            while j < n and not speech[j]:
                j += 1
            if (j - i) * 0.05 >= 0.3:
                seg = db[i:j]
                gaps.append({"de": round(float(t[i]), 2), "ate": round(float(t[min(j, n-1)]), 2),
                             "db_medio": round(float(np.mean(seg)), 1),
                             "tipo": "silencio" if np.mean(seg) < -45 else "som_sem_fala"})
            i = j
        else:
            i += 1
    # piso de energia durante a fala (fala seca vs. com trilha por baixo)
    floor_speech = float(np.percentile(db[speech], 10)) if speech.any() else None
    spoken = sum(wd["e"] - wd["s"] for wd in words)
    pauses = [round(b["s"] - a["e"], 2) for a, b in zip(words, words[1:]) if b["s"] - a["e"] > 0.25]
    return {
        "energia_50ms_db": [round(float(v), 1) for v in db],
        "picos_candidatos_sfx": peaks,
        "trechos_sem_fala": gaps,
        "piso_db_durante_fala": None if floor_speech is None else round(floor_speech, 1),
        "fala": {
            "n_palavras": len(words),
            "palavras_por_min": round(len(words) / (dur / 60), 1) if dur else None,
            "inicio_primeira_palavra": words[0]["s"] if words else None,
            "fim_ultima_palavra": words[-1]["e"] if words else None,
            "tempo_falando_s": round(spoken, 1),
            "pausas_maiores_250ms": pauses,
        },
    }


def process(idx, url, root):
    code = re.search(r"/(?:reel|p|tv)/([\w-]+)", url)
    code = code.group(1) if code else f"v{idx}"
    d = os.path.join(root, f"{idx:02d}_{code}")
    os.makedirs(os.path.join(d, "frames"), exist_ok=True)
    video = os.path.join(d, "video.mp4")
    download(url, video)
    meta = probe(video) | {"url": url, "code": code, "ordem": idx}
    json.dump(meta, open(os.path.join(d, "meta.json"), "w"), ensure_ascii=False, indent=1)
    dur = meta["duration"]

    cuts = detect_cuts(video)
    bounds = [0.0] + [c["t"] for c in cuts] + [dur]
    planos = [{"n": i + 1, "de": round(a, 2), "ate": round(b, 2), "dur": round(b - a, 2)}
              for i, (a, b) in enumerate(zip(bounds, bounds[1:])) if b - a > 0.05]
    json.dump({"cortes": cuts, "planos": planos,
               "n_planos": len(planos),
               "dur_media_plano": round(dur / max(len(planos), 1), 2)},
              open(os.path.join(d, "cuts.json"), "w"), ensure_ascii=False, indent=1)

    pf, pl = [], []
    for p in planos:
        f = os.path.join(d, "frames", f"plano{p['n']:03d}.jpg")
        grab(video, (p["de"] + p["ate"]) / 2, f)
        if not os.path.exists(f):
            continue
        pf.append(f); pl.append(f"P{p['n']} {p['de']:.1f}-{p['ate']:.1f}s")
    sheet(pf, pl, os.path.join(d, "sheet_planos.jpg"))
    sf, sl = [], []
    for s in range(int(dur) + 1):
        f = os.path.join(d, "frames", f"s{s:03d}.jpg")
        grab(video, min(s + 0.5, max(dur - 0.3, 0)), f)
        if os.path.exists(f):
            sf.append(f); sl.append(f"{s}s")
    sheet(sf, sl, os.path.join(d, "sheet_1s.jpg"), cols=8)

    wav = os.path.join(d, "audio.wav")
    if meta["has_audio"]:
        sh(["ffmpeg", "-y", "-v", "error", "-i", video, "-ac", "1", "-ar", "16000", wav])
        tr = transcribe(wav)
        json.dump(tr, open(os.path.join(d, "transcript.json"), "w"), ensure_ascii=False, indent=1)
        json.dump(audio_analysis(wav, tr, dur), open(os.path.join(d, "audio.json"), "w"),
                  ensure_ascii=False)
    print(f"[ok] {idx:02d} {code}  {dur:.1f}s  {len(planos)} planos", flush=True)


if __name__ == "__main__":
    links, root = sys.argv[1], sys.argv[2]
    urls = [l.strip() for l in open(links) if l.strip().startswith("http")]
    os.makedirs(root, exist_ok=True)
    for i, u in enumerate(urls, 1):
        try:
            process(i, u, root)
        except Exception as e:
            print(f"[ERRO] {i:02d} {u}: {e}", flush=True)
