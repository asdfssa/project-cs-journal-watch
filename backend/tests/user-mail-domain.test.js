// อีเมลผู้ใช้ต้องมี @ และโดเมนที่อนุญาต (ไม่ใช่แค่รหัสนิสิต) — `node --test tests/user-mail-domain.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.GOOGLE_ALLOWED_DOMAIN = 'msu.ac.th,gmail.com';
const src = (p) => path.join(__dirname, '..', 'src', p);
const log = [];
require.cache[src('config/database.js')] = {
  id: 'db', filename: src('config/database.js'), loaded: true,
  exports: {
    query: async (sql, p) => { log.push([sql, p]); if (/^\s*SELECT/i.test(sql)) return [[]]; return [{ insertId: 9, affectedRows: 1 }]; },
    getConnection: async () => ({ beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {}, query: async () => [{ insertId: 9 }] }),
  },
};
const Admin = require(src('controllers/AdminController.js'));
const makeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const create = async (msu_mail) => {
  log.length = 0;
  const res = makeRes();
  await Admin.createUser({ user: { sub: 1, role: 'Admin' }, body: { role: 'Student', first_name: 'a', last_name: 'b', msu_mail } }, res, (e) => { throw e; });
  return res;
};

test('เพิ่มผู้ใช้: ใส่แค่รหัสนิสิต (ไม่มี @โดเมน) → 400 INVALID_EMAIL และไม่เขียน DB', async () => {
  const r = await create('66011212039');
  assert.equal(r.code, 400);
  assert.equal(r.body.code, 'INVALID_EMAIL');
  assert.ok(!log.some(([sql]) => /^\s*INSERT/i.test(sql)));
});

test('เพิ่มผู้ใช้: โดเมนไม่อยู่ในรายการที่อนุญาต → 400 INVALID_EMAIL', async () => {
  const r = await create('someone@example.com');
  assert.equal(r.code, 400);
  assert.equal(r.body.code, 'INVALID_EMAIL');
  assert.match(r.body.message, /msu\.ac\.th/);
});

test('เพิ่มผู้ใช้: โดเมนถูก (ตัวพิมพ์ใหญ่ก็ได้) → ผ่านด่านตรวจอีเมล', async () => {
  for (const m of ['66011212039@msu.ac.th', 'Somchai@MSU.AC.TH', 'x@gmail.com']) {
    const r = await create(m);
    assert.notEqual(r.body?.code, 'INVALID_EMAIL', m);
  }
});

test('แก้ไขผู้ใช้: เปลี่ยนอีเมลเป็นแบบผิด → 400 INVALID_EMAIL, ไม่เปลี่ยนอีเมล → ไม่ตรวจซ้ำ', async () => {
  const cur = { user_id: 5, prefix: null, first_name: 'a', last_name: 'b', msu_mail: '66011212039', phone: null, role: 'Student', degree_level: null, curriculum_year: null, study_plan_code: null };
  const db = require(src('config/database.js'));
  const orig = db.query;
  db.query = async (sql, p) => (/^\s*SELECT/i.test(sql) ? [[cur]] : [{ affectedRows: 1 }]);
  const bad = makeRes();
  await Admin.updateUser({ params: { id: '5' }, user: { sub: 1, role: 'Admin' }, body: { msu_mail: 'bad-mail' } }, bad, (e) => { throw e; });
  assert.equal(bad.code, 400);
  assert.equal(bad.body.code, 'INVALID_EMAIL');
  const keep = makeRes();   // อีเมลเก่าที่ผิดรูปแบบ แก้ชื่ออย่างเดียวยังทำได้
  await Admin.updateUser({ params: { id: '5' }, user: { sub: 1, role: 'Admin' }, body: { first_name: 'new' } }, keep, (e) => { throw e; });
  assert.notEqual(keep.body?.code, 'INVALID_EMAIL');
  db.query = orig;
});
