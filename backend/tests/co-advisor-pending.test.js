// อาจารย์ร่วมเห็นคำร้องในคิว /pending แต่กดตัดสินไม่ได้ — `node --test tests/co-advisor-pending.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);
const queries = [];
require.cache[src('config/database.js')] = {
  id: 'db', filename: src('config/database.js'), loaded: true,
  exports: { query: async (sql, p) => { queries.push([sql, p]); return [[]]; } },
};
const PreT3Model = require(src('models/PreT3Model.js'));
const T3Model = require(src('models/T3Model.js'));
const { advisorViewFields } = require(src('models/_approvalHelpers.js'));

for (const [name, Model] of [['Pre-T3', PreT3Model], ['T3', T3Model]]) {
  test(`${name} /pending: query รวมช่องอาจารย์ร่วมด้วย ไม่ใช่แค่ Advisor`, async () => {
    queries.length = 0;
    await Model.findPendingForAdvisor(7);
    const sql = queries[0][0];
    assert.match(sql, /ra\.step IN \('Advisor','Co_Advisor_1','Co_Advisor_2'\)/);
    assert.deepEqual(queries[0][1], [7]);
  });
}

test('advisorViewFields: อาจารย์ร่วม → my_role Co_*, can_review false / อาจารย์หลัก → true', () => {
  const row = {
    overall_status: 'Pending',
    advisor_approval: { user_id: 1, status: 'Pending' },
    co_advisor_1_approval: { user_id: 2, status: 'Pending' },
    co_advisor_2_approval: { user_id: 3, status: 'Pending' },
  };
  assert.deepEqual(advisorViewFields(row, 1), { my_role: 'Major', can_review: true });
  assert.deepEqual(advisorViewFields(row, 2), { my_role: 'Co_1', can_review: false });
  assert.deepEqual(advisorViewFields(row, 3), { my_role: 'Co_2', can_review: false });
});
