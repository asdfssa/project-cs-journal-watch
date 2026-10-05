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

// backward compat — เรียกชื่อเดิมได้
function issueLoginToken(user) {
  return issueAccessToken(user);
}

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
 */
function issueRefreshToken() {
  const token = crypto.randomBytes(64).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + config.jwt.refreshExpiresMs);
  return { token, hash, expiresAt };
}

/**
 * Hash refresh token สำหรับ verify จาก client
 */
function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

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