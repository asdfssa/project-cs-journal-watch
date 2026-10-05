/**
 * Auth Middleware
 * - requireAuth   : ต้องมี access token (full login)
 * - requireOtpToken : ต้องมี OTP token (ระหว่างขั้น verify OTP)
 * - requireRole   : ตรวจ role
 */
const jwtUtil = require('../utils/jwt');

function extractToken(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7);
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({
      success: false,
      code: 'NO_TOKEN',
      message: 'กรุณา login ก่อนเข้าใช้งาน',
    });
  }
  try {
    const payload = jwtUtil.verifyToken(token);
    if (payload.type !== 'access') {
      return res.status(401).json({
        success: false,
        code: 'WRONG_TOKEN_TYPE',
        message: 'ประเภท Token ไม่ถูกต้อง',
      });
    }
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      code: 'INVALID_TOKEN',
      message: 'Token ไม่ถูกต้องหรือหมดอายุ กรุณา login ใหม่',
    });
  }
}

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
