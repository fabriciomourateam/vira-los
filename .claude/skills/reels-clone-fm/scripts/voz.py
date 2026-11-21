#!/usr/bin/env python3
"""Voz clonada do Fabricio (padrão aprovado em 21/11/2026 = versão "F").

Motor: Chatterbox Multilingual (Resemble AI, licença MIT — uso comercial ok), roda em CPU.
  pip install chatterbox-tts   (+ hosts do HuggingFace liberados pra baixar o modelo)

As AMOSTRAS e a DIGITAL da voz NÃO ficam neste repositório (ele é público — com elas qualquer
pessoa clonaria a voz). Ficam no Google Drive do Fabricio, pasta "FM Voz Clone (PRIVADO)":
  ref_v1.wav, ref_v3.wav  (amostras de 12 s) e  voz_fabricio_F.pt  (digital pronta).
Baixe pra uma pasta local e aponte VOZ_DIR pra ela.

Uso:
  VOZ_DIR=/caminho python3 -I voz.py "texto do roteiro" saida.wav
  VOZ_DIR=/caminho python3 -I voz.py --criar-digital        # recria voz_fabricio_F.pt a partir das 2 amostras

Padrão F (ajustável depois — é só mudar PADRAO abaixo):
  - timbre = média das amostras B (ref_v1, vídeo do quiz) e C (ref_v3); entonação/prompt de B
  - exaggeration 1.0 (energia máxima), cfg_weight 0.3 (ritmo solto), temperature 0.8, seed 7
  - frases terminando em "!" quando é ênfase (puxa energia no fim da frase)
  - pós-processo: silêncio > 0,15 s vira 0,09 s; corta silêncio do início/fim
"""
import os, sys, time
import numpy as np, torch, torchaudio as ta

PADRAO = dict(exaggeration=1.0, cfg_weight=0.3, temperature=0.8, seed=7, max_pausa=0.15, nova_pausa=0.09)
VOZ_DIR = os.environ.get("VOZ_DIR", ".")
DIGITAL = os.path.join(VOZ_DIR, "voz_fabricio_F.pt")


def carregar_modelo():
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    torch.set_num_threads(os.cpu_count() or 4)
    return ChatterboxMultilingualTTS.from_pretrained(device="cuda" if torch.cuda.is_available() else "cpu")


def criar_digital(m):
    from chatterbox.mtl_tts import Conditionals
    from chatterbox.models.t3.modules.cond_enc import T3Cond
    d = lambda v: v.detach().clone() if torch.is_tensor(v) else v
    def snap(c):
        return Conditionals(T3Cond(speaker_emb=d(c.t3.speaker_emb), cond_prompt_speech_tokens=d(c.t3.cond_prompt_speech_tokens),
                                   emotion_adv=d(c.t3.emotion_adv)), {k: d(v) for k, v in c.gen.items()})
    with torch.no_grad():
        m.prepare_conditionals(os.path.join(VOZ_DIR, "ref_v1.wav")); cB = snap(m.conds)
        m.prepare_conditionals(os.path.join(VOZ_DIR, "ref_v3.wav")); cC = snap(m.conds)
    c = snap(cB)
    e = (cB.t3.speaker_emb + cC.t3.speaker_emb) / 2
    c.t3.speaker_emb = e / e.norm(dim=-1, keepdim=True) * cB.t3.speaker_emb.norm(dim=-1, keepdim=True)
    c.gen["embedding"] = (cB.gen["embedding"] + cC.gen["embedding"]) / 2
    c.save(DIGITAL)
    return c


def tira_pausas(w, sr, max_pausa, nova):
    x = w.squeeze(0).numpy(); hop = int(sr * 0.01); n = len(x) // hop
    db = 20 * np.log10(np.array([np.sqrt(np.mean(x[i*hop:(i+1)*hop] ** 2) + 1e-12) for i in range(n)]) + 1e-9)
    sil = db < (db.max() - 38); keep = np.ones(len(x), bool); i = 0
    while i < n:
        if sil[i]:
            j = i
            while j < n and sil[j]: j += 1
            if i == 0: keep[:max(0, j*hop - int(0.03*sr))] = False
            elif j == n: keep[i*hop + int(0.08*sr):] = False
            elif (j - i) * 0.01 > max_pausa: keep[i*hop + int(nova/2*sr): j*hop - int(nova/2*sr)] = False
            i = j
        else: i += 1
    return torch.from_numpy(x[keep]).unsqueeze(0)


def falar(m, texto, saida, **kw):
    from chatterbox.mtl_tts import Conditionals
    p = {**PADRAO, **kw}
    m.conds = Conditionals.load(DIGITAL).to(m.device)
    torch.manual_seed(p["seed"])
    w = m.generate(texto, language_id="pt", exaggeration=p["exaggeration"], cfg_weight=p["cfg_weight"], temperature=p["temperature"])
    w = tira_pausas(w, m.sr, p["max_pausa"], p["nova_pausa"])
    ta.save(saida, w, m.sr)
    return w.shape[-1] / m.sr


if __name__ == "__main__":
    m = carregar_modelo()
    if sys.argv[1] == "--criar-digital":
        criar_digital(m); print("digital salva em", DIGITAL)
    else:
        t = time.time(); dur = falar(m, sys.argv[1], sys.argv[2])
        print(f"{sys.argv[2]}: {dur:.1f} s de áudio em {time.time()-t:.0f} s")
