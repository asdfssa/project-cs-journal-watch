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

module.exports = { parsePagination, nonStringField };
