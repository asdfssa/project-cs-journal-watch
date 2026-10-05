/**
 * Demo: Auto Key-Switch ตอนเจอ 429 (production code เดิมไม่ถูกแก้)
 * ยิง request พร้อมกันจำนวนมากพอที่จะกวาดทั้ง 3 keys ให้ชนกัน 429
 * แล้วดักฟัง markKeyUnavailable() (wrap เฉย ๆ ไม่แก้ logic) เพื่อ log การสลับ key จริง
 *
 * รันในคอนเทนเนอร์: docker exec journal-watch-backend node scripts/test-scopus-key-switch.js
 */
const ScopusService = require('/app/src/services/ScopusService');
const scopusProxy = require('/app/src/services/ScopusProxyService');

const ISSN = process.argv[2] || '0031-8949';
const CONCURRENCY = parseInt(process.argv[3], 10) || 30;

// ดักฟัง (ไม่แก้ logic เดิม) เพื่อ log ตอน key ถูก mark unavailable และเปลี่ยนไปใช้ key ถัดไป
const origMark = scopusProxy.markKeyUnavailable.bind(scopusProxy);
scopusProxy.markKeyUnavailable = (idx) => {
  console.log(`  >>> [AUTO-SWITCH] Key index ${idx} เจอ 429 → mark unavailable แล้วลองยิงใหม่ด้วย key ถัดไปอัตโนมัติ`);
  return origMark(idx);
};

async function main() {
  console.log(`=== Demo Auto Key-Switch ===`);
  console.log(`ISSN=${ISSN}, ยิงพร้อมกัน ${CONCURRENCY} requests\n`);

  console.log('สถานะ key ก่อนยิง:');
  console.table(scopusProxy.getStatus());

  // เรียก _fetchFromApi ตรง ๆ ข้าม cache layer เพื่อบังคับให้ยิง Scopus API จริงทุกครั้ง
  const promises = Array.from({ length: CONCURRENCY }, (_, i) =>
    ScopusService._fetchFromApi(ISSN.replace('-', ''))
      .then(r => ({ i, ok: true, name: r?.journal_name }))
      .catch(e => ({ i, ok: false, error: e.message }))
  );

  const results = await Promise.all(promises);
  const okCount = results.filter(r => r.ok).length;
  const failCount = results.length - okCount;

  console.log(`\nผลลัพธ์: สำเร็จ ${okCount}/${results.length}, ล้มเหลว ${failCount}/${results.length}`);
  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    console.log('รายการที่ล้มเหลว:', JSON.stringify(failed, null, 2));
  }

  console.log('\nสถานะ key หลังยิง:');
  console.table(scopusProxy.getStatus());
}

main().catch(e => console.error('ERR', e));
