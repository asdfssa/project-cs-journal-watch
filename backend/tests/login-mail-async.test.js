// login ไม่รอส่งเมล OTP และส่งเมลพังก็ไม่ทำให้ login ล้ม — `node --test tests/login-mail-async.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const bcrypt = require('bcryptjs');

const src = (p) => path.join(__dirname, '..', 'src', p);
const stub = (p, exports) => { require.cache[src(p)] = { id: p, filename: src(p), loaded: true, exports }; };

const hash = bcrypt.hashSync('pw-test', 4);
const state = { mail: () => Promise.resolve({ success: true }), errors: [] };

stub('models/UserModel.js', {
  findByUsername: async () => ({ user_id: 1, role: 'SuperAdmin', account_status: 'Active', password_hash: hash, msu_mail: 'a@b.c' }),
});
stub('models/OtpModel.js', { invalidateActive: async () => {}, create: async () => 1 });
stub('models/RefreshTokenModel.js', {});
stub('services/MailService.js', { sendOtp: (...a) => state.mail(...a) });
stub('utils/logger.js', { error: (m) => state.errors.push(m), info() {}, warn() {}, success() {}, otp() {} });
const { AuthService } = require(src('services/AuthService.js'));

test('ส่งเมลช้า (ยังไม่เสร็จ) login ก็ตอบทันที ได้ otpToken', async () => {
  state.mail = () => new Promise(() => {});           // ไม่เคย resolve
  const r = await Promise.race([
    AuthService.login({ username: 'u', password: 'pw-test' }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('login รอส่งเมล')), 1500)),
  ]);
  assert.ok(r.otpToken);
  assert.ok(r.maskedEmail);
});

test('ส่งเมลไม่สำเร็จ (success:false) login ไม่ล้ม แต่ log error', async () => {
  state.errors.length = 0;
  state.mail = async () => ({ success: false, error: 'smtp down' });
  const r = await AuthService.login({ username: 'u', password: 'pw-test' });
  assert.ok(r.otpToken);
  await new Promise((r2) => setImmediate(r2));
  assert.ok(state.errors.some((m) => /ส่ง OTP ไม่สำเร็จ/.test(m) && /smtp down/.test(m)));
});

test('ส่งเมล throw login ไม่ล้ม (ไม่มี unhandled rejection) และ log error', async () => {
  state.errors.length = 0;
  state.mail = async () => { throw new Error('boom'); };
  const r = await AuthService.login({ username: 'u', password: 'pw-test' });
  assert.ok(r.otpToken);
  await new Promise((r2) => setImmediate(r2));
  assert.ok(state.errors.some((m) => /boom/.test(m)));
});
