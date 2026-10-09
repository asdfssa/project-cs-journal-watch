// B43: ประวัติ review เรียงตามเวลาตัดสิน ไม่ใช่ updated_at — `node --test tests/b43-history-order.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);
const sqls = [];
const dbPath = src('config/database.js');
require.cache[dbPath] = { id: 'db', filename: dbPath, loaded: true, exports: { query: async (sql) => { sqls.push(sql); return [[{ total: 0 }]]; } } };
const PreT3Model = require(src('models/PreT3Model.js'));
const T3Model = require(src('models/T3Model.js'));
PreT3Model._attachDerived = async (r) => r;
T3Model._attachDerived = async (r) => r;

const orderBy = (sql) => /ORDER BY[\s\S]*?LIMIT/.exec(sql)[0];

for (const [name, Model, type] of [['PreT3Model', PreT3Model, 'Pre_T3'], ['T3Model', T3Model, 'T3']]) {
  test(`${name}.findReviewedByAdvisor: เรียงตาม decided_at ของอาจารย์หลัก (DESC) ไม่ใช่ updated_at`, async () => {
    sqls.length = 0;
    await Model.findReviewedByAdvisor(5);
    const o = orderBy(sqls[0]);
    assert.ok(!o.includes('updated_at'));
    assert.match(o, /maj_o\.decided_at/);
    assert.ok(o.includes(`maj_o.request_type = '${type}'`) && o.includes("maj_o.step = 'Advisor'"));
    assert.match(o, /DESC, \w+\.\w+ DESC/); // tie-break ด้วย id ให้ลำดับนิ่งเวลา decided_at เท่ากัน
  });

  test(`${name}.findReviewedByFaculty: เรียงตาม ra.decided_at (DESC)`, async () => {
    sqls.length = 0;
    await Model.findReviewedByFaculty();
    const o = orderBy(sqls[0]);
    assert.ok(!o.includes('updated_at'));
    assert.match(o, /ra\.decided_at DESC/);
  });
}
