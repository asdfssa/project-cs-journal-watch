// "ไม่ใช่ของคุณ" ต้องตอบเหมือน "ไม่มีรายการนี้" ทุกประการ (404 NOT_FOUND) — กันเดาว่า ID มีอยู่จริง (report-1 ข้อ 2)
// `node --test tests/not-owner-404.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);
require.cache[src('config/database.js')] = { id: 'db', filename: 'db', loaded: true, exports: { query: async () => [[]] } };
const PreT3Model = require(src('models/PreT3Model.js'));
const T3Model = require(src('models/T3Model.js'));
const PreT3Controller = require(src('controllers/PreT3Controller.js'));
const T3Controller = require(src('controllers/T3Controller.js'));
const UploadController = require(src('controllers/UploadController.js'));

const ME = 7;       // ผู้เรียก
const OWNER = 99;   // เจ้าของรายการตัวจริง
const approval = (uid, status = 'Pending') => ({ user_id: uid, status });
const mkRow = (status = 'Pending', extra = {}) => ({
  student_id: OWNER, overall_status: status,
  advisor_approval: approval(50), co_advisor_1_approval: null, co_advisor_2_approval: null,
  ...extra,
});
const makeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, download() { this.code = 200; } });
const call = async (fn, req) => { const res = makeRes(); await fn(req, res); return { code: res.code, body: res.body }; };
const checklist = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [`item${i}`, true]));
const resubmitBody = { journal_snapshot: { issn: '1234-5678', journal_name: 'J', indexed_database: 'Scopus' }, checklist_data: checklist };

// หา "คำตอบเมื่อไม่มีรายการ" แล้วเทียบกับ "คำตอบเมื่อมีแต่ไม่ใช่ของฉัน" ต้องเท่ากันทุกบิต
async function assertSame(label, Model, run, nonOwnerRow) {
  Model.findById = async () => null;
  const missing = await run();
  assert.equal(missing.code, 404, `${label}: ไม่มีรายการต้องเป็น 404`);
  Model.findById = async () => nonOwnerRow;
  const other = await run();
  assert.deepEqual(other, missing, `${label}: ไม่ใช่เจ้าของต้องตอบเหมือนไม่มีรายการ`);
}

const preT3Cases = [
  ['Pre-T3 getById (Student)', () => call(PreT3Controller.getById, { user: { sub: ME, role: 'Student' }, params: { id: '5' } }), mkRow()],
  ['Pre-T3 getById (Supervisor ที่ไม่ใช่อาจารย์ของรายการ)', () => call(PreT3Controller.getById, { user: { sub: ME, role: 'Supervisor' }, params: { id: '5' } }), mkRow()],
  ['Pre-T3 resubmit', () => call(PreT3Controller.resubmit, { user: { sub: ME }, params: { id: '5' }, body: structuredClone(resubmitBody) }), mkRow('Rejected')],
  ['Pre-T3 cancel', () => call(PreT3Controller.cancel, { user: { sub: ME }, params: { id: '5' } }), mkRow()],
];
for (const [label, run, row] of preT3Cases) test(label, () => assertSame(label, PreT3Model, run, row));

// advisor-review: ไม่ใช่อาจารย์ของรายการ ต้อง 404 ก่อนเช็คสถานะ — ไม่งั้นสถานะ (Approved → 400 INVALID_STATE) หลุดให้คนนอก
for (const status of ['Pending', 'Approved', 'Rejected']) {
  test(`Pre-T3 advisor-review (ไม่ใช่อาจารย์ของรายการ, สถานะ ${status})`, () =>
    assertSame('Pre-T3 advisor-review', PreT3Model,
      () => call(PreT3Controller.advisorReview, { user: { sub: ME }, params: { id: '5' }, body: { action: 'approve' } }), mkRow(status)));
  test(`T3 advisor-review (ไม่ใช่อาจารย์ของรายการ, สถานะ ${status})`, () =>
    assertSame('T3 advisor-review', T3Model,
      () => call(T3Controller.advisorReview, { user: { sub: ME }, params: { id: '5' }, body: { action: 'approve' } }), mkRow(status)));
}

const t3Cases = [
  ['T3 getById (Student)', () => call(T3Controller.getById, { user: { sub: ME, role: 'Student' }, params: { id: '5' } }), mkRow()],
  ['T3 getById (Supervisor ที่ไม่ใช่อาจารย์ของรายการ)', () => call(T3Controller.getById, { user: { sub: ME, role: 'Supervisor' }, params: { id: '5' } }), mkRow()],
  ['T3 cancel', () => call(T3Controller.cancel, { user: { sub: ME }, params: { id: '5' } }), mkRow()],
];
for (const [label, run, row] of t3Cases) test(label, () => assertSame(label, T3Model, run, row));

test('T3 ยื่นโดยอ้าง Pre-T3 ของคนอื่น ตอบเหมือนไม่มี Pre-T3 นั้น', async () => {
  const body = () => ({
    pre_t3_id: 5, journal_snapshot: {},
    paper_and_research_details: { title_thai: 'a', title_english: 'b', first_author: 'c', corresponding_author: 'd' },
    publication_details: { status: 'published' }, journal_metrics: { has_impact_score: false },
  });
  const run = async () => (await T3Controller._validateAndCreate(ME, body())).error;
  PreT3Model.findById = async () => null;
  const missing = await run();
  assert.equal(missing.status, 404);
  PreT3Model.findById = async () => mkRow('Approved');
  assert.deepEqual(await run(), missing);
});

for (const role of ['Student', 'Supervisor']) {
  test(`ดาวน์โหลดไฟล์ T3 (${role} ที่ไม่ใช่เจ้าของ) ตอบเหมือนไม่มีรายการ`, () =>
    assertSame(`upload ${role}`, T3Model,
      () => call(UploadController.downloadFile, { user: { sub: ME, role }, params: { id: '5', field: 'full_paper' } }), mkRow()));
}

test('เจ้าของจริงยังเข้าถึงได้ตามปกติ (ไม่ถูก 404 ผิด)', async () => {
  PreT3Model.findById = async () => mkRow('Pending', { student_id: ME, first_name: 'a', last_name: 'b' });
  const r = await call(PreT3Controller.getById, { user: { sub: ME, role: 'Student' }, params: { id: '5' } });
  assert.equal(r.code, 200);
  T3Model.findById = async () => mkRow('Pending', { student_id: ME, advisor_approval: approval(ME) });
  const a = await call(T3Controller.getById, { user: { sub: ME, role: 'Supervisor' }, params: { id: '5' } });
  assert.equal(a.code, 200);
});
