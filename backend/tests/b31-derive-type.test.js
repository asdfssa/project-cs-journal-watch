// B31: type/weight ของ T3 derive จาก Pre-T3 + Pre-T3 ปฏิเสธวารสารต้องห้าม — `node --test tests/b31-derive-type.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);
const dbStub = { query: async (...a) => dbStub.reply(...a), reply: async () => [[]] };
require.cache[src('config/database.js')] = { id: 'db', filename: 'db', loaded: true, exports: dbStub };
const PreT3Model = require(src('models/PreT3Model.js'));
const UserModel = require(src('models/UserModel.js'));
const T3Model = require(src('models/T3Model.js'));
const T3Controller = require(src('controllers/T3Controller.js'));
const PreT3Controller = require(src('controllers/PreT3Controller.js'));

const body = (type) => ({
  pre_t3_id: 10,
  journal_snapshot: {},
  paper_and_research_details: { title_thai: 'a', title_english: 'b', first_author: 'c', corresponding_author: 'd' },
  publication_details: { type, weight_score: 9, status: 'published' },
  journal_metrics: { has_impact_score: false },
});

// stub ชั้น model ให้ _validateAndCreate รันถึงจุด derive แล้วดูว่าสร้างด้วย type/weight อะไร
function run(preT3, clientType) {
  const created = {};
  PreT3Model.findById = async () => ({ student_id: 1, overall_status: 'Approved', ...preT3 });
  UserModel.findById = async () => ({ user_id: 1 });
  dbStub.reply = async () => [[{ advisor_id: 5, advisor_type: 'Major' }]];
  T3Model.create = async (_s, _p, _paper, pub) => { Object.assign(created, pub); return 99; };
  return T3Controller._validateAndCreate(1, body(clientType)).then((r) => ({ r, created }));
}

test('TCI กลุ่ม 2 แต่ client ส่ง "นานาชาติ" → ได้ Tier2 (0.6) ไม่ใช่ 1.0', async () => {
  const { r, created } = await run({ indexed_database: 'TCI', quartile_or_tier: 'กลุ่มที่ 2' }, 'วารสารนานาชาติ (international)');
  assert.equal(r.t3Id, 99);
  assert.equal(created.type, 'National_TCI_Tier2');
  assert.equal(created.weight_score, 0.6);
});

test('TCI กลุ่ม 1 → Tier1 (0.8) แม้ client ไม่ส่ง type', async () => {
  const { created } = await run({ indexed_database: 'TCI', quartile_or_tier: '1' }, undefined);
  assert.equal(created.type, 'National_TCI_Tier1');
  assert.equal(created.weight_score, 0.8);
});

test('Scopus → International_Journal (1.0) แม้ client ส่งว่าเป็นระดับชาติ', async () => {
  const { created } = await run({ indexed_database: 'Scopus', quartile_or_tier: 'Q1' }, 'วารสารระดับชาติ');
  assert.equal(created.type, 'International_Journal');
  assert.equal(created.weight_score, 1);
});

test('TCI อ่าน tier ไม่ได้ → 400 INVALID_TIER (ไม่เดา Tier2)', async () => {
  for (const q of [null, '', 'กลุ่มที่ 3', 'abc']) {
    const { r } = await run({ indexed_database: 'TCI', quartile_or_tier: q }, 'x');
    assert.equal(r.error.status, 400);
    assert.equal(r.error.code, 'INVALID_TIER');
  }
});

// --- Pre-T3: วารสารต้องห้าม ---
const makeRes = () => ({ code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const preBody = (issn) => ({
  journal_snapshot: { issn, journal_name: 'J', indexed_database: 'Scopus' },
  checklist_data: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [`item${i}`, true])),
});

test('Pre-T3 submit: ISSN อยู่ในรายการต้องห้าม → 400 UNWANTED_JOURNAL และไม่สร้างรายการ', async () => {
  let created = false;
  PreT3Model.create = async () => { created = true; return 1; };
  let params;
  dbStub.reply = async (sql, p) => { params = p; return [[{ 1: 1 }]]; };
  const res = makeRes();
  await PreT3Controller.submit({ user: { sub: 1 }, body: preBody('12345678') }, res);
  assert.equal(res.code, 400);
  assert.equal(res.body.code, 'UNWANTED_JOURNAL');
  assert.equal(created, false);
  assert.deepEqual(params, ['1234-5678', '12345678']);
});

test('Pre-T3 resubmit: ISSN ต้องห้ามก็ถูกปฏิเสธ', async () => {
  dbStub.reply = async () => [[{ 1: 1 }]];
  const res = makeRes();
  await PreT3Controller.resubmit({ user: { sub: 1 }, params: { id: '3' }, body: preBody('1234-5678') }, res);
  assert.equal(res.body.code, 'UNWANTED_JOURNAL');
});
