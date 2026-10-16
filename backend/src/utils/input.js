/**
 * Input helpers — กันค่าจาก client ที่ผิดรูปแบบไม่ให้กลายเป็น 500
 */

/**
 * แปลง ?page=&limit= เป็นตัวเลขที่ใช้ได้เสมอ (ค่าเพี้ยน → default, limit ไม่เกิน maxLimit)
 *
 * เรียกจาก: AdminController (รายการผู้ใช้/แอดมิน), PreT3Controller + T3Controller (รายการประวัติ), UnwantedJournalController.getAll
 * @param {object} query req.query (app.js ทำให้ค่าซ้ำเหลือค่าเดียวแล้ว)
 * @param {number} [maxLimit] เพดาน limit (ค่าเริ่มต้น 100)
 * @returns {{page:number, limit:number, offset:number}} ส่งต่อให้ controller/Model ใช้ใน SQL LIMIT/OFFSET
 */
function parsePagination(query, maxLimit = 100) {
  const page  = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * คืนชื่อ field แรกที่ส่งมาแต่ไม่ใช่ string (undefined / null ถือว่าไม่ได้ส่ง) — ไม่มีคืน null
 *
 * เรียกจาก: AdminController (สร้าง/แก้ผู้ใช้-แอดมิน) และ UnwantedJournalController (สร้าง/แก้วารสาร) — เช็ค body ก่อนใช้ .trim() ให้ client ที่ส่งตัวเลข/array มาได้ 400 ไม่ใช่ 500
 * @param {object} body req.body
 * @param {string[]} fields ชื่อฟิลด์ที่ต้องเป็น string ถ้ามีส่งมา
 * @returns {string|null} ชื่อฟิลด์แรกที่ผิดชนิด · null = ผ่าน
 */
function nonStringField(body, fields) {
  return fields.find(f => body[f] != null && typeof body[f] !== 'string') || null;
}

/**
 * ค่าสำหรับ `LIKE ?` แบบ "มีคำนี้อยู่ข้างใน" — escape % _ \ ที่ผู้ใช้พิมพ์มา ไม่ให้กลายเป็น wildcard
 * (ค้นด้วย "%" หรือ "_" เดิมได้ทุกแถว / ตรงเกินจริง)
 *
 * เรียกจาก: AdminController (ค้นผู้ใช้/แอดมิน), UnwantedJournalController.getAll, UserController.getStaffDirectory — ผลลัพธ์ส่งเป็น parameter ของ `LIKE ?`
 * @param {string} search ข้อความที่ผู้ใช้พิมพ์
 * @returns {string} ข้อความที่ใส่ % ครอบหน้า-หลัง และ escape ตัวอักษร % _ \ ภายในแล้ว
 */
function likeContains(search) {
  return `%${String(search).replace(/[\\%_]/g, '\\$&')}%`;
}

/**
 * คืนชื่อ field แรกที่เป็น object/array (ไม่ใช่ค่าเดี่ยว) — ใช้กับ field ที่ลง SQL ตรงๆ แต่ชนิดไม่จำเป็นต้องเป็น string
 * (เช่น curriculum_year) กัน {..}/[..] ไปขยายเป็น SQL แล้วได้ 500 หรือแทรกเงื่อนไข (undefined / null ถือว่าไม่ได้ส่ง)
 *
 * เรียกจาก: AdminController (สร้าง/แก้ผู้ใช้), UserController.updateProfile — ตรวจฟิลด์ที่ลงเป็น parameter ของ SQL แต่ไม่จำเป็นต้องเป็น string
 * @param {object} body req.body
 * @param {string[]} fields
 * @returns {string|null} ชื่อฟิลด์แรกที่เป็น object/array · null = ผ่าน
 */
function nonScalarField(body, fields) {
  return fields.find(f => body[f] != null && typeof body[f] === 'object') || null;
}

/**
 * ISSN → รูปแบบเดียว "XXXX-XXXX" (ตัด ขีด/ช่องว่าง, x → X) — ไม่ครบ 8 ตัวคืน null (รูปแบบผิด)
 * ใช้ทั้งตอนบันทึกและตอนค้น ให้ 12345678 / 1234-5678 / 1234 5678 เป็นค่าเดียวกัน
 *
 * เรียกจาก: PreT3Controller (ISSN ของวารสารที่ยื่น) และ UnwantedJournalController (ตรวจ/บันทึก/นำเข้า ISSN)
 * @param {*} value ISSN ในรูปใดก็ได้
 * @returns {string|null} 'XXXX-XXXX' · null = รูปแบบผิด (ผู้เรียกตอบ 400 หรือข้ามแถว)
 */
function normalizeIssn(value) {
  const clean = String(value ?? '').toUpperCase().replace(/[^0-9X]/g, '');
  return /^\d{7}[\dX]$/.test(clean) ? `${clean.slice(0, 4)}-${clean.slice(4)}` : null;
}

/**
 * คู่ ISSN ของวารสาร (ตัวเลขล้วน ไม่มีขีด) — issn = p-ISSN ของวารสารเสมอ ไม่ใช่ตัวที่ผู้ใช้พิมพ์ค้น
 * ไม่งั้น p-ISSN กับ e-ISSN ของวารสารเดียวกันจะยื่น Pre-T3 ซ้ำได้ (เหมือนที่ TCI ทำอยู่แล้ว)
 * ไม่มี p-ISSN → ใช้ e-ISSN, ไม่มีทั้งคู่ → ใช้ตัวที่พิมพ์ค้น
 *
 * เรียกจาก: services/ScopusService และ services/ScopusScraper ตอน map ผลค้นหาเป็นวารสาร
 * @param {string} printRaw p-ISSN ที่แหล่งข้อมูลให้มา
 * @param {string} onlineRaw e-ISSN ที่แหล่งข้อมูลให้มา
 * @param {string} typed สิ่งที่ผู้ใช้พิมพ์ค้น (ใช้เป็นตัวสุดท้ายถ้าไม่มีทั้งคู่)
 * @returns {{issn:string, eissn:string|null}} ตัวเลข/X ล้วน ไม่มีขีด
 */
function pickIssns(printRaw, onlineRaw, typed) {
  const clean = (v) => String(v ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
  const print = clean(printRaw), online = clean(onlineRaw);
  return { issn: print || online || clean(typed), eissn: print && online ? online : null };
}

/**
 * ตัวเลขทศนิยมที่เป็นทางเลือก (เช่น impact_factor, citescore):
 *  - undefined / null / "" / ช่องว่างล้วน (ช่องฟอร์มที่ไม่ได้กรอก) → null
 *  - ตัวเลข หรือสตริงตัวเลข (เช่น "12.5") ที่ >= 0 และ < max → Number
 *  - อย่างอื่น (ข้อความ, ติดลบ, ใหญ่เกินคอลัมน์, object/array/boolean) → NaN — ผู้เรียกตอบ 400
 *    (ไม่ปล่อยให้ชน DECIMAL ใน MySQL แล้วกลายเป็น 500)
 *
 * เรียกจาก: T3Controller (journal_metrics: impact_factor, citescore ฯลฯ ตอนยื่น T3)
 * @param {*} value ค่าจาก req.body
 * @param {number} max ค่าสูงสุด (ไม่รวม) ตามความกว้างของ DECIMAL
 * @returns {number|null} number = ใช้ได้ · null = ไม่ได้กรอก · NaN = ไม่ถูกต้อง (ผู้เรียกตอบ 400)
 */
function optionalDecimal(value, max) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  let n;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(value)) n = Number(value);
  else return NaN;
  return Number.isFinite(n) && n >= 0 && n < max ? n : NaN;
}

module.exports = { parsePagination, nonStringField, nonScalarField, likeContains, normalizeIssn, pickIssns, optionalDecimal };
