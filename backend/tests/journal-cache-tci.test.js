// TCIService + cache: hit ไม่ยิง TCI · miss ยิง 1 ครั้งแล้ว save · ไม่พบ/error ไม่ถูก cache
// `node --test tests/journal-cache-tci.test.js` (ไม่ต่อ MySQL/TCI จริง)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);
const axios = require('axios');
const JournalCache = require(src('services/JournalCache.js'));
const TCIService = require(src('services/TCIService.js'));

const journal = { issn: '0125-2216', eissn: '2630-0001', name_eng: 'Thai Journal', name_local: 'วารสารไทย', tci_tier: '1', status: 'active' };
let postCalls, apiImpl, store, saved, gets;

test.beforeEach(() => {
  postCalls = 0; saved = []; gets = []; store = null;
  apiImpl = async () => ({ data: { journals: [journal] } });
  axios.post = async (...a) => { postCalls++; return apiImpl(...a); };
  JournalCache.shared = () => ({
    async get(issn, source) { gets.push([issn, source]); return store; },
    async save(d) { saved.push(d); },
  });
});

test('miss: ยิง TCI 1 ครั้ง, save ผล, fromCache:false', async () => {
  const r = await TCIService.getJournalByIssn('0125-2216');
  assert.equal(postCalls, 1);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].database_source, 'TCI');
  assert.equal(saved[0].issn, '01252216');
  assert.equal(r.fromCache, false);
  assert.equal(r.tci_tier, 1);
  assert.deepEqual(gets, [['0125-2216', 'TCI']]);
});

test('hit: ไม่ยิง TCI, ไม่ save, คืนค่าจาก cache', async () => {
  store = { issn: '01252216', journal_name: 'cached', database_source: 'TCI', fromCache: true };
  const r = await TCIService.getJournalByIssn('0125-2216');
  assert.equal(r, store);
  assert.equal(postCalls, 0);
  assert.equal(saved.length, 0);
});

test('ไม่พบ (ผลว่าง / ISSN ไม่ตรงเป๊ะ) → null และไม่ถูก cache', async () => {
  apiImpl = async () => ({ data: { journals: [] } });
  assert.equal(await TCIService.getJournalByIssn('0125-2216'), null);
  apiImpl = async () => ({ data: { journals: [{ ...journal, issn: '9999-9999', eissn: '8888-8888' }] } });
  assert.equal(await TCIService.getJournalByIssn('0125-2216'), null);
  assert.equal(saved.length, 0);
});

test('TCI error → throw ต่อ และไม่ถูก cache', async () => {
  apiImpl = async () => { throw new Error('network'); };
  await assert.rejects(TCIService.getJournalByIssn('0125-2216'), /TCI API error/);
  assert.equal(saved.length, 0);
});
