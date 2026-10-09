// X27: FE (journal.*) เรียก API ข้ามโดเมน (api.*) — CSP connect-src + CORS พร้อม credentials
// `node --test tests/x27-cors-csp.test.js`
process.env.CORS_ORIGIN = 'http://localhost:4200,https://journal.farmlnwza007.online';
Object.assign(process.env, { DB_HOST: 'x', DB_USER: 'x', DB_NAME: 'x', JWT_SECRET: 'x'.repeat(48), NODE_ENV: 'development' });
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dbPath = path.join(__dirname, '..', 'src', 'config', 'database.js');
require.cache[dbPath] = { id: 'db', filename: dbPath, loaded: true, exports: { query: async () => [[]], getConnection: async () => ({ release() {} }) } };
const fs = require('node:fs');
// หน้าเว็บ (SPA) ถูกเสิร์ฟจาก backend/frontend — ในเครื่องที่ยังไม่ build ให้สร้าง index.html ชั่วคราวเพื่อทดสอบ CSP ของหน้าเว็บจริง
const frontendDir = path.join(__dirname, '..', 'frontend');
const madeFrontend = !fs.existsSync(frontendDir);
if (madeFrontend) { fs.mkdirSync(frontendDir); fs.writeFileSync(path.join(frontendDir, 'index.html'), '<!doctype html><title>t</title>'); }
test.after(() => { if (madeFrontend) fs.rmSync(frontendDir, { recursive: true, force: true }); });
const app = require(path.join(__dirname, '..', 'src', 'app.js'));

let server, base;
test.before(() => { server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());

const preflight = (origin) => fetch(`${base}/api/v3/auth/refresh`, {
  method: 'OPTIONS',
  headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' },
});

test('CSP connect-src มีโดเมน API (https://api.farmlnwza007.online)', async () => {
  const csp = (await fetch(`${base}/`)).headers.get('content-security-policy') || '';
  const connect = csp.split(';').map(s => s.trim()).find(s => s.startsWith('connect-src')) || '';
  assert.match(connect, /'self'/);
  assert.match(connect, /https:\/\/api\.farmlnwza007\.online/);
});

test('CORS: journal.* ผ่าน preflight พร้อม credentials และ header ที่ FE ส่ง', async () => {
  const r = await preflight('https://journal.farmlnwza007.online');
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://journal.farmlnwza007.online');
  assert.equal(r.headers.get('access-control-allow-credentials'), 'true');
  assert.match(r.headers.get('access-control-allow-headers') || '', /authorization/i);
});

test('CORS: localhost:4200 (ng serve) ยังใช้ได้', async () => {
  assert.equal((await preflight('http://localhost:4200')).headers.get('access-control-allow-origin'), 'http://localhost:4200');
});

test('CORS: origin อื่นไม่ได้รับอนุญาต (ไม่สะท้อน origin, ไม่ใช่ *)', async () => {
  const r = await preflight('https://evil.example');
  assert.notEqual(r.headers.get('access-control-allow-origin'), 'https://evil.example');
  assert.notEqual(r.headers.get('access-control-allow-origin'), '*');
});

test('คำขอจริงข้าม origin: ได้ ACAO ของ journal.* + ACAC true', async () => {
  const r = await fetch(`${base}/api/v3/health`, { headers: { Origin: 'https://journal.farmlnwza007.online' } });
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://journal.farmlnwza007.online');
  assert.equal(r.headers.get('access-control-allow-credentials'), 'true');
});
