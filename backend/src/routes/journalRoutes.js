/**
 * Journal Routes
 * Base path: /api/journal
 */
const express = require('express');
const JournalController = require('../controllers/JournalController');
const { requireAuth } = require('../middlewares/auth');
const { scrapeLimiter } = require('../middlewares/rateLimit');

const router = express.Router();

// ===== API Routes =====
router.get('/scopus', requireAuth, JournalController.searchScopus);
router.get('/tci',    requireAuth, JournalController.searchTci);

// ===== Scraping Routes =====
router.get('/scopus/scrape', requireAuth, scrapeLimiter, JournalController.scrapeScopus);
router.get('/tci/scrape',    requireAuth, scrapeLimiter, JournalController.scrapeTci);

// ===== Utility =====
router.get('/proxy-status', requireAuth, JournalController.proxyStatus);

module.exports = router;