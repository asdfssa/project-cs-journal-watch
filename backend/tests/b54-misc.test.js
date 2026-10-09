// B54: เรื่องเล็กๆ — getStats นับ Cancelled, importUsers เทียบอีเมลไม่สนตัวพิมพ์, suspend/activate Admin เช็คสถานะ, OTP validator ตาม OTP_LENGTH
// `node --test tests/b54-misc.test.js`
process.env.OTP_LENGTH = '8';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const { validationResult } = require('express-validator');

const src = (p) => path.join(__dirname, '..', 'src', p);
const dbPath = src('config/database.js');
const state = { adminStatus: 'Active', existingMails: [], advisors: [] };
const writes = [];
const conn = {
  async query(sql) { if (/^\s*INSERT/i.test(sql)) { writes.push(sql); return [{ insertId: 1 }]; } return [[]]; },
  async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
};
require.cache[dbPath] = {
  id: 'db', filename: dbPath, loaded: true,
  exports: {
    getConnection: async () => conn,
    query: async (sql) => {
      if (/^\s*UPDATE/i.test(sql)) { writes.push(sql); return [{ affectedRows: 1 }]; }
      if (sql.includes("SUM(role = 'Student')")) return [[{ total: 5, students: 1, supervisors: 1, staff: 1, admins: 1, pending: 0, active: 5, suspended: 0 }]];
      if (sql.includes('FROM pre_t3_requests')) return [[{ total: 10, pending: 1, approved: 2, rejected: 3, cancelled: 4 }]];
      if (sql.includes('FROM t3_requests')) return [[{ total: 7, pending: 1, approved: 1, rejected: 2, cancelled: 3 }]];
      if (sql.includes('FROM msu_unwanted_journals')) return [[{ total: 0 }]];
      if (sql.includes('SELECT user_id, role, account_status')) return [[{ user_id: 9, role: 'Admin', account_status: state.adminStatus }]];
      if (sql.includes('FROM users WHERE msu_mail IN') && !sql.includes("role = 'Supervisor'")) return [state.existingMails.map((m) => ({ msu_mail: m }))];
      if (sql.includes("role = 'Supervisor'")) return [state.advisors];
      return [[]];
    },
  },
};
const AdminController = require(src('controllers/AdminController.js'));

const makeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });

test('getStats: นับคำขอที่ Cancelled ด้วย (Pre-T3 และ T3)', async () => {
  const res = makeRes();
  await AdminController.getStats({}, res, (e) => { throw e; });
  assert.equal(res.body.data.pre_t3.cancelled, 4);
  assert.equal(res.body.data.t3.cancelled, 3);
  assert.equal(res.body.data.pre_t3.total, 10);
});

for (const [name, fn, ok, bad, badMsg] of [
  ['suspendAdmin', 'suspendAdmin', 'Active', 'Suspended', /Active/],
  ['activateAdmin', 'activateAdmin', 'Suspended', 'Active', /ถูกระงับ/],
]) {
  test(`${name}: สถานะไม่ตรงเงื่อนไข → 400 ไม่เขียน DB · ตรงเงื่อนไข → สำเร็จ`, async () => {
    writes.length = 0;
    state.adminStatus = bad;
    let res = makeRes();
    await AdminController[fn]({ params: { id: '9' }, user: { sub: 1, role: 'SuperAdmin' } }, res, (e) => { throw e; });
    assert.equal(res.code, 400);
    assert.match(res.body.message, badMsg);
    assert.equal(writes.length, 0);

    state.adminStatus = ok;
    res = makeRes();
    await AdminController[fn]({ params: { id: '9' }, user: { sub: 1, role: 'SuperAdmin' } }, res, (e) => { throw e; });
    assert.equal(res.code, 200);
    assert.equal(writes.length, 1);
  });
}

// ---------- importUsers: อีเมลใน DB ตัวพิมพ์ผสม ----------
const app = express();
app.use((req, _res, next) => { req.user = { sub: 1, role: 'Admin' }; next(); });
app.post('/users', AdminController.importUsers);
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
let server, base;
test.before(() => { server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());
const upload = async (csv) => {
  writes.length = 0;
  const fd = new FormData();
  fd.append('file', new Blob([csv], { type: 'text/csv' }), 'x.csv');
  const r = await fetch(`${base}/users`, { method: 'POST', body: fd });
  return { code: r.status, body: await r.json() };
};

test('importUsers: DB เก็บ "Somchai@MSU.ac.th" แต่ไฟล์ส่ง "somchai@msu.ac.th" → ถูกจับว่ามีอยู่แล้ว', async () => {
  state.existingMails = ['Somchai@MSU.ac.th'];
  const { code, body } = await upload('role,first_name,last_name,msu_mail\nSupervisor,A,B,somchai@msu.ac.th\n');
  assert.equal(code, 400);
  assert.match(body.errors.join(), /Row 2: MSU Mail somchai@msu.ac.th มีอยู่ในระบบแล้ว/);
  assert.equal(writes.length, 0);
});

test('importUsers: อาจารย์ที่ปรึกษาที่ DB เก็บตัวพิมพ์ผสมก็หาเจอ', async () => {
  state.existingMails = [];
  state.advisors = [{ user_id: 77, msu_mail: 'Boss@MSU.ac.th' }];
  const { code, body } = await upload('role,first_name,last_name,msu_mail,advisor_major_mail\nStudent,A,B,s1@msu.ac.th,boss@msu.ac.th\n');
  assert.equal(code, 200, JSON.stringify(body));
});

// ---------- OTP validator ----------
test('verifyOtpValidator/resetPasswordValidator ตามความยาว OTP_LENGTH (8)', async () => {
  const v = require(src('validators/authValidator.js'));
  const run = async (chain, body) => {
    const req = { body };
    for (const c of chain) await c.run(req);
    return validationResult(req).array().map((e) => e.path);
  };
  assert.deepEqual(await run(v.verifyOtpValidator, { otpCode: '12345678' }), []);
  assert.ok((await run(v.verifyOtpValidator, { otpCode: '123456' })).includes('otpCode'));
  assert.ok((await run(v.verifyOtpValidator, { otpCode: '1234567a' })).includes('otpCode'));
});
