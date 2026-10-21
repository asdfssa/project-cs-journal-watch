/**
 * TCIScraper
 * ดึงข้อมูลวารสารจาก TCI ด้วย Web Scraping (Playwright)
 */
const { chromium } = require('playwright');
const config = require('../config');
const { withScrapeSlot } = require('./scrapeQueue');
const JournalCache = require('./JournalCache');

const TCI_BASE = 'https://tci-thailand.org';

/**
 * เส้นสำรองของ TCIService: เปิด Chromium เข้า tci-thailand.org/journal_list แล้วดักผลจาก API ที่หน้าเว็บเรียกเอง
 * เรียกจาก: JournalController.scrapeTci เท่านั้น (ผ่านคิว withScrapeSlot) · ผลมีรูปแบบเดียวกับ TCIService แต่ fetch_method = 'Scraping'
 */
class TCIScraper {

  // ===== Public =====

  /**
   * @param {string} issn
   * @returns {Promise<object|null>} null = ไม่พบ · รอคิวเต็ม → throw 'SCRAPER_BUSY'
   */
  static async getJournalByIssn(issn) {
    const cleanIssn = issn.trim();
    const cache = JournalCache.shared();

    // hit = ไม่เข้าคิว ไม่เปิด Chromium · cache พัง/ไม่พบ → scrape ตามปกติ
    const cached = await cache.get(cleanIssn, 'TCI');
    if (cached) return cached;

    const result = await withScrapeSlot(() => TCIScraper._scrape(cleanIssn));
    if (!result) return null; // ไม่พบ → ไม่ cache
    await cache.save(result);
    return { ...result, fromCache: false };
  }

  // ===== Scraping =====

  /**
   * เรียกจาก: getJournalByIssn (ภายใน withScrapeSlot) · เปิด browser → เปิดหน้า journal_list → _searchAndFindJournal → _parseJournal · ปิด browser ใน finally เสมอ
   */
  static async _scrape(issn) {
    const browser = await chromium.launch({
      headless: config.scraper.headless,
      slowMo: config.scraper.slowMo,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    // ทุกอย่างหลัง launch อยู่ใน try — newContext/newPage throw ก็ยังปิด browser (กัน Chromium ค้าง)
    try {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();

      console.log(`[TCIScraper] เปิดหน้า TCI journal_list ISSN: ${issn}`);
      await page.goto(`${TCI_BASE}/journal_list`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      const journal = await TCIScraper._searchAndFindJournal(page, issn);
      if (!journal) {
        console.log(`[TCIScraper] ไม่พบวารสาร ISSN: ${issn} ใน TCI`);
        return null;
      }

      return TCIScraper._parseJournal(journal, issn);

    } finally {
      await browser.close();
    }
  }

  /**
   * เรียกจาก: _scrape · เลือกโหมดค้นด้วย ISSN, กรอก, กด Search แล้วรอ response ของ list_all_journal ที่ดักไว้
   * @returns {Promise<object|null>} รายการที่ ISSN (issn/eissn) ตรงเป๊ะ · null = ไม่พบ
   */
  static async _searchAndFindJournal(page, issn) {
    // intercept API response จาก /backend/journal/list_all_journal
    let apiResult = null;
    page.on('response', async (res) => {
      if (res.url().includes('/backend/journal/list_all_journal') && res.request().method() === 'POST') {
        try {
          const json = await res.json();
          apiResult = json?.journals || [];
        } catch {}
      }
    });

    // เปลี่ยนโหมดค้นหาเป็น ISSN
    const modeSelect = page.locator('select').filter({ has: page.locator('option[value="ssn"]') }).first();
    await modeSelect.waitFor({ state: 'visible', timeout: 10000 });
    await modeSelect.selectOption('ssn');

    // พิมพ์ ISSN ในช่องค้นหา
    const searchInput = page.locator('input[placeholder="Search"]').first();
    await searchInput.waitFor({ state: 'visible', timeout: 10000 });
    await searchInput.fill(issn);

    apiResult = null;
    const searchButton = page.locator('button:has-text("Search")').first();
    await searchButton.click();

    // รอผลลัพธ์จาก API
    await page.waitForTimeout(2000);
    for (let i = 0; i < 10 && apiResult === null; i++) {
      await page.waitForTimeout(500);
    }

    if (!apiResult || apiResult.length === 0) return null;

    const normalizedIssn = issn.replace(/-/g, '').toLowerCase();
    const exact = apiResult.find(j => {
      const print = (j.issn || '').replace(/-/g, '').toLowerCase();
      const online = (j.eissn || '').replace(/-/g, '').toLowerCase();
      return print === normalizedIssn || online === normalizedIssn;
    });

    // ไม่เจอ exact match → ถือว่าไม่พบวารสารนี้ ดีกว่าเดาวารสารอื่นที่ผลค้นหาใกล้เคียงมา
    return exact || null;
  }

  /**
   * แปลงรายการดิบเป็น object วารสารที่ระบบใช้ (โครงสร้างเหมือน TCIService._parseApiResponse) · เรียกจาก: _scrape
   */
  static _parseJournal(journal, issn) {
    const tier = journal['tci_tier'] ? parseInt(journal['tci_tier']) : null;
    const status = journal['status'] || null;
    const isInactive = status ? !['active', 'name_changed'].includes(status) : false;

    const printIssn = (journal['issn'] || '').replace(/-/g, '').trim();
    const onlineIssn = (journal['eissn'] || '').replace(/-/g, '').trim();
    const fallbackIssn = issn.replace(/-/g, '').trim();

    return {
      issn: printIssn || fallbackIssn,
      eissn: onlineIssn || null,
      journal_name: journal['name_eng'] || journal['name_local'] || '',
      journal_name_th: journal['name_local'] || null,
      publisher: journal['publisher_eng'] || null,
      publisher_th: journal['publisher_loc'] || null,
      database_source: 'TCI',
      tci_tier: tier,
      tci_status: status,
      tci_inactive: isInactive,
      website: journal['website'] || null,
      main_area: journal['main_area'] || null,
      major_area: journal['area'] || null,
      minor_area: journal['minor_area'] || null,
      abbrev_name: journal['abbrev_name'] || null,
      volume_per_year: journal['volume_per_year'] || null,
      issue_per_volume: journal['issue_per_volume'] || null,
      prev_name: journal['prev_name'] || null,
      prev_name_th: journal['prev_name_th'] || null,
      fetch_method: 'Scraping',
    };
  }

}

module.exports = TCIScraper;
