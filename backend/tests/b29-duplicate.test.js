// B29: กัน T3 / Pre-T3 ซ้ำ — รันด้วย `node --test tests/` (stub DB ไม่ต้องต่อ MySQL)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);

const conn = { query: async (sql, params) => conn.reply(sql, params) };

// stub database + helpers ก่อน require model (ไม่ต้องมี node_modules/MySQL)
require.cache[src('config/database.js')] = { id: 'db', filename: 'db', loaded: true, exports: { query: async () => [[]] } };
require.cache[src('models/_approvalHelpers.js')] = {
  id: 'h', filename: 'h', loaded: true,
  exports: { slotFromApproval() {}, fetchApprovalsMap() {}, reviewAdvisorSlot() {}, withTransaction: (fn) => fn(conn) },
};
const T3Model = require(src('models/T3Model.js'));
const PreT3Model = require(src('models/PreT3Model.js'));
const { normalizeIssn } = require(src('utils/input.js'));

const t3Args = [1, 10, { title_thai: 'a', title_english: 'b', first_author: 'c', corresponding_author: 'd' },
  { type: 'x', weight_score: 1, status: 'Published' }, { has_impact_score: false },
  { majorAdvisorId: 5 }];

test('T3: Pre-T3 ที่มี T3 Pending/Approved อยู่แล้ว → T3_ALREADY_EXISTS', async () => {
  conn.reply = (sql) => (sql.includes('FROM pre_t3_requests') ? [[{ overall_status: 'Approved' }]]
    : sql.includes('FROM t3_requests') ? [[{ 1: 1 }]] : [{ insertId: 1 }]);
  await assert.rejects(T3Model.create(...t3Args), { code: 'T3_ALREADY_EXISTS' });
});

test('T3: T3 เดิมถูก reject (ไม่มี Pending/Approved) → ยื่นใหม่ได้', async () => {
  conn.reply = (sql) => (sql.includes('FROM pre_t3_requests') ? [[{ overall_status: 'Approved' }]]
    : sql.includes('SELECT 1 FROM t3_requests') ? [[]] : [{ insertId: 77 }]);
  assert.equal(await T3Model.create(...t3Args), 77);
});

test('T3: Pre-T3 ไม่ Approved (เช่น ถูก cancel ตัดหน้า) → PRE_T3_NOT_APPROVED', async () => {
  conn.reply = () => [[{ overall_status: 'Cancelled' }]];
  await assert.rejects(T3Model.create(...t3Args), { code: 'PRE_T3_NOT_APPROVED' });
});

const snap = { issn: '1234-5678', journal_name: 'J', indexed_database: 'Scopus' };

test('Pre-T3: ISSN เดียวกันที่ active อยู่แล้ว → PRE_T3_DUPLICATE (เช็คทั้งแบบมี/ไม่มีขีด)', async () => {
  let params;
  conn.reply = (sql, p) => { if (sql.includes('issn IN')) { params = p; return [[{ 1: 1 }]]; } return [[]]; };
  await assert.rejects(PreT3Model.create(1, snap, {}, { majorAdvisorId: 5 }, {}), { code: 'PRE_T3_DUPLICATE' });
  assert.deepEqual(params.slice(1, 3), ['1234-5678', '12345678']);
});

test('normalizeIssn: 12345678 และ 1234-5678 เป็นค่าเดียวกัน', () => {
  assert.equal(normalizeIssn('12345678'), '1234-5678');
  assert.equal(normalizeIssn('1234-5678'), '1234-5678');
  assert.equal(normalizeIssn('12345'), null);
});
