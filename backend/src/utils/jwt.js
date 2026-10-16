/**
 * JWT Helper
 * - issueAccessToken  : ออก access token อายุสั้น (15 นาที)
 * - issueOtpToken     : ออก token ชั่วคราวระหว่างขั้น OTP
 * - issueRefreshToken : ออก refresh token แบบ random string (ไม่ใช่ JWT)
 * - verifyToken       : ตรวจสอบ token และคืน payload
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');

/**
 * ออก access token (JWT, issuer 'journal-watch') พก payload ของผู้ใช้ ให้ requireAuth อ่านได้โดยไม่ต้อง join ตารางเอง
 * เรียกจาก: services/AuthService (verifyOtp, googleLogin, refreshToken, _refreshWithinGrace) · ผลลัพธ์ส่งกลับ client ผ่าน AuthController
 * @param {object} user แถวจากตาราง users (user_id, username, role, first_name, last_name, msu_mail, degree_level)
 * @returns {string} JWT — อ่านกลับด้วย verifyToken จะได้ { sub, username, role, firstName, lastName, msuMail, degreeLevel, type:'access' }
 */
function issueAccessToken(user) {
  const payload = {
    sub: user.user_id,
    username: user.username,
    role: user.role,
    firstName: user.first_name,
    lastName: user.last_name,
    msuMail: user.msu_mail,
    degreeLevel: user.degree_level || null,
    type: 'access',
  };
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.accessExpiresIn,
    issuer: 'journal-watch',
  });
}

/**
 * alias ของ issueAccessToken — ปัจจุบันไม่มีที่ไหนเรียกใช้ (เก็บไว้กันโค้ดเก่า)
 */
// backward compat — เรียกชื่อเดิมได้
function issueLoginToken(user) {
  return issueAccessToken(user);
}

/**
 * ออก token ชั่วคราว type 'otp_pending' หลังตรวจ username/password ผ่าน ใช้พิสูจน์ตัวตนในขั้น verify/resend OTP
 * เรียกจาก: services/AuthService.login · ฝั่งรับคือ middlewares/auth.requireOtpToken (ได้ req.otpUserId)
 * @param {number} userId
 */
function issueOtpToken(userId) {
  const payload = {
    sub: userId,
    type: 'otp_pending',
  };
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.otpExpiresIn,
    issuer: 'journal-watch',
  });
}

/**
 * ออก token ชั่วคราว type 'reset_pending' สำหรับขั้นกรอก OTP + รหัสผ่านใหม่
 * เรียกจาก: services/AuthService.requestPasswordReset (ถ้าไม่พบ username ก็ออกด้วย userId 0 เพื่อไม่ให้เดาได้ว่ามีบัญชีหรือไม่) · ฝั่งรับคือ requirePasswordResetToken (ได้ req.resetUserId)
 * @param {number} userId
 */
function issuePasswordResetOtpToken(userId) {
  const payload = {
    sub: userId,
    type: 'reset_pending',
  };
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.otpExpiresIn,
    issuer: 'journal-watch',
  });
}

/**
 * ออก refresh token เป็น random string (ไม่ใช่ JWT)
 * เก็บ hash ไว้ใน DB ไม่เก็บ plain text
 * คืน { token, hash, expiresAt }
 *
 * เรียกจาก: services/AuthService (verifyOtp, googleLogin, refreshToken) — ส่ง token ให้ client ทาง cookie, ส่ง hash + expiresAt ให้ models/RefreshTokenModel เก็บลง DB
 */
function issueRefreshToken() {
  const token = crypto.randomBytes(64).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + config.jwt.refreshExpiresMs);
  return { token, hash, expiresAt };
}

/**
 * Hash refresh token สำหรับ verify จาก client
 *
 * เรียกจาก: services/AuthService (refreshToken, logout) — เอา token จาก cookie มา hash แล้วค้นแถวใน auth_tokens ผ่าน RefreshTokenModel
 * @param {string} token refresh token แบบ plain
 * @returns {string} sha256 hex
 */
function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * ตรวจลายเซ็น + อายุ + issuer ของ JWT · token เสีย/หมดอายุ → throw (JsonWebTokenError / TokenExpiredError)
 * เรียกจาก: middlewares/auth.js (requireAuth, requireOtpToken, requirePasswordResetToken) — ผู้เรียกต้องเช็ค payload.type เองว่าเป็นชนิดที่ต้องการ
 * @param {string} token
 * @returns {object} payload
 */
function verifyToken(token) {
  return jwt.verify(token, config.jwt.secret, { issuer: 'journal-watch' });
}

module.exports = {
  issueAccessToken,
  issueLoginToken,
  issueOtpToken,
  issuePasswordResetOtpToken,
  issueRefreshToken,
  hashRefreshToken,
  verifyToken,
};