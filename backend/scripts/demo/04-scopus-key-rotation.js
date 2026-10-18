/**
 * DEMO 4: Scopus API key rotation + quota (ScopusProxyService ของจริง)
 *  - แสดงสถานะ key ทั้งหมดจากไฟล์ state (data/scopus-proxy-state.json) ที่ระบบใช้อยู่
 *  - หมุน key แบบ round-robin
 *  - จำลอง 429 (โควตาหมด) ที่ key #0 -> ถูกข้ามอัตโนมัติ -> จำลองหมดทุก key -> SCOPUS_QUOTA_EXCEEDED
 *  - --live : ยิง Scopus จริง 1 request เพื่อโชว์ header X-RateLimit-* ที่ Elsevier ส่งกลับ (กินโควตา 1)
 *
 * รัน: node scripts/demo/04-scopus-key-rotation.js [--live]
 * ปลอดภัย: ปิดการเขียนไฟล์ state ในสคริปต์นี้ (การจำลอง 429 อยู่ในหน่วยความจำของสคริปต์เท่านั้น ไม่กระทบระบบที่รันอยู่)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const axios = require('axios');
const config = require('../../src/config');
const proxy = require('../../src/services/ScopusProxyService');

proxy._persist = async () => {};

const line = (t) => console.log(`\n=== ${t} ===`);
const fmt = (s) => s ? new Date(s).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '-';
const status = () => console.table(proxy.getStatus().map(k => ({
  key: `#${k.index}`,
  ใช้ไป: k.weeklyUsage,
  เหลือ: k.remaining,
  โควตาต่อสัปดาห์: k.weeklyLimit,
  'reset (เวลาไทย)': k.weeklyResetAt ? fmt(k.weeklyResetAt * 1000) : '-',
  ...(k.unavailableUntil !== undefined && { 'พักถึง': k.unavailableUntil ? fmt(k.unavailableUntil) : '-' }),
})));

(async () => {
  line(`1) สถานะ key ทั้งหมด (${proxy.keys.length} keys จาก .env, state จากไฟล์)`);
  status();

  if (process.argv.includes('--live')) {
    line('2) ยิง Scopus จริง 1 request — ดู header ที่ Elsevier ส่งกลับ');
    const k = await proxy.getNextKey();
    const r = await axios.get(`${config.scopus.baseUrl}/content/serial/title/issn/00280836`, {
      headers: { 'X-ELS-APIKey': k.key, Accept: 'application/json' }, params: { view: 'STANDARD' }, timeout: 15000, validateStatus: () => true,
    });
    console.log(`HTTP ${r.status} จาก key #${k.index}`);
    for (const h of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']) console.log(`  ${h}: ${r.headers[h]}`);
    if (r.headers['x-ratelimit-reset']) console.log(`  -> reset = ${fmt(r.headers['x-ratelimit-reset'] * 1000)}`);
    await proxy.incrementUsage(k.index, r.headers);
    status();
  }

  line('3) Round-robin: เรียก getNextKey() 6 ครั้ง');
  const picks = [];
  for (let i = 0; i < 6; i++) picks.push((await proxy.getNextKey()).index);
  console.log(`  key ที่ถูกเลือกตามลำดับ: ${picks.map(i => '#' + i).join(' -> ')}`);

  line('4) จำลอง 429 + โควตาหมดที่ key #0 -> ระบบต้องข้าม key #0');
  const resetAt = Math.floor(Date.now() / 1000) + 3 * 86400;
  await proxy.markKeyUnavailable(0, { 'x-ratelimit-limit': '20000', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetAt) });
  status();
  const after = [];
  for (let i = 0; i < 4; i++) after.push((await proxy.getNextKey()).index);
  console.log(`  key ที่ถูกเลือกต่อจากนั้น: ${after.map(i => '#' + i).join(' -> ')}  (ต้องไม่มี #0)`);

  line('5) จำลองทุก key ถูกล็อก -> ต้องได้ SCOPUS_QUOTA_EXCEEDED');
  for (const k of proxy.keys) await proxy.markKeyRejected(k.index);
  try { await proxy.getNextKey(); console.log('  (ไม่ควรมาถึงตรงนี้)'); }
  catch (e) { console.log(`  code=${e.code}\n  message=${e.message}`); }
})().catch(e => console.error('ผิดพลาด:', e.message));
