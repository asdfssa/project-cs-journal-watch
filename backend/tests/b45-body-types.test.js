// B45: body ที่เป็น array/object ต้องได้ 400 ไม่ใช่ 500 — `node --test tests/b45-body-types.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);
const dbPath = src('config/database.js');
const dbCalls = [];
// ไม่ควรเขียน DB เลยเมื่อ input ผิด; query ที่อ่านก่อน validate (เช่น หา target) ตอบแถวปลอมได้
require.cache[dbPath] = {
  id: 'db', filename: dbPath, loaded: true,
  exports: {
    query: async (sql) => {
      dbCalls.push(sql);
      if (/^\s*(UPDATE|INSERT|DELETE)/i.test(sql)) throw new Error('ไม่ควรเขียน DB');
      return [[{ user_id: 1, role: 'Student', first_name: 'a', last_name: 'b', msu_mail: 'a@msu.ac.th', msu_mail_: 1 }]];
    },
  },
};
const { nonScalarField } = require(src('utils/input.js'));
const AdminController = require(src('controllers/AdminController.js'));
const UserController = require(src('controllers/UserController.js'));

const makeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const nextThrow = (e) => { throw e; };

test('nonScalarField: object/array ถูกจับ, สตริง/ตัวเลข/null/undefined ผ่าน', () => {
  assert.equal(nonScalarField({ a: { x: 1 } }, ['a']), 'a');
  assert.equal(nonScalarField({ a: [1] }, ['a']), 'a');
  assert.equal(nonScalarField({ a: 'x', b: 2023, c: null, d: undefined, e: true }, ['a', 'b', 'c', 'd', 'e', 'f']), null);
});

test('AdminController.updateUser: phone/line_id/curriculum_year เป็น object/array → 400', async () => {
  for (const body of [{ phone: { role: 'Admin' } }, { line_id: ['a'] }, { curriculum_year: [2566] }, { prefix: {} }]) {
    const res = makeRes();
    await AdminController.updateUser({ params: { id: '1' }, body, user: { role: 'Admin', sub: 99 } }, res, nextThrow);
    assert.equal(res.code, 400, JSON.stringify(body));
    assert.equal(res.body.code, 'INVALID_INPUT');
  }
});

test('AdminController.createUser: ค่าผิดชนิดใน field ทางเลือก → 400', async () => {
  const base = { role: 'Student', first_name: 'a', last_name: 'b', msu_mail: 'x@msu.ac.th' };
  for (const extra of [{ phone: { a: 1 } }, { degree_level: ['Master'] }, { study_plan_code: {} }, { role: ['Student'] }]) {
    const res = makeRes();
    await AdminController.createUser({ body: { ...base, ...extra }, user: { role: 'Admin', sub: 99 } }, res, nextThrow);
    assert.equal(res.code, 400, JSON.stringify(extra));
  }
});

test('UserController.updateProfile: phone/facebook_id/line_id เป็น object → 400 และไม่เขียน DB', async () => {
  for (const body of [{ phone: { role: 'Admin' } }, { facebook_id: ['x'] }, { line_id: {} }]) {
    const res = makeRes();
    await UserController.updateProfile({ user: { sub: 1 }, body }, res, nextThrow);
    assert.equal(res.code, 400, JSON.stringify(body));
    assert.equal(res.body.code, 'INVALID_INPUT');
  }
});

test('ค่าปกติยังผ่านด่านนี้ (curriculum_year เป็นตัวเลข/สตริง)', () => {
  assert.equal(nonScalarField({ curriculum_year: 2566, phone: '0812345678', line_id: null }, ['curriculum_year', 'phone', 'line_id']), null);
});
