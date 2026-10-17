// DELETE /api/manage/users/:id — `node --test tests/delete-user.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);
const log = [];
let targetRole = 'Student';
let used = { pre_t3: 0, t3: 0, advisor_of: 0, approvals: 0, unwanted: 0 };
const dbPath = src('config/database.js');
const query = async (sql) => {
  log.push(sql);
  if (sql.includes('SELECT user_id, role')) return [[{ user_id: 9, role: targetRole }]];
  if (sql.includes('AS pre_t3')) return [[used]];
  return [{ affectedRows: 1 }];
};
require.cache[dbPath] = {
  id: 'db', filename: dbPath, loaded: true,
  exports: {
    query,
    getConnection: async () => ({ query, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} }),
  },
};
const AdminController = require(src('controllers/AdminController.js'));
const routes = require(src('routes/userManageRoutes.js'));

const makeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
async function call(target, { id = '9', sub = 1, data = {} } = {}) {
  log.length = 0;
  targetRole = target;
  used = { pre_t3: 0, t3: 0, advisor_of: 0, approvals: 0, unwanted: 0, ...data };
  const res = makeRes();
  await AdminController.deleteUser({ params: { id }, user: { role: 'Admin', sub } }, res, (e) => { throw e; });
  return res;
}
const deleted = () => log.some((s) => /DELETE FROM users/.test(s));

test('route DELETE /:id จำกัดเฉพาะ Admin/SuperAdmin (ไม่ใช่ Staff)', () => {
  const l = routes.stack.find((x) => x.route && x.route.path === '/:id' && x.route.methods.delete);
  assert.ok(l);
  assert.equal(l.route.stack.length, 2); // requireRole + handler
});

for (const role of ['Student', 'Supervisor', 'Staff']) {
  test(`ลบ ${role} ที่ไม่มีข้อมูลผูก = 200`, async () => {
    const res = await call(role);
    assert.equal(res.code, 200);
    assert.ok(deleted());
  });
}

test('ลบ Admin/SuperAdmin ผ่านเส้นนี้ = 403', async () => {
  for (const role of ['Admin', 'SuperAdmin']) {
    const res = await call(role);
    assert.equal(res.code, 403);
    assert.ok(!deleted());
  }
});

test('ลบตัวเอง = 400', async () => {
  assert.equal((await call('Student', { sub: 9 })).code, 400);
});

test('มีข้อมูลผูก = 409 USER_HAS_DATA และไม่ลบ', async () => {
  for (const data of [{ t3: 1 }, { pre_t3: 2 }, { advisor_of: 1 }, { approvals: 3 }, { unwanted: 1 }]) {
    const res = await call('Student', { data });
    assert.equal(res.code, 409);
    assert.equal(res.body.code, 'USER_HAS_DATA');
    assert.ok(!deleted());
  }
});
