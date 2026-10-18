/**
 * DEMO 1: ตรวจวารสารกับ Scopus (ยิง API จริงผ่าน ScopusService)
 * แล้วเช็คต่อกับตาราง msu_unwanted_journals ใน DB จริง (ลำดับเดียวกับที่ระบบใช้ตอนผู้ใช้ตรวจ ISSN)
 *
 * รัน: node scripts/demo/01-scopus-check.js [ISSN]      (ค่าเริ่มต้น 0028-0836 = Nature)
 * กินโควตา Scopus 1 request · ไม่เขียนไฟล์ state / ไม่เขียน DB
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const ScopusService = require('../../src/services/ScopusService');
const scopusProxy = require('../../src/services/ScopusProxyService');
const db = require('../../src/config/database');
const { normalizeIssn } = require('../../src/utils/input');

// demo ไม่ควรแตะไฟล์ state ที่ container ใช้อยู่ (โควตาถูกใช้จริง แต่ container จะได้ค่าล่าสุดจาก header ในคำขอถัดไป)
scopusProxy._persist = async () => {};

const line = (t) => console.log(`\n=== ${t} ===`);

(async () => {
  const issn = normalizeIssn(process.argv[2] || '0028-0836');
  if (!issn) { console.error('รูปแบบ ISSN ไม่ถูกต้อง (เช่น 1234-5678)'); process.exit(1); }

  line(`1) ค้น Scopus ISSN ${issn}`);
  const t0 = Date.now();
  const j = await ScopusService.getJournalByIssn(issn);
  console.log(`ใช้เวลา ${Date.now() - t0} ms`);
  if (!j) {
    console.log('ไม่พบวารสารนี้ใน Scopus');
  } else {
    console.table({
      'ชื่อวารสาร': j.journal_name,
      'ผู้จัดพิมพ์': j.publisher,
      'ISSN / eISSN': `${j.issn} / ${j.eissn ?? '-'}`,
      'CiteScore': j.scopus_citescore,
      'Best Quartile': j.scopus_best_quartile,
      'Best Percentile': j.scopus_best_percentile,
      'SJR': j.scopus_sjr,
      'SNIP': j.scopus_snip,
      'Open Access': j.open_access ?? 'ไม่ใช่',
      'หยุดตีพิมพ์ (discontinued)': j.scopus_discontinued,
      'ครอบคลุมปี': `${j.coverage_start_year ?? '?'} - ${j.coverage_end_year ?? 'ปัจจุบัน'}`,
    });
    if (j.scopus_quartile_data) {
      console.log('Quartile แยกตามสาขา:');
      console.table(j.scopus_quartile_data.map(r => ({ สาขา: r.field, rank: r.rank, percentile: r.percentile, quartile: r.quartile })));
    }
  }

  line('2) เช็คกับรายการวารสารต้องห้ามของ มมส. (DB จริง)');
  const [rows] = await db.query(
    'SELECT unwanted_id, issn, journal_name, note FROM msu_unwanted_journals WHERE issn IN (?, ?) LIMIT 1',
    [issn, issn.replace('-', '')]
  );
  console.log(rows.length ? `พบในรายการต้องห้าม: ${JSON.stringify(rows[0])}` : 'ไม่อยู่ในรายการต้องห้าม');

  line('3) โควตา key หลังยิง (ในหน่วยความจำของสคริปต์นี้)');
  console.table(scopusProxy.getStatus().map(k => ({ key: `#${k.index}`, ใช้ไปสัปดาห์นี้: k.weeklyUsage, เหลือ: k.remaining, resetAt: k.weeklyResetAt ? new Date(k.weeklyResetAt * 1000).toLocaleString('th-TH') : '-' })));
})()
  .catch(e => console.error('ผิดพลาด:', e.code || '', e.message))
  .finally(() => db.end());
