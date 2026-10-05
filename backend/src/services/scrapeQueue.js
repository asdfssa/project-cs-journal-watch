/**
 * Scrape Queue — จำกัดจำนวน Chromium ที่เปิดพร้อมกันทั้งระบบ (Scopus + TCI ใช้คิวเดียวกัน)
 * แต่ละตัวกิน RAM ~200–300MB — ไม่จำกัดแล้วมีคนยิงพร้อมกันเยอะ container จะ OOM
 */
const config = require('../config');

let active = 0;
const waiting = [];

/**
 * รัน fn เมื่อได้ช่อง — เต็มก็รอคิว, คิวยาวเกิน maxQueue → throw SCRAPER_BUSY (429)
 */
async function withScrapeSlot(fn) {
  const { maxConcurrent, maxQueue } = config.scraper;
  if (active < maxConcurrent) {
    active++;
  } else {
    if (waiting.length >= maxQueue) {
      throw Object.assign(new Error('scrape queue full'), { code: 'SCRAPER_BUSY' });
    }
    await new Promise(resolve => waiting.push(resolve)); // ได้ช่องต่อจากคนก่อนหน้าโดยตรง (active ไม่ลด)
  }
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();   // ส่งช่องต่อให้คนในคิวทันที — ไม่มีจังหวะที่ request ใหม่แทรกจนเกิน maxConcurrent
    else active--;
  }
}

module.exports = { withScrapeSlot };
