// B39: CSV import — validate รายแถว, query ครั้งเดียว, cap แถว — `node --test tests/b39-csv-import.test.js`
// ยิงผ่าน express + multipart จริง (fetch + FormData) เพื่อให้ผ่าน multer ของ controller
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

const src = (p) => path.join(__dirname, '..', 'src', p);
const dbPath = src('config/database.js');
const queries = [];
const writes = [];
const state = { existingMails: [], existingIssns: [], advisors: [] };

const conn = {
  async query(sql, params) {
    queries.push(sql);
    if (/^\s*INSERT/i.test(sql)) { writes.push(sql); return [{ insertId: writes.length }]; }
    if (sql.includes('GET_LOCK')) return [[{ got: 1 }]];
    return [[]];
  },
  async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
};
require.cache[dbPath] = {
  id: 'db', filename: dbPath, loaded: true,
  exports: {
    getConnection: async () => conn,
    query: async (sql, params) => {
      queries.push(sql);
      if (sql.includes('FROM users WHERE msu_mail IN') && !sql.includes("role = 'Supervisor'")) return [state.existingMails.map((m) => ({ msu_mail: m }))];
      if (sql.includes("role = 'Supervisor'")) return [state.advisors];
      if (sql.includes('FROM msu_unwanted_journals WHERE issn IN')) return [state.existingIssns.map((i) => ({ issn: i }))];
      return [[]];
    },
  },
};
const AdminController = require(src('controllers/AdminController.js'));
const Unwanted = require(src('controllers/UnwantedJournalController.js'));

const app = express();
app.use((req, _res, next) => { req.user = { sub: 1, role: 'Admin' }; next(); });
app.post('/users', AdminController.importUsers);
app.post('/journals', Unwanted.importCsv);
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

let server, base;
test.before(async () => { server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());

async function upload(route, csv) {
  queries.length = 0; writes.length = 0;
  const fd = new FormData();
  fd.append('file', new Blob([csv], { type: 'text/csv' }), 'x.csv');
  const r = await fetch(base + route, { method: 'POST', body: fd });
  return { code: r.status, body: await r.json() };
}
const reset = () => Object.assign(state, { existingMails: [], existingIssns: [], advisors: [] });

const USER_HEAD = 'role,first_name,last_name,msu_mail,degree_level,curriculum_year,study_plan_code\n';

test('users: enum/อีเมล/ซ้ำในไฟล์ผิด → 400 บอกแถว ไม่เขียน DB', async () => {
  reset();
  const { code, body } = await upload('/users', USER_HEAD
    + 'Student,A,B,a@msu.ac.th,Bachelor,2566,Master_A1\n'      // row 2: degree_level ผิด
    + 'Student,C,D,not-an-email,Master,2570,Master_A1\n'        // row 3: อีเมล + ปี
    + 'Student,E,F,dup@msu.ac.th,Master,2566,Nope\n'            // row 4: study_plan ผิด
    + 'Student,G,H,dup@msu.ac.th,Master,2566,Master_A1\n');     // row 5: ซ้ำ row 4
  assert.equal(code, 400);
  const e = body.errors.join('\n');
  assert.match(e, /Row 2: degree_level "Bachelor"/);
  assert.match(e, /Row 3: รูปแบบ msu_mail/);
  assert.match(e, /Row 3: curriculum_year "2570"/);
  assert.match(e, /Row 4: study_plan_code "Nope"/);
  assert.match(e, /Row 4: MSU Mail dup@msu.ac.th ซ้ำในไฟล์/);
  assert.match(e, /Row 5: MSU Mail dup@msu.ac.th ซ้ำในไฟล์/);
  assert.equal(writes.length, 0);
});

test('users: CSV ถูกต้อง → import ได้ และ query ตรวจซ้ำแค่ครั้งเดียวไม่ว่ากี่แถว', async () => {
  reset();
  let csv = USER_HEAD;
  for (let i = 0; i < 50; i++) csv += `Student,N${i},L${i},u${i}@msu.ac.th,Master,2566,Master_A1\n`;
  const { code, body } = await upload('/users', csv);
  assert.equal(code, 200, JSON.stringify(body));
  assert.equal(body.data.imported, 50);
  const reads = queries.filter((q) => /^\s*SELECT/i.test(q));
  assert.ok(reads.length <= 2, `SELECT ${reads.length} ครั้ง`);
});

test('users: เกิน 2000 แถว → 400 TOO_MANY_ROWS', async () => {
  reset();
  let csv = USER_HEAD;
  for (let i = 0; i < 2001; i++) csv += `Student,N,L,u${i}@msu.ac.th,Master,2566,Master_A1\n`;
  const { code, body } = await upload('/users', csv);
  assert.equal(code, 400);
  assert.equal(body.code, 'TOO_MANY_ROWS');
});

const J_HEAD = 'journal_name,issn,publisher,note,recorded_date\n';

test('journals: วันที่ผิด/ISSN ซ้ำใน DB/ซ้ำในไฟล์ → 400 บอกแถว', async () => {
  reset();
  state.existingIssns = ['1111-1111'];
  const { code, body } = await upload('/journals', J_HEAD
    + 'A,11111111,,,2026-01-01\n'      // row 2: ซ้ำใน DB (ไม่มีขีด)
    + 'B,2222-2222,,,32/13/2026\n'     // row 3: วันที่ผิด
    + 'C,3333-3333,,,2026-02-30\n'     // row 4: วันที่ไม่มีจริง + ซ้ำ row 5
    + 'D,33333333,,,2026-01-01\n'      // row 5
    + 'E,,,,\n');                      // row 6: ไม่มี recorded_date
  assert.equal(code, 400);
  const e = body.errors.join('\n');
  assert.match(e, /Row 2: ISSN 11111111 มีอยู่ในรายการแล้ว/);
  assert.match(e, /Row 3: recorded_date "32\/13\/2026" ไม่ถูกต้อง/);
  assert.match(e, /Row 4: recorded_date "2026-02-30" ไม่ถูกต้อง/);
  assert.match(e, /Row 4: ISSN 3333-3333 ซ้ำในไฟล์/);
  assert.match(e, /Row 5: ISSN 33333333 ซ้ำในไฟล์/);
  assert.match(e, /Row 6: ไม่มี recorded_date/);
  assert.equal(writes.length, 0);
});

test('journals: CSV ถูกต้อง → import ได้, ตรวจซ้ำใน DB ครั้งเดียวไม่ว่ากี่แถว', async () => {
  reset();
  let csv = J_HEAD;
  for (let i = 0; i < 40; i++) csv += `J${i},${String(1000 + i).padStart(4, '0')}-${String(2000 + i)},,,2026-01-01\n`;
  const { code, body } = await upload('/journals', csv);
  assert.equal(code, 200, JSON.stringify(body));
  assert.equal(body.data.imported, 40);
  assert.equal(queries.filter((q) => q.includes('FROM msu_unwanted_journals WHERE issn IN')).length, 1);
});

test('errorResponse: MySQL 1265/1366 → 400 ไม่ใช่ 500', () => {
  const { parseError } = require(src('utils/errorResponse.js'));
  for (const code of ['WARN_DATA_TRUNCATED', 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD']) {
    assert.equal(parseError({ code, message: 'x' }).status, 400);
  }
});
