// B53: LIKE escape, เชื่อ CF-Connecting-IP เฉพาะจาก proxy ภายใน, SMTP requireTLS, เพดาน findPendingForFaculty
// `node --test tests/b53-misc-hardening.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports }; };

// ---------- likeContains ----------
const { likeContains } = require(src('utils/input.js'));

test('likeContains: escape % _ \\ ไม่ให้เป็น wildcard', () => {
  assert.equal(likeContains('abc'), '%abc%');
  assert.equal(likeContains('100%'), '%100\\%%');
  assert.equal(likeContains('a_b'), '%a\\_b%');
  assert.equal(likeContains('a\\b'), '%a\\\\b%');
  assert.equal(likeContains('%'), '%\\%%'); // ค้น "%" ต้องไม่เท่ากับ "ทุกแถว"
  assert.equal(likeContains(123), '%123%');
});

test('ค้นผู้ใช้/วารสารด้วย "%" ส่งค่า escape ไปที่ SQL (ทดสอบผ่าน controller)', async () => {
  const seen = [];
  stub(src('config/database.js'), { query: async (sql, params) => { seen.push(params); return [[{ total: 0 }]]; } });
  const Unwanted = require(src('controllers/UnwantedJournalController.js'));
  await Unwanted.getAll({ query: { search: '50%' }, user: { role: 'Admin', sub: 1 } }, { json() {} }, (e) => { throw e; });
  assert.deepEqual(seen[0], ['%50\\%%', '%50\\%%', '%50\\%%']);
});

// ---------- clientIp ----------
const { clientIp } = require(src('middlewares/rateLimit.js'));
const reqOf = (peer, cf, ip = '203.0.113.9') => ({ socket: { remoteAddress: peer }, ip, get: (h) => (h === 'CF-Connecting-IP' ? cf : undefined) });

test('clientIp: เชื่อ CF-Connecting-IP เมื่อ peer เป็น loopback/private (cloudflared)', () => {
  for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '172.18.0.5', '10.0.0.7', '192.168.1.4']) {
    assert.equal(clientIp(reqOf(peer, '198.51.100.7')), '198.51.100.7', peer);
  }
});

test('clientIp: peer เป็น public IP → ไม่เชื่อ header (ปลอมเพื่อหมุน key ไม่ได้)', () => {
  assert.equal(clientIp(reqOf('198.51.100.200', '1.2.3.4', '198.51.100.200')), '198.51.100.200');
  assert.equal(clientIp(reqOf('172.200.1.1', '1.2.3.4', '172.200.1.1')), '172.200.1.1'); // 172.200 ไม่ใช่ private
});

test('clientIp: ไม่มี header → ใช้ req.ip', () => {
  assert.equal(clientIp(reqOf('127.0.0.1', undefined, '127.0.0.1')), '127.0.0.1');
});

// ---------- SMTP requireTLS ----------
function transportOptions(port, requireTLS) {
  let opts;
  stub(src('config/index.js'), { mail: { mode: 'smtp', from: 'x@y.z', smtp: { host: 'smtp.test', port, user: 'u', pass: 'p', requireTLS } } });
  stub(require.resolve('nodemailer'), { createTransport: (o) => { opts = o; return { sendMail: async () => ({}) }; } });
  delete require.cache[src('services/MailService.js')];
  require(src('services/MailService.js'));
  return opts;
}

test('SMTP: port 587 บังคับ STARTTLS (requireTLS) · port 465 ใช้ secure แทน', () => {
  assert.equal(transportOptions(587, true).requireTLS, true);
  assert.equal(transportOptions(465, true).requireTLS, false);
  assert.equal(transportOptions(465, true).secure, true);
});

test('SMTP: ปิดได้ด้วย SMTP_REQUIRE_TLS=false สำหรับ relay ภายใน', () => {
  assert.equal(transportOptions(25, false).requireTLS, false);
});

// ---------- findPendingForFaculty ----------
test('findPendingForFaculty: มี LIMIT และเรียงเก่าสุดก่อน (ของเก่าไม่ตกหล่น)', async () => {
  const sqls = [];
  stub(src('config/database.js'), { query: async (sql) => { sqls.push(sql); return [[]]; } });
  for (const m of ['PreT3Model', 'T3Model']) {
    delete require.cache[src(`models/${m}.js`)];
    const Model = require(src(`models/${m}.js`));
    Model._attachDerived = async (r) => r;
    await Model.findPendingForFaculty();
  }
  for (const sql of sqls) {
    assert.match(sql, /ORDER BY \w+\.created_at ASC\s+LIMIT 1000/);
  }
});
