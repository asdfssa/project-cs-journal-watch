// B49: ไม่ปล่อยข้อมูลผู้สร้าง/path ไฟล์ให้ role ทั่วไป และไม่เก็บ Scopus API key จริงลงดิสก์/response
// `node --test tests/b49-data-leak.test.js` — ไม่แตะไฟล์ state จริง (stub fs ทั้งหมด)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);

// ---------- Scopus: stub config + fs ก่อน require service ----------
const KEY_A = 'aaaaaaaaaaaaaaaaaaaaaaaa11112222';
const KEY_B = 'bbbbbbbbbbbbbbbbbbbbbbbb33334444';
const configPath = src('config/index.js');
require.cache[configPath] = { id: 'cfg', filename: configPath, loaded: true, exports: { scopus: { apiKeys: [KEY_A, KEY_B] } } };

const writes = [];
const realRead = fs.readFileSync;
fs.readFileSync = (p, ...a) => (String(p).endsWith('scopus-proxy-state.json')
  ? JSON.stringify({ [KEY_A]: { weeklyLimit: 20000, weeklyRemaining: 123, weeklyResetAt: null, unavailableUntil: null } }) // state เวอร์ชันเก่า (key จริงเป็นคีย์)
  : realRead(p, ...a));
fs.promises.mkdir = async () => {};
fs.promises.writeFile = async (f, data) => { writes.push(String(data)); };
fs.promises.rename = async () => {};

const scopus = require(src('services/ScopusProxyService.js'));

test('Scopus: อ่าน state เวอร์ชันเก่าต่อได้ (quota ไม่หาย)', () => {
  assert.equal(scopus.keys[0].weeklyRemaining, 123);
  assert.equal(scopus.keys[1].weeklyRemaining, 20000);
});

test('Scopus: ไฟล์ state ที่เขียน ไม่มี API key จริง (migrate จากแบบเก่าทันทีตอนเริ่ม)', async () => {
  await scopus._writeQueue;
  assert.ok(writes.length >= 1, 'ควรเขียนทับไฟล์เก่าทันที');
  await scopus.incrementUsage(0);
  for (const w of writes) {
    assert.ok(!w.includes(KEY_A) && !w.includes(KEY_B), 'ไฟล์ state มี key จริง');
    assert.ok(!w.includes(KEY_A.slice(0, 6)), 'มีส่วนต้นของ key');
  }
  assert.equal(Object.keys(JSON.parse(writes.at(-1))).length, 2);
});

test('Scopus: getStatus โชว์แค่ 4 ตัวท้าย', () => {
  const [a, b] = scopus.getStatus();
  assert.equal(a.keyPreview, '…2222');
  assert.equal(b.keyPreview, '…4444');
  assert.ok(!JSON.stringify([a, b]).includes(KEY_A.slice(0, 6)));
});

// ---------- วารสารต้องห้าม: getAll ตาม role ----------
const dbPath = src('config/database.js');
const ROW = {
  unwanted_id: 7, issn: '1234-5678', journal_name: 'J', publisher: 'P', note: null,
  evidence_file_path: 'uploads/unwanted/evidence/secret-name.pdf', recorded_date: '2026-01-01',
  created_at: '2026-01-02', first_name: 'สมชาย', last_name: 'ใจดี', msu_mail: 'creator@msu.ac.th',
};
const NO_FILE = { ...ROW, unwanted_id: 8, evidence_file_path: null };
require.cache[dbPath] = {
  id: 'db', filename: dbPath, loaded: true,
  exports: { query: async (sql) => (sql.includes('COUNT(*)') ? [[{ total: 2 }]] : [[ROW, NO_FILE]]) },
};
const Controller = require(src('controllers/UnwantedJournalController.js'));
const list = async (role) => {
  const res = { body: null, json(b) { this.body = b; return this; } };
  await Controller.getAll({ query: {}, user: { role, sub: 1 } }, res, (e) => { throw e; });
  return res.body.data.journals;
};

test('getAll: Student/Supervisor ไม่เห็นชื่อ/อีเมลผู้สร้าง และไม่เห็น path ไฟล์บนเซิร์ฟเวอร์', async () => {
  for (const role of ['Student', 'Supervisor']) {
    const [withFile, noFile] = await list(role);
    assert.equal(withFile.first_name, null);
    assert.equal(withFile.last_name, null);
    assert.equal(withFile.msu_mail, null);
    assert.equal(withFile.has_evidence, true);
    assert.equal(withFile.evidence_file_path, '/unwanted-journals/7/evidence'); // truthy ให้ FE ยังโชว์ปุ่มดูไฟล์
    assert.ok(!JSON.stringify(withFile).includes('secret-name'));
    assert.equal(noFile.has_evidence, false);
    assert.equal(noFile.evidence_file_path, null);
  }
});

test('getAll: Admin/SuperAdmin/Staff เห็นครบเหมือนเดิม', async () => {
  for (const role of ['Admin', 'SuperAdmin', 'Staff']) {
    const [withFile] = await list(role);
    assert.equal(withFile.msu_mail, 'creator@msu.ac.th');
    assert.equal(withFile.first_name, 'สมชาย');
    assert.equal(withFile.evidence_file_path, ROW.evidence_file_path);
    assert.equal(withFile.has_evidence, true);
  }
});
