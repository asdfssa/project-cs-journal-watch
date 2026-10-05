/**
 * ScopusScraper
 * ดึงข้อมูลวารสารจาก Scopus ด้วย Web Scraping (Playwright)
 * Port จาก scopus_issn_scraper.py
 */
const { chromium } = require('playwright');
const config = require('../config');

class ScopusScraper {

  // ===== Public =====

  static async getJournalByIssn(issn) {
    const cleanIssn = issn.replace('-', '').trim();
    return ScopusScraper._scrape(cleanIssn);
  }

  // ===== Scraping =====

  static async _scrape(issn) {
  const browser = await chromium.launch({
    headless: config.scraper.headless,
    slowMo: config.scraper.slowMo,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  });

  // ซ่อน webdriver flag
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  try {
    console.log(`[ScopusScraper] เปิดหน้า Scopus Sources ISSN: ${issn}`);
    await page.goto('https://www.scopus.com/sources.uri', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(5000);
    

// await page.screenshot({ path: 'scopus-debug.png', fullPage: true });
// console.log('[ScopusScraper] screenshot saved: scopus-debug.png');

    await ScopusScraper._searchByIssn(page, issn);
    const data = await ScopusScraper._extractSourceDetails(page, issn);
    return data;

  } finally {
    await browser.close();
  }
}

  static async _searchByIssn(page, issn) {
    await page.locator('#srcResultComboDrp-button').click();
    await page.waitForTimeout(500);
    await page.locator('#ui-id-4').click();
    await page.waitForTimeout(300);

    await page.locator('#sourceResultSearchInp').click();
    await page.waitForSelector('#search-term', { timeout: 5000 });

    const issnInput = page.locator('#search-term');
    await issnInput.click();
    await issnInput.fill('');
    await issnInput.type(issn, { delay: 50 });

    await page.locator('#searchTermsSubmit').click();
    await page.waitForSelector('table#sourceResults tbody tr', { timeout: 15000 });

    const firstRow = page.locator('table#sourceResults tbody tr').first();
    const firstLink = firstRow.locator("a[title='View details for this source.']");
    await firstLink.click();

    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
  }

  static async _extractSourceDetails(page, issn) {
    const title = (await page.locator('h2.jnlTitle').first().innerText()).trim();

    // Publisher — ดึงจาก li ที่มี text "Publisher:"
    let publisher = null;
    const publisherLi = page.locator(
      "xpath=//li[contains(., 'Publisher:')]"
    );
    if (await publisherLi.count() > 0) {
      const liText = (await publisherLi.first().innerText()).trim();
      const m = liText.match(/Publisher:\s*(.+)/);
      if (m) publisher = m[1].trim();
    }

    // Coverage years + Discontinued
    let isDiscontinued = false;
    let coverageStartYear = null;
    let coverageEndYear = null;
    const coverageLi = page.locator(
      "xpath=//li[contains(., 'Years currently covered by Scopus')]"
    );
    if (await coverageLi.count() > 0) {
      // เช็ค discontinued
      const discontinuedSpan = coverageLi.first().locator(
        "xpath=.//span[contains(., 'coverage discontinued in Scopus')]"
      );
      isDiscontinued = (await discontinuedSpan.count()) > 0;

      // ดึง coverage years เช่น "from 2022 to 2026"
      const liText = (await coverageLi.first().innerText()).trim();
      const m = liText.match(/from\s+(\d{4})\s+to\s+(\d{4})/i);
      if (m) {
        coverageStartYear = m[1];
        coverageEndYear = m[2];
      }
    }

    // CiteScore — div#rpCard span.value.fontMedLarge
    let citeScore = null;
    const csSpan = page.locator('#rpCard span.value.fontMedLarge');
    if (await csSpan.count() > 0) {
      citeScore = ScopusScraper._extractFirstNumber(
        (await csSpan.first().innerText()).trim()
      );
    }

    // SJR — div#sjrCard span.value.fontMedLarge
    let sjr = null;
    const sjrSpan = page.locator('#sjrCard span.value.fontMedLarge');
    if (await sjrSpan.count() > 0) {
      sjr = ScopusScraper._extractFirstNumber(
        (await sjrSpan.first().innerText()).trim()
      );
    }

    // SNIP — div#snipCard span.value.fontMedLarge
    let snip = null;
    const snipSpan = page.locator('#snipCard span.value.fontMedLarge');
    if (await snipSpan.count() > 0) {
      snip = ScopusScraper._extractFirstNumber(
        (await snipSpan.first().innerText()).trim()
      );
    }

    // เปิด CiteScore rank tab ก่อน แล้วค่อยดึง year/subject ที่อยู่ใน tab นี้
    try {
      await page.getByText('CiteScore rank & trend').click();
      await page.waitForSelector('#citescoreRankTitle', { timeout: 5000 });
    } catch (_) {}

    // CiteScore year — ดึงจาก h3#citescoreRankTitle เช่น "CiteScore rank 2024" → "2024"
    let citeScoreYear = null;
    const rankTitle = page.locator('#citescoreRankTitle');
    if (await rankTitle.count() > 0) {
      const titleText = (await rankTitle.first().innerText()).trim();
      const m = titleText.match(/(\d{4})/);
      if (m) citeScoreYear = m[1];
    }

    // subject_areas + asjcCode — select#rankSubjectCombo options (อยู่ใน tab เดียวกัน)
    const subjectAreas = [];
    const subjectSelect = page.locator('#rankSubjectCombo option');
    const optCount = await subjectSelect.count();
    for (let i = 0; i < optCount; i++) {
      const opt = subjectSelect.nth(i);
      const code = (await opt.getAttribute('value') || '').trim();
      const area = (await opt.innerText()).trim();
      if (code && area) {
        subjectAreas.push({ abbrev: null, code, area });
      }
    }

    const quartiles = await ScopusScraper._extractQuartiles(page, citeScoreYear, subjectAreas);

    // Best quartile
    let bestQuartile = null;
    let bestPercentile = null;
    if (quartiles.length > 0) {
      const best = quartiles.reduce((prev, curr) => {
        const pp = prev.percentile ?? -1;
        const cp = curr.percentile ?? -1;
        return cp > pp ? curr : prev;
      });
      bestQuartile = best.quartile;
      bestPercentile = best.percentile;
    }

    return {
      issn,
      journal_name: title,
      publisher,
      database_source: 'Scopus',
      scopus_discontinued: isDiscontinued,
      scopus_best_quartile: bestQuartile,
      scopus_best_percentile: bestPercentile,
      scopus_quartile_data: quartiles.length > 0 ? quartiles : null,
      scopus_citescore: citeScore,
      scopus_sjr: sjr,
      scopus_snip: snip,
      scopus_h_index: null,
      subject_areas: subjectAreas.length > 0 ? subjectAreas : null,
      coverage_start_year: coverageStartYear,
      coverage_end_year: coverageEndYear,
      fetch_method: 'Scraping',
    };
  }

  static async _extractQuartiles(page, citeScoreYear, subjectAreas = []) {
    const rows = page.locator('tbody#CSCategoryTBody tr');
    const count = await rows.count();
    const quartiles = [];

    // สร้าง map field → asjcCode จาก subjectAreas
    const fieldToCode = {};
    subjectAreas.forEach(s => { fieldToCode[s.area] = s.code; });

    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const cols = row.locator('td');
      if (await cols.count() < 3) continue;

      // col[0]: "Chemistry\nChemistry (miscellaneous)" → field = "Chemistry (miscellaneous)"
      const catRaw = (await cols.nth(0).innerText()).trim();
      const parts = catRaw.split('\n').map(p => p.trim()).filter(Boolean);
      const field = parts.length >= 2 ? parts[1] : (parts[0] || catRaw);

      // col[1]: "#1/124" → rank = "1"
      const rankRaw = (await cols.nth(1).innerText()).trim();
      const rankMatch = rankRaw.match(/#?(\d+)/);
      const rank = rankMatch ? rankMatch[1] : rankRaw;

      // col[2]: "99th" → percentile = 99
      const percText = (await cols.nth(2).innerText()).trim();
      const percentile = ScopusScraper._extractFirstNumber(percText);
      const quartile = ScopusScraper._computeQuartile(percentile);

      // inject year และ asjcCode ให้ตรงกับ API format
      const asjcCode = fieldToCode[field] || null;

      quartiles.push({
        year: citeScoreYear,
        asjcCode,
        field,
        rank,
        percentile,
        quartile,
      });
    }

    return quartiles;
  }

  // ===== Helpers =====

  static _extractFirstNumber(text) {
    if (!text) return null;
    const m = text.replace(/,/g, '').match(/\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  static _computeQuartile(percentile) {
    if (percentile === null || percentile === undefined) return null;
    const p = parseFloat(percentile);
    if (isNaN(p)) return null;
    if (p >= 75) return 'Q1';
    if (p >= 50) return 'Q2';
    if (p >= 25) return 'Q3';
    return 'Q4';
  }

}

module.exports = ScopusScraper;