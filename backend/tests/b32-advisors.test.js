// B32: เปลี่ยนอาจารย์ที่ปรึกษา — `node --test tests/b32-advisors.test.js` (fake DB ในหน่วยความจำ ไม่ต้องต่อ MySQL)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);
const state = {};
const calls = [];

const MAILS = {
  'old@msu.ac.th':  { user_id: 10, account_status: 'Active' },
  'new@msu.ac.th':  { user_id: 20, account_status: 'Active' },
  'co@msu.ac.th':   { user_id: 30, account_status: 'Active' },
  'gone@msu.ac.th': { user_id: 40, account_status: 'Suspended' },
};

const conn = {
  async query(sql, params) {
    calls.push([sql, params]);
    if (sql.includes('FROM advisor_assignments')) return [state.assignments];
    if (sql.includes('COUNT(*)')) return [[{ n: state.pending.shift() ?? 0 }]];
    if (sql.startsWith('UPDATE request_approvals')) return [{ affectedRows: 2 }];
    return [[]];
  },
  async beginTransaction() {}, async commit() { calls.push(['COMMIT']); },
  async rollback() { calls.push(['ROLLBACK']); }, release() {},
};
const dbStub = {
  async query(sql, params) {
    if (sql.includes('FROM users WHERE user_id')) return [[{ user_id: 1, role: 'Student' }]];
    if (sql.includes('msu_mail')) return [MAILS[params[0]] ? [MAILS[params[0]]] : []];
    return [[]];
  },
  getConnection: async () => conn,
};
require.cache[src('config/database.js')] = { id: 'db', filename: 'db', loaded: true, exports: dbStub };
const AdminController = require(src('controllers/AdminController.js'));

const makeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
async function patch(body, { assignments = [{ advisor_id: 10, advisor_type: 'Major' }], pending = [] } = {}) {
  state.assignments = assignments; state.pending = [...pending]; calls.length = 0;
  const res = makeRes();
  await AdminController.updateAdvisors({ params: { id: '1' }, body }, res, (e) => { throw e; });
  return res;
}
const wrote = () => calls.filter(([s]) => /^(DELETE|INSERT)/.test(s)).map(([s, p]) => `${s.split(' ')[0]}:${p.slice(1).join(',')}`);

test('body ว่าง → 400 และไม่แตะ DB (เดิมลบอาจารย์ทั้งหมด)', async () => {
  const res = await patch({});
  assert.equal(res.code, 400);
  assert.equal(res.body.code, 'NOTHING_TO_UPDATE');
  assert.equal(calls.length, 0);
});

test('ส่งแค่ co1 → Major เดิมไม่หาย (ไม่มี DELETE ของ Major)', async () => {
  const res = await patch({ advisor_co1_mail: 'co@msu.ac.th' });
  assert.equal(res.code, 200);
  assert.deepEqual(wrote(), ['DELETE:Co_1', 'INSERT:30,Co_1']);
});

test('เปลี่ยน Major → ย้าย approver ของคำขอ Pending (Pre-T3 + T3) ที่ขั้น Advisor', async () => {
  const res = await patch({ advisor_major_mail: 'new@msu.ac.th' });
  assert.equal(res.code, 200);
  assert.equal(res.body.data.requests_reassigned, 4);
  const updates = calls.filter(([s]) => s.startsWith('UPDATE request_approvals'));
  assert.equal(updates.length, 2);
  assert.ok(updates.every(([s, p]) => s.includes("ra.status = 'Pending'") && p[0] === 20 && p[2] === 'Advisor'));
  assert.deepEqual(wrote(), ['DELETE:Major', 'INSERT:20,Major']);
});

test('ถอด Major (ส่ง "") → 400 MAJOR_REQUIRED', async () => {
  const res = await patch({ advisor_major_mail: '' });
  assert.equal(res.code, 400);
  assert.equal(res.body.code, 'MAJOR_REQUIRED');
});

test('อาจารย์ไม่ Active / ไม่พบ → 400', async () => {
  assert.equal((await patch({ advisor_major_mail: 'gone@msu.ac.th' })).body.code, 'ADVISOR_NOT_ACTIVE');
  assert.equal((await patch({ advisor_major_mail: 'nobody@msu.ac.th' })).code, 400);
});

test('คนเดียวกันสองช่อง → 400 DUPLICATE_ADVISOR และ rollback', async () => {
  const res = await patch({ advisor_co1_mail: 'old@msu.ac.th' }); // old = Major อยู่แล้ว
  assert.equal(res.body.code, 'DUPLICATE_ADVISOR');
  assert.ok(calls.some(([s]) => s === 'ROLLBACK'));
  assert.deepEqual(wrote(), []);
});

test('ถอด Co ที่มีคำขอ Pending รออยู่ → 409 และไม่ลบ assignment', async () => {
  const assignments = [{ advisor_id: 10, advisor_type: 'Major' }, { advisor_id: 30, advisor_type: 'Co_1' }];
  const res = await patch({ advisor_co1_mail: '' }, { assignments, pending: [1, 0] });
  assert.equal(res.code, 409);
  assert.equal(res.body.code, 'ADVISOR_HAS_PENDING_REQUESTS');
  assert.deepEqual(wrote(), []);
  assert.ok(calls.some(([s]) => s === 'ROLLBACK'));
});

test('ถอด Co ที่ไม่มีคำขอค้าง → สำเร็จ', async () => {
  const assignments = [{ advisor_id: 10, advisor_type: 'Major' }, { advisor_id: 30, advisor_type: 'Co_1' }];
  const res = await patch({ advisor_co1_mail: '' }, { assignments, pending: [0, 0] });
  assert.equal(res.code, 200);
  assert.deepEqual(wrote(), ['DELETE:Co_1']);
});

test('ส่งค่าเดิมซ้ำ → ไม่มีการเขียนอะไร', async () => {
  const res = await patch({ advisor_major_mail: 'old@msu.ac.th' });
  assert.equal(res.code, 200);
  assert.deepEqual(wrote(), []);
});
