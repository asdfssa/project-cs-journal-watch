/**
 * ยิง Scopus Serial Title API 1 request แล้วแสดง header X-RateLimit-* ของ Elsevier
 * ใช้สาธิตว่า Elsevier บอกเวลา reset โควตารายสัปดาห์มาทาง response header
 * (ไม่แก้ไฟล์ใด ๆ, กินโควตา 1 request)
 *
 * รัน: node scripts/show-scopus-rate-limit.js [ISSN]
 */
require('dotenv').config();
const axios = require('axios');

const API_KEY = process.env.SCOPUS_API_KEY_1;
const ISSN = process.argv[2] || '00280836'; // Nature

if (!API_KEY) {
  console.error('ไม่พบ SCOPUS_API_KEY_1 ใน .env');
  process.exit(1);
}

(async () => {
  const res = await axios.get(`https://api.elsevier.com/content/serial/title/issn/${ISSN}`, {
    headers: { 'X-ELS-APIKey': API_KEY, Accept: 'application/json' },
    params: { view: 'STANDARD' },
    timeout: 15000,
    validateStatus: () => true,
  });

  const h = res.headers;
  console.log(`HTTP ${res.status}  (ISSN ${ISSN})\n`);
  console.log('--- response headers ที่เกี่ยวกับ rate limit ---');
  for (const k of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']) {
    console.log(`${k}: ${h[k]}`);
  }

  const reset = parseInt(h['x-ratelimit-reset'], 10);
  if (!isNaN(reset)) {
    const d = new Date(reset * 1000);
    console.log('\n--- แปลงค่า reset (unix seconds -> เวลา) ---');
    console.log(`UTC      : ${d.toISOString()}`);
    console.log(`Bangkok  : ${d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`);
    console.log(`อีก ${((reset * 1000 - Date.now()) / 86400000).toFixed(2)} วัน`);
  }
})().catch(e => { console.error('ผิดพลาด:', e.message); process.exit(1); });
