import {AbsoluteFill, Audio, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import '@fontsource/inter/800-italic.css';
import '@fontsource/playfair-display/400.css';
import plano from './data/plano.json';
import words from './data/words.json';
import config from './data/config.json';

type Plano = {fala: string; headline: string; estilo: 'sans' | 'serif' | 'cta'; de: number; ate: number; punch: boolean};
const P = plano as Plano[];
const W = words as {w: string; s: number; e: number}[];
const shadow = '0 3px 0 #000, 0 0 12px rgba(0,0,0,.85)';
const emoji = '"Noto Color Emoji","Apple Color Emoji","Segoe UI Emoji"';
const CTA_SUB = 'que eu te mando como funciona';

export const Reel2 = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = f / fps;
  let idx = 0;
  for (let i = 0; i < P.length; i++) if (t >= P[i].de - 1e-6) idx = i;
  const p = P[idx];

  // legenda karaokê seco
  let cur: string | null = null;
  for (let i = 0; i < W.length; i++) {
    if (t < W[i].s) break;
    const next = W[i + 1];
    const gap = next ? next.s - W[i].e : Infinity;
    const until = next && gap <= 0.6 ? next.s : W[i].e;
    cur = t < until ? W[i].w : null;
  }

  const head: React.CSSProperties = {
    position: 'absolute', top: '9%', left: '6%', width: '88%', textAlign: 'center', color: '#fff',
    textShadow: shadow, WebkitTextStroke: '2px #000', paintOrder: 'stroke fill', lineHeight: 1.12,
  };
  const sans: React.CSSProperties = {fontFamily: `Inter, ${emoji}`, fontWeight: 800, fontStyle: 'italic'};

  return (
    <AbsoluteFill style={{background: '#000'}}>
      <AbsoluteFill style={{transform: `scale(${p.punch ? 1.12 : 1})`, transformOrigin: '50% 40%'}}>
        <OffthreadVideo src={staticFile(config.video)} muted={config.audioSeparado} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
      </AbsoluteFill>
      {config.audioSeparado && <Audio src={staticFile(config.audio)} />}
      <div style={head}>
        {p.estilo === 'serif' ? (
          <div style={{fontFamily: 'Playfair Display', fontWeight: 400, fontStyle: 'normal', fontSize: 96}}>{p.headline}</div>
        ) : p.estilo === 'cta' ? (
          <>
            <div style={{...sans, fontSize: 120}}>{p.headline}</div>
            <div style={{...sans, fontSize: 44, marginTop: 14}}>{CTA_SUB}</div>
          </>
        ) : (
          <div style={{...sans, fontSize: 84}}>{p.headline}</div>
        )}
      </div>
      {cur && (
        <div style={{position: 'absolute', top: 1590, left: 0, width: '100%', textAlign: 'center', color: '#fff', fontFamily: 'Playfair Display', fontWeight: 400, fontSize: 64, textShadow: '0 2px 8px rgba(0,0,0,.9)'}}>{cur.toLowerCase()}</div>
      )}
    </AbsoluteFill>
  );
};
