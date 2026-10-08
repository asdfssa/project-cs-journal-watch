/**
 * Validation Middleware
 * รวบรวม errors จาก express-validator แล้วส่ง 400 ถ้ามี
 */
const { validationResult } = require('express-validator');

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'ข้อมูลที่ส่งมาไม่ถูกต้อง กรุณาตรวจสอบและลองใหม่',
      errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
}

module.exports = handleValidation;

// ใช้กับ router.param('id', requireNumericId) — :id ต้องเป็นจำนวนเต็มบวก
// (กัน parseInt('abc') = NaN ไปลง SQL เป็น `= NaN` → 500, และ '12abc' ถูกตีความเป็น 12)
function requireNumericId(req, res, next, id) {
  if (!/^[1-9]\d{0,9}$/.test(id)) {
    return res.status(400).json({ success: false, code: 'INVALID_ID', message: 'รหัสไม่ถูกต้อง' });
  }
  next();
}

module.exports.requireNumericId = requireNumericId;
