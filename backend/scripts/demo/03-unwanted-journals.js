/**
 * DEMO 3: รายชื่อวารสารต้องห้ามของ มมส. (ตาราง msu_unwanted_journals ใน DB จริง)
 * เรียก UnwantedJournalController.checkByIssn / deleteOne ของจริง (ส่ง req/res จำลอง ไม่ต้องเปิดเซิร์ฟเวอร์)
 *
 * รัน: node scripts/demo/03-unwanted-journals.js
 *
 * ขั้นตอน: อ่านรายการ -> เช็ค ISSN (ทั้งแบบมี/ไม่มีขีด) -> เพิ่มแถวทดสอบ -> เช็คซ้ำ -> ลบแถวทดสอบ
 * แถวทดสอบใช้ ISSN 9999-9990 ชื่อ "[DEMO]" และถูกลบเสมอตอนจบ (แม้เกิด error) · ข้อมูลจริงไม่ถูกแตะ
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const db = require('../../src/config/database');
const Ctrl = require('../../src/controllers/UnwantedJournalController');

const DEMO_ISSN = '9999-9990';
const line = (t) => console.log(`\n=== ${t} ===`);

// เรียก controller ของจริงด้วย req/res จำลอง แล้วคืน JSON ที่มันตอบ
function call(fn, req) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); } };
    fn(req, res, reject);
  });
}
const check = async (issn) => {
  const { body } = await call(Ctrl.checkByIssn, { params: { issn } });
  console.log(`  ตรวจ "${issn}" -> ${body.data?.isUnwanted ? `ต้องห้าม: ${body.data.journal.journal_name}` : (body.data ? 'ปกติ (ไม่อยู่ในรายการ)' : body.message)}`);
};

(async () => {
  line('1) รายการวารสารต้องห้ามใน DB ตอนนี้');
  const [list] = await db.query('SELECT unwanted_id, issn, journal_name, publisher, recorded_date FROM msu_unwanted_journals ORDER BY unwanted_id');
  console.table(list);

  line('2) เช็ค ISSN ผ่าน checkByIssn (รองรับทั้งมี/ไม่มีขีด)');
  if (list[0]?.issn) {
    const real = list[0].issn;
    await check(real);
    await check(real.replace('-', ''));
  }
  await check('0028-0836');   // Nature — ควรปกติ
  await check('abc');         // รูปแบบผิด

  line('3) เพิ่มแถวทดสอบ แล้วเช็คใหม่ (ลบทิ้งท้ายสคริปต์)');
  const [exists] = await db.query('SELECT 1 FROM msu_unwanted_journals WHERE issn = ?', [DEMO_ISSN]);
  if (exists.length) throw new Error(`มี ISSN ${DEMO_ISSN} อยู่ใน DB แล้ว — หยุดเพื่อไม่ให้ลบข้อมูลที่ไม่ใช่ของ demo`);

  let demoId = null;
  try {
    const [ins] = await db.query(
      'INSERT INTO msu_unwanted_journals (issn, journal_name, publisher, note, recorded_date) VALUES (?, ?, ?, ?, CURDATE())',
      [DEMO_ISSN, '[DEMO] Predatory Journal Example', 'Demo Publisher', 'แถวทดสอบสำหรับ demo']
    );
    demoId = ins.insertId;
    console.log(`  INSERT สำเร็จ unwanted_id=${demoId}`);
    await check(DEMO_ISSN);
  } finally {
    if (demoId) {
      line('4) ลบแถวทดสอบด้วย deleteOne ของจริง');
      const { body } = await call(Ctrl.deleteOne, { params: { id: demoId } });
      console.log(`  ${body.message}`);
      await check(DEMO_ISSN);
    }
  }
})()
  .catch(e => console.error('ผิดพลาด:', e.message))
  .finally(() => db.end());
