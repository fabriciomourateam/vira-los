import React, { useState, useEffect, useRef } from 'react';
import {
  Calendar, Upload, Clock, CheckCircle2, AlertCircle, Loader2, Trash2,
  Instagram, Youtube, Plus, X, Play, Image, ChevronLeft, ChevronRight,
  RefreshCw, Zap, Link2, Settings, Grid3X3,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, parseISO, addMonths, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  api, uploadsUrl, checkBackend,
  ContentItem, Schedule, PlatformsStatus, RepeatRule,
} from '../lib/api';

// ── Constantes ────────────────────────────────────────────────────────────────
const PLATFORMS = ['instagram', 'tiktok', 'youtube'] as const;
type Platform = typeof PLATFORMS[number];

const PLATFORM_COLORS: Record<Platform, string> = {
  instagram: 'bg-pink-500',
  tiktok: 'bg-black',
  youtube: 'bg-red-500',
};

const STATUS_CONFIG = {
  pending:  { label: 'Agendado',    color: 'bg-blue-100 text-blue-700',    icon: Clock },
  posting:  { label: 'Publicando',  color: 'bg-yellow-100 text-yellow-700', icon: Loader2 },
  done:     { label: 'Publicado',   color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  partial:  { label: 'Parcial',     color: 'bg-orange-100 text-orange-700', icon: AlertCircle },
  failed:   { label: 'Falhou',      color: 'bg-red-100 text-red-700',      icon: AlertCircle },
  cancelled:{ label: 'Cancelado',   color: 'bg-gray-100 text-gray-500',    icon: X },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const TikTokIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.26 8.26 0 004.83 1.56V6.8a4.85 4.85 0 01-1.06-.11z"/>
  </svg>
);

function PlatformIcon({ p, size = 14 }: { p: Platform; size?: number }) {
  if (p === 'instagram') return <Instagram size={size} />;
  if (p === 'tiktok') return <TikTokIcon size={size} />;
  return <Youtube size={size} />;
}

function parseJsonSafe<T>(str: string, fallback: T): T {
  try { return JSON.parse(str); } catch { return fallback; }
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function Agendador() {
  const [view, setView] = useState<'biblioteca' | 'calendario' | 'fila'>('biblioteca');
  const [content, setContent] = useState<ContentItem[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [platforms, setPlatforms] = useState<PlatformsStatus>({
    instagram: { connected: false, username: null, expires_at: null },
    tiktok:    { connected: false, username: null, expires_at: null },
    youtube:   { connected: false, username: null, expires_at: null },
  });
  const [loading, setLoading] = useState(true);
  const [backendOk, setBackendOk] = useState(false);

  // Modais
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadType, setUploadType] = useState<'video' | 'carousel'>('video');
  const [schedulingItem, setSchedulingItem] = useState<ContentItem | null>(null);
  const [platformsOpen, setPlatformsOpen] = useState(false);

  // Calendário
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  async function load() {
    const ok = await checkBackend();
    setBackendOk(ok);
    if (!ok) { setLoading(false); return; }
    try {
      const [c, s, p] = await Promise.all([
        api.get<ContentItem[]>('/api/content'),
        api.get<Schedule[]>('/api/schedule'),
        api.get<PlatformsStatus>('/api/platforms/status'),
      ]);
      setContent(c);
      setSchedules(s);
      setPlatforms(p);
    } catch { /* silent */ }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function deleteContent(id: string) {
    await api.delete(`/api/content/${id}`);
    setContent((p) => p.filter((c) => c.id !== id));
  }

  async function deleteSchedule(id: string) {
    await api.delete(`/api/schedule/${id}`);
    setSchedules((p) => p.filter((s) => s.id !== id));
  }

  async function triggerSchedule(id: string) {
    await api.post(`/api/schedule/${id}/trigger`);
    await load();
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <section>
        <h2 className="text-2xl font-extrabold tracking-tight mb-1">📅 Agendador de Posts</h2>
        <p className="text-muted-foreground text-sm">
          Suba seus vídeos, programe datas e publique automaticamente no Instagram, TikTok e YouTube
        </p>
      </section>

      {/* Backend offline warning */}
      {!backendOk && !loading && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex gap-3 items-start">
          <AlertCircle size={18} className="text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-bold text-red-700">Servidor desconectado</p>
            <p className="text-xs text-red-600 mt-0.5">
              Rode <code className="bg-red-100 px-1 rounded">cd server && npm install && npm run dev</code> em outro terminal para ativar a automação.
            </p>
          </div>
        </div>
      )}

      {/* Platform status bar */}
      <div className="flex flex-wrap gap-2 items-center">
        {PLATFORMS.map((p) => {
          const status = platforms[p];
          return (
            <button
              key={p}
              onClick={() => setPlatformsOpen(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                status.connected
                  ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                  : 'bg-secondary text-muted-foreground border border-border hover:border-foreground/30'
              }`}
            >
              <PlatformIcon p={p} size={12} />
              {status.connected ? status.username || p : `Conectar ${p}`}
            </button>
          );
        })}
        <button
          onClick={() => setPlatformsOpen(true)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold bg-secondary text-muted-foreground hover:text-foreground border border-border transition-all ml-auto"
        >
          <Settings size={12} /> Plataformas
        </button>
      </div>

      {/* View switcher */}
      <div className="flex gap-1 bg-secondary p-1 rounded-xl">
        {[
          { id: 'biblioteca', label: 'Biblioteca', icon: Grid3X3 },
          { id: 'calendario', label: 'Calendário', icon: Calendar },
          { id: 'fila',       label: 'Fila',       icon: Clock },
        ].map((v) => {
          const Icon = v.icon;
          const active = view === v.id;
          return (
            <button
              key={v.id}
              onClick={() => setView(v.id as typeof view)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all ${
                active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon size={13} />
              {v.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="py-16 flex justify-center">
          <Loader2 size={28} className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {view === 'biblioteca' && (
            <BibliotecaView
              content={content}
              onUpload={() => { setUploadType('video'); setUploadOpen(true); }}
              onUploadCarousel={() => { setUploadType('carousel'); setUploadOpen(true); }}
              onSchedule={setSchedulingItem}
              onDelete={deleteContent}
            />
          )}
          {view === 'calendario' && (
            <CalendarioView
              schedules={schedules}
              month={calendarMonth}
              selectedDay={selectedDay}
              onMonthChange={setCalendarMonth}
              onDaySelect={setSelectedDay}
              onDelete={deleteSchedule}
              onTrigger={triggerSchedule}
            />
          )}
          {view === 'fila' && (
            <FilaView
              schedules={schedules}
              onDelete={deleteSchedule}
              onTrigger={triggerSchedule}
              onRefresh={load}
            />
          )}
        </>
      )}

      {/* Modais */}
      {uploadOpen && (
        <UploadModal
          type={uploadType}
          onClose={() => setUploadOpen(false)}
          onSuccess={(item) => { setContent((p) => [item, ...p]); setUploadOpen(false); }}
        />
      )}
      {schedulingItem && (
        <ScheduleModal
          item={schedulingItem}
          platforms={platforms}
          onClose={() => setSchedulingItem(null)}
          onSuccess={(created) => {
            setSchedules((p) => [...p, ...created]);
            setSchedulingItem(null);
            setView('fila');
          }}
        />
      )}
      {platformsOpen && (
        <PlatformsModal
          platforms={platforms}
          onClose={() => setPlatformsOpen(false)}
          onRefresh={load}
        />
      )}
    </div>
  );
}

// ── Biblioteca ────────────────────────────────────────────────────────────────
function BibliotecaView({
  content, onUpload, onUploadCarousel, onSchedule, onDelete,
}: {
  content: ContentItem[];
  onUpload: () => void;
  onUploadCarousel: () => void;
  onSchedule: (item: ContentItem) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          onClick={onUpload}
          className="flex items-center gap-2 px-4 py-2.5 bg-foreground text-background rounded-xl text-sm font-bold hover:opacity-90 transition-opacity"
        >
          <Upload size={15} /> Subir Vídeo
        </button>
        <button
          onClick={onUploadCarousel}
          className="flex items-center gap-2 px-4 py-2.5 bg-secondary text-foreground rounded-xl text-sm font-bold hover:bg-secondary/70 transition-colors border border-border"
        >
          <Image size={15} /> Carrossel
        </button>
      </div>

      {content.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">
          <Upload size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">Nenhum conteúdo ainda</p>
          <p className="text-xs mt-1">Suba seu primeiro vídeo ou carrossel</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {content.map((item) => (
            <ContentCard key={item.id} item={item} onSchedule={onSchedule} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

function ContentCard({ item, onSchedule, onDelete }: {
  item: ContentItem;
  onSchedule: (item: ContentItem) => void;
  onDelete: (id: string) => void;
}) {
  const thumb = item.thumbnail
    ? uploadsUrl(item.thumbnail)
    : item.type === 'carousel'
    ? uploadsUrl(parseJsonSafe<string[]>(item.file_path, [])[0] || '')
    : null;

  return (
    <div className="bg-card rounded-2xl overflow-hidden border border-border group hover:border-foreground/20 transition-all" style={{ boxShadow: 'var(--shadow-card)' }}>
      {/* Thumbnail */}
      <div className="relative aspect-[9/16] bg-secondary overflow-hidden">
        {thumb ? (
          <img src={thumb} alt={item.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {item.type === 'video' ? (
              <Play size={24} className="text-muted-foreground" />
            ) : (
              <Image size={24} className="text-muted-foreground" />
            )}
          </div>
        )}
        <div className="absolute top-2 left-2">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full text-white ${
            item.type === 'video' ? 'bg-blue-500' : 'bg-purple-500'
          }`}>
            {item.type === 'video' ? 'VÍDEO' : 'CARROSSEL'}
          </span>
        </div>
        <button
          onClick={() => onDelete(item.id)}
          className="absolute top-2 right-2 w-6 h-6 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Trash2 size={12} className="text-white" />
        </button>
      </div>
      {/* Info */}
      <div className="p-3">
        <p className="text-xs font-semibold truncate">{item.title}</p>
        {item.caption && (
          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{item.caption}</p>
        )}
        <button
          onClick={() => onSchedule(item)}
          className="mt-2 w-full flex items-center justify-center gap-1 py-1.5 bg-foreground text-background rounded-lg text-[11px] font-bold hover:opacity-90 transition-opacity"
        >
          <Calendar size={11} /> Agendar
        </button>
      </div>
    </div>
  );
}

// ── Calendário ────────────────────────────────────────────────────────────────
function CalendarioView({
  schedules, month, selectedDay, onMonthChange, onDaySelect, onDelete, onTrigger,
}: {
  schedules: Schedule[];
  month: Date;
  selectedDay: Date | null;
  onMonthChange: (d: Date) => void;
  onDaySelect: (d: Date | null) => void;
  onDelete: (id: string) => void;
  onTrigger: (id: string) => void;
}) {
  const start = startOfMonth(month);
  const end = endOfMonth(month);
  const days = eachDayOfInterval({ start, end });
  const firstDow = getDay(start); // 0=Sun

  // Posts por dia
  const postsByDay: Record<string, Schedule[]> = {};
  for (const s of schedules) {
    const key = s.scheduled_for.substring(0, 10);
    if (!postsByDay[key]) postsByDay[key] = [];
    postsByDay[key].push(s);
  }

  const daySchedules = selectedDay
    ? (postsByDay[format(selectedDay, 'yyyy-MM-dd')] || [])
    : [];

  return (
    <div className="space-y-4">
      {/* Month nav */}
      <div className="flex items-center justify-between bg-card rounded-2xl p-4" style={{ boxShadow: 'var(--shadow-card)' }}>
        <button onClick={() => onMonthChange(subMonths(month, 1))} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
          <ChevronLeft size={18} />
        </button>
        <span className="font-bold text-sm capitalize">
          {format(month, 'MMMM yyyy', { locale: ptBR })}
        </span>
        <button onClick={() => onMonthChange(addMonths(month, 1))} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Calendar grid */}
      <div className="bg-card rounded-2xl p-4 overflow-hidden" style={{ boxShadow: 'var(--shadow-card)' }}>
        <div className="grid grid-cols-7 mb-2">
          {['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map((d) => (
            <div key={d} className="text-center text-[10px] font-bold text-muted-foreground py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
          {days.map((day) => {
            const key = format(day, 'yyyy-MM-dd');
            const posts = postsByDay[key] || [];
            const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;
            const isToday = isSameDay(day, new Date());
            return (
              <button
                key={key}
                onClick={() => onDaySelect(isSelected ? null : day)}
                className={`relative aspect-square rounded-lg flex flex-col items-center justify-start pt-1 transition-all text-xs font-semibold ${
                  isSelected ? 'bg-foreground text-background' :
                  isToday ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                  posts.length > 0 ? 'hover:bg-secondary' : 'hover:bg-secondary/50 text-muted-foreground'
                }`}
              >
                {format(day, 'd')}
                {posts.length > 0 && (
                  <div className="flex gap-0.5 mt-0.5 flex-wrap justify-center">
                    {posts.slice(0, 3).map((s, i) => {
                      const plats = parseJsonSafe<Platform[]>(s.platforms, []);
                      return (
                        <div key={i} className={`w-1.5 h-1.5 rounded-full ${
                          s.status === 'done' ? 'bg-emerald-400' :
                          s.status === 'failed' ? 'bg-red-400' : 'bg-blue-400'
                        }`} />
                      );
                    })}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Day detail */}
      {selectedDay && daySchedules.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {format(selectedDay, "d 'de' MMMM", { locale: ptBR })} — {daySchedules.length} post(s)
          </p>
          {daySchedules.map((s) => (
            <ScheduleRow key={s.id} schedule={s} onDelete={onDelete} onTrigger={onTrigger} />
          ))}
        </div>
      )}
      {selectedDay && daySchedules.length === 0 && (
        <p className="text-center text-xs text-muted-foreground py-4">Nenhum post nesse dia</p>
      )}
    </div>
  );
}

// ── Fila ──────────────────────────────────────────────────────────────────────
function FilaView({ schedules, onDelete, onTrigger, onRefresh }: {
  schedules: Schedule[];
  onDelete: (id: string) => void;
  onTrigger: (id: string) => void;
  onRefresh: () => void;
}) {
  const now = new Date();
  const upcoming = schedules.filter((s) => s.status === 'pending');
  const history = schedules.filter((s) => s.status !== 'pending');

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {upcoming.length} agendado(s)
        </p>
        <button onClick={onRefresh} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw size={13} /> Atualizar
        </button>
      </div>

      {upcoming.length === 0 ? (
        <div className="py-10 text-center text-muted-foreground">
          <Clock size={28} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">Nenhum post agendado</p>
          <p className="text-xs mt-1">Vá para Biblioteca e clique em "Agendar"</p>
        </div>
      ) : (
        <div className="space-y-2">
          {upcoming.map((s) => (
            <ScheduleRow key={s.id} schedule={s} onDelete={onDelete} onTrigger={onTrigger} />
          ))}
        </div>
      )}

      {history.length > 0 && (
        <>
          <div className="h-px bg-border" />
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Histórico</p>
          <div className="space-y-2">
            {history.slice(0, 20).map((s) => (
              <ScheduleRow key={s.id} schedule={s} onDelete={onDelete} onTrigger={onTrigger} compact />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ScheduleRow({ schedule: s, onDelete, onTrigger, compact = false }: {
  schedule: Schedule;
  onDelete: (id: string) => void;
  onTrigger: (id: string) => void;
  compact?: boolean;
}) {
  const plats = parseJsonSafe<Platform[]>(s.platforms, []);
  const cfg = STATUS_CONFIG[s.status] || STATUS_CONFIG.pending;
  const StatusIcon = cfg.icon;
  const date = parseISO(s.scheduled_for);
  const repeat = s.repeat_rule !== 'none' ? parseJsonSafe<RepeatRule>(s.repeat_rule, null as any) : null;

  return (
    <div className={`bg-card rounded-xl p-3 border border-border flex items-start gap-3 ${compact ? 'opacity-70' : ''}`} style={{ boxShadow: 'var(--shadow-card)' }}>
      {/* Thumbnail */}
      <div className="w-10 h-10 rounded-lg bg-secondary overflow-hidden shrink-0 flex items-center justify-center">
        {s.thumbnail ? (
          <img src={uploadsUrl(s.thumbnail)} alt="" className="w-full h-full object-cover" />
        ) : (
          <Play size={14} className="text-muted-foreground" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{s.content_title}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {/* Platform pills */}
          {plats.map((p) => (
            <span key={p} className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-white font-bold ${PLATFORM_COLORS[p]}`}>
              <PlatformIcon p={p} size={10} /> {p}
            </span>
          ))}
          {/* Date */}
          <span className="text-[11px] text-muted-foreground">
            {format(date, "dd/MM/yy HH:mm")}
          </span>
          {/* Repeat badge */}
          {repeat && repeat.type !== 'none' && (
            <span className="text-[10px] bg-secondary px-1.5 py-0.5 rounded font-medium text-muted-foreground">
              ↻ {repeat.type === 'daily' ? 'diário' : repeat.type === 'weekly' ? 'semanal' : 'mensal'}
            </span>
          )}
        </div>
        {s.error_message && (
          <p className="text-[10px] text-red-500 mt-0.5 truncate">{s.error_message}</p>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {/* Status badge */}
        <span className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold ${cfg.color}`}>
          <StatusIcon size={10} className={s.status === 'posting' ? 'animate-spin' : ''} />
          {cfg.label}
        </span>

        {/* Actions */}
        {s.status === 'pending' && (
          <button
            onClick={() => onTrigger(s.id)}
            title="Publicar agora"
            className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          >
            <Zap size={14} />
          </button>
        )}
        <button
          onClick={() => onDelete(s.id)}
          className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-red-500"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Upload Modal ──────────────────────────────────────────────────────────────
function UploadModal({ type, onClose, onSuccess }: {
  type: 'video' | 'carousel';
  onClose: () => void;
  onSuccess: (item: ContentItem) => void;
}) {
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!files.length) { setError('Selecione ao menos 1 arquivo'); return; }
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('title', title || files[0].name);
      form.append('caption', caption);
      form.append('hashtags', hashtags);
      if (type === 'video') {
        form.append('file', files[0]);
        const item = await api.upload<ContentItem>('/api/content/video', form);
        onSuccess(item);
      } else {
        for (const f of files) form.append('files', f);
        const item = await api.upload<ContentItem>('/api/content/carousel', form);
        onSuccess(item);
      }
    } catch (e: any) {
      setError(e.message || 'Erro no upload');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-4">
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-background rounded-2xl p-6 w-full max-w-md"
        style={{ boxShadow: 'var(--shadow-layered)' }}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-base">
            {type === 'video' ? '🎬 Subir Vídeo' : '🖼️ Subir Carrossel'}
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-secondary transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* File picker */}
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-foreground/30 transition-colors"
          >
            <Upload size={24} className="mx-auto mb-2 text-muted-foreground" />
            {files.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {type === 'video' ? 'Clique para selecionar um vídeo (.mp4, .mov)' : 'Clique para selecionar imagens'}
              </p>
            ) : (
              <p className="text-sm font-semibold">{files.map((f) => f.name).join(', ')}</p>
            )}
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept={type === 'video' ? 'video/mp4,video/quicktime,video/mov' : 'image/*'}
              multiple={type === 'carousel'}
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
          </div>

          <input
            type="text"
            placeholder="Título (opcional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10"
          />
          <textarea
            placeholder="Legenda / Caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={3}
            className="w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 resize-none"
          />
          <input
            type="text"
            placeholder="#hashtags #separadas #por #espaço"
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            className="w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10"
          />

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={uploading}
            className="w-full py-2.5 bg-foreground text-background rounded-xl text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2"
          >
            {uploading ? <><Loader2 size={16} className="animate-spin" /> Enviando...</> : 'Salvar na Biblioteca'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

// ── Schedule Modal ────────────────────────────────────────────────────────────
function ScheduleModal({ item, platforms, onClose, onSuccess }: {
  item: ContentItem;
  platforms: PlatformsStatus;
  onClose: () => void;
  onSuccess: (created: Schedule[]) => void;
}) {
  const [selPlatforms, setSelPlatforms] = useState<Platform[]>(
    PLATFORMS.filter((p) => platforms[p].connected)
  );
  const [caption, setCaption] = useState(item.caption || '');
  const [hashtags, setHashtags] = useState(item.hashtags || '');
  const [dates, setDates] = useState<string[]>([toLocalDateTimeString(new Date())]);
  const [repeatType, setRepeatType] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
  const [repeatInterval, setRepeatInterval] = useState(1);
  const [repeatEndDate, setRepeatEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function togglePlatform(p: Platform) {
    setSelPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  }

  function addDate() {
    setDates((p) => [...p, toLocalDateTimeString(new Date())]);
  }

  function updateDate(i: number, v: string) {
    setDates((p) => p.map((d, idx) => idx === i ? v : d));
  }

  function removeDate(i: number) {
    setDates((p) => p.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selPlatforms.length) { setError('Selecione ao menos 1 plataforma'); return; }
    if (!dates.length) { setError('Adicione ao menos 1 data'); return; }
    setLoading(true);
    setError('');
    try {
      const repeat_rule = repeatType !== 'none'
        ? { type: repeatType, interval: repeatInterval, end_date: repeatEndDate || null }
        : null;

      const isoDatees = dates.map((d) => new Date(d).toISOString());
      const created = await api.post<Schedule[]>('/api/schedule', {
        content_item_id: item.id,
        platforms: selPlatforms,
        dates: isoDatees,
        caption,
        hashtags,
        repeat_rule,
      });
      onSuccess(created);
    } catch (e: any) {
      setError(e.message || 'Erro ao agendar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-4 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-background rounded-2xl p-6 w-full max-w-md my-4"
        style={{ boxShadow: 'var(--shadow-layered)' }}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-base">📅 Agendar Post</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-secondary"><X size={18} /></button>
        </div>

        {/* Preview do item */}
        <div className="flex items-center gap-3 p-3 bg-secondary rounded-xl mb-5">
          <div className="w-10 h-10 rounded-lg bg-border overflow-hidden shrink-0 flex items-center justify-center">
            {item.thumbnail ? (
              <img src={uploadsUrl(item.thumbnail)} alt="" className="w-full h-full object-cover" />
            ) : (
              <Play size={14} className="text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{item.title}</p>
            <p className="text-[10px] text-muted-foreground capitalize">{item.type}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Plataformas */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 block">Plataformas</label>
            <div className="flex gap-2">
              {PLATFORMS.map((p) => {
                const connected = platforms[p].connected;
                const selected = selPlatforms.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    disabled={!connected}
                    onClick={() => togglePlatform(p)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold border-2 transition-all ${
                      !connected ? 'opacity-30 cursor-not-allowed border-border bg-secondary text-muted-foreground' :
                      selected ? `border-transparent text-white ${PLATFORM_COLORS[p]}` :
                      'border-border bg-secondary text-muted-foreground hover:border-foreground/30'
                    }`}
                    title={!connected ? `${p} não conectado` : undefined}
                  >
                    <PlatformIcon p={p} size={13} />
                    {p}
                  </button>
                );
              })}
            </div>
            {!PLATFORMS.some((p) => platforms[p].connected) && (
              <p className="text-[11px] text-orange-500 mt-1">Conecte ao menos 1 plataforma nas configurações</p>
            )}
          </div>

          {/* Caption */}
          <textarea
            placeholder="Legenda / Caption (opcional — usa o padrão do conteúdo)"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={2}
            className="w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-foreground/10"
          />
          <input
            type="text"
            placeholder="#hashtags (opcional)"
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            className="w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10"
          />

          {/* Datas */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 block">
              Datas de Publicação
            </label>
            <div className="space-y-2">
              {dates.map((d, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    type="datetime-local"
                    value={d}
                    onChange={(e) => updateDate(i, e.target.value)}
                    className="flex-1 bg-secondary border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10"
                  />
                  {dates.length > 1 && (
                    <button type="button" onClick={() => removeDate(i)} className="p-2 rounded-lg hover:bg-secondary transition-colors">
                      <X size={14} className="text-muted-foreground" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addDate}
              className="mt-2 flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus size={13} /> Adicionar outra data
            </button>
          </div>

          {/* Repetição */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 block">Repetição</label>
            <div className="flex gap-2 flex-wrap">
              {(['none', 'daily', 'weekly', 'monthly'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRepeatType(r)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                    repeatType === r ? 'bg-foreground text-background border-transparent' : 'bg-secondary border-border text-muted-foreground'
                  }`}
                >
                  {r === 'none' ? 'Sem repetição' : r === 'daily' ? 'Diário' : r === 'weekly' ? 'Semanal' : 'Mensal'}
                </button>
              ))}
            </div>
            {repeatType !== 'none' && (
              <div className="mt-2 flex gap-2 items-center">
                <span className="text-xs text-muted-foreground">A cada</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={repeatInterval}
                  onChange={(e) => setRepeatInterval(Number(e.target.value))}
                  className="w-16 bg-secondary border border-border rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none"
                />
                <span className="text-xs text-muted-foreground">
                  {repeatType === 'daily' ? 'dia(s)' : repeatType === 'weekly' ? 'semana(s)' : 'mês(es)'}
                </span>
                <span className="text-xs text-muted-foreground ml-2">até</span>
                <input
                  type="date"
                  value={repeatEndDate}
                  onChange={(e) => setRepeatEndDate(e.target.value)}
                  placeholder="Sem fim"
                  className="flex-1 bg-secondary border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none"
                />
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-foreground text-background rounded-xl text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2"
          >
            {loading
              ? <><Loader2 size={16} className="animate-spin" /> Agendando...</>
              : `Agendar ${dates.length} post(s) em ${selPlatforms.length} plataforma(s)`
            }
          </button>
        </form>
      </motion.div>
    </div>
  );
}

// ── Platforms Modal ───────────────────────────────────────────────────────────
function PlatformsModal({ platforms, onClose, onRefresh }: {
  platforms: PlatformsStatus;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [igToken, setIgToken] = useState('');
  const [igUserId, setIgUserId] = useState('');
  const [igUsername, setIgUsername] = useState('');
  const [saving, setSaving] = useState<Platform | null>(null);
  const [msg, setMsg] = useState('');

  async function connectInstagram() {
    if (!igToken || !igUserId) { setMsg('Token e User ID são obrigatórios'); return; }
    setSaving('instagram');
    try {
      await api.post('/api/platforms/instagram/manual', {
        access_token: igToken, user_id: igUserId, username: igUsername || 'instagram',
      });
      setMsg('✅ Instagram conectado!');
      await onRefresh();
    } catch (e: any) {
      setMsg(`❌ ${e.message}`);
    }
    setSaving(null);
  }

  async function connectOAuth(platform: 'tiktok' | 'youtube') {
    setSaving(platform);
    try {
      const { url } = await api.get<{ url: string }>(`/api/platforms/${platform}/auth-url`);
      window.open(url, '_blank', 'width=600,height=700');
      setMsg(`Autorize no popup e atualize esta página`);
    } catch (e: any) {
      setMsg(`❌ ${e.message}`);
    }
    setSaving(null);
  }

  async function disconnect(platform: Platform) {
    await api.delete(`/api/platforms/${platform}`);
    await onRefresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-4 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-background rounded-2xl p-6 w-full max-w-md my-4"
        style={{ boxShadow: 'var(--shadow-layered)' }}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-base">🔌 Conectar Plataformas</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-secondary"><X size={18} /></button>
        </div>

        <div className="space-y-5">
          {/* Instagram */}
          <div className="p-4 bg-card rounded-xl border border-border">
            <div className="flex items-center gap-2 mb-3">
              <Instagram size={18} className="text-pink-500" />
              <span className="font-bold text-sm">Instagram</span>
              {platforms.instagram.connected && (
                <span className="ml-auto text-xs text-emerald-600 font-bold">✓ {platforms.instagram.username}</span>
              )}
            </div>
            {platforms.instagram.connected ? (
              <button onClick={() => disconnect('instagram')} className="text-xs text-red-500 hover:text-red-700 font-medium">
                Desconectar
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground">
                  Cole seu <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" className="underline">long-lived token</a> do Meta Graph Explorer
                </p>
                <input type="text" placeholder="Access Token" value={igToken} onChange={(e) => setIgToken(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-xs focus:outline-none" />
                <input type="text" placeholder="Instagram User ID (numérico)" value={igUserId} onChange={(e) => setIgUserId(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-xs focus:outline-none" />
                <input type="text" placeholder="Username (opcional)" value={igUsername} onChange={(e) => setIgUsername(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-xs focus:outline-none" />
                <button onClick={connectInstagram} disabled={saving === 'instagram'}
                  className="w-full py-2 bg-pink-500 text-white rounded-lg text-xs font-bold hover:bg-pink-600 disabled:opacity-50 transition-colors">
                  {saving === 'instagram' ? 'Salvando...' : 'Conectar Instagram'}
                </button>
              </div>
            )}
          </div>

          {/* TikTok */}
          <div className="p-4 bg-card rounded-xl border border-border">
            <div className="flex items-center gap-2 mb-3">
              <TikTokIcon size={18} />
              <span className="font-bold text-sm">TikTok</span>
              {platforms.tiktok.connected && (
                <span className="ml-auto text-xs text-emerald-600 font-bold">✓ {platforms.tiktok.username}</span>
              )}
            </div>
            {platforms.tiktok.connected ? (
              <button onClick={() => disconnect('tiktok')} className="text-xs text-red-500 hover:text-red-700 font-medium">
                Desconectar
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground">Requer app aprovado no TikTok Developer Portal</p>
                <button onClick={() => connectOAuth('tiktok')} disabled={saving === 'tiktok'}
                  className="w-full py-2 bg-black text-white rounded-lg text-xs font-bold hover:opacity-80 disabled:opacity-50 transition-opacity">
                  {saving === 'tiktok' ? 'Abrindo...' : 'Conectar via OAuth'}
                </button>
              </div>
            )}
          </div>

          {/* YouTube */}
          <div className="p-4 bg-card rounded-xl border border-border">
            <div className="flex items-center gap-2 mb-3">
              <Youtube size={18} className="text-red-500" />
              <span className="font-bold text-sm">YouTube</span>
              {platforms.youtube.connected && (
                <span className="ml-auto text-xs text-emerald-600 font-bold">✓ {platforms.youtube.username}</span>
              )}
            </div>
            {platforms.youtube.connected ? (
              <button onClick={() => disconnect('youtube')} className="text-xs text-red-500 hover:text-red-700 font-medium">
                Desconectar
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground">Requer projeto no Google Cloud com YouTube Data API v3 ativada</p>
                <button onClick={() => connectOAuth('youtube')} disabled={saving === 'youtube'}
                  className="w-full py-2 bg-red-500 text-white rounded-lg text-xs font-bold hover:bg-red-600 disabled:opacity-50 transition-colors">
                  {saving === 'youtube' ? 'Abrindo...' : 'Conectar via Google'}
                </button>
              </div>
            )}
          </div>

          {msg && (
            <p className={`text-xs text-center font-medium ${msg.startsWith('✅') ? 'text-emerald-600' : msg.startsWith('❌') ? 'text-red-500' : 'text-muted-foreground'}`}>
              {msg}
            </p>
          )}

          {/* Guia rápido */}
          <div className="p-3 bg-secondary rounded-xl">
            <p className="text-[11px] font-bold mb-1 text-muted-foreground uppercase tracking-wider">Configure o servidor</p>
            <p className="text-[11px] text-muted-foreground">
              Adicione suas credenciais em <code className="bg-border px-1 rounded">server/.env</code> baseado no arquivo <code className="bg-border px-1 rounded">server/.env.example</code>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function toLocalDateTimeString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
