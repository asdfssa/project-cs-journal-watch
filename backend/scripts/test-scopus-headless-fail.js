/**
 * ทดสอบ Headless Scraper กับ Scopus (สำหรับหลักฐาน section 3.9.2)
 * รันแบบ headless:true ตรง ๆ (ไม่ผ่าน docker/Xvfb) แล้ว screenshot ทุกจุดสำคัญ
 * เพื่อดูว่า Scopus บล็อก/แสดง bot-detection หรือไม่ตอนใช้ headless browser
 *
 * รัน: node scripts/test-scopus-headless-fail.js [ISSN]
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ISSN = process.argv[2] || '00280836';
const OUT_DIR = path.join(__dirname, 'evidence');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  console.log(`เริ่มทดสอบ Headless Scraper (headless=true), ISSN=${ISSN}`);

  const browser = await chromium.launch({
    headless: true,
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

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  let step = 'goto';

  try {
    console.log('[1] เปิดหน้า Scopus Sources...');
    await page.goto('https://www.scopus.com/sources.uri', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    const shot1 = path.join(OUT_DIR, 'headless-01-after-goto.png');
    await page.screenshot({ path: shot1, fullPage: true });
    console.log(`   screenshot: ${shot1}`);
    console.log(`   page title: ${await page.title()}`);
    console.log(`   page url: ${page.url()}`);

    step = 'select-dropdown';
    console.log('[2] พยายามเปิด dropdown ค้นหาด้วย ISSN...');
    await page.locator('#srcResultComboDrp-button').click({ timeout: 10000 });
    await page.waitForTimeout(500);
    await page.locator('#ui-id-4').click({ timeout: 10000 });

    step = 'search-input';
    console.log('[3] พยายามกรอก ISSN แล้วค้นหา...');
    await page.locator('#sourceResultSearchInp').click({ timeout: 10000 });
    await page.waitForSelector('#search-term', { timeout: 5000 });
    const issnInput = page.locator('#search-term');
    await issnInput.fill('');
    await issnInput.type(ISSN, { delay: 50 });
    await page.locator('#searchTermsSubmit').click();

    step = 'wait-results';
    await page.waitForSelector('table#sourceResults tbody tr', { timeout: 15000 });

    const shot2 = path.join(OUT_DIR, 'headless-02-results.png');
    await page.screenshot({ path: shot2, fullPage: true });
    console.log(`   สำเร็จ! screenshot: ${shot2}`);
    console.log('\n>>> ผลสรุป: Headless scraper ทำงานสำเร็จรอบนี้ (ไม่โดนบล็อก) <<<');

  } catch (err) {
    const failShot = path.join(OUT_DIR, `headless-FAIL-at-${step}.png`);
    try {
      await page.screenshot({ path: failShot, fullPage: true });
    } catch (_) {}
    console.log(`\n>>> ล้มเหลวที่ขั้นตอน "${step}": ${err.message}`);
    console.log(`   screenshot ตอนล้มเหลว: ${failShot}`);
    console.log(`   page title ตอนล้มเหลว: ${await page.title().catch(() => '(อ่านไม่ได้)')}`);
    console.log(`   page url ตอนล้มเหลว: ${page.url()}`);

    const html = await page.content().catch(() => null);
    if (html) {
      const htmlPath = path.join(OUT_DIR, `headless-FAIL-at-${step}.html`);
      fs.writeFileSync(htmlPath, html);
      console.log(`   บันทึก HTML ตอนล้มเหลวไว้ที่: ${htmlPath}`);
    }
  } finally {
    await browser.close();
  }
}

main();
