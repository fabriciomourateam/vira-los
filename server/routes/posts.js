const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads'),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
});

// GET /api/content — lista todos os itens
router.get('/', (_req, res) => {
  res.json(db.getAllContent());
});

// POST /api/content/video — upload de vídeo
router.post('/video', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });
    const { title, caption, hashtags } = req.body;
    const item = {
      id: uuidv4(),
      title: title || req.file.originalname,
      type: 'video',
      file_path: req.file.filename,
      thumbnail: null,
      caption: caption || '',
      hashtags: hashtags || '',
    };
    db.createContent(item);
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/content/carousel — upload de carrossel (múltiplas imagens)
router.post('/carousel', upload.array('files', 10), (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'Arquivos não enviados' });
    const { title, caption, hashtags } = req.body;
    const filenames = req.files.map((f) => f.filename);
    const item = {
      id: uuidv4(),
      title: title || 'Carrossel',
      type: 'carousel',
      file_path: JSON.stringify(filenames),
      thumbnail: filenames[0],
      caption: caption || '',
      hashtags: hashtags || '',
    };
    db.createContent(item);
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/content/:id — atualiza caption/hashtags/title
router.patch('/:id', (req, res) => {
  try {
    db.updateContent(req.params.id, req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/content/:id
router.delete('/:id', (req, res) => {
  try {
    db.deleteContent(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
