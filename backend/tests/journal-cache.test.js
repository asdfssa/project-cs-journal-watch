// JournalCache (TTL 6 ชม., ตาราง journals_cache) — `node --test tests/journal-cache.test.js`
// ใช้ DB จำลองในหน่วยความจำ (ไม่ต่อ MySQL จริง) · เวลาควบคุมได้ด้วย db.nowMs
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createJournalCache, COLUMNS } = require(path.join(__dirname, '..', 'src', 'services', 'JournalCache.js'));

const HOUR = 3600 * 1000;

// ตัวจำลองให้ตรงกับ SQL 3 แบบที่โมดูลใช้: lookup / upsert / purge
function fakeDb() {
  const db = {
    nowMs: 1_000_000_000_000,
    rows: [],
    calls: [],
    fail: false,
    async query(sql, params) {
      db.calls.push({ sql, params });
      if (db.fail) throw new Error('db down');
      if (sql.startsWith('SELECT')) {
        const [source, i1, i2, ttl] = params;
        const hit = db.rows.find(r => r.database_source === source && (r.issn === i1 || r.eissn === i2)
          && r.last_updated.getTime() >= db.nowMs - ttl * HOUR);
        return [hit ? [{ ...hit }] : []];
      }
      if (sql.startsWith('INSERT')) {
        const row = Object.fromEntries(COLUMNS.map((c, i) => [c, params[i]]));
        row.last_updated = new Date(db.nowMs);
        const idx = db.rows.findIndex(r => r.issn === row.issn && r.database_source === row.database_source);
        if (idx >= 0) db.rows[idx] = row; else db.rows.push(row);
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('DELETE')) {
        const before = db.rows.length;
        db.rows = db.rows.filter(r => r.last_updated.getTime() >= db.nowMs - params[0] * HOUR);
        return [{ affectedRows: before - db.rows.length }];
      }
      throw new Error('unexpected sql: ' + sql);
    },
  };
  return db;
}

const make = (db, opts = {}) => createJournalCache({
  db, ttlHours: 6, purgeIntervalMinutes: 10, now: () => db.nowMs, log: () => {}, ...opts,
});

const scopus = (extra = {}) => ({
  issn: '15244539', eissn: '15424863', journal_name: 'CA', publisher: 'Wiley', database_source: 'Scopus',
  scopus_quartile_data: [{ subject_area: 'Oncology', quartile: 'Q1', percentile: 99 }],
  scopus_best_quartile: 'Q1', scopus_best_percentile: 99, scopus_h_index: null, scopus_total_docs: 106,
  open_access: null, open_access_type: null, scopus_citescore: 10.5, scopus_sjr: 1.25, scopus_snip: 2.5,
  scopus_discontinued: false, subject_areas: [{ code: '2730', area: 'Oncology' }],
  coverage_start_year: '2000', coverage_end_year: '2026', fetch_method: 'API', ...extra,
});
const tci = (extra = {}) => ({
  issn: '15244539', eissn: null, journal_name: 'วารสารไทย', database_source: 'TCI',
  tci_tier: 1, tci_status: 'active', tci_inactive: false, fetch_method: 'API', ...extra,
});

test('ไม่มีใน cache → null', async () => {
  assert.equal(await make(fakeDb()).get('1524-4539', 'Scopus'), null);
});

test('save แล้ว get → hit, fromCache:true, ข้อมูลครบชนิดเดียวกับ fetch สด', async () => {
  const db = fakeDb(); const c = make(db);
  const src = scopus();
  await c.save(src);
  const r = await c.get('1524-4539', 'Scopus');
  assert.equal(r.fromCache, true);
  assert.ok(r.cached_at instanceof Date);
  assert.deepEqual(r.scopus_quartile_data, src.scopus_quartile_data);
  assert.deepEqual(r.subject_areas, src.subject_areas);
  assert.equal(r.scopus_citescore, 10.5);
  assert.equal(typeof r.scopus_sjr, 'number');
  assert.equal(r.scopus_discontinued, false);
  assert.equal(r.fetch_method, 'API');
  assert.equal('tci_tier' in r, false);     // Scopus ไม่มี field ของ TCI
});

test('DECIMAL ที่ DB คืนเป็นสตริง และ JSON ที่คืนเป็นสตริง → แปลงกลับเป็น number/object', async () => {
  const db = fakeDb(); const c = make(db);
  await c.save(scopus());
  const row = db.rows[0];
  row.scopus_citescore = '10.50'; row.scopus_sjr = '1.2500'; row.scopus_snip = '2.5000';
  assert.equal(typeof row.scopus_quartile_data, 'string'); // save เก็บ JSON เป็นสตริง
  row.scopus_discontinued = 0;
  const r = await c.get('15244539', 'Scopus');
  assert.equal(r.scopus_citescore, 10.5);
  assert.equal(r.scopus_snip, 2.5);
  assert.equal(r.scopus_quartile_data[0].quartile, 'Q1');
  assert.equal(r.scopus_discontinued, false);
});

test('ค้นด้วย e-ISSN และ ISSN ตัวพิมพ์เล็ก/มีขีด ได้ hit จากแถวเดียวกัน', async () => {
  const db = fakeDb(); const c = make(db);
  await c.save(scopus({ issn: '2049363X', eissn: '20493638' }));
  assert.ok(await c.get('2049-3638', 'Scopus'));
  assert.ok(await c.get('2049-363x', 'Scopus'));
});

test('Scopus กับ TCI ISSN เดียวกันแยกเป็นคนละแถว', async () => {
  const db = fakeDb(); const c = make(db);
  await c.save(scopus()); await c.save(tci());
  assert.equal(db.rows.length, 2);
  assert.equal((await c.get('15244539', 'TCI')).tci_tier, 1);
  assert.equal((await c.get('15244539', 'Scopus')).scopus_best_quartile, 'Q1');
});

test('TTL: 5 ชม.59 นาที = hit · เกิน 6 ชม. = miss', async () => {
  const db = fakeDb(); const c = make(db);
  await c.save(scopus());
  db.nowMs += 6 * HOUR - 60_000;
  assert.ok(await c.get('15244539', 'Scopus'));
  db.nowMs += 120_000;
  assert.equal(await c.get('15244539', 'Scopus'), null);
});

test('อ่านจาก cache ไม่ต่ออายุ (ไม่มี query เขียนตอน get, last_updated คงเดิม)', async () => {
  const db = fakeDb(); const c = make(db);
  await c.save(scopus());
  const stamp = db.rows[0].last_updated.getTime();
  db.calls.length = 0; db.nowMs += 3 * HOUR;
  await c.get('15244539', 'Scopus');
  assert.equal(db.calls.length, 1);
  assert.ok(db.calls[0].sql.startsWith('SELECT'));
  assert.equal(db.rows[0].last_updated.getTime(), stamp);
});

test('ไม่ cache ผล null / ไม่มี issn / ไม่รู้ source', async () => {
  const db = fakeDb(); const c = make(db);
  await c.save(null); await c.save(undefined);
  await c.save({ journal_name: 'x', database_source: 'Scopus' });
  await c.save({ issn: '15244539', journal_name: 'x', database_source: 'Other' });
  assert.equal(db.calls.length, 0);
});

test('DB พัง: save ไม่ throw, get คืน null (ถือเป็น miss)', async () => {
  const db = fakeDb(); const c = make(db);
  db.fail = true;
  await assert.doesNotReject(c.save(scopus()));
  assert.equal(await c.get('15244539', 'Scopus'), null);
});

test('Scraping ไม่ทับผล API ที่ยังไม่หมดอายุ · API ทับ Scraping ได้ · Scraping ทับ API ที่หมดอายุได้', async () => {
  const db = fakeDb(); const c = make(db);
  await c.save(scopus({ journal_name: 'from-api' }));
  await c.save(scopus({ journal_name: 'from-scrape', fetch_method: 'Scraping' }));
  assert.equal(db.rows[0].journal_name, 'from-api');

  db.nowMs += 7 * HOUR;
  await c.save(scopus({ journal_name: 'scrape-2', fetch_method: 'Scraping' }));
  assert.equal(db.rows[0].journal_name, 'scrape-2');

  await c.save(scopus({ journal_name: 'api-2' }));
  assert.equal(db.rows[0].journal_name, 'api-2');
  assert.equal(db.rows[0].fetch_method, 'API');
});

test('auto-purge: ลบแถวหมดอายุตอน save, แถวสดไม่ถูกลบ', async () => {
  const db = fakeDb(); const c = make(db);
  await c.save(scopus({ issn: '11111111', eissn: null }));
  db.nowMs += 7 * HOUR;
  await c.save(scopus({ issn: '22222222', eissn: null }));
  assert.deepEqual(db.rows.map(r => r.issn), ['22222222']);
});

test('auto-purge: ไม่ถี่กว่า purgeIntervalMinutes', async () => {
  const db = fakeDb(); const c = make(db);
  const deletes = () => db.calls.filter(x => x.sql.startsWith('DELETE')).length;
  await c.save(scopus({ issn: '11111111', eissn: null }));
  const first = deletes();
  db.nowMs += 5 * 60_000;
  await c.save(scopus({ issn: '22222222', eissn: null }));
  assert.equal(deletes(), first);
  db.nowMs += 6 * 60_000;
  await c.save(scopus({ issn: '33333333', eissn: null }));
  assert.equal(deletes(), first + 1);
});

test('auto-purge พัง → save ยังสำเร็จ ไม่ throw', async () => {
  const db = fakeDb(); const c = make(db);
  const orig = db.query.bind(db);
  db.query = async (sql, p) => { if (sql.startsWith('DELETE')) throw new Error('boom'); return orig(sql, p); };
  await assert.doesNotReject(c.save(scopus()));
  assert.equal(db.rows.length, 1);
});
