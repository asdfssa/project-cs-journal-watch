/**
 * DEMO 2: ตรวจวารสารกับ TCI (ยิง API ของ tci-thailand.org จริงผ่าน TCIService)
 * แล้วเช็คต่อกับตาราง msu_unwanted_journals ใน DB จริง
 *
 * รัน: node scripts/demo/02-tci-check.js [ISSN]      (ค่าเริ่มต้น 0858-0855 = ABAC Journal)
 * ไม่เขียน DB / ไม่ใช้โควตา (TCI ไม่มี API key)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const TCIService = require('../../src/services/TCIService');
const db = require('../../src/config/database');
const { normalizeIssn } = require('../../src/utils/input');

const line = (t) => console.log(`\n=== ${t} ===`);

(async () => {
  const issn = normalizeIssn(process.argv[2] || '0858-0855');
  if (!issn) { console.error('รูปแบบ ISSN ไม่ถูกต้อง (เช่น 1234-5678)'); process.exit(1); }

  line(`1) ค้น TCI ISSN ${issn}`);
  const t0 = Date.now();
  const j = await TCIService.getJournalByIssn(issn);
  console.log(`ใช้เวลา ${Date.now() - t0} ms`);
  if (!j) {
    console.log('ไม่พบวารสารนี้ใน TCI');
  } else {
    console.table({
      'ชื่อวารสาร (EN)': j.journal_name,
      'ชื่อวารสาร (TH)': j.journal_name_th,
      'ผู้จัดพิมพ์': j.publisher,
      'ISSN / eISSN': `${j.issn} / ${j.eissn ?? '-'}`,
      'TCI Tier': j.tci_tier ?? 'ไม่มี',
      'สถานะ': j.tci_status,
      'ไม่ active (tci_inactive)': j.tci_inactive,
      'สาขาหลัก': j.main_area,
      'เว็บไซต์': j.website,
    });
  }

  line('2) เช็คกับรายการวารสารต้องห้ามของ มมส. (DB จริง)');
  const [rows] = await db.query(
    'SELECT unwanted_id, issn, journal_name, note FROM msu_unwanted_journals WHERE issn IN (?, ?) LIMIT 1',
    [issn, issn.replace('-', '')]
  );
  console.log(rows.length ? `พบในรายการต้องห้าม: ${JSON.stringify(rows[0])}` : 'ไม่อยู่ในรายการต้องห้าม');
})()
  .catch(e => console.error('ผิดพลาด:', e.message))
  .finally(() => db.end());
