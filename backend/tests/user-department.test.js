// สาขาวิชา (users.department เป็น ENUM) — `node --test tests/user-department.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.GOOGLE_ALLOWED_DOMAIN = 'msu.ac.th';
const src = (p) => path.join(__dirname, '..', 'src', p);
const log = [];
require.cache[src('config/database.js')] = {
  id: 'db', filename: src('config/database.js'), loaded: true,
  exports: {
    query: async (sql, p) => { log.push([sql, p]); if (/^\s*SELECT/i.test(sql)) return [[]]; return [{ insertId: 9, affectedRows: 1 }]; },
    getConnection: async () => ({ beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {}, query: async (sql, p) => { log.push([sql, p]); return [{ insertId: 9 }]; } }),
  },
};
const Admin = require(src('controllers/AdminController.js'));
const makeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const create = async (extra, role = 'Student') => {
  log.length = 0;
  const res = makeRes();
  await Admin.createUser({ user: { sub: 1, role: 'Admin' }, body: { role, first_name: 'a', last_name: 'b', msu_mail: 'a@msu.ac.th', ...extra } }, res, (e) => { throw e; });
  return res;
};
const insertedDept = () => log.find(([sql]) => /INSERT INTO users/i.test(sql))?.[1].at(-1);

test('เพิ่มนิสิต: สาขาถูกต้อง → บันทึกลง department', async () => {
  const r = await create({ degree_level: 'Master', department: 'นิเทศศาสตร์สร้างสรรค์ดิจิทัล' });
  assert.notEqual(r.code, 400);
  assert.equal(insertedDept(), 'นิเทศศาสตร์สร้างสรรค์ดิจิทัล');
});

test('เพิ่มนิสิต: ไม่ระบุสาขา → null (ไม่บังคับ)', async () => {
  await create({ degree_level: 'Master' });
  assert.equal(insertedDept(), null);
});

test('เพิ่มนิสิต: สาขาไม่อยู่ในรายการ → 400 INVALID_DEPARTMENT และไม่เขียน DB', async () => {
  const r = await create({ department: 'CS' });
  assert.equal(r.code, 400);
  assert.equal(r.body.code, 'INVALID_DEPARTMENT');
  assert.ok(!log.some(([sql]) => /^\s*INSERT/i.test(sql)));
});

test('เพิ่มนิสิต: ปริญญาเอกเลือกสาขาที่มีเฉพาะปริญญาโท → 400, สาขาร่วมผ่าน', async () => {
  const bad = await create({ degree_level: 'Doctoral', department: 'สารสนเทศและนวัตกรรมดิจิทัล' });
  assert.equal(bad.body.code, 'INVALID_DEPARTMENT');
  const ok = await create({ degree_level: 'Doctoral', department: 'วิทยาการคอมพิวเตอร์' });
  assert.notEqual(ok.code, 400);
});

test('เพิ่มอาจารย์: ส่งสาขามาก็ไม่บันทึก (สาขาเป็นของนิสิต)', async () => {
  await create({ department: 'เทคโนโลยีสารสนเทศ' }, 'Supervisor');
  assert.equal(insertedDept(), null);
});

test('แก้ไขนิสิต: เปลี่ยนเป็นปริญญาเอกขณะสาขาเดิมมีเฉพาะปริญญาโท → 400', async () => {
  const cur = { user_id: 5, prefix: null, first_name: 'a', last_name: 'b', msu_mail: 'a@msu.ac.th', phone: null, role: 'Student', degree_level: 'Master', curriculum_year: null, study_plan_code: null, department: 'สื่อนฤมิต' };
  const db = require(src('config/database.js'));
  const orig = db.query;
  db.query = async (sql) => (/^\s*SELECT/i.test(sql) ? [[cur]] : [{ affectedRows: 1 }]);
  const ok = makeRes();   // สื่อนฤมิตมีทั้งโทและเอก
  await Admin.updateUser({ params: { id: '5' }, user: { sub: 1, role: 'Admin' }, body: { degree_level: 'Doctoral' } }, ok, (e) => { throw e; });
  assert.notEqual(ok.code, 400);
  const bad = makeRes();
  await Admin.updateUser({ params: { id: '5' }, user: { sub: 1, role: 'Admin' }, body: { degree_level: 'Doctoral', department: 'นิเทศศาสตร์สร้างสรรค์ดิจิทัล' } }, bad, (e) => { throw e; });
  assert.equal(bad.code, 400);
  assert.equal(bad.body.code, 'INVALID_DEPARTMENT');
  db.query = orig;
});
