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
 * ISSN → รูปแบบเดียว "XXXX-XXXX" (ตัด ขีด/ช่องว่าง, x → X) — ไม่ครบ 8 ตัวคืน null (รูปแบบผิด)
 * ใช้ทั้งตอนบันทึกและตอนค้น ให้ 12345678 / 1234-5678 / 1234 5678 เป็นค่าเดียวกัน
 */
function normalizeIssn(value) {
  const clean = String(value ?? '').toUpperCase().replace(/[^0-9X]/g, '');
  return /^\d{7}[\dX]$/.test(clean) ? `${clean.slice(0, 4)}-${clean.slice(4)}` : null;
}

module.exports = { parsePagination, nonStringField, normalizeIssn };
