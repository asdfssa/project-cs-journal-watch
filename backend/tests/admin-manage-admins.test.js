// Admin จัดการ Admin ด้วยกันได้ แต่แตะ SuperAdmin ไม่ได้ — `node --test tests/admin-manage-admins.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);
const log = [];
let targetRole = 'Admin';
const dbPath = src('config/database.js');
require.cache[dbPath] = {
  id: 'db', filename: dbPath, loaded: true,
  exports: {
    query: async (sql) => {
      log.push(sql);
      if (sql.includes('SELECT user_id, role')) return [[{ user_id: 9, role: targetRole, prefix: null, first_name: 'A', last_name: 'B', msu_mail: 'a@msu.ac.th', account_status: 'Active' }]];
      return [{ affectedRows: 1 }];
    },
  },
};
const AdminController = require(src('controllers/AdminController.js'));
const adminRoutes = require(src('routes/adminRoutes.js'));

const makeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
async function call(fn, role, target, body = {}) {
  log.length = 0;
  targetRole = target;
  const res = makeRes();
  await AdminController[fn]({ params: { id: '9' }, body, user: { role, sub: 1 } }, res, (e) => { throw e; });
  return res;
}
const wrote = () => log.some((s) => /^\s*(UPDATE|DELETE)/.test(s));

test('routes /admins ไม่มี requireRole SuperAdmin ซ้อนแล้ว', () => {
  const layers = adminRoutes.stack.filter((l) => l.route && l.route.path.startsWith('/admins'));
  assert.ok(layers.length >= 6);
  for (const l of layers) assert.ok(l.route.stack.length <= 2, l.route.path); // (limiter +) handler
});

for (const fn of ['updateAdmin', 'suspendAdmin', 'deleteAdmin', 'activateAdmin']) {
  test(`${fn}: Admin → SuperAdmin = 403 และไม่เขียน DB`, async () => {
    const res = await call(fn, 'Admin', 'SuperAdmin', { first_name: 'X' });
    assert.equal(res.code, 403);
    assert.ok(!wrote());
  });
}

test('Admin แก้/ลบ/ระงับ Admin คนอื่นได้', async () => {
  assert.equal((await call('updateAdmin', 'Admin', 'Admin', { first_name: 'New' })).code, 200);
  assert.equal((await call('deleteAdmin', 'Admin', 'Admin')).code, 200);
  assert.equal((await call('suspendAdmin', 'Admin', 'Admin')).code, 200);
});

test('SuperAdmin ลบ SuperAdmin ไม่ได้ แต่ลบ Admin ได้', async () => {
  assert.equal((await call('deleteAdmin', 'SuperAdmin', 'SuperAdmin')).code, 403);
  assert.equal((await call('deleteAdmin', 'SuperAdmin', 'Admin')).code, 200);
});
