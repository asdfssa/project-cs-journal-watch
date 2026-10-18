// ล็อกของ key (unavailableUntil) ที่หมดเวลาแล้วต้องถูกล้างเป็น null — `node --test tests/scopus-expired-lock.test.js`
Object.assign(process.env, { DB_HOST: 'x', DB_USER: 'x', DB_NAME: 'x', JWT_SECRET: 'x'.repeat(48), NODE_ENV: 'development', SCOPUS_API_KEY_1: 'key-expired', SCOPUS_API_KEY_2: 'key-active' });
delete process.env.SCOPUS_API_KEY_3;
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');

const id = (k) => crypto.createHash('sha256').update(k).digest('hex').slice(0, 16);
const future = Date.now() + 3600_000;
const state = {
  [id('key-expired')]: { weeklyLimit: 20000, weeklyRemaining: 19000, weeklyResetAt: null, unavailableUntil: Date.now() - 1000 },
  [id('key-active')]: { weeklyLimit: 20000, weeklyRemaining: 19000, weeklyResetAt: null, unavailableUntil: future },
};
// ไม่แตะไฟล์ state จริง: อ่านจาก stub, เขียนเก็บไว้ตรวจ
const written = [];
const realRead = fs.readFileSync;
fs.readFileSync = (p, ...a) => (String(p).endsWith('scopus-proxy-state.json') ? JSON.stringify(state) : realRead(p, ...a));
fs.promises.mkdir = async () => {};
fs.promises.writeFile = async (p, data) => { written.push(JSON.parse(data)); };
fs.promises.rename = async () => {};

const proxy = require('../src/services/ScopusProxyService');

test('โหลด state: ล็อกที่หมดเวลาแล้วเป็น null · ล็อกที่ยังไม่หมดคงเดิม · เขียนไฟล์ใหม่ล้างค่าเก่า', async () => {
  assert.equal(proxy.keys[0].unavailableUntil, null);
  assert.equal(proxy.keys[1].unavailableUntil, future);
  await proxy._writeQueue;
  assert.equal(written.at(-1)[id('key-expired')].unavailableUntil, null);
  assert.equal(written.at(-1)[id('key-active')].unavailableUntil, future);
});

test('_isLocked: หมดเวลาระหว่างรันแล้วล้างเป็น null', () => {
  const k = proxy.keys[1];
  k.unavailableUntil = Date.now() - 1;
  assert.equal(proxy._isLocked(k), false);
  assert.equal(k.unavailableUntil, null);
});
