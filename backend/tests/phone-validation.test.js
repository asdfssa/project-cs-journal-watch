// เบอร์โทรต้อง 10 หลัก — `node --test tests/phone-validation.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);
const log = [];
const dbPath = src('config/database.js');
const query = async (sql) => {
  log.push(sql);
  if (/FROM users\s+WHERE user_id/.test(sql)) return [[{ user_id: 9, role: 'Student', first_name: 'A', last_name: 'B', msu_mail: 'a@msu.ac.th', phone: null, account_status: 'Active' }]];
  return [[]];
};
require.cache[dbPath] = { id: 'db', filename: dbPath, loaded: true, exports: { query, getConnection: async () => ({ query, release() {} }) } };
const { phoneError } = require(src('utils/input.js'));
const AdminController = require(src('controllers/AdminController.js'));

const makeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const wrote = () => log.some((s) => /^\s*(INSERT|UPDATE)/.test(s));

test('phoneError: ว่าง/10 หลัก ผ่าน · อื่นๆ ไม่ผ่าน', () => {
  for (const ok of [undefined, null, '', '   ', '0812345678']) assert.equal(phoneError(ok), null, String(ok));
  for (const bad of ['081234567', '08123456789', '081-234-5678', ' 0812345678', 'abcdefghij', '081234567a']) assert.ok(phoneError(bad), bad);
});

test('createUser: เบอร์ไม่ครบ 10 = 400 INVALID_PHONE และไม่ insert', async () => {
  log.length = 0;
  const res = makeRes();
  await AdminController.createUser({ body: { role: 'Student', first_name: 'A', last_name: 'B', msu_mail: 'a@msu.ac.th', phone: '12345' }, user: { role: 'Admin', sub: 1 } }, res, (e) => { throw e; });
  assert.equal(res.code, 400);
  assert.equal(res.body.code, 'INVALID_PHONE');
  assert.ok(!wrote());
});

test('updateUser: เบอร์ไม่ครบ 10 = 400 INVALID_PHONE และไม่ update', async () => {
  log.length = 0;
  const res = makeRes();
  await AdminController.updateUser({ params: { id: '9' }, body: { phone: '12345' }, user: { role: 'Admin', sub: 1 } }, res, (e) => { throw e; });
  assert.equal(res.code, 400);
  assert.equal(res.body.code, 'INVALID_PHONE');
  assert.ok(!wrote());
});
