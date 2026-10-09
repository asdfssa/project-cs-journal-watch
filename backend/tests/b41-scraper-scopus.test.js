// B41: คิว scrape, ไม่พบ ISSN = null, Scopus key ถูกปฏิเสธ/429 — `node --test tests/b41-scraper-scopus.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);
const stubModule = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports }; };

// config ปลอม: 2 Scopus key, คิว scrape 1 ช่อง รอได้ 50ms
const cfg = {
  scopus: { apiKeys: ['key-one-1111', 'key-two-2222'], baseUrl: 'http://scopus.test' },
  scraper: { maxConcurrent: 1, maxQueue: 3, queueTimeoutMs: 50, headless: true, slowMo: 0 },
};
stubModule(src('config/index.js'), cfg);

// ไม่แตะไฟล์ state จริง
fs.promises.mkdir = async () => {};
fs.promises.writeFile = async () => {};
fs.promises.rename = async () => {};
const realRead = fs.readFileSync;
fs.readFileSync = (p, ...a) => (String(p).endsWith('scopus-proxy-state.json') ? '{}' : realRead(p, ...a));

// axios ปลอม: ตอบตามคิวที่กำหนดต่อ key
const axiosPath = require.resolve('axios');
const axiosCalls = [];
const axiosPlan = {}; // key -> () => response | throw
stubModule(axiosPath, { get: async (_url, opts) => { const k = opts.headers['X-ELS-APIKey']; axiosCalls.push(k); return axiosPlan[k](); } });

const { withScrapeSlot, claimUserScrape } = require(src('services/scrapeQueue.js'));
const proxy = require(src('services/ScopusProxyService.js'));
const ScopusService = require(src('services/ScopusService.js'));

const httpError = (status, headers = {}) => Object.assign(new Error(`HTTP ${status}`), { response: { status, headers } });
const OK = { headers: {}, data: { 'serial-metadata-response': { entry: [{ 'dc:title': 'T', 'prism:issn': '12345678' }] } } };
const reset = () => {
  axiosCalls.length = 0;
  for (const k of proxy.keys) { k.unavailableUntil = null; k.weeklyRemaining = 20000; k.weeklyLimit = 20000; k.recentRequestTimestamps = []; }
  proxy.currentIndex = 0;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- scrapeQueue ----------
test('คิว: รอเกิน queueTimeoutMs → SCRAPER_BUSY และคิวไม่ค้าง (คนถัดไปยังได้ช่อง)', async () => {
  let release;
  const holder = withScrapeSlot(() => new Promise((r) => { release = r; })); // กินช่องเดียวไว้
  await sleep(5);
  await assert.rejects(withScrapeSlot(async () => 'never'), { code: 'SCRAPER_BUSY' });
  release('done');
  assert.equal(await holder, 'done');
  assert.equal(await withScrapeSlot(async () => 'free'), 'free'); // ช่องกลับมาว่างจริง ไม่รั่ว
});

test('คิว: คนที่รออยู่ได้ช่องต่อทันทีเมื่อคนก่อนเสร็จ (ก่อนหมดเวลา)', async () => {
  let release;
  const first = withScrapeSlot(() => new Promise((r) => { release = r; }));
  await sleep(5);
  const second = withScrapeSlot(async () => 'second');
  setTimeout(() => release('first'), 10);
  assert.equal(await first, 'first');
  assert.equal(await second, 'second');
});

test('ผู้ใช้เดียวค้น scrape ซ้อนไม่ได้ (SCRAPER_USER_BUSY) และปล่อยสิทธิ์แล้วค้นใหม่ได้', () => {
  const release = claimUserScrape(42);
  assert.throws(() => claimUserScrape(42), { code: 'SCRAPER_USER_BUSY' });
  assert.doesNotThrow(() => claimUserScrape(43)()); // คนอื่นไม่โดน
  release();
  assert.doesNotThrow(() => claimUserScrape(42)());
});

// ---------- ScopusScraper: ไม่พบ = false (→ null → 404) ----------
test('ScopusScraper._searchByIssn: ตารางผลลัพธ์ไม่ขึ้น (timeout) → false ไม่ throw', async () => {
  const ScopusScraper = require(src('services/ScopusScraper.js'));
  const loc = { click: async () => {}, fill: async () => {}, type: async () => {}, first() { return loc; }, locator() { return loc; } };
  const page = {
    locator: () => loc,
    waitForTimeout: async () => {},
    waitForSelector: async (sel) => {
      if (sel.includes('sourceResults')) throw Object.assign(new Error('t'), { name: 'TimeoutError' });
    },
    waitForLoadState: async () => {},
  };
  assert.equal(await ScopusScraper._searchByIssn(page, '12345678'), false);

  // error อื่นที่ไม่ใช่ timeout ยังต้องโผล่ (ไม่กลืนเป็น "ไม่พบ")
  page.waitForSelector = async (sel) => { if (sel.includes('sourceResults')) throw new Error('browser crashed'); };
  await assert.rejects(ScopusScraper._searchByIssn(page, '12345678'), /browser crashed/);
});

// ---------- ScopusService ----------
test('401/403: ตัด key นั้นออกแล้วลอง key ถัดไป ผู้ใช้ได้ผลปกติ', async () => {
  reset();
  axiosPlan['key-one-1111'] = () => { throw httpError(403); };
  axiosPlan['key-two-2222'] = () => OK;
  const r = await ScopusService.getJournalByIssn('1234-5678');
  assert.ok(r);
  assert.deepEqual(axiosCalls, ['key-one-1111', 'key-two-2222']);
  assert.ok(proxy.keys[0].unavailableUntil > Date.now() + 23 * 3600 * 1000, 'key ที่ถูกปฏิเสธต้องพักยาว');

  axiosCalls.length = 0;
  await ScopusService.getJournalByIssn('1234-5678'); // คำขอถัดไปไม่ไปชน key เสียอีก
  assert.ok(!axiosCalls.includes('key-one-1111'));
});

test('ทุก key ถูกปฏิเสธ → SCOPUS_QUOTA_EXCEEDED (ให้ระบบ fallback) ไม่ใช่วนไม่จบ/500 ดิบ', async () => {
  reset();
  axiosPlan['key-one-1111'] = () => { throw httpError(401); };
  axiosPlan['key-two-2222'] = () => { throw httpError(401); };
  await assert.rejects(ScopusService.getJournalByIssn('1234-5678'), { code: 'SCOPUS_QUOTA_EXCEEDED' });
  assert.equal(axiosCalls.length, 2);
});

test('บันทึก usage พัง → ผลค้นที่ได้มาแล้วยังคืนปกติ', async () => {
  reset();
  axiosPlan['key-one-1111'] = () => OK;
  const orig = proxy.incrementUsage;
  proxy.incrementUsage = async () => { throw new Error('disk full'); };
  const errLog = console.error; console.error = () => {};
  try { assert.ok(await ScopusService.getJournalByIssn('1234-5678')); }
  finally { proxy.incrementUsage = orig; console.error = errLog; }
});

test('429 ขณะ quota รายสัปดาห์ยังเหลือ → พัก key แค่ ~30 วินาที (ไม่ใช่ 1 ชั่วโมง)', async () => {
  reset();
  await proxy.markKeyUnavailable(0, { 'x-ratelimit-limit': '20000', 'x-ratelimit-remaining': '19000', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 86400) });
  const wait = proxy.keys[0].unavailableUntil - Date.now();
  assert.ok(wait > 0 && wait <= 31000, `พัก ${wait}ms`);
});

test('429 ที่ quota หมดจริง → พักถึงเวลารีเซ็ต · ไม่มี header → ยังพัก 1 ชม. เหมือนเดิม', async () => {
  reset();
  const resetAt = Math.floor(Date.now() / 1000) + 2 * 86400;
  await proxy.markKeyUnavailable(0, { 'x-ratelimit-limit': '20000', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetAt) });
  assert.equal(proxy.keys[0].unavailableUntil, resetAt * 1000);

  reset();
  proxy.keys[1].weeklyRemaining = null; // ไม่รู้ quota
  await proxy.markKeyUnavailable(1, null);
  const wait = proxy.keys[1].unavailableUntil - Date.now();
  assert.ok(wait > 59 * 60 * 1000 && wait <= 60 * 60 * 1000);
});
