/**
 * scraper-scopus.js
 * Standalone Scopus Web Scraper (Node.js + Playwright)
 * Port จาก scopus_issn_scraper.py
 *
 * วิธีใช้:
 *   node scraper-scopus.js 0007-9235
 */

const { chromium } = require('playwright');

// ===== Helper: ดึงตัวเลขแรกจาก string =====
function extractFirstNumber(text) {
  if (!text) return null;
  const cleaned = text.replace(/,/g, '');
  const m = cleaned.match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

// ===== Helper: คำนวณ Quartile จาก percentile =====
function computeQuartile(percentile) {
  if (percentile === null || percentile === undefined) return null;
  const p = parseFloat(percentile);
  if (isNaN(p)) return null;
  if (p >= 75) return 'Q1';
  if (p >= 50) return 'Q2';
  if (p >= 25) return 'Q3';
  return 'Q4';
}

// ===== Search by ISSN =====
async function searchByIssn(page, issn) {
  console.log('[SCOPUS] เลือกโหมดค้นหาเป็น ISSN...');
  await page.locator('#srcResultComboDrp-button').click();
  await page.waitForTimeout(500);
  await page.locator('#ui-id-4').click();
  await page.waitForTimeout(300);

  console.log('[SCOPUS] กรอก ISSN...');
  await page.locator('#sourceResultSearchInp').click();
  await page.waitForSelector('#search-term', { timeout: 5000 });
  const issnInput = page.locator('#search-term');
  await issnInput.click();
  await issnInput.fill('');
  await issnInput.type(issn, { delay: 50 });

  console.log('[SCOPUS] กดปุ่ม Find sources...');
  await page.locator('#searchTermsSubmit').click();

  console.log('[SCOPUS] รอผลลัพธ์ในตาราง...');
  await page.waitForSelector('table#sourceResults tbody tr', { timeout: 15000 });

  console.log('[SCOPUS] คลิกลิงก์วารสารแถวแรก...');
  const firstRow = page.locator('table#sourceResults tbody tr').first();
  const firstLink = firstRow.locator("a[title='View details for this source.']");
  await firstLink.click();

  console.log('[SCOPUS] รอหน้า Source details โหลด...');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);
}

// ===== Extract Quartiles จากตาราง CiteScore =====
async function extractQuartiles(page) {
  const rows = page.locator('tbody#CSCategoryTBody tr');
  const count = await rows.count();
  const quartiles = [];

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const cols = row.locator('td');
    if (await cols.count() < 3) continue;

    const catRaw = (await cols.nth(0).innerText()).trim();
    const parts = catRaw.split('\n').map(p => p.trim()).filter(Boolean);
    let category;
    if (parts.length >= 2) {
      category = `${parts[0]}: ${parts[1]}`;
    } else if (parts.length === 1) {
      category = parts[0];
    } else {
      category = catRaw;
    }

    const rankText = (await cols.nth(1).innerText()).trim();
    const percText = (await cols.nth(2).innerText()).trim();
    const percentile = extractFirstNumber(percText);
    const quartile = computeQuartile(percentile);

    quartiles.push({
      category,
      rank_raw: rankText,
      percentile,
      quartile,
    });
  }

  return quartiles;
}

// ===== Extract Source Details =====
async function extractSourceDetails(page, issn) {
  console.log('[SCOPUS] ดึงข้อมูลจากหน้า Source details...');

  const title = (await page.locator('h2.jnlTitle').first().innerText()).trim();

  // เช็ค discontinued
  let isDiscontinued = false;
  const coverageLi = page.locator(
    "xpath=//li[contains(., 'Years currently covered by Scopus')]"
  );
  if (await coverageLi.count() > 0) {
    const discontinuedSpan = coverageLi.first().locator(
      "xpath=.//span[contains(., 'coverage discontinued in Scopus')]"
    );
    isDiscontinued = (await discontinuedSpan.count()) > 0;
  }

  // เปิด CiteScore rank tab
  try {
    await page.getByText('CiteScore rank & trend').click();
    await page.waitForTimeout(1500);
  } catch (_) {}

  const quartiles = await extractQuartiles(page);

  // หา best quartile
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
    database_source: 'Scopus',
    scopus_discontinued: isDiscontinued,
    scopus_best_quartile: bestQuartile,
    scopus_best_percentile: bestPercentile,
    scopus_quartile_data: quartiles.length > 0 ? quartiles : null,
    fetch_method: 'Scraping',
  };
}

// ===== Main Scraper =====
async function scrapeScopusByIssn(issn) {
  if (!issn) throw new Error('ISSN is empty');

  const browser = await chromium.launch({ headless: false, slowMo: 400 });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('[SCOPUS] เปิดหน้า Scopus Sources...');
    await page.goto('https://www.scopus.com/sources.uri', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(5000);

    await searchByIssn(page, issn);
    const data = await extractSourceDetails(page, issn);

    return data;
  } finally {
    await browser.close();
  }
}

// ===== Run Standalone =====
(async () => {
  const issn = process.argv[2];
  if (!issn) {
    console.error('Usage: node scraper-scopus.js <ISSN>');
    console.error('Example: node scraper-scopus.js 0007-9235');
    process.exit(1);
  }

  console.log(`\n=== Scopus Scraper (Node.js) ===`);
  console.log(`ISSN: ${issn}\n`);

  try {
    const result = await scrapeScopusByIssn(issn);
    console.log('\n=== ผลลัพธ์ ===');
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('[ERROR]', err.message);
    process.exit(1);
  }
})();

module.exports = { scrapeScopusByIssn };