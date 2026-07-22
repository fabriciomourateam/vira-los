/**
 * MlabsScheduler.tsx — agendar carrosséis/reels no mLabs (em N datas de uma vez).
 *
 * Exporta:
 *   <MlabsScheduleButton kind contentId caption hasVideo />  — botão por item + modal
 *   <MlabsSettingsButton />                                  — engrenagem: auto-postar,
 *                                                              hora padrão, calibrar, agendados
 *
 * As datas usam <input type="datetime-local">, cujo valor "AAAA-MM-DDTHH:MM" (hora local SP)
 * casa direto com o backend (/api/mlabs/schedule), que converte SP→UTC.
 */
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  CalendarClock, Loader2, Plus, X, Upload, Settings, Check, Trash2, RefreshCw, Wand2, Film,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Soma `months` a uma string local "AAAA-MM-DDTHH:MM" preservando a hora.
// Usa a mesma lógica de overflow de mês do backend (Date.setMonth).
function shiftMonthsLocal(base: string, months: number): string {
  const m = String(base).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return base;
  const dt = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  dt.setMonth(dt.getMonth() + months);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}T${p(dt.getHours())}:${p(dt.getMinutes())}`;
}

// Recalcula todas as datas a partir da 1ª: [first, first+interval, first+2*interval, ...]
// A hora da 1ª data é preservada em todas (mudar hora na 1ª propaga).
function recomputeLinkedDates(first: string, count: number, intervalMonths: number): string[] {
  return Array.from({ length: count }, (_, k) => (k === 0 ? first : shiftMonthsLocal(first, k * intervalMonths)));
}

// Diferença em meses (ano+mês) entre duas datas locais — usada para inferir o
// intervalo real das datas padrão vindas do backend.
function monthGap(a: string, b: string): number {
  const ma = String(a).match(/^(\d{4})-(\d{2})/);
  const mb = String(b).match(/^(\d{4})-(\d{2})/);
  if (!ma || !mb) return 3;
  return (+mb[1] * 12 + +mb[2]) - (+ma[1] * 12 + +ma[2]);
}

// ── Botão + modal de agendamento ────────────────────────────────────────────────
export function MlabsScheduleButton({
  kind, contentId, caption, hasVideo,
}: { kind: 'carousel' | 'reel'; contentId: string; caption?: string; hasVideo?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-foreground bg-blue-600 hover:bg-blue-500 px-2.5 py-1 rounded-lg inline-flex items-center gap-1 transition-colors"
      >
        <CalendarClock size={12} /> Agendar no mLabs
      </button>
      {open && (
        <MlabsScheduleModal
          kind={kind} contentId={contentId} caption={caption} hasVideo={hasVideo}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function MlabsScheduleModal({
  kind, contentId, caption, hasVideo, onClose,
}: { kind: 'carousel' | 'reel'; contentId: string; caption?: string; hasVideo?: boolean; onClose: () => void }) {
  const [dates, setDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [videoReady, setVideoReady] = useState(!!hasVideo);
  const [uploading, setUploading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [captionText, setCaptionText] = useState(caption || '');
  // Vincular datas: quando ligado, as datas seguem a 1ª (1ª + N, +2N, +3N meses)
  // e mudar data/horário da 1ª propaga para as demais. Reel não é evergreen, então
  // começa desvinculado (cada reel = 1 slot livre); carrossel começa vinculado.
  const isReel = kind === 'reel';
  const [linked, setLinked] = useState(!isReel);
  const [intervalMonths, setIntervalMonths] = useState(3);

  useEffect(() => {
    // Reel: próximo slot livre (esquema N/dia). Carrossel: datas evergreen (meses).
    const url = isReel ? `${API}/api/mlabs/reel-slots?count=1` : `${API}/api/mlabs/default-dates`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        const arr: string[] = d.dates || [];
        setDates(arr);
        if (!isReel && arr.length >= 2) {
          const gap = monthGap(arr[0], arr[1]);
          if (gap >= 1) setIntervalMonths(Math.min(24, gap));
        }
      })
      .catch(() => setDates([]))
      .finally(() => setLoading(false));
  }, [isReel]);

  // Renderiza do banco: pega um clipe cru livre e queima a fraseTela no vídeo.
  async function renderFromBank() {
    setRendering(true);
    try {
      const r = await fetch(`${API}/api/reels/saved/${contentId}/render`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoSchedule: false }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha ao renderizar.');
      setVideoReady(true);
      toast.success('Texto queimado no clipe do banco. Vídeo pronto!');
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao renderizar o reel.');
    } finally {
      setRendering(false);
    }
  }

  function setDate(i: number, v: string) {
    setDates((p) => {
      // Vinculado + edição da 1ª data (ou horário): recalcula todas a partir dela.
      if (linked && i === 0) return recomputeLinkedDates(v, p.length, intervalMonths);
      return p.map((d, j) => (j === i ? v : d));
    });
  }
  function addDate() {
    setDates((p) => {
      if (linked && p[0]) return [...p, shiftMonthsLocal(p[0], p.length * intervalMonths)];
      const last = p[p.length - 1];
      return [...p, last || ''];
    });
  }
  function removeDate(i: number) {
    setDates((p) => {
      const next = p.filter((_, j) => j !== i);
      // Vinculado: mantém o espaçamento a partir da 1ª após remover.
      if (linked && next.length && next[0]) return recomputeLinkedDates(next[0], next.length, intervalMonths);
      return next;
    });
  }
  // Liga/desliga o vínculo; ao ligar, normaliza as datas para 1ª + k*intervalo.
  function toggleLinked() {
    setLinked((on) => {
      const nowOn = !on;
      if (nowOn) setDates((p) => (p[0] ? recomputeLinkedDates(p[0], p.length, intervalMonths) : p));
      return nowOn;
    });
  }
  function changeInterval(months: number) {
    const safe = Math.max(1, Math.min(24, months || 1));
    setIntervalMonths(safe);
    if (linked) setDates((p) => (p[0] ? recomputeLinkedDates(p[0], p.length, safe) : p));
  }

  async function uploadVideo(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('video', file);
      const r = await fetch(`${API}/api/mlabs/upload-reel/${contentId}`, { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha no upload.');
      setVideoReady(true);
      toast.success('Vídeo do reel enviado.');
    } catch (e: any) {
      toast.error(e?.message || 'Erro no upload do vídeo.');
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    const clean = dates.filter(Boolean);
    if (!clean.length) { toast.error('Adicione ao menos 1 data.'); return; }
    if (kind === 'reel' && !videoReady) { toast.error('Suba o vídeo editado do reel antes de agendar.'); return; }
    setSubmitting(true);
    try {
      const r = await fetch(`${API}/api/mlabs/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: kind, contentId, dates: clean, caption: captionText }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha ao agendar.');
      toast.success(`Agendado no mLabs em ${clean.length} data(s)!`);
      onClose();
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao agendar no mLabs.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-foreground inline-flex items-center gap-2">
            <CalendarClock size={18} className="text-blue-400" /> Agendar no mLabs
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>

        <p className="text-xs text-muted-foreground">
          {kind === 'carousel' ? 'Carrossel' : 'Reel'} agendado nas datas/horas abaixo (horário de Brasília).
          O mLabs publica em cada data.
        </p>

        {kind === 'reel' && (
          <div className={`border rounded-lg p-3 space-y-2 ${videoReady ? 'border-green-500/40 bg-green-500/5' : 'border-border'}`}>
            {videoReady ? (
              <div className="text-xs font-medium text-green-400 flex items-center gap-2"><Check size={14} /> Vídeo pronto pra agendar</div>
            ) : (
              <>
                {/* Caminho automático: queima a fraseTela num clipe cru do banco */}
                <button
                  onClick={renderFromBank} disabled={rendering || uploading}
                  className="w-full text-xs font-semibold text-foreground bg-blue-600 hover:bg-blue-500 px-3 py-2 rounded-lg inline-flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {rendering ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                  {rendering ? 'Renderizando...' : 'Renderizar do banco (queima o texto no clipe)'}
                </button>
                {/* Caminho manual: subir um .mp4 já editado */}
                <label className="text-[11px] text-muted-foreground flex items-center justify-center gap-1.5 cursor-pointer hover:text-foreground">
                  <Upload size={12} /> {uploading ? 'Enviando...' : 'ou subir um .mp4 já editado'}
                  <input
                    type="file" accept="video/mp4,video/quicktime,.mp4,.mov" className="hidden"
                    disabled={uploading || rendering}
                    onChange={(e) => e.target.files?.[0] && uploadVideo(e.target.files[0])}
                  />
                </label>
              </>
            )}
          </div>
        )}

        {/* Legenda — editável antes de postar */}
        <div className="space-y-1">
          <span className="text-xs font-medium text-foreground">Legenda (vai pro post)</span>
          <textarea
            value={captionText} onChange={(e) => setCaptionText(e.target.value)}
            className="w-full h-28 bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground whitespace-pre-wrap"
          />
          <span className="text-[11px] text-muted-foreground">{captionText.length} caracteres</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground"><Loader2 size={20} className="animate-spin" /></div>
        ) : (
          <div className="space-y-2">
            {/* Opção: vincular datas e replicar a partir da 1ª */}
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/60 px-2.5 py-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={linked} onChange={toggleLinked} className="accent-blue-500 w-3.5 h-3.5" />
                <span className="text-xs text-foreground leading-tight">
                  Replicar a partir da 1ª data
                  <span className="block text-[10px] text-muted-foreground">Mudar data/horário da 1ª ajusta as demais</span>
                </span>
              </label>
              <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                a cada
                <input
                  type="number" min={1} max={24} value={intervalMonths}
                  disabled={!linked}
                  onChange={(e) => changeInterval(parseInt(e.target.value, 10))}
                  className="w-12 bg-background border border-border rounded px-1.5 py-1 text-center text-foreground disabled:opacity-50"
                />
                meses
              </div>
            </div>

            <div className="space-y-2 max-h-64 overflow-auto">
              {dates.map((d, i) => {
                const locked = linked && i > 0;
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground w-4 text-right flex-shrink-0">{i + 1}</span>
                    <input
                      type="datetime-local" value={d} onChange={(e) => setDate(i, e.target.value)}
                      readOnly={locked}
                      title={locked ? 'Definida pela 1ª data — edite a 1ª para mudar' : undefined}
                      className={`flex-1 bg-background border border-border rounded-lg px-2 py-1.5 text-sm text-foreground ${locked ? 'opacity-60 cursor-not-allowed' : ''}`}
                    />
                    <button onClick={() => removeDate(i)} className="text-muted-foreground hover:text-red-400 p-1"><Trash2 size={15} /></button>
                  </div>
                );
              })}
              <button onClick={addDate} className="text-xs text-blue-400 hover:text-blue-300 inline-flex items-center gap-1 mt-1">
                <Plus size={13} /> Adicionar data
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground px-3 py-1.5">Cancelar</button>
          <button
            onClick={submit} disabled={submitting || loading}
            className="text-sm font-semibold text-foreground bg-blue-600 hover:bg-blue-500 px-4 py-1.5 rounded-lg inline-flex items-center gap-2 disabled:opacity-60"
          >
            {submitting ? <Loader2 size={15} className="animate-spin" /> : <CalendarClock size={15} />}
            Agendar {dates.filter(Boolean).length} data(s)
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Engrenagem: settings + agendados ────────────────────────────────────────────
interface Settings {
  autoScheduleCarousel: boolean; defaultTime: string; dateOffsetsMonths: number[];
  profileId: number | null; ownerId: number | null; channelSourceIds: number[];
  channelSourceIdsReel: number[]; youtubeShortsChannelId: number | null;
  autoScheduleReel: boolean; autoRenderReel: boolean;
  reelPostsPerDay: number; reelScheduleDays: number; reelScheduleTimes: string[];
  reelFontSize: number;
}
interface Agendado {
  id: string; contentType: string; caption?: string; dates: string[]; status: string; error?: string; created_at: string;
}
interface RawVideo {
  id: string; file: string; originalName?: string; size?: number; used: boolean; usedByReelId?: string | null; created_at: string;
}

export function MlabsSettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-border text-muted-foreground hover:text-foreground transition-colors"
        title="Configurações do mLabs"
      >
        <Settings size={15} /> mLabs
      </button>
      {open && <MlabsSettingsModal onClose={() => setOpen(false)} />}
    </>
  );
}

function MlabsSettingsModal({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [agendados, setAgendados] = useState<Agendado[]>([]);
  const [saving, setSaving] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [sessionText, setSessionText] = useState('');
  const [savingSession, setSavingSession] = useState(false);
  const [rawVideos, setRawVideos] = useState<RawVideo[]>([]);
  const [uploadingRaw, setUploadingRaw] = useState(false);

  function loadRawVideos() {
    fetch(`${API}/api/reels/raw-videos`).then((r) => r.json()).then((d) => setRawVideos(Array.isArray(d) ? d : [])).catch(() => {});
  }

  async function uploadRawVideos(files: FileList) {
    setUploadingRaw(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('videos', f));
      const r = await fetch(`${API}/api/reels/raw-videos`, { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha no upload.');
      toast.success(`${d.count} clipe(s) no banco.`);
      loadRawVideos();
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao subir clipes.');
    } finally {
      setUploadingRaw(false);
    }
  }

  async function deleteRawVideo(id: string) {
    try {
      await fetch(`${API}/api/reels/raw-videos/${id}`, { method: 'DELETE' });
      setRawVideos((p) => p.filter((v) => v.id !== id));
    } catch { /* ignora */ }
  }

  async function saveSession() {
    const txt = sessionText.trim();
    if (!txt) { toast.error('Cole o JSON dos cookies (export do Cookie-Editor).'); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(txt); }
    catch { toast.error('JSON inválido — copie o "Export as JSON" inteiro.'); return; }
    setSavingSession(true);
    try {
      const r = await fetch(`${API}/api/mlabs/session`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha ao salvar sessão.');
      toast.success(`Sessão salva: ${d.mlabsCookies ?? d.cookies} cookies do mLabs.`);
      setSessionText('');
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao salvar sessão.');
    } finally { setSavingSession(false); }
  }

  useEffect(() => {
    fetch(`${API}/api/mlabs/settings`).then((r) => r.json()).then(setS).catch(() => {});
    fetch(`${API}/api/mlabs/agendados`).then((r) => r.json()).then(setAgendados).catch(() => {});
    loadRawVideos();
  }, []);

  async function save(patch: Partial<Settings>) {
    if (!s) return;
    const next = { ...s, ...patch };
    setS(next);
    setSaving(true);
    try {
      await fetch(`${API}/api/mlabs/settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
    } finally { setSaving(false); }
  }

  async function calibrate() {
    setCalibrating(true);
    try {
      const r = await fetch(`${API}/api/mlabs/calibrate`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha na calibração.');
      setS((p) => (p ? { ...p, ...d.settings } : p));
      toast.success(`Calibrado: perfil ${d.profileId ?? '?'}, canais [${(d.channelSourceIds || []).join(', ')}]`);
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao calibrar.');
    } finally { setCalibrating(false); }
  }

  const configured = s && s.profileId && s.channelSourceIds?.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg p-5 space-y-4 max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-foreground inline-flex items-center gap-2"><Settings size={18} className="text-blue-400" /> mLabs</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>

        {!s ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground"><Loader2 size={20} className="animate-spin" /></div>
        ) : (
          <>
            {!configured && (
              <div className="text-xs text-yellow-300 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-2">
                Ainda não calibrado. Depois de semear a sessão (login), clique em <b>Calibrar</b> pra
                aprender seu perfil e canais do mLabs.
              </div>
            )}

            {/* Auto-postar carrossel */}
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span className="text-sm text-foreground">
                Agendar carrosséis automaticamente após gerar
                <span className="block text-xs text-muted-foreground">Todo carrossel novo entra no mLabs com as datas padrão.</span>
              </span>
              <input type="checkbox" checked={s.autoScheduleCarousel} onChange={(e) => save({ autoScheduleCarousel: e.target.checked })} className="w-5 h-5 accent-blue-500" />
            </label>

            {/* Hora padrão */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-foreground">Hora padrão (Brasília)</span>
              <input type="time" value={s.defaultTime} onChange={(e) => save({ defaultTime: e.target.value })}
                className="bg-background border border-border rounded-lg px-2 py-1 text-sm text-foreground" />
            </div>

            {/* Offsets */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-foreground">
                Repetição (meses a partir de amanhã)
                <span className="block text-xs text-muted-foreground">Ex.: 0,3,6,9 → amanhã, +3, +6, +9 meses</span>
              </span>
              <input
                type="text" defaultValue={(s.dateOffsetsMonths || []).join(',')}
                onBlur={(e) => save({ dateOffsetsMonths: e.target.value.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n)) })}
                className="w-24 bg-background border border-border rounded-lg px-2 py-1 text-sm text-foreground text-center" />
            </div>

            {/* Identificação da conta (ids do mLabs) */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">
                  profileId
                  <span className="block text-xs text-muted-foreground">id do perfil. Ex.: 7371627</span>
                </span>
                <input
                  type="number" defaultValue={s.profileId ?? ''}
                  onBlur={(e) => save({ profileId: parseInt(e.target.value, 10) || null })}
                  className="w-32 bg-background border border-border rounded-lg px-2 py-1 text-sm text-foreground text-center" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">
                  ownerId (upload)
                  <span className="block text-xs text-muted-foreground">id do dono dos arquivos. Ex.: 3209986</span>
                </span>
                <input
                  type="number" defaultValue={s.ownerId ?? ''}
                  onBlur={(e) => save({ ownerId: parseInt(e.target.value, 10) || null })}
                  className="w-32 bg-background border border-border rounded-lg px-2 py-1 text-sm text-foreground text-center" />
              </div>
            </div>

            {/* Canais (ids do mLabs) — carrossel/feed e reel/shorts são diferentes */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">
                  Canais do carrossel (feed)
                  <span className="block text-xs text-muted-foreground">ids separados por vírgula. Ex.: 3,1,23</span>
                </span>
                <input
                  type="text" defaultValue={(s.channelSourceIds || []).join(',')}
                  onBlur={(e) => save({ channelSourceIds: e.target.value.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n)) })}
                  className="w-28 bg-background border border-border rounded-lg px-2 py-1 text-sm text-foreground text-center" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">
                  Canais do reel (reels/shorts/tiktok)
                  <span className="block text-xs text-muted-foreground">Ex.: 15,18,20,19</span>
                </span>
                <input
                  type="text" defaultValue={(s.channelSourceIdsReel || []).join(',')}
                  onBlur={(e) => save({ channelSourceIdsReel: e.target.value.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n)) })}
                  className="w-28 bg-background border border-border rounded-lg px-2 py-1 text-sm text-foreground text-center" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">
                  Canal YouTube Shorts
                  <span className="block text-xs text-muted-foreground">Exige título no agendamento. Ex.: 20</span>
                </span>
                <input
                  type="number" defaultValue={s.youtubeShortsChannelId ?? 20}
                  onBlur={(e) => save({ youtubeShortsChannelId: parseInt(e.target.value, 10) || null })}
                  className="w-28 bg-background border border-border rounded-lg px-2 py-1 text-sm text-foreground text-center" />
              </div>
            </div>

            {/* ── Reels: esteira automática (vídeo cru → texto queimado → agendar) ── */}
            <div className="space-y-3 pt-3 border-t border-border">
              <span className="text-sm font-semibold text-foreground inline-flex items-center gap-2">
                <Film size={15} className="text-blue-400" /> Reels — vídeo automático
              </span>

              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <span className="text-sm text-foreground">
                  Renderizar reels automaticamente
                  <span className="block text-xs text-muted-foreground">Após gerar o reel, queima a frase de tela num clipe do banco.</span>
                </span>
                <input type="checkbox" checked={!!s.autoRenderReel} onChange={(e) => save({ autoRenderReel: e.target.checked })} className="w-5 h-5 accent-blue-500" />
              </label>

              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <span className="text-sm text-foreground">
                  Agendar reels automaticamente
                  <span className="block text-xs text-muted-foreground">Assim que o vídeo renderiza, entra no mLabs no próximo horário livre.</span>
                </span>
                <input type="checkbox" checked={!!s.autoScheduleReel} onChange={(e) => save({ autoScheduleReel: e.target.checked })} className="w-5 h-5 accent-blue-500" />
              </label>

              {/* Esquema de agendamento flexível: N/dia por X dias, nos horários */}
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-foreground">Posts por dia</span>
                  <input type="number" min={1} max={12} defaultValue={s.reelPostsPerDay ?? 2}
                    onBlur={(e) => save({ reelPostsPerDay: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    className="w-16 bg-background border border-border rounded-lg px-2 py-1 text-sm text-foreground text-center" />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-foreground">Por quantos dias</span>
                  <input type="number" min={1} max={365} defaultValue={s.reelScheduleDays ?? 30}
                    onBlur={(e) => save({ reelScheduleDays: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    className="w-16 bg-background border border-border rounded-lg px-2 py-1 text-sm text-foreground text-center" />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">
                  Horários (Brasília)
                  <span className="block text-xs text-muted-foreground">Separados por vírgula. Ex.: 11:00,18:00</span>
                </span>
                <input type="text" defaultValue={(s.reelScheduleTimes || []).join(',')}
                  onBlur={(e) => save({ reelScheduleTimes: e.target.value.split(',').map((x) => x.trim()).filter((x) => /^\d{1,2}:\d{2}$/.test(x)) })}
                  className="w-28 bg-background border border-border rounded-lg px-2 py-1 text-sm text-foreground text-center" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">
                  Tamanho do texto na tela
                  <span className="block text-xs text-muted-foreground">px (base 1080×1920). Padrão: 96</span>
                </span>
                <input type="number" min={40} max={200} defaultValue={s.reelFontSize ?? 96}
                  onBlur={(e) => save({ reelFontSize: Math.max(40, Math.min(200, parseInt(e.target.value, 10) || 96)) })}
                  className="w-20 bg-background border border-border rounded-lg px-2 py-1 text-sm text-foreground text-center" />
              </div>

              {/* Banco de vídeos crus */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">
                    Banco de clipes crus
                    <span className="block text-xs text-muted-foreground">
                      {rawVideos.filter((v) => !v.used).length} livre(s) · {rawVideos.length} no total
                    </span>
                  </span>
                  <label className="text-xs font-medium text-foreground bg-blue-600 hover:bg-blue-500 px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1 cursor-pointer">
                    {uploadingRaw ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Subir clipes
                    <input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm" multiple className="hidden"
                      disabled={uploadingRaw}
                      onChange={(e) => e.target.files?.length && uploadRawVideos(e.target.files)} />
                  </label>
                </div>
                {rawVideos.length > 0 && (
                  <div className="space-y-1 max-h-40 overflow-auto">
                    {rawVideos.map((v) => (
                      <div key={v.id} className="text-xs flex items-center gap-2 bg-background border border-border rounded-lg px-2 py-1.5">
                        <span className={`px-1.5 py-0.5 rounded ${v.used ? 'bg-muted text-muted-foreground' : 'bg-green-500/15 text-green-400'}`}>{v.used ? 'usado' : 'livre'}</span>
                        <span className="text-foreground truncate flex-1">{v.originalName || v.file}</span>
                        <button onClick={() => deleteRawVideo(v.id)} className="text-muted-foreground hover:text-red-400 p-0.5"><Trash2 size={13} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Sessão do mLabs — cole o export do Cookie-Editor (sem terminal) */}
            <div className="space-y-1.5 pt-2 border-t border-border">
              <span className="text-sm font-semibold text-foreground">Sessão do mLabs (cookies)</span>
              <span className="block text-xs text-muted-foreground">
                Login do mLabs tem captcha. Logue no navegador, exporte com a extensão Cookie-Editor
                (Export → Export as JSON) e cole aqui.
              </span>
              <textarea
                value={sessionText} onChange={(e) => setSessionText(e.target.value)}
                placeholder='Cole aqui o JSON dos cookies (começa com [ ... ])'
                className="w-full h-20 bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground font-mono"
              />
              <button onClick={saveSession} disabled={savingSession}
                className="text-sm font-medium text-foreground bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded-lg inline-flex items-center gap-2 disabled:opacity-60">
                {savingSession ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Salvar sessão
              </button>
            </div>

            <button onClick={calibrate} disabled={calibrating}
              className="text-sm font-medium text-foreground bg-secondary hover:bg-secondary/70 border border-border px-3 py-1.5 rounded-lg inline-flex items-center gap-2 disabled:opacity-60">
              {calibrating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Calibrar / renovar
            </button>
            {saving && <span className="text-xs text-muted-foreground ml-2">salvando…</span>}

            {/* Agendados */}
            <div className="pt-2 border-t border-border">
              <p className="text-sm font-semibold text-foreground mb-2">Agendados ({agendados.length})</p>
              {agendados.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nada agendado ainda.</p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-auto">
                  {agendados.slice(0, 30).map((a) => (
                    <div key={a.id} className="text-xs flex items-center gap-2 bg-background border border-border rounded-lg px-2 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded ${a.status === 'agendado' ? 'bg-green-500/15 text-green-400' : a.status === 'erro' ? 'bg-red-500/15 text-red-400' : 'bg-yellow-500/15 text-yellow-400'}`}>{a.status}</span>
                      <span className="text-muted-foreground">{a.contentType}</span>
                      <span className="text-foreground truncate flex-1">{(a.caption || '').slice(0, 40) || '—'}</span>
                      <span className="text-muted-foreground shrink-0">{a.dates?.length || 0}×</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
