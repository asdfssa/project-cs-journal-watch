/**
 * Input helpers — กันค่าจาก client ที่ผิดรูปแบบไม่ให้กลายเป็น 500
 */

/**
 * แปลง ?page=&limit= เป็นตัวเลขที่ใช้ได้เสมอ (ค่าเพี้ยน → default, limit ไม่เกิน maxLimit)
 */
function parsePagination(query, maxLimit = 100) {
  const page  = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * คืนชื่อ field แรกที่ส่งมาแต่ไม่ใช่ string (undefined / null ถือว่าไม่ได้ส่ง) — ไม่มีคืน null
 */
function nonStringField(body, fields) {
  return fields.find(f => body[f] != null && typeof body[f] !== 'string') || null;
}

/**
 * ค่าสำหรับ `LIKE ?` แบบ "มีคำนี้อยู่ข้างใน" — escape % _ \ ที่ผู้ใช้พิมพ์มา ไม่ให้กลายเป็น wildcard
 * (ค้นด้วย "%" หรือ "_" เดิมได้ทุกแถว / ตรงเกินจริง)
 */
function likeContains(search) {
  return `%${String(search).replace(/[\\%_]/g, '\\$&')}%`;
}

/**
 * คืนชื่อ field แรกที่เป็น object/array (ไม่ใช่ค่าเดี่ยว) — ใช้กับ field ที่ลง SQL ตรงๆ แต่ชนิดไม่จำเป็นต้องเป็น string
 * (เช่น curriculum_year) กัน {..}/[..] ไปขยายเป็น SQL แล้วได้ 500 หรือแทรกเงื่อนไข (undefined / null ถือว่าไม่ได้ส่ง)
 */
function nonScalarField(body, fields) {
  return fields.find(f => body[f] != null && typeof body[f] === 'object') || null;
}

/**
 * ISSN → รูปแบบเดียว "XXXX-XXXX" (ตัด ขีด/ช่องว่าง, x → X) — ไม่ครบ 8 ตัวคืน null (รูปแบบผิด)
 * ใช้ทั้งตอนบันทึกและตอนค้น ให้ 12345678 / 1234-5678 / 1234 5678 เป็นค่าเดียวกัน
 */
function normalizeIssn(value) {
  const clean = String(value ?? '').toUpperCase().replace(/[^0-9X]/g, '');
  return /^\d{7}[\dX]$/.test(clean) ? `${clean.slice(0, 4)}-${clean.slice(4)}` : null;
}

/**
 * ตัวเลขทศนิยมที่เป็นทางเลือก (เช่น impact_factor, citescore):
 *  - undefined / null / "" / ช่องว่างล้วน (ช่องฟอร์มที่ไม่ได้กรอก) → null
 *  - ตัวเลข หรือสตริงตัวเลข (เช่น "12.5") ที่ >= 0 และ < max → Number
 *  - อย่างอื่น (ข้อความ, ติดลบ, ใหญ่เกินคอลัมน์, object/array/boolean) → NaN — ผู้เรียกตอบ 400
 *    (ไม่ปล่อยให้ชน DECIMAL ใน MySQL แล้วกลายเป็น 500)
 */
function optionalDecimal(value, max) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  let n;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(value)) n = Number(value);
  else return NaN;
  return Number.isFinite(n) && n >= 0 && n < max ? n : NaN;
}

module.exports = { parsePagination, nonStringField, nonScalarField, likeContains, normalizeIssn, optionalDecimal };
