// B55: Scopus คืน issn = p-ISSN ของวารสารเสมอ (ค้นด้วย e-ISSN ก็ได้ตัวเดียวกัน) — `node --test tests/b55-scopus-issn-pair.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);
const proxyPath = src('services/ScopusProxyService.js');
require.cache[proxyPath] = { id: 'proxy', filename: proxyPath, loaded: true, exports: {} };
const { pickIssns } = require(src('utils/input.js'));
const ScopusService = require(src('services/ScopusService.js'));

// MMWR Recommendations and Reports: ISSN 1057-5987, E-ISSN 1545-8601
const entry = { 'dc:title': 'MMWR', 'prism:issn': '10575987', 'prism:eIssn': '15458601' };

test('ค้นด้วย p-ISSN และ e-ISSN ได้ issn ตัวเดียวกัน (ยื่นซ้ำถูกกัน)', () => {
  const byPrint = ScopusService._parseApiResponse(entry, '10575987');
  const byOnline = ScopusService._parseApiResponse(entry, '15458601');
  assert.equal(byPrint.issn, '10575987');
  assert.equal(byOnline.issn, '10575987');
  assert.equal(byOnline.eissn, '15458601');
});

test('pickIssns: ไม่มี p-ISSN → ใช้ e-ISSN; ไม่มีทั้งคู่ → ใช้ตัวที่พิมพ์; eissn เป็น null', () => {
  assert.deepEqual(pickIssns(undefined, '1545-8601', '15458601'), { issn: '15458601', eissn: null });
  assert.deepEqual(pickIssns(undefined, undefined, '1234-567x'), { issn: '1234567X', eissn: null });
  assert.deepEqual(pickIssns('1057-5987', undefined, '10575987'), { issn: '10575987', eissn: null });
});
