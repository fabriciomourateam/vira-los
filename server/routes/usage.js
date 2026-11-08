const express = require('express');
const router = express.Router();
const { getSummary, getRecent } = require('../services/usageTracker');

router.get('/summary', (req, res) => {
  res.json(getSummary());
});

router.get('/recent', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  res.json(getRecent(limit));
});

module.exports = router;
