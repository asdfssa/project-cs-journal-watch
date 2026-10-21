// Scrapers + cache: hit ไม่เข้าคิว/ไม่เปิด Chromium · miss scrape แล้ว save · ไม่พบ/error ไม่ถูก cache
// `node --test tests/journal-cache-scrapers.test.js` (ไม่เปิด Chromium, ไม่ต่อ MySQL จริง)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);

// คิวปลอม: นับการขอ slot (hit ต้องไม่ขอ)
const queue = { slots: 0, async withScrapeSlot(fn) { queue.slots++; return fn(); }, claimUserScrape() { return () => {}; } };
const queuePath = src('services/scrapeQueue.js');
require.cache[queuePath] = { id: queuePath, filename: queuePath, loaded: true, exports: queue };

const JournalCache = require(src('services/JournalCache.js'));
const ScopusScraper = require(src('services/ScopusScraper.js'));
const TCIScraper = require(src('services/TCIScraper.js'));

const CASES = [
  { name: 'ScopusScraper', S: ScopusScraper, source: 'Scopus', typed: '1057-5987', clean: '10575987',
    result: { issn: '10575987', eissn: null, journal_name: 'MMWR', database_source: 'Scopus', fetch_method: 'Scraping' } },
  { name: 'TCIScraper', S: TCIScraper, source: 'TCI', typed: '0125-2216', clean: '0125-2216',
    result: { issn: '01252216', eissn: null, journal_name: 'Thai', database_source: 'TCI', fetch_method: 'Scraping' } },
];

let store, saved, gets, scrapeCalls, scrapeImpl;
test.beforeEach(() => {
  store = null; saved = []; gets = []; scrapeCalls = 0; queue.slots = 0;
  JournalCache.shared = () => ({
    async get(issn, source) { gets.push([issn, source]); return store; },
    async save(d) { saved.push(d); },
  });
});

for (const c of CASES) {
  test.beforeEach(() => { scrapeImpl = async () => ({ ...c.result }); });

  test(`${c.name} miss: เข้าคิว+scrape 1 ครั้ง, save ผล, fromCache:false`, async () => {
    c.S._scrape = async () => { scrapeCalls++; return scrapeImpl(); };
    const r = await c.S.getJournalByIssn(c.typed);
    assert.equal(scrapeCalls, 1);
    assert.equal(queue.slots, 1);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].fetch_method, 'Scraping');
    assert.equal(r.fromCache, false);
    assert.deepEqual(gets, [[c.clean, c.source]]);
  });

  test(`${c.name} hit: ไม่เข้าคิว, ไม่ scrape (ไม่เปิด Chromium), ไม่ save`, async () => {
    c.S._scrape = async () => { scrapeCalls++; return scrapeImpl(); };
    store = { ...c.result, fromCache: true };
    const r = await c.S.getJournalByIssn(c.typed);
    assert.equal(r, store);
    assert.equal(queue.slots, 0);
    assert.equal(scrapeCalls, 0);
    assert.equal(saved.length, 0);
  });

  test(`${c.name} ไม่พบ (null) → ไม่ถูก cache`, async () => {
    c.S._scrape = async () => null;
    assert.equal(await c.S.getJournalByIssn(c.typed), null);
    assert.equal(saved.length, 0);
  });

  test(`${c.name} scrape error → throw ต่อ และไม่ถูก cache`, async () => {
    c.S._scrape = async () => { throw new Error('boom'); };
    await assert.rejects(c.S.getJournalByIssn(c.typed), /boom/);
    assert.equal(saved.length, 0);
  });
}
