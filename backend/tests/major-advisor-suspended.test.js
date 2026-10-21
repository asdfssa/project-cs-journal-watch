// ที่ปรึกษาหลักถูกระงับ → ยื่น Pre-T3/T3 ไม่ได้ ไม่ insert — `node --test tests/major-advisor-suspended.test.js`
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

// แถว advisor_assignments: Major + Co_1 (Co ถูกระงับก็ยื่นได้)
const advisors = (majorStatus, coStatus = 'Active') => [[
  { advisor_id: 5, advisor_type: 'Major', account_status: majorStatus, first_name: 'M', last_name: 'A', role: 'Supervisor' },
  { advisor_id: 6, advisor_type: 'Co_1', account_status: coStatus, first_name: 'C', last_name: 'B', role: 'Supervisor' },
]];
dbStub.reply = async (sql) => (sql.includes('advisor_assignments') ? advisors(dbStub.major, dbStub.co) : [[]]);

const makeRes = () => ({ code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const preBody = {
  journal_snapshot: { issn: '12345678', journal_name: 'J', indexed_database: 'Scopus' },
  checklist_data: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [`item${i}`, true])),
};
const t3Body = {
  pre_t3_id: 10, journal_snapshot: {},
  paper_and_research_details: { title_thai: 'a', title_english: 'b', first_author: 'c', corresponding_author: 'd' },
  publication_details: { status: 'published' }, journal_metrics: { has_impact_score: false },
};

let created;
UserModel.findById = async () => ({ user_id: 1, degree_level: 'Master', curriculum_year: '2566', study_plan_code: 'Master_A1', msu_mail: 's@msu.ac.th' });
// ตัวตรวจวารสารฝั่ง server (report-1) ไม่ใช่สิ่งที่เทสต์นี้ทดสอบ → ตอบว่าวารสารปกติ
require(src('services/ScopusService.js')).getJournalByIssn = async () => ({ scopus_best_quartile: 'Q1', scopus_discontinued: false });
PreT3Model.create = async () => { created = true; return 1; };
PreT3Model.findById = async () => ({ student_id: 1, overall_status: 'Approved', indexed_database: 'Scopus', quartile_or_tier: 'Q1' });
T3Model.create = async () => { created = true; return 99; };

for (const status of ['Suspended', 'Pending']) {
  test(`Pre-T3 submit: Major ${status} → 400 MAJOR_ADVISOR_SUSPENDED และไม่สร้างรายการ`, async () => {
    created = false; dbStub.major = status; dbStub.co = 'Active';
    const res = makeRes();
    await PreT3Controller.submit({ user: { sub: 1 }, body: preBody }, res);
    assert.equal(res.code, 400);
    assert.equal(res.body.code, 'MAJOR_ADVISOR_SUSPENDED');
    assert.equal(created, false);
  });

  test(`T3 submit: Major ${status} → 400 MAJOR_ADVISOR_SUSPENDED และไม่สร้างรายการ`, async () => {
    created = false; dbStub.major = status; dbStub.co = 'Active';
    const r = await T3Controller._validateAndCreate(1, JSON.parse(JSON.stringify(t3Body)));
    assert.equal(r.error.status, 400);
    assert.equal(r.error.code, 'MAJOR_ADVISOR_SUSPENDED');
    assert.equal(created, false);
  });
}

test('Co ถูกระงับ แต่ Major Active → T3 ยื่นได้', async () => {
  created = false; dbStub.major = 'Active'; dbStub.co = 'Suspended';
  const r = await T3Controller._validateAndCreate(1, JSON.parse(JSON.stringify(t3Body)));
  assert.equal(r.t3Id, 99);
  assert.equal(created, true);
});
