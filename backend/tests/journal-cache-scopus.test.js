// ScopusService + cache: hit ไม่กินโควตา key / ไม่ยิง API · miss ยิง 1 ครั้งแล้ว save · null/error ไม่ถูก cache
// `node --test tests/journal-cache-scopus.test.js` (ไม่ต่อ MySQL/Scopus จริง)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);

// stub ScopusProxyService (นับการขอ key) ก่อนโหลด ScopusService
const proxy = {
  keyRequests: 0, usage: 0,
  async getNextKey() { proxy.keyRequests++; return { key: 'k', index: 0 }; },
  async incrementUsage() { proxy.usage++; },
  async markKeyUnavailable() {}, async markKeyRejected() {},
};
const proxyPath = src('services/ScopusProxyService.js');
require.cache[proxyPath] = { id: 'proxy', filename: proxyPath, loaded: true, exports: proxy };

const axios = require('axios');
const JournalCache = require(src('services/JournalCache.js'));
const ScopusService = require(src('services/ScopusService.js'));

const apiBody = { 'serial-metadata-response': { entry: [{ 'dc:title': 'MMWR', 'prism:issn': '10575987', 'prism:eIssn': '15458601' }] } };
let apiCalls, apiImpl, store, saved, gets;

test.beforeEach(() => {
  proxy.keyRequests = 0; proxy.usage = 0; apiCalls = 0; saved = []; gets = []; store = null;
  apiImpl = async () => ({ headers: {}, data: apiBody });
  axios.get = async (...a) => { apiCalls++; return apiImpl(...a); };
  JournalCache.shared = () => ({
    async get(issn, source) { gets.push([issn, source]); return store; },
    async save(d) { saved.push(d); },
  });
});

test('miss: ยิง API 1 ครั้ง, ขอ key 1 ครั้ง, save ผล, fromCache:false', async () => {
  const r = await ScopusService.getJournalByIssn('1057-5987');
  assert.equal(apiCalls, 1);
  assert.equal(proxy.keyRequests, 1);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].issn, '10575987');
  assert.equal(r.fromCache, false);
  assert.equal(r.journal_name, 'MMWR');
  assert.deepEqual(gets, [['10575987', 'Scopus']]);
});

test('hit: ไม่ยิง API, ไม่ขอ key (ไม่กินโควตา), ไม่ save, คืนค่าจาก cache', async () => {
  store = { issn: '10575987', journal_name: 'cached', database_source: 'Scopus', fromCache: true };
  const r = await ScopusService.getJournalByIssn('1057-5987');
  assert.equal(r, store);
  assert.equal(apiCalls, 0);
  assert.equal(proxy.keyRequests, 0);
  assert.equal(proxy.usage, 0);
  assert.equal(saved.length, 0);
});

test('ไม่พบวารสาร (null) → ไม่ถูก cache', async () => {
  apiImpl = async () => ({ headers: {}, data: { 'serial-metadata-response': { entry: [] } } });
  assert.equal(await ScopusService.getJournalByIssn('1057-5987'), null);
  assert.equal(saved.length, 0);
});

test('API 404 → null และไม่ถูก cache', async () => {
  apiImpl = async () => { throw Object.assign(new Error('nf'), { response: { status: 404 } }); };
  assert.equal(await ScopusService.getJournalByIssn('1057-5987'), null);
  assert.equal(saved.length, 0);
});

test('API error อื่น → throw ต่อ และไม่ถูก cache', async () => {
  apiImpl = async () => { throw new Error('network'); };
  await assert.rejects(ScopusService.getJournalByIssn('1057-5987'), /Scopus API error/);
  assert.equal(saved.length, 0);
});
