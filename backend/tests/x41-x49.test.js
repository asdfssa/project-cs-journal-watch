// X41: ไฟล์ static ที่ไม่มี → 404 (ไม่ใช่ index.html) · X49: journal_url ต้องเป็น http(s) — `node --test tests/x41-x49.test.js`
Object.assign(process.env, { DB_HOST: 'x', DB_USER: 'x', DB_NAME: 'x', JWT_SECRET: 'x'.repeat(48), NODE_ENV: 'development' });
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dbPath = path.join(__dirname, '..', 'src', 'config', 'database.js');
require.cache[dbPath] = { id: 'db', filename: dbPath, loaded: true, exports: { query: async () => [[]], getConnection: async () => ({ release() {} }) } };

// SPA จำลอง: index.html + ไฟล์ static จริง 1 ไฟล์ (สร้างชั่วคราวถ้ายังไม่ได้ build)
const frontendDir = path.join(__dirname, '..', 'frontend');
const madeFrontend = !fs.existsSync(frontendDir);
if (madeFrontend) {
  fs.mkdirSync(frontendDir);
  fs.writeFileSync(path.join(frontendDir, 'index.html'), '<!doctype html><title>spa</title>');
  fs.writeFileSync(path.join(frontendDir, 'main-REAL.js'), 'console.log("real chunk")');
}
const app = require(path.join(__dirname, '..', 'src', 'app.js'));
const PreT3Controller = require(path.join(__dirname, '..', 'src', 'controllers', 'PreT3Controller.js'));

let server, base;
test.before(() => { server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); if (madeFrontend) fs.rmSync(frontendDir, { recursive: true, force: true }); });

test('X41: ไฟล์ .js/.css/.png ที่ไม่มีอยู่ → 404 (ไม่ใช่ HTML)', async () => {
  for (const p of ['/chunk-DOESNOTEXIST.js', '/styles-OLD.css', '/assets/logo.png', '/favicon.ico']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 404, p);
    assert.ok(!/html/.test(r.headers.get('content-type') || ''), p);
  }
});

test('X41: ไฟล์ static จริงยังเสิร์ฟได้ · route ของ Angular (ไม่มีนามสกุล) ยังได้ index.html', async () => {
  const js = await fetch(base + '/main-REAL.js');
  assert.equal(js.status, 200);
  assert.match(await js.text(), /real chunk/);
  for (const p of ['/', '/login', '/student/pre-t3/history', '/admin/manage-users']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    assert.match(await r.text(), /<title>spa<\/title>/, p);
  }
});

test('X41: /api/v3/... ที่ไม่มียังเป็น 404 JSON', async () => {
  const r = await fetch(base + '/api/v3/ไม่มี.js');
  assert.equal(r.status, 404);
  assert.match(r.headers.get('content-type') || '', /json/);
});

// ---------- X49 ----------
const checklist = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => [`item${i}`, true]));
const validate = (journal_url) => {
  const body = { journal_snapshot: { issn: '1234-5678', journal_name: 'J', indexed_database: 'Scopus', journal_url }, checklist_data: checklist };
  return { err: PreT3Controller._validateBody(body), js: body.journal_snapshot };
};

test('X49: http/https ผ่าน (และถูก trim)', () => {
  for (const u of ['https://example.org/journal', 'http://example.org', '  https://example.org/a?b=1#c  ']) {
    const { err, js } = validate(u);
    assert.equal(err, null, u);
    assert.equal(js.journal_url, u.trim());
  }
});

test('X49: โดเมนที่นิสิตพิมพ์ไม่มี scheme → เติม https:// ให้ · แต่ scheme อันตรายไม่ถูกเติม', () => {
  for (const [input, expected] of [['www.example.com', 'https://www.example.com'], ['journal.example.org/about?x=1', 'https://journal.example.org/about?x=1'], [' example.co.th ', 'https://example.co.th']]) {
    const { err, js } = validate(input);
    assert.equal(err, null, input);
    assert.equal(js.journal_url, expected);
  }
  for (const u of ['javascript:alert(1)', 'data:text/html,x', 'a b.com', 'foo@bar.com', 'localhost', 'x.y z']) {
    assert.equal(validate(u).err?.code, 'INVALID_JOURNAL', u);
  }
});

test('X49: ไม่ใส่ลิงก์ (undefined / null / "") ผ่าน — เป็นช่องทางเลือก', () => {
  for (const u of [undefined, null, '']) assert.equal(validate(u).err, null, String(u));
});

test('X49: scheme อันตราย/ไม่ใช่ลิงก์/ชนิดผิด/ยาวเกิน → 400 INVALID_JOURNAL', () => {
  const bad = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'file:///etc/passwd', 'ftp://example.org', 'vbscript:x',
    '//example.org', 'not a url', 'https://', { href: 'https://x.org' }, ['https://x.org'], 123, 'https://example.org/' + 'a'.repeat(260)];
  for (const u of bad) {
    const { err } = validate(u);
    assert.equal(err?.code, 'INVALID_JOURNAL', JSON.stringify(u).slice(0, 60));
    assert.match(err.message, /journal_url/);
  }
});
