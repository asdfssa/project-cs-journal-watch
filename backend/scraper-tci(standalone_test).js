/**
 * scraper-tci.js
 * Standalone TCI Web Scraper (Node.js + Playwright)
 * Port จาก tci_issn_scraper.py
 *
 * วิธีใช้:
 *   node scraper-tci.js 0858-0855
 */

const { chromium } = require('playwright');

// ===== Search by ISSN =====
async function searchByIssn(page, issn) {
  console.log('[TCI] รอ select ค้นหา...');
  await page.waitForSelector('select.chakra-select', { timeout: 10000 });

  const selects = page.locator('select.chakra-select');
  const count = await selects.count();

  let target = null;
  for (let i = 0; i < count; i++) {
    const s = selects.nth(i);
    const hasIssn = await s.locator('option', { hasText: 'ISSN' }).count();
    if (hasIssn > 0) {
      target = s;
      break;
    }
  }

  if (!target) throw new Error('ไม่พบ select ที่มี option ISSN');

  await target.click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  console.log('[TCI] เปลี่ยนโหมดค้นหาเป็น ISSN แล้ว');

  console.log('[TCI] รอ input ค้นหา ISSN...');
  await page.waitForSelector("input[placeholder='Search']", { timeout: 15000 });

  const searchInput = page.locator("input[placeholder='Search']").first();
  await searchInput.click();
  await searchInput.fill('');
  await searchInput.type(issn, { delay: 50 });

  console.log('[TCI] กดปุ่ม Search...');
  const searchButton = page.locator("button:has-text('Search')").first();
  await searchButton.click();

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
}

// ===== Extract TCI Details =====
async function extractTciDetails(page, issn) {
  console.log('[TCI] ดึงข้อมูลจากการ์ดผลลัพธ์...');

  const titleLink = page.locator("a.chakra-link[href*='journal_info']").first();
  await titleLink.waitFor({ state: 'visible', timeout: 10000 });

  const title = (await titleLink.innerText()).trim();

  // หา card container
  const cardRoot = titleLink.locator(
    "xpath=ancestor::div[contains(., 'Issues/Year')][1]"
  );

  // Tier
  let tier = null;
  const tierEl = cardRoot.locator('p', { hasText: 'TIER' });
  if (await tierEl.count() > 0) {
    const tierText = (await tierEl.first().innerText()).trim();
    // ดึงตัวเลข tier เช่น "TIER: 1" → 1
    const m = tierText.match(/TIER[:\s]*(\d+)/i);
    tier = m ? parseInt(m[1]) : tierText;
  }

  // pISSN / eISSN
  let pissn = null;
  let eissn = null;
  const issnEl = cardRoot.locator('p', { hasText: 'pISSN' });
  if (await issnEl.count() > 0) {
    const issnText = (await issnEl.first().innerText()).trim();
    const mp = issnText.match(/pISSN:\s*([0-9Xx-]+)/);
    if (mp) pissn = mp[1];
    const me = issnText.match(/eISSN:\s*([0-9Xx-]+)/);
    if (me) eissn = me[1];
  }

  // Status
  let status = null;
  const statusEl = cardRoot.locator('span').filter({
    hasText: /Active|Inactive|Ceased|Under review|Name Changed/i
  });
  if (await statusEl.count() > 0) {
    status = (await statusEl.first().innerText()).trim();
  }

  // Subject Area
  let subjectArea = null;
  const saEl = cardRoot.locator('p', { hasText: 'Subject Area' });
  if (await saEl.count() > 0) {
    const saText = (await saEl.first().innerText()).trim();
    const m = saText.match(/Subject Area:\s*(.+)/);
    subjectArea = m ? m[1].trim() : saText;
  }

  return {
    title,
    search_issn: issn,
    pissn,
    eissn,
    issn: pissn || issn,
    tier,
    tci_tier: typeof tier === 'number' ? tier : null,
    status,
    tci_inactive: status ? status.toLowerCase() === 'inactive' : false,
    subject_area: subjectArea,
    database_source: 'TCI',
    fetch_method: 'Scraping',
  };
}

// ===== Main Scraper =====
async function scrapeTciByIssn(issn) {
  if (!issn) throw new Error('ISSN is empty');

  const browser = await chromium.launch({ headless: false, slowMo: 400 });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('[TCI] เปิดหน้า TCI journal_list...');
    await page.goto('https://tci-thailand.org/journal_list', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(3000);

    await searchByIssn(page, issn);
    const data = await extractTciDetails(page, issn);

    return data;
  } finally {
    await browser.close();
  }
}

// ===== Run Standalone =====
(async () => {
  const issn = process.argv[2];
  if (!issn) {
    console.error('Usage: node scraper-tci.js <ISSN>');
    console.error('Example: node scraper-tci.js 0858-0855');
    process.exit(1);
  }

  console.log(`\n=== TCI Scraper (Node.js) ===`);
  console.log(`ISSN: ${issn}\n`);

  try {
    const result = await scrapeTciByIssn(issn);
    console.log('\n=== ผลลัพธ์ ===');
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('[ERROR]', err.message);
    process.exit(1);
  }
})();

module.exports = { scrapeTciByIssn };