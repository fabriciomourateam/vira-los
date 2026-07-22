/**
 * Database layer — JSON file-based persistence
 * Zero native dependencies, works on Windows/Mac/Linux sem compilação.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../uploads');

// Garante que os diretórios existem
if (!fs.existsSync(DATA_DIR))    fs.mkdirSync(DATA_DIR,    { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── JSON store helpers ────────────────────────────────────────────────────────
function dbPath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function readDb(name) {
  const p = dbPath(name);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
}

function writeDb(name, data) {
  fs.writeFileSync(dbPath(name), JSON.stringify(data, null, 2), 'utf8');
}

function readObj(name) {
  const p = dbPath(name);
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

function writeObj(name, data) {
  fs.writeFileSync(dbPath(name), JSON.stringify(data, null, 2), 'utf8');
}

function now() {
  return new Date().toISOString();
}

// ── Seed default hook templates ───────────────────────────────────────────────
const HOOKS_FILE = dbPath('hooks');
if (!fs.existsSync(HOOKS_FILE)) {
  const defaultHooks = [
    { id: 'h01', text: '3 sinais que sua {tema} está baixa...', category: 'list', use_count: 0, created_at: now() },
    { id: 'h02', text: 'O que ninguém te conta sobre {tema}', category: 'curiosity', use_count: 0, created_at: now() },
    { id: 'h03', text: 'Antes eu tinha {problema}. Depois que descobri {solução}...', category: 'before_after', use_count: 0, created_at: now() },
    { id: 'h04', text: 'Se você tem mais de 30 anos e {sintoma}, presta atenção nisso', category: 'fear', use_count: 0, created_at: now() },
    { id: 'h05', text: 'Para de {erro comum} se você quer {resultado desejado}', category: 'fear', use_count: 0, created_at: now() },
    { id: 'h06', text: 'A verdade sobre {tema} que especialistas não falam', category: 'curiosity', use_count: 0, created_at: now() },
    { id: 'h07', text: 'Como eu consegui {resultado} em {tempo} sem {sacrifício}', category: 'before_after', use_count: 0, created_at: now() },
    { id: 'h08', text: 'Você comete esses {N} erros com {tema}?', category: 'question', use_count: 0, created_at: now() },
    { id: 'h09', text: 'Isso vai mudar a forma como você vê {tema} para sempre', category: 'curiosity', use_count: 0, created_at: now() },
    { id: 'h10', text: '{N} coisas que ninguém faz mas que {benefício enorme}', category: 'list', use_count: 0, created_at: now() },
    { id: 'h11', text: 'Por que {crença comum} está destruindo seu {resultado}', category: 'fear', use_count: 0, created_at: now() },
    { id: 'h12', text: 'O segredo de {pessoa de sucesso} para {resultado}', category: 'curiosity', use_count: 0, created_at: now() },
    { id: 'h13', text: 'Fiz {ação} por {tempo} e olha o que aconteceu...', category: 'before_after', use_count: 0, created_at: now() },
    { id: 'h14', text: 'Se eu soubesse isso antes, teria {resultado mais rápido}', category: 'curiosity', use_count: 0, created_at: now() },
    { id: 'h15', text: '{N} erros que estão impedindo você de {objetivo}', category: 'list', use_count: 0, created_at: now() },
  ];
  writeDb('hooks', defaultHooks);
}

// ── Content Items ─────────────────────────────────────────────────────────────
const getAllContent    = () => readDb('content').sort((a, b) => b.created_at.localeCompare(a.created_at));
const getContent      = (id) => readDb('content').find((c) => c.id === id) || null;
const createContent   = (item) => { const db = readDb('content'); db.push({ ...item, created_at: now() }); writeDb('content', db); };
const updateContent   = (id, data) => { const db = readDb('content').map((c) => c.id === id ? { ...c, ...data } : c); writeDb('content', db); };
const deleteContent   = (id) => writeDb('content', readDb('content').filter((c) => c.id !== id));

// ── Scheduled Posts ───────────────────────────────────────────────────────────
function getAllSchedules() {
  const content = readDb('content');
  const map = Object.fromEntries(content.map((c) => [c.id, c]));
  return readDb('schedules')
    .map((s) => {
      const c = map[s.content_item_id] || {};
      return {
        ...s,
        content_title: c.title || '',
        content_type: c.type || 'video',
        thumbnail: c.thumbnail || null,
        file_path: c.file_path || '',
        content_caption: c.caption || '',
        content_hashtags: c.hashtags || '',
      };
    })
    .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));
}

function getSchedule(id) {
  const base = readDb('schedules').find((s) => s.id === id);
  if (!base) return null;
  const c = getContent(base.content_item_id) || {};
  return {
    ...base,
    content_title: c.title || '',
    content_type: c.type || 'video',
    thumbnail: c.thumbnail || null,
    file_path: c.file_path || '',
    content_caption: c.caption || '',
    content_hashtags: c.hashtags || '',
  };
}

const createSchedule = (s) => {
  const db = readDb('schedules');
  db.push({ ...s, created_at: now() });
  writeDb('schedules', db);
};

const deleteSchedule = (id) => writeDb('schedules', readDb('schedules').filter((s) => s.id !== id));

function getPendingSchedules(beforeDate) {
  const content = readDb('content');
  const map = Object.fromEntries(content.map((c) => [c.id, c]));
  return readDb('schedules')
    .filter((s) => s.status === 'pending' && s.scheduled_for <= beforeDate)
    .map((s) => {
      const c = map[s.content_item_id] || {};
      return {
        ...s,
        content_title: c.title || '',
        content_type: c.type || 'video',
        file_path: c.file_path || '',
        content_caption: c.caption || '',
        content_hashtags: c.hashtags || '',
      };
    });
}

function updateScheduleStatus(id, status, error = null, postedAt = null) {
  const db = readDb('schedules').map((s) =>
    s.id === id ? { ...s, status, error_message: error, posted_at: postedAt } : s
  );
  writeDb('schedules', db);
}

// ── Platform Tokens ───────────────────────────────────────────────────────────
const getPlatformToken = (platform) => readObj('tokens')[platform] || null;

function setPlatformToken(platform, data) {
  const tokens = readObj('tokens');
  tokens[platform] = { ...tokens[platform], ...data, updated_at: now() };
  writeObj('tokens', tokens);
}

function deletePlatformToken(platform) {
  const tokens = readObj('tokens');
  delete tokens[platform];
  writeObj('tokens', tokens);
}

// ── Viral References ──────────────────────────────────────────────────────────
const getAllReferences  = () => readDb('references').sort((a, b) => b.saved_at.localeCompare(a.saved_at));
const createReference  = (r) => { const db = readDb('references'); db.push({ ...r, tags: JSON.stringify(r.tags || []), saved_at: now() }); writeDb('references', db); };
const deleteReference  = (id) => writeDb('references', readDb('references').filter((r) => r.id !== id));

// ── Hook Templates ────────────────────────────────────────────────────────────
const getAllHooks      = () => readDb('hooks').sort((a, b) => b.use_count - a.use_count || b.created_at.localeCompare(a.created_at));
const createHook      = (h) => { const db = readDb('hooks'); db.push({ ...h, use_count: 0, created_at: now() }); writeDb('hooks', db); };
const incrementHookUse = (id) => { const db = readDb('hooks').map((h) => h.id === id ? { ...h, use_count: h.use_count + 1 } : h); writeDb('hooks', db); };
const deleteHook      = (id) => writeDb('hooks', readDb('hooks').filter((h) => h.id !== id));

// ── Content Ideas ─────────────────────────────────────────────────────────────
const getAllIdeas      = () => readDb('ideas').map(i => ({ status: 'idea', ...i })).sort((a, b) => b.created_at.localeCompare(a.created_at));
const createIdea      = (i) => { const db = readDb('ideas'); db.push({ ...i, tags: JSON.stringify(i.tags || []), created_at: now() }); writeDb('ideas', db); };
const updateIdea      = (id, data) => { const db = readDb('ideas').map((i) => i.id === id ? { ...i, ...data } : i); writeDb('ideas', db); };
const deleteIdea      = (id) => writeDb('ideas', readDb('ideas').filter((i) => i.id !== id));

// ── Post Results (log de publicações) ────────────────────────────────────────
function logPostResult(result) {
  const db = readDb('post_results');
  db.push({ ...result, logged_at: now() });
  writeDb('post_results', db);
}

// ── Ideas Generator Config (pré-carregado com nicho do usuário) ───────────────
const IDEAS_CONFIG_FILE = dbPath('ideas_config');
if (!fs.existsSync(IDEAS_CONFIG_FILE)) {
  writeObj('ideas_config', {
    niche: 'Nutrição esportiva, fitness, uso de hormônios para fins estéticos, dieta e treino',
    instagramHandle: 'fabriciomourateam',
    hashtags: [
      'nutricaoesportiva', 'fitness', 'musculacao', 'dieta', 'treino', 'academia',
      'testosterona', 'oxandrolona', 'mounjaro', 'semaglutida', 'trt',
      'hipertrofia', 'emagrecimento', 'cutting', 'bulking', 'composicaocorporal',
      'suplementacao', 'bodybuilding', 'transformacaocorporal', 'saudemasculina',
      'peptideos', 'hormonioestetico', 'anabolizantes', 'nutricionista',
      'personaltrainer', 'ozempic', 'tirzepatida', 'nutricaofuncional',
      'perdadegordura', 'ganhodemassa', 'shape', 'definicaomuscular',
    ],
    keywords: [
      'nutrição esportiva', 'testosterona TRT', 'mounjaro emagrecimento',
      'oxandrolona resultados', 'hipertrofia dicas', 'dieta fitness',
      'hormônios estéticos', 'composição corporal', 'semaglutida emagrecimento',
    ],
    platforms: ['instagram', 'tiktok', 'trends', 'reddit'],
    postsPerDay: 3,
    country: 'BR',
    updated_at: new Date().toISOString(),
  });
}

const getIdeasConfig       = () => readObj('ideas_config');
const setIdeasConfig       = (c) => writeObj('ideas_config', { ...c, updated_at: now() });

const getDiscoveredIdeas   = () => readDb('discovered_ideas').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
const saveDiscoveredIdeas  = (ideas) => writeDb('discovered_ideas', ideas.map(i => ({ ...i, created_at: i.created_at || now() })));
const deleteDiscoveredIdea = (id) => writeDb('discovered_ideas', readDb('discovered_ideas').filter(i => i.id !== id));

const getContentCalendar   = () => readObj('content_calendar');
const setContentCalendar   = (cal) => writeObj('content_calendar', cal);

const getTrackedPosts      = () => readDb('tracked_posts').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
const addTrackedPost       = (p) => { const db = readDb('tracked_posts'); db.push({ ...p, created_at: now() }); writeDb('tracked_posts', db); };
const updateTrackedPost    = (id, data) => writeDb('tracked_posts', readDb('tracked_posts').map(p => p.id === id ? { ...p, ...data, updated_at: now() } : p));
const deleteTrackedPost    = (id) => writeDb('tracked_posts', readDb('tracked_posts').filter(p => p.id !== id));

// ── Slides Salvos (biblioteca de slides reutilizáveis) ────────────────────────
const getSavedSlides  = () => readDb('saved_slides').sort((a, b) => b.created_at.localeCompare(a.created_at));
const saveSlide       = (s) => { const db = readDb('saved_slides'); db.push({ ...s, created_at: now() }); writeDb('saved_slides', db); };
const deleteSavedSlide = (id) => writeDb('saved_slides', readDb('saved_slides').filter(s => s.id !== id));

// ── Instagram Token + Posts + Analysis ───────────────────────────────────────
const getInstagramToken     = () => readObj('instagram_token');
const setInstagramToken     = (data) => writeObj('instagram_token', { ...data, updatedAt: now() });
const clearInstagramToken   = () => {
  const p = dbPath('instagram_token');
  if (fs.existsSync(p)) fs.unlinkSync(p);
};
const getInstagramPosts     = () => readDb('instagram_posts');
const saveInstagramPosts    = (posts) => writeDb('instagram_posts', posts);
const getInstagramAnalysis  = () => readObj('instagram_analysis');
const saveInstagramAnalysis = (data) => writeObj('instagram_analysis', { ...data, savedAt: now() });
const getInstagramAudience  = () => readObj('instagram_audience');
const setInstagramAudience  = (data) => writeObj('instagram_audience', { ...data, savedAt: now() });

// ── Instagram History (snapshots de métricas — 1 por dia, append-only) ────────
const getInstagramHistory   = () => readDb('instagram_history');
const appendInstagramHistory = (snapshot) => {
  const hist = readDb('instagram_history');
  const day = (snapshot.date || now()).slice(0, 10);
  const idx = hist.findIndex((h) => (h.date || '').slice(0, 10) === day);
  if (idx >= 0) hist[idx] = snapshot;   // mesma data → atualiza o registro do dia
  else hist.push(snapshot);
  hist.sort((a, b) => new Date(a.date) - new Date(b.date));
  writeDb('instagram_history', hist);
  return hist;
};

// ── Carousel Config (persistente, único por usuário) ──────────────────────────
const getCarouselConfig = () => readObj('carousel_config');
const setCarouselConfig = (config) => {
  const { updated_at, ...rest } = config; // evita duplicar campo de controle
  writeObj('carousel_config', { ...rest, updated_at: now() });
};

// ── Carrosseis Salvos (histórico + templates) ─────────────────────────────────
const getAllCarousels  = () => readDb('carousels').sort((a, b) => b.created_at.localeCompare(a.created_at));
const saveCarousel    = (c) => { const db = readDb('carousels'); db.push({ ...c, created_at: now() }); writeDb('carousels', db); };
const updateCarousel  = (id, data) => { const db = readDb('carousels').map((c) => c.id === id ? { ...c, ...data } : c); writeDb('carousels', db); };
const deleteCarousel  = (id) => writeDb('carousels', readDb('carousels').filter((c) => c.id !== id));

// ── Reels (roteiros gerados a partir de carrosseis salvos) ────────────────────
const getAllReels = () => readDb('reels').sort((a, b) => b.created_at.localeCompare(a.created_at));
const getReel    = (id) => readDb('reels').find((r) => r.id === id) || null;
const saveReel   = (r) => { const db = readDb('reels'); db.push({ ...r, created_at: now() }); writeDb('reels', db); };
const updateReel = (id, data) => { const db = readDb('reels').map((r) => r.id === id ? { ...r, ...data } : r); writeDb('reels', db); };
const deleteReel = (id) => writeDb('reels', readDb('reels').filter((r) => r.id !== id));

// ── Banco de vídeos crus (clipes de treino sem texto, pra render dos reels) ────
// Cada item: { id, path, file, originalName, size, used, usedByReelId, created_at }
const getAllRawVideos = () => readDb('raw_videos').sort((a, b) => b.created_at.localeCompare(a.created_at));
const getRawVideo    = (id) => readDb('raw_videos').find((v) => v.id === id) || null;
const saveRawVideo   = (v) => { const db = readDb('raw_videos'); db.push({ used: false, usedByReelId: null, ...v, created_at: now() }); writeDb('raw_videos', db); };
const updateRawVideo = (id, data) => { const db = readDb('raw_videos').map((v) => v.id === id ? { ...v, ...data } : v); writeDb('raw_videos', db); };
const deleteRawVideo = (id) => writeDb('raw_videos', readDb('raw_videos').filter((v) => v.id !== id));
// Pega o clipe cru livre mais antigo (FIFO) — o auto-pick da rotina diária.
const pickUnusedRawVideo = () => getAllRawVideos().filter((v) => !v.used).sort((a, b) => a.created_at.localeCompare(b.created_at))[0] || null;

// ── Conteúdo diário (rotina automática: 2 carrosséis + 2 reels/dia) ───────────
const getAllDailyBatches = () => readDb('daily_content').sort((a, b) => b.created_at.localeCompare(a.created_at));
const saveDailyBatch    = (b) => { const db = readDb('daily_content'); db.push({ ...b, created_at: now() }); writeDb('daily_content', db); };
const updateDailyBatch  = (id, data) => { const db = readDb('daily_content').map((b) => b.id === id ? { ...b, ...data } : b); writeDb('daily_content', db); };

// ── Documentos vivos (painéis editáveis: Público / SEO) ───────────────────────
// Guarda só o override do usuário; se não existir, o frontend usa o default dele.
const getDoc = (id) => { const d = readObj(`doc_${id}`); return d && Object.keys(d).length ? d : null; };
const setDoc = (id, data) => writeObj(`doc_${id}`, { ...data, updated_at: now() });

// ── Caixinhas de perguntas (Q&A stickers gerados a partir do IG do usuário) ───
const getAllQaStickers = () => readDb('qa_stickers').sort((a, b) => b.created_at.localeCompare(a.created_at));
const saveQaStickers   = (s) => { const db = readDb('qa_stickers'); db.push({ ...s, created_at: now() }); writeDb('qa_stickers', db); };
const updateQaStickers = (id, data) => { const db = readDb('qa_stickers').map((s) => s.id === id ? { ...s, ...data } : s); writeDb('qa_stickers', db); };
const deleteQaStickers = (id) => writeDb('qa_stickers', readDb('qa_stickers').filter((s) => s.id !== id));
// Template customizado do prompt das caixinhas (editável pela UI)
const getCaixinhasPrompt = () => readObj('caixinhas_prompt');
const setCaixinhasPrompt = (data) => writeObj('caixinhas_prompt', { ...data, updated_at: now() });
const resetCaixinhasPrompt = () => { const p = dbPath('caixinhas_prompt'); if (fs.existsSync(p)) fs.unlinkSync(p); };

// ── Sessões de gravação de Reels (fila pra gravação em batch) ─────────────────
const getAllReelsSessions = () => readDb('reels_sessions').sort((a, b) => b.created_at.localeCompare(a.created_at));
const getReelsSession    = (id) => readDb('reels_sessions').find((s) => s.id === id) || null;
const saveReelsSession   = (s) => { const db = readDb('reels_sessions'); db.push({ ...s, created_at: now() }); writeDb('reels_sessions', db); };
const updateReelsSession = (id, data) => { const db = readDb('reels_sessions').map((s) => s.id === id ? { ...s, ...data, updated_at: now() } : s); writeDb('reels_sessions', db); };
const deleteReelsSession = (id) => writeDb('reels_sessions', readDb('reels_sessions').filter((s) => s.id !== id));

// ── Brand Kits ────────────────────────────────────────────────────────────────
const getAllBrandKits  = () => readDb('brand_kits').sort((a, b) => b.created_at.localeCompare(a.created_at));
const getBrandKit     = (id) => readDb('brand_kits').find((k) => k.id === id) || null;
const createBrandKit  = (k) => { const db = readDb('brand_kits'); db.push({ ...k, created_at: now(), updated_at: now() }); writeDb('brand_kits', db); return k; };
const updateBrandKit  = (id, data) => { const db = readDb('brand_kits').map((k) => k.id === id ? { ...k, ...data, updated_at: now() } : k); writeDb('brand_kits', db); };
const deleteBrandKit  = (id) => writeDb('brand_kits', readDb('brand_kits').filter((k) => k.id !== id));

// ── Studio Conversations ──────────────────────────────────────────────────────
const getAllStudioConversations = () => readDb('studio_conversations').sort((a, b) => b.updated_at.localeCompare(a.updated_at));
const getStudioConversation    = (id) => readDb('studio_conversations').find((c) => c.id === id) || null;
const createStudioConversation = (c) => { const db = readDb('studio_conversations'); db.push({ ...c, created_at: now(), updated_at: now() }); writeDb('studio_conversations', db); return c; };
const updateStudioConversation = (id, data) => { const db = readDb('studio_conversations').map((c) => c.id === id ? { ...c, ...data, updated_at: now() } : c); writeDb('studio_conversations', db); };
const deleteStudioConversation = (id) => {
  writeDb('studio_conversations', readDb('studio_conversations').filter((c) => c.id !== id));
  writeDb('studio_messages', readDb('studio_messages').filter((m) => m.conversation_id !== id));
};

// ── Studio Messages ───────────────────────────────────────────────────────────
const getStudioMessages       = (conv_id) => readDb('studio_messages').filter((m) => m.conversation_id === conv_id).sort((a, b) => a.created_at.localeCompare(b.created_at));
const createStudioMessage     = (m) => { const db = readDb('studio_messages'); db.push({ ...m, created_at: now() }); writeDb('studio_messages', db); return m; };
const updateStudioMessage     = (id, data) => { const db = readDb('studio_messages').map((m) => m.id === id ? { ...m, ...data } : m); writeDb('studio_messages', db); };

// ── Reels Scripts (banco de roteiros salvos) ─────────────────────────────────
const getAllReelsScripts = () => readDb('reels_scripts').sort((a, b) => (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at));
const createReelsScript = (s) => { const db = readDb('reels_scripts'); db.push({ ...s, created_at: now(), updated_at: now() }); writeDb('reels_scripts', db); return s; };
const updateReelsScript = (id, data) => { const db = readDb('reels_scripts').map((s) => s.id === id ? { ...s, ...data, updated_at: now() } : s); writeDb('reels_scripts', db); };
const deleteReelsScript = (id) => writeDb('reels_scripts', readDb('reels_scripts').filter((s) => s.id !== id));

// ── Studio Posts (galeria) ────────────────────────────────────────────────────
const getAllStudioPosts  = () => readDb('studio_posts').sort((a, b) => b.created_at.localeCompare(a.created_at));
const getStudioPost     = (id) => readDb('studio_posts').find((p) => p.id === id) || null;
const createStudioPost  = (p) => { const db = readDb('studio_posts'); db.push({ ...p, created_at: now(), updated_at: now() }); writeDb('studio_posts', db); return p; };
const updateStudioPost  = (id, data) => { const db = readDb('studio_posts').map((p) => p.id === id ? { ...p, ...data, updated_at: now() } : p); writeDb('studio_posts', db); };
const deleteStudioPost  = (id) => writeDb('studio_posts', readDb('studio_posts').filter((p) => p.id !== id));

// ── Máquina de Carrosséis (modo BrandsDecoded) ────────────────────────────────
// Schema: { id, briefing, headlines:[], headlineEscolhida, estrutura, html,
//          legenda, status: 'draft'|'approved'|'rendered', archived?:bool,
//          created_at, updated_at }
const getAllMaquinaCarrosseis = () => readDb('maquina_carrosseis').sort((a, b) => (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at));
const getMaquinaCarrossel    = (id) => readDb('maquina_carrosseis').find((c) => c.id === id) || null;
const createMaquinaCarrossel = (c) => { const db = readDb('maquina_carrosseis'); const item = { ...c, created_at: now(), updated_at: now() }; db.push(item); writeDb('maquina_carrosseis', db); return item; };
const updateMaquinaCarrossel = (id, data) => { const db = readDb('maquina_carrosseis').map((c) => c.id === id ? { ...c, ...data, updated_at: now() } : c); writeDb('maquina_carrosseis', db); };
const deleteMaquinaCarrossel = (id) => writeDb('maquina_carrosseis', readDb('maquina_carrosseis').filter((c) => c.id !== id));

// ── mLabs (agendamento via Browserless) ───────────────────────────────────────
// Settings: { profileId, channelSourceIds:[], ownerId, autoScheduleCarousel:bool,
//             defaultTimes:["11:00"], dateOffsetsMonths:[0,3,6,9], updated_at }
const MLABS_DEFAULTS = {
  profileId: null,
  channelSourceIds: [],          // canais de CARROSSEL/feed (ex.: [3,1,23])
  channelSourceIdsReel: [],      // canais de REEL/shorts/tiktok (ex.: [15,18,20,19])
  youtubeShortsChannelId: 20,    // id do canal YouTube Shorts (exige título no agendamento)
  ownerId: null,
  autoScheduleCarousel: false,
  autoScheduleReel: false,       // agenda o reel sozinho assim que o vídeo renderiza
  autoRenderReel: false,         // rotina diária queima o texto no clipe cru do banco
  defaultTime: '11:00',          // hora SP padrão das postagens
  dateOffsetsMonths: [0, 3, 6, 9], // CARROSSEL: amanhã e a cada 3 meses → 4 datas (evergreen)
  // REEL: esquema flexível "N posts/dia por X dias" (sem trava de 2/dia). Cada
  // reel ocupa 1 slot livre; slots = reelScheduleTimes × reelScheduleDays.
  reelPostsPerDay: 2,
  reelScheduleDays: 30,
  reelScheduleTimes: ['11:00', '18:00'],
  reelFontSize: 96,              // tamanho do texto queimado (px, base 1080×1920)
  reelFontFile: null,            // caminho de fonte custom (senão usa a do sistema)
  reelCtaColor: '#F5B301',       // cor do "Leia a legenda" (dourado, como nos reels dele)
  reelCtaAtMiddle: true,         // "Leia a legenda" entra na metade do vídeo → fim
  updated_at: null,
};
const getMlabsSettings = () => ({ ...MLABS_DEFAULTS, ...readObj('mlabs_settings') });
const setMlabsSettings = (c) => writeObj('mlabs_settings', { ...getMlabsSettings(), ...c, updated_at: now() });

// Sessão do navegador (storageState do Playwright: cookies + localStorage)
const getMlabsSession = () => { const s = readObj('mlabs_session'); return s && s.cookies ? s : null; };
const setMlabsSession = (state) => writeObj('mlabs_session', state || {});
const clearMlabsSession = () => writeObj('mlabs_session', {});

// Registros de agendamento (o que MANDAMOS pro mLabs — pra você saber o que enviou)
// Schema: { id, contentType:'carousel'|'reel', contentId, caption, dates:[isoSP],
//           platforms:[], status:'agendado'|'erro', error?, mlabsResponse?, created_at }
const getAllMlabsSchedules = () => readDb('mlabs_schedules').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
const createMlabsSchedule = (s) => { const db = readDb('mlabs_schedules'); const item = { ...s, created_at: now() }; db.push(item); writeDb('mlabs_schedules', db); return item; };
const updateMlabsSchedule = (id, data) => { const db = readDb('mlabs_schedules').map((s) => s.id === id ? { ...s, ...data } : s); writeDb('mlabs_schedules', db); };
const deleteMlabsSchedule = (id) => writeDb('mlabs_schedules', readDb('mlabs_schedules').filter((s) => s.id !== id));

// Fotos usadas recentemente nos carrosséis (pra não repetir entre carrosséis seguidos).
// Lista das mais recentes primeiro, deduplicada por caminho (ignora querystring), capada.
const getRecentPhotoUrls = () => { const o = readObj('recent_photo_urls'); return Array.isArray(o.urls) ? o.urls : []; };
const addRecentPhotoUrls = (urls, cap = 80) => {
  if (!Array.isArray(urls) || !urls.length) return;
  const merged = [...urls.filter(Boolean), ...getRecentPhotoUrls()];
  const seen = new Set(); const out = [];
  for (const u of merged) {
    const k = String(u).split('?')[0];
    if (seen.has(k)) continue;
    seen.add(k); out.push(u);
    if (out.length >= cap) break;
  }
  writeObj('recent_photo_urls', { urls: out, updated_at: now() });
};

// Títulos/ângulos usados recentemente nos carrosséis diários (pra não repetir o mesmo
// enfoque). Mais recentes primeiro, deduplicado, capado.
const getRecentTopics = () => { const o = readObj('recent_topics'); return Array.isArray(o.topics) ? o.topics : []; };
const addRecentTopics = (topics, cap = 20) => {
  if (!Array.isArray(topics) || !topics.length) return;
  const merged = [...topics.filter(Boolean), ...getRecentTopics()];
  const seen = new Set(); const out = [];
  for (const t of merged) { if (seen.has(t)) continue; seen.add(t); out.push(t); if (out.length >= cap) break; }
  writeObj('recent_topics', { topics: out, updated_at: now() });
};

// CTA dos REELS (configurável, separado do CTA dos carrosséis). Default: comenta TESTO
// → passo a passo natural. Trocável sem código (setReelsCta).
const REELS_CTA_DEFAULT = { keyword: 'DIETA', benefit: 'te mando um cardápio que seca sem passar fome' };
const getReelsCta = () => ({ ...REELS_CTA_DEFAULT, ...readObj('reels_cta') });
const setReelsCta = (c) => writeObj('reels_cta', { ...getReelsCta(), ...c, updated_at: now() });

// CTA do CARROSSEL (último slide). Configurável — antes era chumbado em SHAPE/Acompanhamento.
// Default: comenta palavra pra receber valor (mecânica de comentário), coerente com os reels.
const CAROUSEL_CTA_DEFAULT = { label: 'COMENTA:', keyword: 'DIETA', benefit: 'Pra receber um cardápio que seca sem passar fome' };
const getCarouselCta = () => ({ ...CAROUSEL_CTA_DEFAULT, ...readObj('carousel_cta') });
const setCarouselCta = (c) => writeObj('carousel_cta', { ...getCarouselCta(), ...c, updated_at: now() });

module.exports = {
  getAllContent, getContent, createContent, updateContent, deleteContent,
  getAllSchedules, getSchedule, createSchedule, deleteSchedule,
  getPendingSchedules, updateScheduleStatus,
  getPlatformToken, setPlatformToken, deletePlatformToken,
  getAllReferences, createReference, deleteReference,
  getAllHooks, createHook, incrementHookUse, deleteHook,
  getAllIdeas, createIdea, updateIdea, deleteIdea,
  logPostResult,
  getSavedSlides, saveSlide, deleteSavedSlide,
  getCarouselConfig, setCarouselConfig,
  getAllCarousels, saveCarousel, updateCarousel, deleteCarousel,
  // Reels
  getAllReels, getReel, saveReel, updateReel, deleteReel,
  getAllRawVideos, getRawVideo, saveRawVideo, updateRawVideo, deleteRawVideo, pickUnusedRawVideo,
  getAllDailyBatches, saveDailyBatch, updateDailyBatch,
  getDoc, setDoc,  // Reels Sessions (fila de gravação)
  getAllReelsSessions, getReelsSession, saveReelsSession, updateReelsSession, deleteReelsSession,
  // Caixinhas de perguntas
  getAllQaStickers, saveQaStickers, updateQaStickers, deleteQaStickers,
  getCaixinhasPrompt, setCaixinhasPrompt, resetCaixinhasPrompt,
  // Brand Kits
  getAllBrandKits, getBrandKit, createBrandKit, updateBrandKit, deleteBrandKit,
  // Studio
  getAllStudioConversations, getStudioConversation, createStudioConversation, updateStudioConversation, deleteStudioConversation,
  getStudioMessages, createStudioMessage, updateStudioMessage,
  getAllStudioPosts, getStudioPost, createStudioPost, updateStudioPost, deleteStudioPost,
  // Máquina de Carrosséis
  getAllMaquinaCarrosseis, getMaquinaCarrossel, createMaquinaCarrossel, updateMaquinaCarrossel, deleteMaquinaCarrossel,
  // Reels Scripts
  getAllReelsScripts, createReelsScript, updateReelsScript, deleteReelsScript,
  getInstagramToken, setInstagramToken, clearInstagramToken,
  getInstagramPosts, saveInstagramPosts,
  getInstagramAnalysis, saveInstagramAnalysis,
  getInstagramAudience, setInstagramAudience,
  getInstagramHistory, appendInstagramHistory,
  // Ideas Generator
  getIdeasConfig, setIdeasConfig,
  getDiscoveredIdeas, saveDiscoveredIdeas, deleteDiscoveredIdea,
  getContentCalendar, setContentCalendar,
  getTrackedPosts, addTrackedPost, updateTrackedPost, deleteTrackedPost,
  // mLabs
  getMlabsSettings, setMlabsSettings,
  getMlabsSession, setMlabsSession, clearMlabsSession,
  getAllMlabsSchedules, createMlabsSchedule, updateMlabsSchedule, deleteMlabsSchedule,
  getRecentPhotoUrls, addRecentPhotoUrls,
  getRecentTopics, addRecentTopics,
  getReelsCta, setReelsCta,
  getCarouselCta, setCarouselCta,
};
