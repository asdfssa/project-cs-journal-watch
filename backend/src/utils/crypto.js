/**
 * Crypto Utility
 * - สร้าง OTP code (numeric)
 * - Hash OTP ก่อนเก็บลง DB (ใช้ SHA-256)
 * - Compare OTP แบบ constant-time เพื่อกัน timing attack
 */
const crypto = require('crypto');
const config = require('../config');

/**
 * สร้าง OTP เป็นตัวเลขล้วน
 * ใช้ crypto.randomInt (cryptographically secure, ไม่ใช้ Math.random)
 */
function generateOtp(length = config.otp.length) {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length);
  return crypto.randomInt(min, max).toString();
}

/**
 * Hash OTP ด้วย SHA-256
 * เหตุผลที่ไม่ใช้ bcrypt: OTP มี entropy ต่ำ (6 หลัก = ~20 bits)
 *   bcrypt cost 12 จะใช้เวลา ~250ms ต่อครั้ง verify
 *   SHA-256 + short expiry (10 นาที) + max attempts (5) เพียงพอแล้ว
 */
function hashOtp(otp) {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

/**
 * เปรียบเทียบ hash แบบ constant-time
 * ป้องกัน timing attack ที่อาจเดา hash ได้จากเวลาที่ใช้
 */
function compareOtpHash(plainOtp, hashedOtp) {
  const computed = hashOtp(plainOtp);
  if (computed.length !== hashedOtp.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hashedOtp));
}

module.exports = {
  generateOtp,
  hashOtp,
  compareOtpHash,
};
