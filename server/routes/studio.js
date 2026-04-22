/**
 * studio.js — Studio de Criação de Designs
 *
 * POST   /api/studio/generate                           → streaming SSE de design
 * GET    /api/studio/conversations                      → lista conversas
 * POST   /api/studio/conversations                      → cria conversa
 * GET    /api/studio/conversations/:id                  → busca conversa + mensagens
 * PATCH  /api/studio/conversations/:id                  → renomeia/atualiza
 * DELETE /api/studio/conversations/:id                  → exclui conversa + mensagens
 * GET    /api/studio/conversations/:id/messages         → lista mensagens
 * POST   /api/studio/conversations/:id/messages         → adiciona mensagem
 * GET    /api/studio/posts                              → galeria de posts
 * POST   /api/studio/posts                             → salva post na galeria
 * PATCH  /api/studio/posts/:id                          → atualiza post
 * DELETE /api/studio/posts/:id                          → exclui post
 */

const express = require('express');
const db = require('../db/database');
const { generateDesignStream } = require('../services/studioService');

const router = express.Router();

function newId() {
  return require('crypto').randomUUID();
}

// ─── Geração de design com SSE streaming ─────────────────────────────────────

router.post('/generate', async (req, res) => {
  const { conversationId, format, brandKitId, contextType, contextData, userMessage } = req.body;

  if (!userMessage) return res.status(400).json({ error: '"userMessage" é obrigatório' });
  if (!format)      return res.status(400).json({ error: '"format" é obrigatório' });

  // Carrega brand kit se informado
  const brandKit = brandKitId ? db.getBrandKit(brandKitId) : null;

  // Histórico da conversa (sem html_content para não sobrecarregar o contexto)
  let messages = [];
  if (conversationId) {
    messages = db.getStudioMessages(conversationId).map(m => ({
      role: m.role,
      content: m.content,
    }));
  }

  await generateDesignStream(res, {
    format,
    brandKit,
    contextType: contextType || 'blank',
    contextData: contextData || null,
    messages,
    userMessage,
  });
});

// ─── Conversas ────────────────────────────────────────────────────────────────

router.get('/conversations', (req, res) => {
  const convs = db.getAllStudioConversations();
  res.json(convs);
});

router.post('/conversations', (req, res) => {
  const { title, format, brandKitId, contextType, contextData } = req.body;
  const conv = {
    id: newId(),
    title: title || 'Nova criação',
    format: format || 'post',
    brand_kit_id: brandKitId || null,
    context_type: contextType || 'blank',
    context_data: contextData || null,
  };
  db.createStudioConversation(conv);
  res.status(201).json(conv);
});

router.get('/conversations/:id', (req, res) => {
  const conv = db.getStudioConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  const messages = db.getStudioMessages(req.params.id);
  res.json({ ...conv, messages });
});

router.patch('/conversations/:id', (req, res) => {
  const conv = db.getStudioConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  const allowed = ['title', 'format', 'brand_kit_id'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );
  db.updateStudioConversation(req.params.id, updates);
  res.json({ ...conv, ...updates });
});

router.delete('/conversations/:id', (req, res) => {
  const conv = db.getStudioConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  db.deleteStudioConversation(req.params.id);
  res.json({ ok: true });
});

// ─── Mensagens ────────────────────────────────────────────────────────────────

router.get('/conversations/:id/messages', (req, res) => {
  res.json(db.getStudioMessages(req.params.id));
});

router.post('/conversations/:id/messages', (req, res) => {
  const conv = db.getStudioConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });

  const { role, content, html_content, caption, hashtags } = req.body;
  const msg = {
    id: newId(),
    conversation_id: req.params.id,
    role: role || 'user',
    content: content || '',
    html_content: html_content || null,
    caption: caption || null,
    hashtags: hashtags || [],
  };
  db.createStudioMessage(msg);

  // Atualiza timestamp da conversa
  db.updateStudioConversation(req.params.id, {});

  res.status(201).json(msg);
});

// ─── Galeria de Posts ─────────────────────────────────────────────────────────

router.get('/posts', (req, res) => {
  let posts = db.getAllStudioPosts();

  // Filtros opcionais
  if (req.query.format) {
    posts = posts.filter(p => p.format === req.query.format);
  }
  if (req.query.brand_kit_id) {
    posts = posts.filter(p => p.brand_kit_id === req.query.brand_kit_id);
  }
  if (req.query.search) {
    const q = req.query.search.toLowerCase();
    posts = posts.filter(p =>
      (p.title || '').toLowerCase().includes(q) ||
      (p.caption || '').toLowerCase().includes(q)
    );
  }

  res.json(posts);
});

router.post('/posts', (req, res) => {
  const { title, format, html_content, caption, hashtags, brand_kit_id, conversation_id, message_id } = req.body;

  if (!html_content) return res.status(400).json({ error: '"html_content" é obrigatório' });

  const post = {
    id: newId(),
    title: title || 'Sem título',
    format: format || 'post',
    html_content,
    caption: caption || '',
    hashtags: hashtags || [],
    brand_kit_id: brand_kit_id || null,
    conversation_id: conversation_id || null,
    message_id: message_id || null,
  };
  db.createStudioPost(post);
  res.status(201).json(post);
});

router.patch('/posts/:id', (req, res) => {
  const post = db.getStudioPost(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });
  const allowed = ['title', 'html_content', 'caption', 'hashtags', 'brand_kit_id'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );
  db.updateStudioPost(req.params.id, updates);
  res.json({ ...post, ...updates });
});

router.delete('/posts/:id', (req, res) => {
  const post = db.getStudioPost(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });
  db.deleteStudioPost(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
