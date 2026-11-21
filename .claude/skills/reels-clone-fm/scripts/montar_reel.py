#!/usr/bin/env python3
"""Pós-produção do reel (formato F1 yap): corta as pausas do vídeo do clone e prepara o Remotion.

Uso:  python3 -I montar_reel.py VIDEO.mp4 roteiro.json REMOTION_DIR [--max-pausa 0.25]
  VIDEO.mp4     vídeo cru do clone (ex.: saída do heygen.py), com áudio
  roteiro.json  [{"fala": "...", "headline": "...", "estilo": "sans|serif|cta", "punch": false}, ...]
                (1 item por frase/plano; headline troca a cada frase, corte seco)
  REMOTION_DIR  pasta remotion/ desta skill

Faz: Whisper (word timestamps) → corta todo silêncio > max-pausa (jump cut, igual às refs) →
suaviza a pele (--sem-pele desliga) → grava REMOTION_DIR/public/base.mp4 + src/data/{words,plano,config}.json. Depois renderize (README).
Requisitos: ffmpeg, faster-whisper (modelo large-v3-turbo, hosts do HuggingFace liberados).
"""
import argparse, json, os, re, subprocess, unicodedata, wave
import numpy as np


def norm(s):
    s = unicodedata.normalize("NFKD", s.lower())
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in s if not unicodedata.combining(c)))


def palavras(video, tmp):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", video, "-ac", "1", "-ar", "16000", tmp], check=True)
    from faster_whisper import WhisperModel
    with wave.open(tmp) as w:  # passa array (o decode por PyAV de algumas versões quebra)
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    m = WhisperModel("large-v3-turbo", device="cpu", compute_type="int8")
    segs, _ = m.transcribe(x, language="pt", word_timestamps=True)
    return [{"w": y.word.strip(), "s": y.start, "e": y.end} for s in segs for y in s.words]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video"); ap.add_argument("roteiro"); ap.add_argument("remotion")
    ap.add_argument("--max-pausa", type=float, default=0.25)
    ap.add_argument("--sem-pele", action="store_true", help="não aplica a suavização de pele (padrão: aplica)")
    a = ap.parse_args()
    R = json.load(open(a.roteiro))
    W = palavras(a.video, "/tmp/_montar_reel.wav")

    # início de cada frase: alinha as palavras do roteiro com as do Whisper (difflib) —
    # procurar só a 1ª palavra erra em falas como "É o seu negócio" × "não é o seu treino"
    import difflib
    rw, ini = [], []
    for fr in R:
        ini.append(len(rw)); rw += [norm(x) for x in fr["fala"].split() if norm(x)]
    ww = [norm(w["w"]) for w in W]
    m = {}
    for b in difflib.SequenceMatcher(None, rw, ww, autojunk=False).get_matching_blocks():
        for t in range(b.size):
            m[b.a + t] = b.b + t
    idx = []
    for n, i0 in enumerate(ini):
        fim = ini[n + 1] if n + 1 < len(ini) else len(rw)
        k = next((m[i] - (i - i0) for i in range(i0, fim) if i in m), None)
        idx.append(0 if n == 0 else max(0, min(len(W) - 1, k if k is not None else int(len(W) * i0 / len(rw)))))

    PAD0, PAD1 = 0.06, 0.10
    iv = [[max(0, W[0]["s"] - PAD0), W[0]["e"] + PAD1]]
    for p, q in zip(W, W[1:]):
        if q["s"] - p["e"] > a.max_pausa:
            iv.append([q["s"] - PAD0, q["e"] + PAD1])
        else:
            iv[-1][1] = q["e"] + PAD1
    iv[-1][1] += 0.35

    def remap(t):
        off = 0
        for s, e in iv:
            if t <= e:
                return off + max(0, t - s)
            off += e - s
        return off

    NW = [{"w": w["w"], "s": round(remap(w["s"]), 3), "e": round(remap(w["e"]), 3)} for w in W]
    dur = round(sum(e - s for s, e in iv), 3)
    P = []
    for n, (fr, i) in enumerate(zip(R, idx)):
        P.append({"fala": fr["fala"], "headline": fr["headline"], "estilo": fr.get("estilo", "sans"),
                  "punch": fr.get("punch", n % 2 == 1), "de": 0.0 if n == 0 else round(NW[i]["s"] - 0.03, 3)})
    for n in range(len(P)):
        P[n]["ate"] = P[n + 1]["de"] if n + 1 < len(P) else dur

    D = os.path.join(a.remotion, "src", "data"); os.makedirs(D, exist_ok=True)
    os.makedirs(os.path.join(a.remotion, "public"), exist_ok=True)
    json.dump(NW, open(os.path.join(D, "words.json"), "w"), ensure_ascii=False, indent=0)
    json.dump(P, open(os.path.join(D, "plano.json"), "w"), ensure_ascii=False, indent=1)
    json.dump({"video": "base.mp4", "audioSeparado": False, "audio": "", "duracaoS": dur},
              open(os.path.join(D, "config.json"), "w"), indent=1)
    fc = "".join(f"[0:v]trim={s:.3f}:{e:.3f},setpts=PTS-STARTPTS[v{k}];[0:a]atrim={s:.3f}:{e:.3f},asetpts=PTS-STARTPTS[a{k}];"
                 for k, (s, e) in enumerate(iv))
    fc += "".join(f"[v{k}][a{k}]" for k in range(len(iv))) + f"concat=n={len(iv)}:v=1:a=1[vc][a]"
    # pele: bilateral suave misturado 80% com o original (tira manchas sem cara de plástico; testado 21/11, ajustável)
    fc += (";[vc]split[o][s];[s]bilateral=sigmaS=8:sigmaR=0.06:planes=7[b];"
           "[o][b]blend=all_mode=normal:all_opacity=0.8,eq=saturation=1.05:contrast=1.02[v]") if not a.sem_pele else ";[vc]null[v]"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", a.video, "-filter_complex", fc, "-map", "[v]", "-map", "[a]",
                    "-c:v", "libx264", "-crf", "16", "-preset", "fast", "-r", "25", "-c:a", "aac", "-b:a", "192k",
                    os.path.join(a.remotion, "public", "base.mp4")], check=True)
    print(f"{len(iv)} trechos, {dur} s"); [print(f"  {p['de']:6.2f}  {p['headline']}") for p in P]


if __name__ == "__main__":
    main()
