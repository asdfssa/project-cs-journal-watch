// B40: toMysqlDate — `node --test tests/b40-meeting-date.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const { toMysqlDate } = require('../src/utils/date');

test('วันที่เปล่า → null', () => {
  for (const v of [undefined, null, '']) assert.equal(toMysqlDate(v), null);
});

test('YYYY-MM-DD ที่เป็นวันจริง → คืนตามเดิม', () => {
  assert.equal(toMysqlDate('2026-07-16'), '2026-07-16');
  assert.equal(toMysqlDate(' 2024-02-29 '), '2024-02-29');
});

test('datepicker ไทยส่ง UTC 17:00 ของวันก่อนหน้า → ได้วันที่ไทยที่ถูกต้อง (เดิมช้าไป 1 วัน)', () => {
  assert.equal(toMysqlDate('2026-07-15T17:00:00Z'), '2026-07-16');
  assert.equal(toMysqlDate('2026-07-15T17:00:00.000Z'), '2026-07-16');
  assert.equal(toMysqlDate('2026-07-16T00:00:00+07:00'), '2026-07-16');
  assert.equal(toMysqlDate('2026-07-16T16:59:59Z'), '2026-07-16');
  assert.equal(toMysqlDate('2026-12-31T17:00:00Z'), '2027-01-01'); // ข้ามปี
});

test('datetime ไม่มี timezone → ใช้ส่วนวันที่ที่เขียน', () => {
  assert.equal(toMysqlDate('2026-07-16T00:00:00'), '2026-07-16');
});

test('รูปแบบผิด/วันที่ไม่มีจริง/ไม่ใช่ string → undefined (ให้ controller ตอบ 400)', () => {
  for (const v of ['hello', '2026-13-45', '2026-02-30', '2025-02-29', '16/07/2026', '2026-07-16 garbage', 20260716, {}, [], true]) {
    assert.equal(toMysqlDate(v), undefined, String(JSON.stringify(v)));
  }
});

// controller: วันที่ผิด → 400 INVALID_DATE ก่อนแตะ DB (เดิม slice แล้วชน MySQL → 500)
const path = require('node:path');
test('faculty-review ทั้ง Pre-T3 และ T3: meeting_date ผิด → 400 INVALID_DATE', async () => {
  const dbPath = path.join(__dirname, '..', 'src', 'config', 'database.js');
  require.cache[dbPath] = { id: 'db', filename: dbPath, loaded: true, exports: { query: async () => { throw new Error('ไม่ควรแตะ DB'); } } };
  for (const name of ['PreT3Controller', 'T3Controller']) {
    const C = require(path.join(__dirname, '..', 'src', 'controllers', `${name}.js`));
    for (const bad of ['hello', '2026-02-30']) {
      const res = { status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
      await C.facultyReview({ params: { id: '1' }, user: { sub: 1 }, body: { action: 'approve', meeting_no: '1/2569', meeting_date: bad } }, res);
      assert.equal(res.code, 400, `${name} ${bad}`);
      assert.equal(res.body.code, 'INVALID_DATE');
    }
  }
});
