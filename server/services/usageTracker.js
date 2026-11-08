/**
 * usageTracker.js
 * Rastreia toda chamada Claude (custo USD/BRL + tempo/dinheiro economizados).
 *
 * Como funciona:
 *  1. patchAnthropicSDK() monkey-patcha Anthropic.Messages.prototype.create UMA vez
 *     no startup do server. A partir daí toda chamada Claude (de qualquer arquivo)
 *     é interceptada e tem `usage` registrado.
 *  2. withFeature('label', () => fn()) define o rótulo da feature via AsyncLocalStorage.
 *     Middleware nos routes seta isso por requisição. Sem rótulo → 'unknown'.
 *  3. Persistido em data/claude_usage.json (cap em 10k entries).
 */

const { AsyncLocalStorage } = require('async_hooks');
const fs = require('fs');
const path = require('path');

const featureCtx = new AsyncLocalStorage();

// Preço USD por milhão de tokens (Anthropic — abr/2026).
// Fonte: https://www.anthropic.com/pricing
const PRICING = {
  'claude-sonnet-4-6':           { input: 3,    output: 15,  cacheRead: 0.30, cacheCreate: 3.75  },
  'claude-haiku-4-5-20251001':   { input: 0.80, output: 4,   cacheRead: 0.08, cacheCreate: 1.00  },
  'claude-haiku-4-5':            { input: 0.80, output: 4,   cacheRead: 0.08, cacheCreate: 1.00  },
  'claude-opus-4-7':             { input: 15,   output: 75,  cacheRead: 1.50, cacheCreate: 18.75 },
  // Fallback (Sonnet pricing) — modelo desconhecido
  '_default':                    { input: 3,    output: 15,  cacheRead: 0.30, cacheCreate: 3.75  },
};

// Minutos que cada feature economiza vs. fazer manualmente.
// Editável: ajuste aqui se a estimativa não bater com sua realidade.
const TIME_SAVED_MIN = {
  'carousel':              180,  // 3h — gerar 1 carrossel completo
  'regenerate-slide':       10,
  'legenda':                10,
  'maquina-headlines':      30,
  'maquina-structure':      20,
  'maquina-html':           60,
  'maquina-full':          180,
  'ideas':                  30,
  'reels-analysis':         25,
  'roteiro':                40,
  'viral-score':             5,
  'trend-radar':            15,
  'story-sequence':         30,
  'instagram-analytics':    20,
  'agent':                  10,
  'research':               30,
  'schedule':                5,
  'unknown':                 5,
};

// Configuração: cotação e custo/hora do social media.
// R$ 1600 bruto ÷ (22 dias úteis × 6h/dia) = R$ 12,12/hora
const USD_BRL = 5.20;
const SM_GROSS_BRL = 1600;
const SM_DAYS_PER_MONTH = 22;
const SM_HOURS_PER_DAY = 6;
const HOURLY_RATE_BRL = SM_GROSS_BRL / (SM_DAYS_PER_MONTH * SM_HOURS_PER_DAY);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const USAGE_FILE = path.join(DATA_DIR, 'claude_usage.json');

function readUsage() {
  try { return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); }
  catch { return []; }
}

function writeUsage(arr) {
  fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
  fs.writeFileSync(USAGE_FILE, JSON.stringify(arr, null, 2));
}

function priceFor(model) {
  return PRICING[model] || PRICING._default;
}

function timeSavedFor(feature) {
  return TIME_SAVED_MIN[feature] != null ? TIME_SAVED_MIN[feature] : TIME_SAVED_MIN.unknown;
}

function track(feature, model, usage) {
  if (!usage) return null;
  const p = priceFor(model);
  const inputTok    = usage.input_tokens || 0;
  const outputTok   = usage.output_tokens || 0;
  const cacheRead   = usage.cache_read_input_tokens || 0;
  const cacheCreate = usage.cache_creation_input_tokens || 0;
  const usd =
    (inputTok    / 1e6) * p.input +
    (outputTok   / 1e6) * p.output +
    (cacheRead   / 1e6) * p.cacheRead +
    (cacheCreate / 1e6) * p.cacheCreate;
  const brl = usd * USD_BRL;
  const minSaved = timeSavedFor(feature);
  const moneySaved = (minSaved / 60) * HOURLY_RATE_BRL;
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ts: new Date().toISOString(),
    feature, model: model || 'unknown',
    inputTok, outputTok, cacheRead, cacheCreate,
    usd:        +usd.toFixed(6),
    brl:        +brl.toFixed(4),
    minSaved,
    moneySaved: +moneySaved.toFixed(2),
  };
  const arr = readUsage();
  arr.push(entry);
  if (arr.length > 10000) arr.splice(0, arr.length - 10000);
  writeUsage(arr);
  return entry;
}

function withFeature(label, fn) {
  return featureCtx.run(label, fn);
}

function currentFeature() {
  return featureCtx.getStore() || 'unknown';
}

let _patched = false;
function patchAnthropicSDK() {
  if (_patched) return;
  const sdk = require('@anthropic-ai/sdk');
  const Anthropic = sdk.default || sdk;
  const Messages = Anthropic.Messages;
  if (!Messages || !Messages.prototype || !Messages.prototype.create) {
    console.warn('[usageTracker] Anthropic.Messages.prototype.create não encontrado — tracking desabilitado');
    return;
  }
  const origCreate = Messages.prototype.create;
  Messages.prototype.create = async function (...args) {
    const result = await origCreate.apply(this, args);
    try {
      const params = args[0] || {};
      const feature = currentFeature();
      // Streaming responses não retornam usage diretamente — pula
      if (result && result.usage) {
        track(feature, params.model, result.usage);
      }
    } catch (e) {
      console.error('[usageTracker] track failed:', e.message);
    }
    return result;
  };
  _patched = true;
  console.log('[usageTracker] Anthropic SDK patched — tracking ativo');
}

function getSummary() {
  const arr = readUsage();
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const monthStr = now.toISOString().slice(0, 7);

  const summary = {
    total:      { brl: 0, savedBrl: 0, count: 0, minSaved: 0 },
    today:      { brl: 0, savedBrl: 0, count: 0, minSaved: 0 },
    thisMonth:  { brl: 0, savedBrl: 0, count: 0, minSaved: 0 },
    lastMonth:  { brl: 0, savedBrl: 0, count: 0, minSaved: 0 },
    byFeature:  {},
    byMonth:    {},
    config: {
      usdBrl: USD_BRL,
      hourlyRateBrl: +HOURLY_RATE_BRL.toFixed(2),
      smGrossBrl: SM_GROSS_BRL,
      smDaysPerMonth: SM_DAYS_PER_MONTH,
      smHoursPerDay: SM_HOURS_PER_DAY,
      timeSavedMin: TIME_SAVED_MIN,
      pricingUsd: PRICING,
    },
  };

  // Mês passado (string YYYY-MM)
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthStr = lastMonthDate.toISOString().slice(0, 7);

  const accumulate = (cat, e) => {
    cat.brl += e.brl;
    cat.savedBrl += e.moneySaved;
    cat.count++;
    cat.minSaved += e.minSaved;
  };

  for (const e of arr) {
    accumulate(summary.total, e);
    const day = e.ts.slice(0, 10);
    const month = e.ts.slice(0, 7);
    if (day === todayStr) accumulate(summary.today, e);
    if (month === monthStr) accumulate(summary.thisMonth, e);
    if (month === lastMonthStr) accumulate(summary.lastMonth, e);

    summary.byFeature[e.feature] = summary.byFeature[e.feature] || { brl: 0, savedBrl: 0, count: 0, minSaved: 0 };
    accumulate(summary.byFeature[e.feature], e);

    summary.byMonth[month] = summary.byMonth[month] || { brl: 0, savedBrl: 0, count: 0, minSaved: 0 };
    accumulate(summary.byMonth[month], e);
  }

  // Round
  const roundCat = (c) => ({
    brl:      +c.brl.toFixed(2),
    savedBrl: +c.savedBrl.toFixed(2),
    count:    c.count,
    minSaved: c.minSaved,
  });
  summary.total      = roundCat(summary.total);
  summary.today      = roundCat(summary.today);
  summary.thisMonth  = roundCat(summary.thisMonth);
  summary.lastMonth  = roundCat(summary.lastMonth);
  for (const k of Object.keys(summary.byFeature)) summary.byFeature[k] = roundCat(summary.byFeature[k]);
  for (const k of Object.keys(summary.byMonth)) summary.byMonth[k] = roundCat(summary.byMonth[k]);
  return summary;
}

function getRecent(limit = 50) {
  const arr = readUsage();
  return arr.slice(-Math.min(limit, arr.length)).reverse();
}

module.exports = {
  patchAnthropicSDK,
  withFeature,
  currentFeature,
  track,
  getSummary,
  getRecent,
  USD_BRL,
  HOURLY_RATE_BRL,
};
