/**
 * เช็คสถานะ Scopus API key ทั้งหมดแยกทีละตัว (bypass round-robin)
 * ยิง Scopus REST API จริงด้วยแต่ละ key ตรงๆ เพื่อดูว่า key ไหนใช้งานได้/โดน rate limit/invalid
 *
 * รัน:  node scripts/check-scopus-keys-live.js [ISSN]
 */
const path = require('path');
const axios = require('axios');
const config = require(path.join(__dirname, '..', 'src', 'config'));

const ISSN = (process.argv[2] || '0031-8949').replace('-', '');

async function checkKey(key, index) {
  const label = `Key ${index} (${key.slice(0, 6)}...${key.slice(-4)})`;
  try {
    const res = await axios.get(
      `${config.scopus.baseUrl}/content/serial/title/issn/${ISSN}`,
      {
        headers: { 'X-ELS-APIKey': key, Accept: 'application/json' },
        params: { view: 'STANDARD', field: 'dc:title' },
        timeout: 15000,
      }
    );
    const entry = res.data?.['serial-metadata-response']?.entry?.[0];
    return { index, label, status: 'OK', httpStatus: res.status, journalName: entry?.['dc:title'] || '(ไม่มีข้อมูล entry)' };
  } catch (err) {
    const httpStatus = err.response?.status;
    let reason = 'unknown error';
    if (httpStatus === 429) reason = 'RATE LIMITED (429)';
    else if (httpStatus === 401 || httpStatus === 403) reason = 'INVALID/UNAUTHORIZED KEY (' + httpStatus + ')';
    else if (httpStatus === 404) reason = 'ISSN not found (key ใช้ได้ปกติ แค่ ISSN นี้ไม่มี)';
    else if (err.code === 'ECONNABORTED') reason = 'TIMEOUT';
    else reason = `HTTP ${httpStatus || err.code || err.message}`;
    return { index, label, status: httpStatus === 404 ? 'OK (key ปกติ)' : 'FAIL', httpStatus, reason };
  }
}

async function main() {
  console.log(`\n=== เช็คสถานะ Scopus API Key ทั้งหมด (ISSN ทดสอบ: ${ISSN}) ===\n`);

  const keys = [
    config.scopus.apiKeys[0],
    config.scopus.apiKeys[1],
    config.scopus.apiKeys[2],
  ].filter(Boolean);

  if (keys.length === 0) {
    console.log('ไม่พบ API key เลย');
    process.exit(1);
  }

  for (let i = 0; i < keys.length; i++) {
    process.stdout.write(`ยิงทดสอบ Key ${i}... `);
    const result = await checkKey(keys[i], i);
    if (result.status.startsWith('OK')) {
      console.log(`✅ ${result.status}${result.journalName ? ' — ' + result.journalName : ''}`);
    } else {
      console.log(`❌ ${result.reason}`);
    }
  }

  console.log('\n=== จบการเช็ค ===\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
