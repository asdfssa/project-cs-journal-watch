// /health ต้องตรวจ DB — `node --test tests/health-db.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);
const state = { query: async () => [[{ 1: 1 }]] };
const stubModule = (p, exports) => { require.cache[src(p)] = { id: p, filename: src(p), loaded: true, exports }; };
stubModule('config/database.js', { query: (...a) => state.query(...a) });
for (const r of ['authRoutes', 'journalRoutes', 'adminRoutes', 'userManageRoutes', 'unwantedJournalRoutes', 'preT3Routes', 't3Routes', 'uploadRoutes', 'userRoutes']) {
  stubModule(`routes/${r}.js`, require('express').Router());
}
const router = require(src('routes/index.js'));
const handler = router.stack.find((l) => l.route?.path === '/health').route.stack[0].handle;
const call = async () => {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({}, res);
  return res;
};

test('DB ปกติ → 200 status ok', async () => {
  state.query = async () => [[{ 1: 1 }]];
  const r = await call();
  assert.equal(r.code, 200);
  assert.equal(r.body.status, 'ok');
  assert.equal(r.body.db, 'ok');
});

test('DB ล่ม (query throw) → 503 status error', async () => {
  state.query = async () => { throw new Error('ECONNREFUSED'); };
  const r = await call();
  assert.equal(r.code, 503);
  assert.equal(r.body.status, 'error');
  assert.equal(r.body.db, 'down');
  assert.ok(!JSON.stringify(r.body).includes('ECONNREFUSED'));   // ไม่หลุดรายละเอียด error
});

test('DB ค้างไม่ตอบ → 503 ภายใน ~3 วินาที', async () => {
  state.query = () => new Promise(() => {});
  const t0 = Date.now();
  const r = await call();
  assert.equal(r.code, 503);
  assert.ok(Date.now() - t0 < 4500);
});
