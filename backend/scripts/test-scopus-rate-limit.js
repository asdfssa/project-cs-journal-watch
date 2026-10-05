/**
 * ทดสอบ Rate Limit จริงของ Scopus Serial Title API
 * ยิง request รัว ๆ ด้วย key จริงจาก .env จนกว่าจะเจอ HTTP 429
 * ใช้สำหรับเก็บหลักฐานตัวเลขจริงประกอบวิทยานิพนธ์ (section 3.9.2) เท่านั้น
 *
 * รัน: node scripts/test-scopus-rate-limit.js [ISSN]
 */
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.SCOPUS_API_KEY_1;
const ISSN = process.argv[2] || '00280836'; // Nature, default ทดสอบ
const BASE_URL = 'https://api.elsevier.com/content/serial/title/issn';
const MAX_REQUESTS = 500; // เพดานกันยิงจนหมด weekly quota (20,000) โดยไม่ตั้งใจ

if (!API_KEY) {
  console.error('ไม่พบ SCOPUS_API_KEY_1 ใน .env');
  process.exit(1);
}

const log = [];

function record(entry) {
  log.push(entry);
  const rl = entry.rateLimitHeaders;
  const rlStr = rl
    ? ` | limit=${rl.limit ?? '-'} remaining=${rl.remaining ?? '-'} reset=${rl.reset ?? '-'}`
    : '';
  console.log(
    `#${entry.n} t=${entry.elapsedMs}ms status=${entry.status}${rlStr}`
  );
}

function extractRateLimitHeaders(headers) {
  const limit = headers['x-ratelimit-limit'];
  const remaining = headers['x-ratelimit-remaining'];
  const reset = headers['x-ratelimit-reset'];
  if (limit === undefined && remaining === undefined && reset === undefined) return null;
  return { limit, remaining, reset };
}

async function main() {
  console.log(`เริ่มทดสอบ Scopus Serial Title API, ISSN=${ISSN}`);
  console.log(`Key preview: ${API_KEY.slice(0, 6)}...${API_KEY.slice(-4)}`);
  console.log(`เพดานทดสอบสูงสุด: ${MAX_REQUESTS} requests\n`);

  const start = Date.now();
  let hit429 = false;

  for (let n = 1; n <= MAX_REQUESTS; n++) {
    const reqStart = Date.now();
    try {
      const res = await axios.get(`${BASE_URL}/${ISSN}`, {
        headers: {
          'X-ELS-APIKey': API_KEY,
          Accept: 'application/json',
        },
        params: { view: 'STANDARD' },
        timeout: 15000,
        validateStatus: () => true, // อยากเห็นทุก status code รวมถึง 429
      });

      const elapsedMs = Date.now() - start;
      record({
        n,
        elapsedMs,
        status: res.status,
        rateLimitHeaders: extractRateLimitHeaders(res.headers),
      });

      if (res.status === 429) {
        hit429 = true;
        console.log(`\n>>> เจอ 429 Too Many Requests ที่ request ลำดับที่ ${n} (เวลาผ่านไป ${elapsedMs} ms) <<<`);
        console.log('Response body:', JSON.stringify(res.data));
        break;
      }
    } catch (err) {
      const elapsedMs = Date.now() - start;
      record({
        n,
        elapsedMs,
        status: err.response?.status || `ERROR:${err.code || err.message}`,
        rateLimitHeaders: err.response ? extractRateLimitHeaders(err.response.headers) : null,
      });
      if (err.response?.status === 429) {
        hit429 = true;
        console.log(`\n>>> เจอ 429 Too Many Requests ที่ request ลำดับที่ ${n} (เวลาผ่านไป ${elapsedMs} ms) <<<`);
        break;
      }
    }
  }

  if (!hit429) {
    console.log(`\nยิงครบ ${MAX_REQUESTS} requests แล้วยังไม่เจอ 429 (อาจต้องเพิ่ม MAX_REQUESTS หรือยิงเร็วขึ้น)`);
  }

  const outPath = path.join(__dirname, `scopus-rate-limit-result-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ issn: ISSN, hit429, totalRequests: log.length, log }, null, 2));
  console.log(`\nบันทึกผลละเอียดไว้ที่: ${outPath}`);
}

main();
