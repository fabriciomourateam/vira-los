'use strict';
/**
 * promptTemplateService.js — Gerenciamento de templates de prompt para fmteam
 *
 * Armazena templates customizáveis do preamble (instruções/regras/distribuição).
 * O bloco de estrutura HTML é sempre adicionado pelo servidor — usuários não podem quebrar a estrutura técnica.
 *
 * Arquivo de persistência: DATA_DIR/fmteam-prompt-templates.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const TEMPLATES_FILE = path.join(DATA_DIR, 'fmteam-prompt-templates.json');

// ─── Template base — preamble/instruções com tokens {{VARIÁVEL}} ─────────────

const BASE_PREAMBLE_TEMPLATE = `Você é um agente especializado em criar carrosseis profissionais para Instagram no estilo fmteam (Fabricio Moura): identidade visual dourada, slides dark com foto full-bleed e headline grande, slides light com imagem no topo e texto escuro, slide gradient com texto escuro, CTA com card branco.

Tema: "{{TOPIC}}"
Nicho: {{NICHE}}
Tom: {{TONE}}
Emoção dominante: {{EMOTION}}
Instagram: {{HANDLE_AT}}
Total de slides: {{NUM_SLIDES}} (1 capa + {{TOTAL_CONTENT}} conteúdo + 1 CTA final)
{{INSTRUCTIONS_BLOCK}}
{{IMAGES_BLOCK}}
{{ROTEIRO_BLOCK}}

━━━ REGRAS ABSOLUTAS — FMTEAM v2 ━━━
- Retorne APENAS o código HTML completo. Comece com <!DOCTYPE html> e termine com </html>
- NÃO use markdown, code fences, comentários ou texto fora do HTML
- NÃO inclua tags <style> nem <link rel="stylesheet"> no HTML — o CSS e fontes são injetados automaticamente pelo servidor
- No <head> inclua apenas: <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>...</title>
- Use EXATAMENTE as classes listadas abaixo
- TODOS os slides: wrapper = <div class="slide [tipo] [ctx]"> onde:
    tipos de fundo: slide-dark | slide-light | slide-grad
    contexto: on-dark (dark slides) | on-light (light e gradient slides)
- TODOS os slides começam com .accent-bar + .brand-bar e terminam com .prog
- Brand bar: APENAS "{{HANDLE_UPPER}}" à esquerda + "{{YEAR}}" à direita. NADA mais.
- Sem swipe hint, sem badges de tipo (ANÁLISE, TENDÊNCIA etc.)

{{SLIDE_DISTRIBUTION}}
Máximo 35 palavras por slide de conteúdo.

{{VIRAL_STRUCTURE}}`;

// ─── Persistência ─────────────────────────────────────────────────────────────

/**
 * @typedef {{ id: string, name: string, content: string, createdAt: string, updatedAt: string }} PromptTemplate
 * @typedef {{ activeId: string | null, templates: PromptTemplate[] }} TemplateStore
 */

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/** @returns {TemplateStore} */
function readStore() {
  ensureDataDir();
  if (!fs.existsSync(TEMPLATES_FILE)) {
    return { activeId: null, templates: [] };
  }
  try {
    const raw = fs.readFileSync(TEMPLATES_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { activeId: null, templates: [] };
  }
}

/** @param {TemplateStore} store */
function writeStore(store) {
  ensureDataDir();
  fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(store, null, 2), 'utf8');
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/** @returns {{ activeId: string | null, templates: PromptTemplate[] }} */
function listTemplates() {
  const store = readStore();
  return { activeId: store.activeId || null, templates: store.templates || [] };
}

/**
 * @param {string} id
 * @returns {PromptTemplate | null}
 */
function getTemplate(id) {
  const store = readStore();
  return store.templates.find(t => t.id === id) || null;
}

/**
 * @returns {PromptTemplate | null}
 */
function getActiveTemplate() {
  const store = readStore();
  if (!store.activeId) return null;
  return store.templates.find(t => t.id === store.activeId) || null;
}

/**
 * @param {{ name?: string, content?: string }} opts
 * @returns {PromptTemplate}
 */
function createTemplate({ name = 'Template customizado', content = BASE_PREAMBLE_TEMPLATE } = {}) {
  const store = readStore();
  const now = new Date().toISOString();
  /** @type {PromptTemplate} */
  const tpl = {
    id: crypto.randomUUID(),
    name: name.trim() || 'Template customizado',
    content: content || BASE_PREAMBLE_TEMPLATE,
    createdAt: now,
    updatedAt: now,
  };
  store.templates.push(tpl);
  writeStore(store);
  return tpl;
}

/**
 * @param {string} id
 * @param {{ name?: string, content?: string }} updates
 * @returns {PromptTemplate | null}
 */
function updateTemplate(id, updates) {
  const store = readStore();
  const idx = store.templates.findIndex(t => t.id === id);
  if (idx === -1) return null;
  const tpl = store.templates[idx];
  if (updates.name !== undefined) tpl.name = (updates.name || '').trim() || tpl.name;
  if (updates.content !== undefined) tpl.content = updates.content;
  tpl.updatedAt = new Date().toISOString();
  store.templates[idx] = tpl;
  writeStore(store);
  return tpl;
}

/**
 * @param {string} id
 * @returns {boolean}
 */
function deleteTemplate(id) {
  const store = readStore();
  const idx = store.templates.findIndex(t => t.id === id);
  if (idx === -1) return false;
  store.templates.splice(idx, 1);
  if (store.activeId === id) store.activeId = null;
  writeStore(store);
  return true;
}

/**
 * @param {string} id
 * @returns {boolean}
 */
function setActiveTemplate(id) {
  const store = readStore();
  const exists = store.templates.some(t => t.id === id);
  if (!exists) return false;
  store.activeId = id;
  writeStore(store);
  return true;
}

function deactivate() {
  const store = readStore();
  store.activeId = null;
  writeStore(store);
}

// ─── Substituição de variáveis ─────────────────────────────────────────────────

/**
 * Substitui todos os tokens {{VAR}} no conteúdo do template.
 * @param {string} content — o preamble template
 * @param {Record<string, string>} vars — mapa de VAR → valor
 * @returns {string}
 */
function instantiateTemplate(content, vars) {
  let result = content;
  for (const [key, value] of Object.entries(vars)) {
    const token = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(token, value ?? '');
  }
  return result;
}

module.exports = {
  BASE_PREAMBLE_TEMPLATE,
  listTemplates,
  getTemplate,
  getActiveTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  setActiveTemplate,
  deactivate,
  instantiateTemplate,
};
