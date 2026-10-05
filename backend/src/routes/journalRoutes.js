/**
 * Journal Routes
 * Base path: /api/journal
 */
const express = require('express');
const JournalController = require('../controllers/JournalController');
const { requireAuth } = require('../middlewares/auth');
const { scrapeLimiter } = require('../middlewares/rateLimit');
const { captchaIfFrequent } = require('../middlewares/captcha');

const router = express.Router();

// ===== API Routes =====
// captchaIfFrequent: ค้นถี่เกินโควตาต่อผู้ใช้ → ต้องแนบ Turnstile token (428 CAPTCHA_REQUIRED)
router.get('/scopus', requireAuth, captchaIfFrequent, JournalController.searchScopus);
router.get('/tci',    requireAuth, captchaIfFrequent, JournalController.searchTci);

// ===== Scraping Routes =====
router.get('/scopus/scrape', requireAuth, captchaIfFrequent, scrapeLimiter, JournalController.scrapeScopus);
router.get('/tci/scrape',    requireAuth, captchaIfFrequent, scrapeLimiter, JournalController.scrapeTci);

module.exports = router;