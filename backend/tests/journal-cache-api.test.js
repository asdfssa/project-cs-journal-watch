// Cache ใน API: response ค้นวารสารมี fromCache/cached_at · GET /admin/stats มี journal_cache (นับเฉพาะแถวที่ยังไม่หมดอายุ)
// `node --test tests/journal-cache-api.test.js` (ไม่ต่อ MySQL — stub config/database)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);

const queries = [];
const dbPath = src('config/database.js');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('FROM journals_cache')) {
        return [[{ total: '3', scopus: '2', tci: '1', via_api: '2', via_scraping: '1' }]];
      }
      if (sql.includes('FROM users')) {
        return [[{ total: 1, students: 1, supervisors: 0, staff: 0, admins: 0, pending: 0, active: 1, suspended: 0 }]];
      }
      return [[{ total: 0, pending: 0, approved: 0, rejected: 0, cancelled: 0 }]];
    },
  },
};

const JournalController = require(src('controllers/JournalController.js'));
const AdminController = require(src('controllers/AdminController.js'));

test('_normalizeResponse: hit จาก cache ส่ง fromCache:true + cached_at', () => {
  const at = new Date('2026-10-21T01:00:00Z');
  const n = JournalController._normalizeResponse({ issn: '10575987', fromCache: true, cached_at: at });
  assert.equal(n.fromCache, true);
  assert.equal(n.cached_at, at);
});

test('_normalizeResponse: ดึงสด → fromCache:false, cached_at:null', () => {
  const n = JournalController._normalizeResponse({ issn: '10575987', fromCache: false });
  assert.equal(n.fromCache, false);
  assert.equal(n.cached_at, null);
  assert.equal(JournalController._normalizeResponse({ issn: '1' }).fromCache, false);
});

test('GET /admin/stats: journal_cache เป็นตัวเลข + นับเฉพาะแถวที่ยังไม่หมดอายุตาม TTL', async () => {
  queries.length = 0;
  let body;
  await AdminController.getStats({}, { json: (b) => { body = b; } }, (e) => { throw e; });
  assert.deepEqual(body.data.journal_cache, { total: 3, scopus: 2, tci: 1, via_api: 2, via_scraping: 1, ttl_hours: 6 });
  const q = queries.find(x => x.sql.includes('FROM journals_cache'));
  assert.match(q.sql, /last_updated >= NOW\(\) - INTERVAL \? HOUR/);
  assert.deepEqual(q.params, [6]);
});
