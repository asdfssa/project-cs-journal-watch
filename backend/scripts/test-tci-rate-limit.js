/**
 * ทดสอบ Rate Limit ของ TCI API (endpoint สาธารณะ ไม่ต้องใช้ API Key)
 * ยิง burst (concurrent) ไล่ระดับขึ้นเรื่อย ๆ เหมือน test-scopus-rate-limit-burst.js
 * เพื่อดูว่ามีการจำกัดจำนวนคำขอต่อวินาทีหรือไม่
 *
 * รัน: node scripts/test-tci-rate-limit.js
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const URL = 'https://tci-thailand.org/backend/journal/list_all_journal';
const MAX_BURST = 30;

async function fireOne(n) {
  const t0 = Date.now();
  try {
    const res = await axios.post(
      URL,
      { start_item: 0, offset: 10, tiers: [], status: [], area: [], main_area: [], option: 'ssn', search: '0028-0836' },
      { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 15000, validateStatus: () => true }
    );
    return { n, status: res.status, ms: Date.now() - t0 };
  } catch (err) {
    return { n, status: err.response?.status || `ERROR:${err.code || err.message}`, ms: Date.now() - t0 };
  }
}

async function main() {
  console.log('เริ่มทดสอบ TCI API Burst Rate Limit\n');
  const allRounds = [];
  let stop = false;

  for (let burstSize = 2; burstSize <= MAX_BURST && !stop; burstSize++) {
    console.log(`--- Round: ยิงพร้อมกัน ${burstSize} requests ---`);
    const results = await Promise.all(Array.from({ length: burstSize }, (_, i) => fireOne(i + 1)));
    const statuses = results.map(r => r.status);
    console.log(`ผลลัพธ์: ${JSON.stringify(statuses)}`);
    allRounds.push({ burstSize, results });

    const badCount = statuses.filter(s => s === 429 || s === 403 || String(s).startsWith('ERROR')).length;
    if (badCount > 0) {
      console.log(`\n>>> เจอสัญญาณ rate-limit/error ที่ burst size = ${burstSize} <<<`);
      stop = true;
    } else {
      await new Promise(r => setTimeout(r, 800));
    }
  }

  if (!stop) console.log(`\nทดสอบครบถึง burst size = ${MAX_BURST} แล้วยังไม่เจอสัญญาณ rate-limit ใด ๆ`);

  const outPath = path.join(__dirname, `tci-burst-result-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(allRounds, null, 2));
  console.log(`บันทึกผลไว้ที่: ${outPath}`);
}

main();
