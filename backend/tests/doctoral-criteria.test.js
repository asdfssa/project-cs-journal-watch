// ปริญญาเอกยื่น Pre-T3 ได้เฉพาะ Scopus Q1/Q2 — `node --test tests/doctoral-criteria.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);
const stub = (p, exports) => { require.cache[src(p)] = { id: p, filename: src(p), loaded: true, exports }; };

const state = { degree: 'Doctoral' };
stub('config/database.js', {
  query: async (sql) => {
    if (sql.includes('msu_unwanted_journals')) return [[]];
    if (sql.includes('advisor_assignments')) return [[]]; // ไม่มีที่ปรึกษา → ผ่านด่านเกณฑ์แล้วหยุดที่ NO_ADVISOR
    return [[]];
  },
});
stub('models/UserModel.js', {
  findById: async () => ({ user_id: 1, degree_level: state.degree, curriculum_year: '2566', study_plan_code: 'Doc_2_1', first_name: 'a', last_name: 'b' }),
});
stub('models/PreT3Model.js', {
  findById: async () => ({ student_id: 1, overall_status: 'Rejected' }),
  resubmit: async () => true,
});
stub('services/MailService.js', { sendPreT3Notification: () => {} });
const C = require(src('controllers/PreT3Controller.js'));

const checklist = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [`item${i}`, true]));
const body = (db, q) => ({ journal_snapshot: { issn: '1234-5678', journal_name: 'J', indexed_database: db, quartile_or_tier: q }, checklist_data: checklist });
const makeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const run = async (fn, degree, db, q) => {
  state.degree = degree;
  const res = makeRes();
  await C[fn]({ user: { sub: 1 }, params: { id: '5' }, body: body(db, q) }, res);
  return res;
};

for (const fn of ['submit', 'resubmit']) {
  test(`${fn}: ป.เอก เลือก TCI → 400 DOCTORAL_SCOPUS_ONLY`, async () => {
    const r = await run(fn, 'Doctoral', 'TCI', 'กลุ่มที่ 1');
    assert.equal(r.code, 400);
    assert.equal(r.body.code, 'DOCTORAL_SCOPUS_ONLY');
  });
  test(`${fn}: ป.เอก Scopus Q3/Q4/ว่าง → 400 DOCTORAL_QUARTILE_TOO_LOW`, async () => {
    for (const q of ['Q3', 'Q4', '', null]) {
      const r = await run(fn, 'Doctoral', 'Scopus', q);
      assert.equal(r.code, 400, String(q));
      assert.equal(r.body.code, 'DOCTORAL_QUARTILE_TOO_LOW');
    }
  });
  test(`${fn}: ป.เอก Scopus Q1/Q2 ผ่านด่านเกณฑ์`, async () => {
    for (const q of ['Q1', 'Q2', 'q2 ']) {
      const r = await run(fn, 'Doctoral', 'Scopus', q);
      assert.ok(!String(r.body?.code).startsWith('DOCTORAL_'), `${q}: ${JSON.stringify(r.body)}`);
    }
  });
  test(`${fn}: ป.โท ไม่ถูกด่านนี้กัน (รอเกณฑ์จากที่ปรึกษา)`, async () => {
    for (const [db, q] of [['TCI', 'กลุ่มที่ 2'], ['Scopus', 'Q3']]) {
      const r = await run(fn, 'Master', db, q);
      assert.ok(!String(r.body?.code).startsWith('DOCTORAL_'), JSON.stringify(r.body));
    }
  });
}
