// B47: OTP hash ด้วย HMAC — `node --test tests/b47-otp-hmac.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const load = (secret) => {
  const cfg = path.join(__dirname, '..', 'src', 'config', 'index.js');
  const mod = path.join(__dirname, '..', 'src', 'utils', 'crypto.js');
  require.cache[cfg] = { id: 'cfg', filename: cfg, loaded: true, exports: { jwt: { secret }, otp: { length: 6 } } };
  delete require.cache[mod];
  return require(mod);
};

test('hashOtp ไม่ใช่ SHA-256 ล้วนอีกแล้ว (ไล่ 10^6 ค่าจากตารางไม่ได้ถ้าไม่มี secret)', () => {
  const c = load('s'.repeat(48));
  const plainSha = crypto.createHash('sha256').update('123456').digest('hex');
  assert.notEqual(c.hashOtp('123456'), plainSha);
  assert.match(c.hashOtp('123456'), /^[0-9a-f]{64}$/);
});

test('hash เดิมเสมอสำหรับ OTP เดิม, ต่างกันเมื่อ OTP หรือ secret ต่างกัน', () => {
  const a = load('a'.repeat(48));
  assert.equal(a.hashOtp('123456'), a.hashOtp('123456'));
  assert.notEqual(a.hashOtp('123456'), a.hashOtp('123457'));
  const hashA = a.hashOtp('123456');
  const b = load('b'.repeat(48));
  assert.notEqual(b.hashOtp('123456'), hashA);
});

test('compareOtpHash: ถูก → true, ผิด/แฮชเก่า SHA-256/ค่าเพี้ยน → false (ไม่ throw)', () => {
  const c = load('c'.repeat(48));
  const h = c.hashOtp('654321');
  assert.equal(c.compareOtpHash('654321', h), true);
  assert.equal(c.compareOtpHash('654322', h), false);
  const legacy = crypto.createHash('sha256').update('654321').digest('hex');
  assert.equal(c.compareOtpHash('654321', legacy), false);
  for (const bad of [null, undefined, '', 'short', 12345]) assert.equal(c.compareOtpHash('654321', bad), false);
});

test('generateOtp ยังได้เลข 6 หลัก', () => {
  const c = load('d'.repeat(48));
  for (let i = 0; i < 200; i++) assert.match(c.generateOtp(), /^[1-9]\d{5}$/);
});
