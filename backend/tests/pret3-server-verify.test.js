// Pre-T3: server ตรวจวารสารเองจาก Scopus/TCI (ผ่าน service + cache) ไม่เชื่อ quartile_or_tier / is_discontinued จาก client
// (report-1 ข้อ 1) — `node --test tests/pret3-server-verify.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);
const stub = (p, exports) => { require.cache[src(p)] = { id: p, filename: src(p), loaded: true, exports }; };

const state = { unwanted: [], degree: 'Doctoral', scopus: null, tci: null, scopusErr: null, lookups: [], created: [], resubmitted: [] };
// ตาราง msu_unwanted_journals จำลอง: เจอเมื่อ ISSN (มี/ไม่มีขีด) อยู่ใน state.unwanted
stub('config/database.js', { query: async (sql, params) => (sql.includes('msu_unwanted_journals') ? [params.some((p) => state.unwanted.includes(p)) ? [{ 1: 1 }] : []] : [[]]) });
stub('models/UserModel.js', {
  findById: async () => ({ user_id: 1, msu_mail: 'a@msu.ac.th', degree_level: state.degree, curriculum_year: '2566', study_plan_code: 'Doc_2_1', first_name: 'a', last_name: 'b' }),
  findActiveAdvisorAssignments: async () => [{ advisor_id: 2, advisor_type: 'Major', account_status: 'Active' }],
});
stub('models/PreT3Model.js', {
  findById: async () => ({ student_id: 1, overall_status: 'Rejected' }),
  create: async (_s, snapshot) => { state.created.push({ ...snapshot }); return 11; },
  resubmit: async (_id, snapshot) => { state.resubmitted.push({ ...snapshot }); return true; },
});
stub('services/MailService.js', { sendPreT3Notification: () => {} });
stub('services/ScopusService.js', {
  getJournalByIssn: async (issn) => { state.lookups.push(['Scopus', issn]); if (state.scopusErr) throw state.scopusErr; return state.scopus; },
});
stub('services/TCIService.js', {
  getJournalByIssn: async (issn) => { state.lookups.push(['TCI', issn]); return state.tci; },
});
const C = require(src('controllers/PreT3Controller.js'));

const checklist = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [`item${i}`, true]));
const body = (js) => ({ journal_snapshot: { issn: '1234-5678', journal_name: 'J', indexed_database: 'Scopus', quartile_or_tier: 'Q1', is_discontinued: false, ...js }, checklist_data: checklist });
const makeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const run = async (fn, js, degree = 'Doctoral') => {
  state.degree = degree;
  const res = makeRes();
  await C[fn]({ user: { sub: 1 }, params: { id: '5' }, body: body(js) }, res);
  return res;
};
test.beforeEach(() => {
  Object.assign(state, { unwanted: [], scopus: { scopus_best_quartile: 'Q1', scopus_discontinued: false }, tci: { tci_tier: 1, tci_inactive: false }, scopusErr: null, lookups: [], created: [], resubmitted: [] });
});

for (const fn of ['submit', 'resubmit']) {
  const stored = () => (fn === 'submit' ? state.created : state.resubmitted);

  test(`${fn}: PoC report-1 — ป.เอกปลอม Q3 เป็น Q1 → 400 DOCTORAL_QUARTILE_TOO_LOW และไม่บันทึก`, async () => {
    state.scopus = { scopus_best_quartile: 'Q3', scopus_discontinued: false };
    const r = await run(fn, { quartile_or_tier: 'Q1' });
    assert.equal(r.code, 400);
    assert.equal(r.body.code, 'DOCTORAL_QUARTILE_TOO_LOW');
    assert.equal(stored().length, 0);
  });

  test(`${fn}: client ส่ง is_discontinued=false แต่จริงคือ Discontinued (Scopus) → 400 JOURNAL_DISCONTINUED`, async () => {
    state.scopus = { scopus_best_quartile: 'Q1', scopus_discontinued: true };
    const r = await run(fn, { is_discontinued: false });
    assert.equal(r.code, 400);
    assert.equal(r.body.code, 'JOURNAL_DISCONTINUED');
    assert.equal(stored().length, 0);
  });

  test(`${fn}: TCI Inactive จริง แม้ client บอกว่าไม่ → 400 JOURNAL_DISCONTINUED`, async () => {
    state.tci = { tci_tier: 1, tci_inactive: true };
    const r = await run(fn, { indexed_database: 'TCI', quartile_or_tier: 'กลุ่มที่ 1' }, 'Master');
    assert.equal(r.body.code, 'JOURNAL_DISCONTINUED');
    assert.equal(stored().length, 0);
  });

  test(`${fn}: ไม่พบวารสารในฐานข้อมูลที่อ้าง → 400 JOURNAL_NOT_FOUND และไม่บันทึก`, async () => {
    state.scopus = null;
    const r = await run(fn, {}, 'Master');
    assert.equal(r.code, 400);
    assert.equal(r.body.code, 'JOURNAL_NOT_FOUND');
    assert.equal(stored().length, 0);
  });

  test(`${fn}: ตรวจกับต้นทางไม่ได้ (เช่น โควตา Scopus หมด) → ไม่ยอมรับค่าจาก client และไม่บันทึก`, async () => {
    state.scopusErr = Object.assign(new Error('SCOPUS_QUOTA_EXCEEDED'), { code: 'SCOPUS_QUOTA_EXCEEDED' });
    const r = await run(fn, { quartile_or_tier: 'Q1' });
    assert.ok(r.code >= 400);
    assert.notEqual(r.body.success, true);
    assert.equal(stored().length, 0);
  });

  test(`${fn}: บันทึกค่าจริงจากต้นทาง ไม่ใช่ค่าที่ client ส่ง (ป.โท ส่ง Q1 แต่จริง Q3 → เก็บ Q3)`, async () => {
    state.scopus = { scopus_best_quartile: 'Q3', scopus_discontinued: false };
    const r = await run(fn, { quartile_or_tier: 'Q1' }, 'Master');
    assert.ok(r.code < 400, JSON.stringify(r.body));
    assert.equal(stored().length, 1);
    assert.equal(stored()[0].quartile_or_tier, 'Q3');
    assert.equal(stored()[0].is_discontinued, false);
  });

  test(`${fn}: TCI เก็บ "กลุ่มที่ N" จาก tci_tier จริง · ไม่มี tier → กลุ่มที่ 99 (เหมือนที่ frontend ทำ)`, async () => {
    state.tci = { tci_tier: 2, tci_inactive: false };
    await run(fn, { indexed_database: 'TCI', quartile_or_tier: 'กลุ่มที่ 1' }, 'Master');
    assert.equal(stored().at(-1).quartile_or_tier, 'กลุ่มที่ 2');
    state.tci = { tci_tier: null, tci_inactive: false };
    await run(fn, { indexed_database: 'TCI', quartile_or_tier: 'กลุ่มที่ 1' }, 'Master');
    assert.equal(stored().at(-1).quartile_or_tier, 'กลุ่มที่ 99');
  });

  test(`${fn}: เลือก service ตาม indexed_database และส่ง ISSN ที่ normalize แล้ว`, async () => {
    await run(fn, { issn: '12345678' });
    await run(fn, { issn: '12345678', indexed_database: 'TCI', quartile_or_tier: 'กลุ่มที่ 1' }, 'Master');
    assert.deepEqual(state.lookups, [['Scopus', '1234-5678'], ['TCI', '1234-5678']]);
  });

  test(`${fn}: ป.เอกที่ข้อมูลจริงเป็น Scopus Q2 ผ่านและเก็บ Q2`, async () => {
    state.scopus = { scopus_best_quartile: 'Q2', scopus_discontinued: false };
    const r = await run(fn, { quartile_or_tier: 'Q1' });
    assert.ok(r.code < 400, JSON.stringify(r.body));
    assert.equal(stored()[0].quartile_or_tier, 'Q2');
  });
}

for (const fn of ['submit', 'resubmit']) {
  const stored = () => (fn === 'submit' ? state.created : state.resubmitted);
  const mmwr = (extra = {}) => ({ issn: '10575987', eissn: '15458601', journal_name: 'MMWR', scopus_best_quartile: 'Q1', scopus_discontinued: false, ...extra });

  test(`${fn}: พิมพ์ e-ISSN ของวารสารที่ p-ISSN อยู่ในรายการไม่พึงประสงค์ → 400 UNWANTED_JOURNAL (เลี่ยงไม่ได้)`, async () => {
    state.scopus = mmwr(); state.unwanted = ['1057-5987'];
    const r = await run(fn, { issn: '1545-8601' }, 'Master');
    assert.equal(r.code, 400);
    assert.equal(r.body.code, 'UNWANTED_JOURNAL');
    assert.equal(stored().length, 0);
  });

  test(`${fn}: พิมพ์ p-ISSN แต่ e-ISSN ของวารสารเดียวกันอยู่ในรายการไม่พึงประสงค์ → 400 UNWANTED_JOURNAL`, async () => {
    state.scopus = mmwr(); state.unwanted = ['1545-8601'];
    const r = await run(fn, { issn: '1057-5987' }, 'Master');
    assert.equal(r.body.code, 'UNWANTED_JOURNAL');
    assert.equal(stored().length, 0);
  });

  test(`${fn}: บันทึก ISSN = p-ISSN จริงเสมอ (พิมพ์ e-ISSN) และชื่อวารสารจากต้นทาง ไม่ใช่ชื่อที่ client ส่ง`, async () => {
    state.scopus = mmwr();
    const r = await run(fn, { issn: '1545-8601', journal_name: 'Nature (ปลอมชื่อ)' }, 'Master');
    assert.ok(r.code < 400, JSON.stringify(r.body));
    assert.equal(stored()[0].issn, '1057-5987');
    assert.equal(stored()[0].journal_name, 'MMWR');
  });

  test(`${fn}: ต้นทางไม่ส่งชื่อ/ISSN มา → คงค่าที่ client ส่ง (ไม่เขียนทับเป็นค่าว่าง)`, async () => {
    state.scopus = { scopus_best_quartile: 'Q1', scopus_discontinued: false };
    const r = await run(fn, { issn: '1234-5678', journal_name: 'Client Name' }, 'Master');
    assert.ok(r.code < 400, JSON.stringify(r.body));
    assert.equal(stored()[0].issn, '1234-5678');
    assert.equal(stored()[0].journal_name, 'Client Name');
  });
}
