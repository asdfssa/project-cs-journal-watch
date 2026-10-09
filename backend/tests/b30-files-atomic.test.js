// B30: submitWithFiles เขียนไฟล์ + evidence ใน transaction เดียวกับ T3 — `node --test tests/b30-files-atomic.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);
const conn = { query: async (sql, params) => { conn.calls.push([sql, params]); return [[]]; }, calls: [] };
require.cache[src('config/database.js')] = { id: 'db', filename: 'db', loaded: true, exports: { query: async () => [[]] } };
const T3Model = require(src('models/T3Model.js'));
const T3Controller = require(src('controllers/T3Controller.js'));

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const makeRes = () => ({ code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
// X32: ต้องแนบ acceptance_letter + full_paper เสมอ
const REQ_FILES = () => ({ acceptance_letter: [{ buffer: PNG, mimetype: 'application/pdf' }], full_paper: [{ buffer: PNG, mimetype: 'application/pdf' }] });
const makeReq = (files) => ({ user: { sub: 1 }, body: { pre_t3_id: '1' }, files });

test('ไฟล์ล้มกลางทาง → โฟลเดอร์ถูกลบ, ไม่มีไฟล์กำพร้า, ตอบ 500', async () => {
  const cwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b30-'));
  process.chdir(tmp);
  const orig = T3Controller._validateAndCreate;
  T3Controller._validateAndCreate = async (_s, _b, afterInsert) => {
    await afterInsert(conn, 42);            // เขียนไฟล์สำเร็จ
    throw new Error('commit failed');       // แล้ว transaction พัง
  };
  try {
    const res = makeRes();
    await T3Controller.submitWithFiles(makeReq(REQ_FILES()), res);
    assert.equal(res.code, 500);
    assert.equal(fs.existsSync(path.join(tmp, 'uploads', 't3', '42')), false);
  } finally {
    T3Controller._validateAndCreate = orig;
    process.chdir(cwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('สำเร็จ → นามสกุลมาจากเนื้อไฟล์จริง (PNG ที่ประกาศเป็น pdf ได้ .png) + บันทึก evidence ด้วย conn ของ transaction', async () => {
  const cwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b30-'));
  process.chdir(tmp);
  conn.calls.length = 0;
  const orig = T3Controller._validateAndCreate;
  T3Controller._validateAndCreate = async (_s, _b, afterInsert) => {
    await afterInsert(conn, 7);
    return { t3Id: 7, student: {}, majorAdvisor: { advisor_id: 0 }, journal_snapshot: {}, paper_and_research_details: {} };
  };
  try {
    const res = makeRes();
    await T3Controller.submitWithFiles(makeReq(REQ_FILES()), res);
    assert.equal(res.code, 201);
    assert.match(res.body.data.uploaded.full_paper, /^uploads\/t3\/7\/full_paper\/[0-9a-f-]{36}\.png$/);
    assert.ok(conn.calls.some(([sql]) => sql.includes('t3_evidence_files')));
  } finally {
    T3Controller._validateAndCreate = orig;
    process.chdir(cwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('ไฟล์เนื้อหาไม่ใช่ชนิดที่อนุญาต → 400 และไม่เรียกสร้าง T3', async () => {
  let called = false;
  const orig = T3Controller._validateAndCreate;
  T3Controller._validateAndCreate = async () => { called = true; };
  try {
    const res = makeRes();
    await T3Controller.submitWithFiles(makeReq({ ...REQ_FILES(), full_paper: [{ buffer: Buffer.from('<html>'), mimetype: 'application/pdf' }] }), res);
    assert.equal(res.code, 400);
    assert.equal(called, false);
  } finally { T3Controller._validateAndCreate = orig; }
});

test('T3Model.create: afterInsert รันใน transaction เดียวกัน และ error ถูกส่งต่อ (ให้ rollback)', async () => {
  const seen = [];
  // ใช้ stub conn: Pre-T3 Approved, ไม่มี T3 ซ้ำ, insert ได้ id 9
  const c = { query: async (sql) => (sql.includes('FROM pre_t3_requests') ? [[{ overall_status: 'Approved' }]]
    : sql.includes('SELECT 1 FROM t3_requests') ? [[]] : [{ insertId: 9 }]) };
  const args = [1, 10, { title_thai: 'a', title_english: 'b', first_author: 'c', corresponding_author: 'd' },
    { type: 'x', weight_score: 1, status: 'Published' }, { has_impact_score: false }, { majorAdvisorId: 5 }];
   // withTransaction ใช้ db.getConnection → stub ที่ pool
  const db = require(src('config/database.js'));
  db.getConnection = async () => ({ ...c, beginTransaction: async () => {}, commit: async () => seen.push('commit'),
    rollback: async () => seen.push('rollback'), release: () => {} });
  assert.equal(await T3Model.create(...args, async (conn2, id) => { assert.equal(id, 9); seen.push('after'); }), 9);
  await assert.rejects(T3Model.create(...args, async () => { throw new Error('disk full'); }), /disk full/);
  assert.deepEqual(seen, ['after', 'commit', 'rollback']);
});

test('X32: ไม่แนบ acceptance_letter/full_paper → 400 MISSING_REQUIRED_FILES และไม่สร้าง T3', async () => {
  let called = false;
  const orig = T3Controller._validateAndCreate;
  T3Controller._validateAndCreate = async () => { called = true; };
  try {
    for (const files of [undefined, {}, { full_paper: REQ_FILES().full_paper }, { journal_cover: REQ_FILES().full_paper }]) {
      const res = makeRes();
      await T3Controller.submitWithFiles(makeReq(files), res);
      assert.equal(res.code, 400);
      assert.equal(res.body.code, 'MISSING_REQUIRED_FILES');
    }
    const res = makeRes();
    await T3Controller.submitWithFiles(makeReq({ full_paper: REQ_FILES().full_paper }), res);
    assert.deepEqual(res.body.missing, ['acceptance_letter']);
    assert.equal(called, false);
  } finally { T3Controller._validateAndCreate = orig; }
});

test('X32: ไม่มี POST /t3 แบบ JSON แล้ว (เหลือ /with-files ทางเดียว)', () => {
  const router = require(src('routes/t3Routes.js'));
  const posts = router.stack.filter(l => l.route?.methods.post).map(l => l.route.path);
  assert.deepEqual(posts, ['/with-files']);
});
