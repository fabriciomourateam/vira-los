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
  CalendarClock, Loader2, Plus, X, Upload, Settings, Check, Trash2, RefreshCw,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

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

  useEffect(() => {
    fetch(`${API}/api/mlabs/default-dates`)
      .then((r) => r.json())
      .then((d) => setDates(d.dates || []))
      .catch(() => setDates([]))
      .finally(() => setLoading(false));
  }, []);

  function setDate(i: number, v: string) { setDates((p) => p.map((d, j) => (j === i ? v : d))); }
  function addDate() {
    const last = dates[dates.length - 1];
    setDates((p) => [...p, last || '']);
  }
  function removeDate(i: number) { setDates((p) => p.filter((_, j) => j !== i)); }

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
        body: JSON.stringify({ contentType: kind, contentId, dates: clean }),
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
          <div className={`border rounded-lg p-3 ${videoReady ? 'border-green-500/40 bg-green-500/5' : 'border-border'}`}>
            <label className="text-xs font-medium text-foreground flex items-center gap-2 cursor-pointer">
              {videoReady ? <Check size={14} className="text-green-400" /> : <Upload size={14} />}
              {videoReady ? 'Vídeo enviado' : (uploading ? 'Enviando...' : 'Subir vídeo editado (.mp4)')}
              <input
                type="file" accept="video/mp4,video/quicktime,.mp4,.mov" className="hidden"
                disabled={uploading}
                onChange={(e) => e.target.files?.[0] && uploadVideo(e.target.files[0])}
              />
            </label>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground"><Loader2 size={20} className="animate-spin" /></div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-auto">
            {dates.map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="datetime-local" value={d} onChange={(e) => setDate(i, e.target.value)}
                  className="flex-1 bg-background border border-border rounded-lg px-2 py-1.5 text-sm text-foreground"
                />
                <button onClick={() => removeDate(i)} className="text-muted-foreground hover:text-red-400 p-1"><Trash2 size={15} /></button>
              </div>
            ))}
            <button onClick={addDate} className="text-xs text-blue-400 hover:text-blue-300 inline-flex items-center gap-1 mt-1">
              <Plus size={13} /> Adicionar data
            </button>
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
}
interface Agendado {
  id: string; contentType: string; caption?: string; dates: string[]; status: string; error?: string; created_at: string;
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
