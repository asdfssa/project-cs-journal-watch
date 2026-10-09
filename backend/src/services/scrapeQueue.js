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
  const { maxConcurrent, maxQueue, queueTimeoutMs } = config.scraper;
  if (active < maxConcurrent) {
    active++;
  } else {
    if (waiting.length >= maxQueue) {
      throw Object.assign(new Error('scrape queue full'), { code: 'SCRAPER_BUSY' });
    }
    // ได้ช่องต่อจากคนก่อนหน้าโดยตรง (active ไม่ลด) · รอนานเกิน queueTimeoutMs → ถอนตัวออกจากคิวแล้วตอบ 429
    // (ไม่งั้นคำขอค้างจน Cloudflare ตัดที่ ~100 วินาที ผู้ใช้เห็นเป็น 524)
    await new Promise((resolve, reject) => {
      const entry = { resolve };
      entry.timer = setTimeout(() => {
        waiting.splice(waiting.indexOf(entry), 1);
        reject(Object.assign(new Error('scrape queue wait timeout'), { code: 'SCRAPER_BUSY' }));
      }, queueTimeoutMs);
      waiting.push(entry);
    });
  }
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) {   // ส่งช่องต่อให้คนในคิวทันที — ไม่มีจังหวะที่ request ใหม่แทรกจนเกิน maxConcurrent
      clearTimeout(next.timer);
      next.resolve();
    } else active--;
  }
}

// ผู้ใช้หนึ่งคนค้นแบบ scraping ได้ทีละ 1 คำขอ (รวมที่รอคิวอยู่) — ไม่งั้นคนเดียวจองคิวทั้ง 10 ช่องได้
// คืนฟังก์ชันปล่อยสิทธิ์ ต้องเรียกใน finally
const busyUsers = new Set();
function claimUserScrape(userId) {
  if (busyUsers.has(userId)) {
    throw Object.assign(new Error('user already has a scrape in progress'), { code: 'SCRAPER_USER_BUSY' });
  }
  busyUsers.add(userId);
  return () => busyUsers.delete(userId);
}

module.exports = { withScrapeSlot, claimUserScrape };
