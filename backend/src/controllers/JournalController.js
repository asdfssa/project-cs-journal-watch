/**
 * Journal Controller
 * รับ HTTP request → เรียก ScopusService / TCIService / Scraper → ส่ง response
 */
const ScopusService = require('../services/ScopusService');
const TCIService = require('../services/TCIService');
const ScopusScraper = require('../services/ScopusScraper');
const TCIScraper = require('../services/TCIScraper');
const scopusProxy = require('../services/ScopusProxyService');
const { serverError } = require('../utils/errorResponse');

class JournalController {

  // ===== Validate ISSN =====
  static _validateIssn(issn) {
    if (!issn) return 'ISSN is required';
    const clean = issn.replace('-', '');
    if (!/^\d{7}[\dX]$/i.test(clean)) return 'Invalid ISSN format (expected: xxxx-xxxx)';
    return null;
  }

  // ===== Normalize Response =====
  /**
   * Normalize ข้อมูลจากทุก Service/Scraper ให้ออกมา schema เดียวกัน
   * field ไหนไม่มีข้อมูล → null
   */
  static _normalizeResponse(data) {
    if (!data) return null;

    return {
      // ===== Common =====
      issn:              data.issn              ?? null,
      eissn:             data.eissn             ?? null,
      journal_name:      data.journal_name      ?? null,
      journal_name_th:   data.journal_name_th   ?? null,
      publisher:         data.publisher         ?? null,
      publisher_th:      data.publisher_th      ?? null,
      database_source:   data.database_source   ?? null,
      website:           data.website           ?? null,
      abbrev_name:       data.abbrev_name       ?? null,

      // ===== TCI fields =====
      tci_tier:          data.tci_tier          ?? null,
      tci_status:        data.tci_status        ?? null,
      tci_inactive:      data.tci_inactive      ?? null,
      main_area:         data.main_area         ?? null,
      major_area:        data.major_area        ?? null,
      minor_area:        data.minor_area        ?? null,
      volume_per_year:   data.volume_per_year   ?? null,
      issue_per_volume:  data.issue_per_volume  ?? null,
      prev_name:         data.prev_name         ?? null,
      prev_name_th:      data.prev_name_th      ?? null,

      // ===== Scopus fields =====
      scopus_quartile_data:   data.scopus_quartile_data   ?? null,
      scopus_best_quartile:   data.scopus_best_quartile   ?? null,
      scopus_best_percentile: data.scopus_best_percentile ?? null,
      scopus_h_index:         data.scopus_h_index         ?? null,
      scopus_citescore:       data.scopus_citescore       ?? null,
      scopus_sjr:             data.scopus_sjr             ?? null,
      scopus_snip:            data.scopus_snip            ?? null,
      scopus_discontinued:    data.scopus_discontinued    ?? null,
      subject_areas:          data.subject_areas          ?? null,
      coverage_start_year:    data.coverage_start_year    ?? null,
      coverage_end_year:      data.coverage_end_year      ?? null,

      // ===== Meta =====
      fetch_method: data.fetch_method ?? null,
      usedFallback: data.usedFallback ?? false,
    };
  }

  // ===================================================
  // API Endpoints
  // ===================================================

  /**
   * GET /api/journal/scopus?issn=xxxx-xxxx
   * ดึงข้อมูล Scopus ผ่าน API
   */
  static async searchScopus(req, res, next) {
    try {
      const { issn } = req.query;
      const err = JournalController._validateIssn(issn);
      if (err) return res.status(400).json({ success: false, message: err });

      const result = await ScopusService.getJournalByIssn(issn);
      if (!result) {
        return res.status(404).json({
          success: false,
          message: 'Journal not found in Scopus database',
        });
      }

      return res.json({
        success: true,
        data: JournalController._normalizeResponse(result),
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/journal/tci?issn=xxxx-xxxx
   * ดึงข้อมูล TCI ผ่าน API
   */
  static async searchTci(req, res, next) {
    try {
      const { issn } = req.query;
      const err = JournalController._validateIssn(issn);
      if (err) return res.status(400).json({ success: false, message: err });

      const result = await TCIService.getJournalByIssn(issn);
      if (!result) {
        return res.status(404).json({
          success: false,
          message: 'Journal not found in TCI database',
        });
      }

      return res.json({
        success: true,
        data: JournalController._normalizeResponse(result),
      });
    } catch (err) {
      next(err);
    }
  }

  // ===================================================
  // Scraping Endpoints
  // ===================================================

  /**
   * GET /api/journal/scopus/scrape?issn=xxxx-xxxx
   * ดึงข้อมูล Scopus ผ่าน Web Scraping
   */
  static async scrapeScopus(req, res, next) {
    try {
      const { issn } = req.query;
      const err = JournalController._validateIssn(issn);
      if (err) return res.status(400).json({ success: false, message: err });

      const result = await ScopusScraper.getJournalByIssn(issn);
      if (!result) {
        return res.status(404).json({
          success: false,
          message: 'Journal not found in Scopus (Scraping)',
        });
      }

      return res.json({
        success: true,
        data: JournalController._normalizeResponse(result),
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/journal/tci/scrape?issn=xxxx-xxxx
   * ดึงข้อมูล TCI ผ่าน Web Scraping
   */
  static async scrapeTci(req, res, next) {
    try {
      const { issn } = req.query;
      const err = JournalController._validateIssn(issn);
      if (err) return res.status(400).json({ success: false, message: err });

      const result = await TCIScraper.getJournalByIssn(issn);
      if (!result) {
        return res.status(404).json({
          success: false,
          message: 'Journal not found in TCI (Scraping)',
        });
      }

      return res.json({
        success: true,
        data: JournalController._normalizeResponse(result),
      });
    } catch (err) {
      next(err);
    }
  }

  // ===================================================
  // Utility
  // ===================================================

  /**
   * GET /api/journal/proxy-status
   */
  static async proxyStatus(req, res, next) {
    try {
      return res.json({
        success: true,
        data: scopusProxy.getStatus(),
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = JournalController;