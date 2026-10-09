// วารสาร Discontinued/Inactive ยื่น Pre-T3 ไม่ได้ — `node --test tests/discontinued.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);
const stub = (p, exports) => { require.cache[src(p)] = { id: p, filename: src(p), loaded: true, exports }; };

stub('config/database.js', { query: async () => [[]] });
stub('models/UserModel.js', {
  findById: async () => ({ user_id: 1, degree_level: 'Master', curriculum_year: '2566', study_plan_code: 'Master_A1', first_name: 'a', last_name: 'b' }),
});
stub('models/PreT3Model.js', { findById: async () => ({ student_id: 1, overall_status: 'Rejected' }), resubmit: async () => true });
stub('services/MailService.js', { sendPreT3Notification: () => {} });
const C = require(src('controllers/PreT3Controller.js'));

const checklist = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [`item${i}`, true]));
const body = (extra) => ({ journal_snapshot: { issn: '1234-5678', journal_name: 'J', indexed_database: 'Scopus', quartile_or_tier: 'Q1', ...extra }, checklist_data: checklist });
const makeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const run = async (fn, extra) => {
  const res = makeRes();
  await C[fn]({ user: { sub: 1 }, params: { id: '5' }, body: body(extra) }, res);
  return res;
};

for (const fn of ['submit', 'resubmit']) {
  test(`${fn}: is_discontinued=true (Scopus Discontinued หรือ TCI Inactive) → 400 JOURNAL_DISCONTINUED`, async () => {
    const r = await run(fn, { is_discontinued: true });
    assert.equal(r.code, 400);
    assert.equal(r.body.code, 'JOURNAL_DISCONTINUED');
  });
  test(`${fn}: is_discontinued=false/ไม่ส่ง ผ่านด่านนี้`, async () => {
    for (const extra of [{ is_discontinued: false }, {}]) {
      const r = await run(fn, extra);
      assert.notEqual(r.body?.code, 'JOURNAL_DISCONTINUED');
    }
  });
}
