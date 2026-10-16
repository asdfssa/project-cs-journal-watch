/**
 * Auth Middleware
 * - requireAuth   : ต้องมี access token (full login)
 * - requireOtpToken : ต้องมี OTP token (ระหว่างขั้น verify OTP)
 * - requireRole   : ตรวจ role
 */
const jwtUtil = require('../utils/jwt');
const db = require('../config/database');

/**
 * ดึง JWT ออกจาก header `Authorization: Bearer <token>`
 * เรียกจาก: requireAuth / requireOtpToken / requirePasswordResetToken ในไฟล์นี้
 * @param {import('express').Request} req
 * @returns {string|null} ตัว token (ไม่มีคำว่า Bearer) · null = ไม่มี header หรือรูปแบบไม่ใช่ Bearer
 */
function extractToken(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7);
}

/**
 * Middleware ด่านแรกของทุก endpoint ที่ต้อง login แล้ว
 * เรียกจาก: ทุกไฟล์ใน routes/ (ยกเว้น login/OTP/refresh/logout/forgot/reset ใน authRoutes) — วางไว้หน้า requireRole เสมอ
 * ลำดับ: เอา token → jwt.verify (utils/jwt.verifyToken) → ต้องเป็น type 'access' → ถาม DB ว่าบัญชียัง Active และ role ตรงกับใน token
 *   (เช็ค DB ทุก request เพื่อให้ผู้ที่ถูกระงับ/เปลี่ยน role มีผลทันที ไม่ต้องรอ token หมดอายุ 15 นาที)
 * ส่งต่อให้ handler ถัดไป: `req.user = payload` ของ token = { sub (user_id), username, role, firstName, lastName, msuMail, degreeLevel, type }
 *   controller/middleware ที่ตามหลังอ่านผู้ใช้ปัจจุบันจาก req.user.sub / req.user.role
 * ตอบ 401 เมื่อ: NO_TOKEN / INVALID_TOKEN / WRONG_TOKEN_TYPE / ACCOUNT_INACTIVE / ROLE_CHANGED · DB พัง → next(err) ไป errorHandler
 */
async function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({
      success: false,
      code: 'NO_TOKEN',
      message: 'กรุณา login ก่อนเข้าใช้งาน',
    });
  }
  let payload;
  try {
    payload = jwtUtil.verifyToken(token);
  } catch (err) {
    return res.status(401).json({
      success: false,
      code: 'INVALID_TOKEN',
      message: 'Token ไม่ถูกต้องหรือหมดอายุ กรุณา login ใหม่',
    });
  }
  if (payload.type !== 'access') {
    return res.status(401).json({
      success: false,
      code: 'WRONG_TOKEN_TYPE',
      message: 'ประเภท Token ไม่ถูกต้อง',
    });
  }

  // token ยังไม่หมดอายุแต่บัญชีอาจถูกระงับ/ถูกเปลี่ยน role ไปแล้ว — เช็คกับ DB ทุกครั้ง
  // (ROLE_CHANGED → frontend refresh แล้วได้ token ที่มี role ปัจจุบัน)
  try {
    const [rows] = await db.query('SELECT role, account_status FROM users WHERE user_id = ?', [payload.sub]);
    if (!rows.length || rows[0].account_status !== 'Active') {
      return res.status(401).json({
        success: false,
        code: 'ACCOUNT_INACTIVE',
        message: 'บัญชีนี้ไม่สามารถใช้งานได้ในขณะนี้ กรุณาติดต่อผู้ดูแลระบบ',
      });
    }
    if (rows[0].role !== payload.role) {
      return res.status(401).json({
        success: false,
        code: 'ROLE_CHANGED',
        message: 'สิทธิ์ของบัญชีถูกเปลี่ยน กรุณาเข้าสู่ระบบใหม่',
      });
    }
  } catch (err) {
    return next(err);
  }

  req.user = payload;
  next();
}

/**
 * Middleware ของขั้นตอน OTP ตอน login (verify-otp / resend-otp)
 * เรียกจาก: routes/authRoutes.js (POST /auth/verify-otp, /auth/resend-otp)
 * ใช้ token ชนิด 'otp_pending' ที่ AuthService.login ออกให้หลังตรวจรหัสผ่านผ่าน — access token ใช้แทนไม่ได้
 * ส่งต่อ: `req.otpUserId` = user_id ของเจ้าของ token → AuthController.verifyOtp / resendOtp
 */
function requireOtpToken(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({
      success: false,
      code: 'NO_OTP_TOKEN',
      message: 'กรุณาระบุ OTP Token',
    });
  }
  try {
    const payload = jwtUtil.verifyToken(token);
    if (payload.type !== 'otp_pending') {
      return res.status(401).json({
        success: false,
        code: 'WRONG_TOKEN_TYPE',
        message: 'ประเภท Token ไม่ถูกต้อง',
      });
    }
    req.otpUserId = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      code: 'OTP_TOKEN_EXPIRED',
      message: 'OTP หมดอายุ กรุณาเข้าสู่ระบบใหม่',
    });
  }
}

/**
 * Middleware ของขั้น 2 ของการรีเซ็ตรหัสผ่าน (ส่ง OTP + รหัสผ่านใหม่)
 * เรียกจาก: routes/authRoutes.js (POST /auth/reset-password)
 * ใช้ token ชนิด 'reset_pending' ที่ AuthService.requestPasswordReset ออกให้ — แยกชนิดจาก otp_pending เพื่อไม่ให้สลับกันใช้ได้
 * ส่งต่อ: `req.resetUserId` = user_id → AuthController.resetPassword
 */
function requirePasswordResetToken(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({
      success: false,
      code: 'NO_RESET_TOKEN',
      message: 'กรุณาระบุ Reset OTP Token',
    });
  }
  try {
    const payload = jwtUtil.verifyToken(token);
    if (payload.type !== 'reset_pending') {
      return res.status(401).json({
        success: false,
        code: 'WRONG_TOKEN_TYPE',
        message: 'ประเภท Token ไม่ถูกต้อง',
      });
    }
    req.resetUserId = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      code: 'RESET_TOKEN_EXPIRED',
      message: 'Token หมดอายุ กรุณาขอรีเซ็ตรหัสผ่านใหม่',
    });
  }
}

/**
 * Factory สร้าง middleware ตรวจ role (ต้องวางหลัง requireAuth เพราะอ่านจาก req.user.role)
 * เรียกจาก: routes/ ทุกไฟล์ เช่น requireRole('Admin', 'SuperAdmin') · routes/userRoutes.js ใช้ ALL_ROLES
 * @param {...string} allowedRoles Student | Supervisor | Staff | Admin | SuperAdmin
 * @returns {Function} (req, res, next) → role ไม่อยู่ในรายการ ตอบ 403 FORBIDDEN, ผ่านแล้ว next()
 * หมายเหตุ: ตรวจแค่ 'role อะไร' ส่วน 'เป็นเจ้าของข้อมูลนี้ไหม' แต่ละ controller เช็คเอง
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'คุณไม่มีสิทธิ์เข้าถึง endpoint นี้',
      });
    }
    next();
  };
}

module.exports = { requireAuth, requireOtpToken, requirePasswordResetToken, requireRole };
