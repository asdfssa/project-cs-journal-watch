// Scopus: ส่ง open_access / scopus_total_docs ให้ frontend — `node --test tests/scopus-extra-fields.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.SCOPUS_API_KEY_1 = process.env.SCOPUS_API_KEY_1 || 'test-key';
const ScopusService = require(path.join(__dirname, '..', 'src', 'services', 'ScopusService.js'));
const JournalController = require(path.join(__dirname, '..', 'src', 'controllers', 'JournalController.js'));

const entry = (extra = {}) => ({
  'dc:title': 'Test Journal',
  'dc:publisher': 'Pub',
  coverageStartYear: '2000',
  coverageEndYear: String(new Date().getFullYear()),
  'subject-area': [{ '@code': '2730', '@abbrev': 'MEDI', '$': 'Oncology' }],
  citeScoreYearInfoList: {
    citeScoreYearInfo: [{
      '@year': '2025', '@status': 'Complete',
      citeScoreInformationList: [{ citeScoreInfo: [{ citeScore: '10.5', scholarlyOutput: '106', citationCount: '1113',
        citeScoreSubjectRank: [{ subjectCode: '2730', rank: '1', percentile: '99' }] }] }],
    }],
  },
  ...extra,
});

test('scopus_total_docs มาจาก scholarlyOutput ของ CiteScore', () => {
  const r = ScopusService._parseApiResponse(entry(), '00000000');
  assert.equal(r.scopus_total_docs, 106);
});

test('openaccess = "1" → open_access "Open Access" + ส่ง type ต่อ', () => {
  const r = ScopusService._parseApiResponse(entry({ openaccess: '1', openaccessType: 'Gold' }), '00000000');
  assert.equal(r.open_access, 'Open Access');
  assert.equal(r.open_access_type, 'Gold');
});

test('ไม่ใช่ Open Access → null ทั้งคู่ และ H-Index ยังเป็น null (API ไม่ให้)', () => {
  const r = ScopusService._parseApiResponse(entry({ openaccess: '0' }), '00000000');
  assert.equal(r.open_access, null);
  assert.equal(r.open_access_type, null);
  assert.equal(r.scopus_h_index, null);
});

test('JournalController ส่งฟิลด์ใหม่ต่อให้ frontend', () => {
  const n = JournalController._normalizeResponse({ scopus_total_docs: 5, open_access: 'Open Access', open_access_type: 'Gold' });
  assert.equal(n.scopus_total_docs, 5);
  assert.equal(n.open_access, 'Open Access');
  assert.equal(n.open_access_type, 'Gold');
});
