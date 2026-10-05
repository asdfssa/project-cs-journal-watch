/**
 * ทดสอบ Rate Limit (throttle ต่อวินาที) ของ Scopus Serial Title API แบบ Burst
 * ยิง request พร้อมกันหลาย ๆ ตัวในหนึ่งรอบ (concurrent) แล้วค่อย ๆ เพิ่มจำนวนต่อรอบ
 * จนกว่าจะเจอ HTTP 429 เพื่อหา threshold จริงของ req/sec
 *
 * รัน: node scripts/test-scopus-rate-limit-burst.js [ISSN]
 */
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.SCOPUS_API_KEY_1;
const ISSN = process.argv[2] || '00280836';
const BASE_URL = 'https://api.elsevier.com/content/serial/title/issn';
const MAX_BURST = 20; // ทดสอบไล่ตั้งแต่ 2 ถึง 20 request พร้อมกัน

if (!API_KEY) {
  console.error('ไม่พบ SCOPUS_API_KEY_1 ใน .env');
  process.exit(1);
}

function extractRateLimitHeaders(headers) {
  const limit = headers['x-ratelimit-limit'];
  const remaining = headers['x-ratelimit-remaining'];
  const reset = headers['x-ratelimit-reset'];
  if (limit === undefined && remaining === undefined && reset === undefined) return null;
  return { limit, remaining, reset };
}

async function fireOne(n) {
  const t0 = Date.now();
  try {
    const res = await axios.get(`${BASE_URL}/${ISSN}`, {
      headers: { 'X-ELS-APIKey': API_KEY, Accept: 'application/json' },
      params: { view: 'STANDARD' },
      timeout: 15000,
      validateStatus: () => true,
    });
    return { n, status: res.status, ms: Date.now() - t0, rl: extractRateLimitHeaders(res.headers) };
  } catch (err) {
    return {
      n,
      status: err.response?.status || `ERROR:${err.code || err.message}`,
      ms: Date.now() - t0,
      rl: err.response ? extractRateLimitHeaders(err.response.headers) : null,
    };
  }
}

async function main() {
  console.log(`เริ่มทดสอบ Burst Rate Limit, ISSN=${ISSN}`);
  console.log(`Key preview: ${API_KEY.slice(0, 6)}...${API_KEY.slice(-4)}\n`);

  const allRounds = [];
  let stop = false;

  for (let burstSize = 2; burstSize <= MAX_BURST && !stop; burstSize++) {
    console.log(`\n--- Round: ยิงพร้อมกัน ${burstSize} requests ---`);
    const promises = Array.from({ length: burstSize }, (_, i) => fireOne(i + 1));
    const results = await Promise.all(promises);

    const statuses = results.map(r => r.status);
    const count429 = statuses.filter(s => s === 429).length;
    console.log(`ผลลัพธ์: ${JSON.stringify(statuses)}`);

    allRounds.push({ burstSize, results });

    if (count429 > 0) {
      console.log(`\n>>> เจอ 429 ที่ burst size = ${burstSize} request พร้อมกัน (จำนวนที่โดน 429: ${count429}/${burstSize}) <<<`);
      stop = true;
    } else {
      // เว้นจังหวะสั้น ๆ ก่อนรอบถัดไปกันปนกับรอบก่อน
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  if (!stop) {
    console.log(`\nทดสอบครบถึง burst size = ${MAX_BURST} แล้วยังไม่เจอ 429`);
  }

  const outPath = path.join(__dirname, `scopus-burst-result-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ issn: ISSN, allRounds }, null, 2));
  console.log(`\nบันทึกผลละเอียดไว้ที่: ${outPath}`);
}

main();
