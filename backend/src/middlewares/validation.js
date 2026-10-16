/**
 * Validation Middleware
 * รวบรวม errors จาก express-validator แล้วส่ง 400 ถ้ามี
 */
const { validationResult } = require('express-validator');

/**
 * Middleware ปิดท้ายชุด validator ของ express-validator — ถ้า validator ก่อนหน้าพบข้อผิดพลาดจะตอบ 400 VALIDATION_ERROR
 * เรียกจาก: routes/authRoutes.js ต่อจาก loginValidator / verifyOtpValidator / googleLoginValidator / forgotPasswordValidator / resetPasswordValidator (validators/authValidator.js)
 * ตอบ: { success:false, code:'VALIDATION_ERROR', errors:[{ field, message }] } · ไม่มี error → next() ไป AuthController
 * หมายเหตุ: validator เหล่านี้ trim/toLowerCase ค่าใน req.body ให้ด้วย (sanitize) controller จึงได้ค่าที่สะอาดแล้ว
 */
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

/**
 * ตัวตรวจ `:id` ใน URL — ต้องเป็นจำนวนเต็มบวกไม่เกิน 10 หลัก ไม่งั้นตอบ 400 INVALID_ID
 * เรียกจาก: router.param('id', requireNumericId) ในทุก router ที่มี :id (admin, userManage, upload, unwantedJournal, preT3, t3)
 * Express เรียกก่อน handler ทุกครั้งที่ path มี :id · controller จึงใช้ parseInt(req.params.id) ได้อย่างปลอดภัย
 */
// ใช้กับ router.param('id', requireNumericId) — :id ต้องเป็นจำนวนเต็มบวก
// (กัน parseInt('abc') = NaN ไปลง SQL เป็น `= NaN` → 500, และ '12abc' ถูกตีความเป็น 12)
function requireNumericId(req, res, next, id) {
  if (!/^[1-9]\d{0,9}$/.test(id)) {
    return res.status(400).json({ success: false, code: 'INVALID_ID', message: 'รหัสไม่ถูกต้อง' });
  }
  next();
}

module.exports.requireNumericId = requireNumericId;
