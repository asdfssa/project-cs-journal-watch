// นิสิตยกเลิกไม่ได้เมื่อ advisor อนุมัติครบแล้ว — `node --test tests/cancel-advisor-approved.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);
const sqls = [];
require.cache[src('config/database.js')] = { id: 'db', filename: 'db', loaded: true,
  exports: { query: async (sql, params) => { sqls.push([sql, params]); return [{ affectedRows: 0 }]; } } };
const T3Model = require(src('models/T3Model.js'));
const PreT3Model = require(src('models/PreT3Model.js'));

for (const [name, Model, id, type] of [['T3', T3Model, 5, "'T3'"], ['Pre-T3', PreT3Model, 6, "'Pre_T3'"]]) {
  test(`${name}.cancel: Pending ต้องมี advisor ที่ยังไม่ Approved, Rejected ยกเลิกได้`, async () => {
    sqls.length = 0;
    assert.equal(await Model.cancel(id), false);
    const [sql, params] = sqls[0];
    assert.match(sql, new RegExp(`request_type = ${type}`));
    assert.match(sql, /ra\.step IN \('Advisor', 'Co_Advisor_1', 'Co_Advisor_2'\) AND ra\.status <> 'Approved'/);
    assert.match(sql, /'Rejected'/);
    assert.deepEqual(params, [id]);
  });
}
