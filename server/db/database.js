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
const getAllIdeas      = () => readDb('ideas').sort((a, b) => b.created_at.localeCompare(a.created_at));
const createIdea      = (i) => { const db = readDb('ideas'); db.push({ ...i, tags: JSON.stringify(i.tags || []), created_at: now() }); writeDb('ideas', db); };
const updateIdea      = (id, data) => { const db = readDb('ideas').map((i) => i.id === id ? { ...i, ...data } : i); writeDb('ideas', db); };
const deleteIdea      = (id) => writeDb('ideas', readDb('ideas').filter((i) => i.id !== id));

module.exports = {
  getAllContent, getContent, createContent, updateContent, deleteContent,
  getAllSchedules, getSchedule, createSchedule, deleteSchedule,
  getPendingSchedules, updateScheduleStatus,
  getPlatformToken, setPlatformToken, deletePlatformToken,
  getAllReferences, createReference, deleteReference,
  getAllHooks, createHook, incrementHookUse, deleteHook,
  getAllIdeas, createIdea, updateIdea, deleteIdea,
};
