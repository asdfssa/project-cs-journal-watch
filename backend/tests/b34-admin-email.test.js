// B34: เปลี่ยนอีเมล Admin ต้องยืนยันรหัสผ่าน + ตัด session — `node --test tests/b34-admin-email.test.js`
process.env.NODE_ENV = 'production'; // ให้ limiter ไม่ skip localhost
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const bcryptjs = require('bcryptjs');
const express = require('express');

const src = (p) => path.join(__dirname, '..', 'src', p);
const PASSWORD_HASH = bcryptjs.hashSync('correct-horse', 4);
const log = [];
const dbPath = src('config/database.js');
require.cache[dbPath] = {
  id: 'db', filename: dbPath, loaded: true,
  exports: {
    query: async (sql, params) => {
      log.push(sql);
      if (sql.includes('SELECT user_id, role, prefix')) return [[{ user_id: 5, role: 'Admin', prefix: null, first_name: 'A', last_name: 'B', msu_mail: 'old@msu.ac.th' }]];
      if (sql.includes('SELECT password_hash')) return [[{ password_hash: PASSWORD_HASH }]];
      return [{ affectedRows: 1 }];
    },
  },
};
const AdminController = require(src('controllers/AdminController.js'));
const { passwordConfirmLimiter } = require(src('middlewares/rateLimit.js'));

const makeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
async function patch(body, actor = { role: 'Admin', sub: 5 }) {
  log.length = 0;
  const res = makeRes();
  await AdminController.updateAdmin({ params: { id: '5' }, body, user: actor }, res, (e) => { throw e; });
  return res;
}
const did = (re) => log.some((s) => re.test(s));

test('เปลี่ยนอีเมลโดยไม่ส่งรหัสผ่าน → 400 PASSWORD_REQUIRED และไม่แก้อะไร', async () => {
  const res = await patch({ msu_mail: 'attacker@evil.com' });
  assert.equal(res.code, 400);
  assert.equal(res.body.code, 'PASSWORD_REQUIRED');
  assert.ok(!did(/UPDATE users/));
});

test('รหัสผ่านผิด → 403 INVALID_PASSWORD และไม่แก้อะไร', async () => {
  const res = await patch({ msu_mail: 'attacker@evil.com', current_password: 'wrong' });
  assert.equal(res.code, 403);
  assert.equal(res.body.code, 'INVALID_PASSWORD');
  assert.ok(!did(/UPDATE users/) && !did(/UPDATE auth_tokens/));
});

test('รหัสผ่านถูก → แก้อีเมล + ยกเลิก OTP ค้าง + ตัดทุก refresh token + แจ้งให้ login ใหม่', async () => {
  const res = await patch({ msu_mail: 'New@MSU.ac.th', current_password: 'correct-horse' });
  assert.equal(res.code, 200);
  assert.equal(res.body.data.relogin_required, true);
  assert.ok(did(/UPDATE users/) && did(/UPDATE auth_tokens/));
});

test('แก้ชื่ออย่างเดียว หรือส่งอีเมลเดิม → ไม่ต้องใช้รหัสผ่าน และไม่ตัด session', async () => {
  for (const body of [{ first_name: 'New' }, { first_name: 'New', msu_mail: 'OLD@msu.ac.th' }]) {
    const res = await patch(body);
    assert.equal(res.code, 200, JSON.stringify(body));
    assert.equal(res.body.data.relogin_required, false);
    assert.ok(!did(/UPDATE auth_tokens/));
  }
});

test('current_password เป็น object → 400 (ไม่ใช่ 500)', async () => {
  const res = await patch({ msu_mail: 'x@msu.ac.th', current_password: { $ne: '' } });
  assert.equal(res.code, 400);
  assert.equal(res.body.code, 'INVALID_INPUT');
});

test('limiter: นับเฉพาะครั้งที่ล้มเหลว — ผิด 5 ครั้งแล้วถูกบล็อก, สำเร็จไม่กินโควตา', async () => {
  const app = express();
  app.use((req, _res, next) => { req.user = { sub: 77 }; next(); });
  app.get('/ok', passwordConfirmLimiter, (_req, res) => res.json({}));
  app.get('/fail', passwordConfirmLimiter, (_req, res) => res.status(403).json({}));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (let i = 0; i < 20; i++) assert.equal((await fetch(base + '/ok')).status, 200);
    for (let i = 0; i < 5; i++) assert.equal((await fetch(base + '/fail')).status, 403);
    assert.equal((await fetch(base + '/fail')).status, 429);
  } finally { server.close(); }
});
