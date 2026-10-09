// X39: ปฏิเสธบัญชี Pending ผ่าน /suspend · X44: student_count ของอาจารย์ — `node --test tests/x39-x44.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dbPath = path.join(__dirname, '..', 'src', 'config', 'database.js');
const state = { target: null, writes: [] };
require.cache[dbPath] = {
  id: 'db', filename: dbPath, loaded: true,
  exports: {
    query: async (sql, params) => {
      if (/^\s*UPDATE users SET account_status/i.test(sql)) { state.writes.push(params); return [{ affectedRows: 1 }]; }
      if (sql.includes('SELECT user_id, account_status, role FROM users WHERE user_id')) return [state.target ? [state.target] : []];
      if (sql.includes('COUNT(*) AS total FROM users')) return [[{ total: 4 }]];
      if (sql.includes('FROM users u') && sql.includes('LIMIT')) return [state.rows];
      if (sql.includes('FROM advisor_assignments aa')) return [[]];
      if (sql.includes('COUNT(DISTINCT student_id)')) { state.countParams = params; return [[{ advisor_id: 10, n: 3 }, { advisor_id: 20, n: '1' }]]; }
      if (sql.includes('COUNT(*) AS n FROM request_approvals')) return [[{ n: 0 }]];
      return [[]];
    },
  },
};
const AdminController = require(path.join(__dirname, '..', 'src', 'controllers', 'AdminController.js'));
const makeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const suspend = async (target, caller) => {
  state.target = target; state.writes = [];
  const res = makeRes();
  await AdminController.suspendUser({ params: { id: '5' }, user: caller }, res, (e) => { throw e; });
  return res;
};
const ADMIN = { sub: 1, role: 'Admin' }, STAFF = { sub: 2, role: 'Staff' };

test('X39: Admin ปฏิเสธ Staff ที่ Pending → 200 และตั้งเป็น Suspended', async () => {
  const res = await suspend({ user_id: 5, role: 'Staff', account_status: 'Pending' }, ADMIN);
  assert.equal(res.code, 200);
  assert.equal(res.body.message, 'ปฏิเสธบัญชีที่รออนุมัติเรียบร้อยแล้ว');
  assert.equal(res.body.success, true);
  assert.deepEqual(state.writes, [['5']]);
});

test('X39: Staff ปฏิเสธ Staff ด้วยกันไม่ได้ (ต้องเป็น Admin) → 403 ไม่เขียน DB', async () => {
  const res = await suspend({ user_id: 5, role: 'Staff', account_status: 'Pending' }, STAFF);
  assert.equal(res.code, 403);
  assert.equal(state.writes.length, 0);
});

test('X39: บัญชี Active ระงับได้ตามเดิม ข้อความเดิม · Suspended ซ้ำ → 400', async () => {
  let res = await suspend({ user_id: 5, role: 'Student', account_status: 'Active' }, STAFF);
  assert.equal(res.code, 200);
  assert.equal(res.body.message, 'ระงับบัญชีเรียบร้อยแล้ว');
  res = await suspend({ user_id: 5, role: 'Student', account_status: 'Suspended' }, ADMIN);
  assert.equal(res.code, 400);
  assert.equal(state.writes.length, 0);
});

test('X39: Admin/SuperAdmin ยังระงับผ่านหน้านี้ไม่ได้ · ผู้ใช้ที่ไม่มี → 404', async () => {
  assert.equal((await suspend({ user_id: 5, role: 'Admin', account_status: 'Pending' }, ADMIN)).code, 403);
  assert.equal((await suspend(null, ADMIN)).code, 404);
});

test('X44: แถวอาจารย์มี student_count (ไม่มีนิสิตเลย = 0) · แถว role อื่นไม่มี field นี้', async () => {
  state.rows = [
    { user_id: 10, role: 'Supervisor', first_name: 'A' }, { user_id: 20, role: 'Supervisor', first_name: 'B' },
    { user_id: 30, role: 'Supervisor', first_name: 'C' }, { user_id: 40, role: 'Student', first_name: 'D' },
  ];
  const res = makeRes();
  await AdminController.getUsers({ query: {}, user: STAFF }, res, (e) => { throw e; });
  const byId = Object.fromEntries(res.body.data.users.map(u => [u.user_id, u]));
  assert.equal(byId[10].student_count, 3);
  assert.equal(byId[20].student_count, 1);      // DECIMAL/BIGINT ที่เป็นสตริงถูกแปลงเป็นตัวเลข
  assert.equal(byId[30].student_count, 0);
  assert.ok(!('student_count' in byId[40]));
  assert.deepEqual(state.countParams, [[10, 20, 30]]); // นับเฉพาะอาจารย์ในหน้านี้ ไม่ใช่ทั้งระบบ
  assert.ok('advisors' in byId[40]);              // field เดิมยังอยู่
});

test('X44: ไม่มีอาจารย์ในหน้า → ไม่ยิง query นับ', async () => {
  state.rows = [{ user_id: 40, role: 'Student', first_name: 'D' }]; state.countParams = undefined;
  const res = makeRes();
  await AdminController.getUsers({ query: { role: 'Student' }, user: STAFF }, res, (e) => { throw e; });
  assert.equal(state.countParams, undefined);
});
