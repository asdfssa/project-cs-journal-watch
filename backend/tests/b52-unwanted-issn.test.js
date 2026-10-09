// B52: ค้น/เช็ค/กันซ้ำ ISSN ของวารสารต้องห้าม — `node --test tests/b52-unwanted-issn.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);
const log = [];
const dbPath = src('config/database.js');
const state = { dupRows: [], lockGot: 1 };

const lockConn = {
  async query(sql, params) {
    log.push(['LOCK_CONN', sql, params]);
    if (sql.includes('GET_LOCK')) return [[{ got: state.lockGot }]];
    return [[]];
  },
  release() { log.push(['RELEASE_CONN']); },
};
require.cache[dbPath] = {
  id: 'db', filename: dbPath, loaded: true,
  exports: {
    getConnection: async () => lockConn,
    query: async (sql, params) => {
      log.push(['DB', sql, params]);
      if (sql.includes('COUNT(*)')) return [[{ total: 0 }]];
      if (/^\s*INSERT/i.test(sql)) return [{ insertId: 1 }];
      if (sql.includes('issn IN')) return [state.dupRows];
      return [[]];
    },
  },
};
const Controller = require(src('controllers/UnwantedJournalController.js'));
const makeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const reset = () => { log.length = 0; state.dupRows = []; state.lockGot = 1; };

test('getAll: ค้น "12345678" เทียบ issn แบบตัดขีดด้วย (เดิมไม่เจอ 1234-5678)', async () => {
  reset();
  await Controller.getAll({ query: { search: '12345678' } }, makeRes(), (e) => { throw e; });
  const [, sql, params] = log.find(([k, s]) => k === 'DB' && s.includes('COUNT(*)'));
  assert.match(sql, /REPLACE\(issn, '-', ''\) LIKE \?/);
  assert.deepEqual(params, ['%12345678%', '%12345678%', '%12345678%', '%12345678%']);
});

test('getAll: ค้นแบบมีขีด/ช่องว่างก็ตัดเป็นตัวเลขเทียบด้วย และค้นชื่อทั่วไปไม่โดน', async () => {
  reset();
  await Controller.getAll({ query: { search: '1234 5678' } }, makeRes(), (e) => { throw e; });
  assert.equal(log.find(([k, s]) => k === 'DB' && s.includes('COUNT(*)'))[2][2], '%12345678%');

  reset();
  await Controller.getAll({ query: { search: 'Journal of X' } }, makeRes(), (e) => { throw e; });
  const [, sql, params] = log.find(([k, s]) => k === 'DB' && s.includes('COUNT(*)'));
  assert.ok(!sql.includes('REPLACE(issn'));
  assert.equal(params.length, 3);
});

test('checkByIssn: เทียบทั้งแบบมี/ไม่มีขีด (แถวเก่าเก็บไม่มีขีดก็เจอ)', async () => {
  reset();
  state.dupRows = [];
  await Controller.checkByIssn({ params: { issn: '12345678' } }, makeRes(), (e) => { throw e; });
  const [, sql, params] = log.find(([k]) => k === 'DB');
  assert.match(sql, /issn IN \(\?, \?\)/);
  assert.deepEqual(params, ['1234-5678', '12345678']);
});

test('createOne: ISSN ซ้ำ → 400, ถือ lock แล้วปล่อยเสมอ, ไม่ INSERT', async () => {
  reset();
  state.dupRows = [{ unwanted_id: 9 }];
  const res = makeRes();
  await runCreate({ journal_name: 'J', issn: '12345678', recorded_date: '2026-01-01' }, res);
  assert.equal(res.code, 400);
  assert.ok(log.some(([k, s]) => k === 'LOCK_CONN' && s.includes('GET_LOCK')));
  assert.ok(log.some(([k, s]) => k === 'LOCK_CONN' && s.includes('RELEASE_LOCK')));
  assert.ok(!log.some(([, s]) => /^\s*INSERT/i.test(s)));
});

test('createOne: ไม่ซ้ำ → INSERT สำเร็จ และปล่อย lock หลังเขียนเสร็จ (ไม่ใช่ก่อน)', async () => {
  reset();
  const res = makeRes();
  await runCreate({ journal_name: 'J', issn: '1234-5678', recorded_date: '2026-01-01' }, res);
  assert.equal(res.code, 201);
  const iInsert = log.findIndex(([, s]) => /^\s*INSERT/i.test(s));
  const iRelease = log.findIndex(([, s]) => s.includes('RELEASE_LOCK'));
  assert.ok(iInsert >= 0 && iRelease > iInsert);
});

test('createOne: ได้ lock ไม่ทัน → 503 BUSY และคืน connection', async () => {
  reset();
  state.lockGot = 0;
  const res = makeRes();
  await runCreate({ journal_name: 'J', issn: '1234-5678', recorded_date: '2026-01-01' }, res);
  assert.equal(res.code, 503);
  assert.equal(res.body.code, 'BUSY');
  assert.ok(log.some(([k]) => k === 'RELEASE_CONN'));
});

// createOne ห่อ multer (uploadEvidence) ไว้ — request ที่ไม่ใช่ multipart ทำให้ multer ข้ามไปเรียก callback ทันที
function runCreate(body, res) {
  return new Promise((resolve) => {
    const req = { body, user: { sub: 1 }, headers: { 'content-type': 'application/json' } };
    const done = res.json.bind(res);
    res.json = (b) => { done(b); resolve(); return res; };
    Controller.createOne(req, res, (e) => { res.code = 500; res.body = { error: e.message }; resolve(); });
  });
}
