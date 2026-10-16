/**
 * Crypto Utility
 * - สร้าง OTP code (numeric)
 * - Hash OTP ก่อนเก็บลง DB (HMAC-SHA256)
 * - Compare OTP แบบ constant-time เพื่อกัน timing attack
 */
const crypto = require('crypto');
const config = require('../config');

/**
 * สร้าง OTP เป็นตัวเลขล้วน
 * ใช้ crypto.randomInt (cryptographically secure, ไม่ใช้ Math.random)
 *
 * เรียกจาก: services/AuthService (_issueOtpForUser ตอน login และ requestPasswordReset) — ค่า plain ส่งทางอีเมล ส่วนที่เก็บลง DB คือ hashOtp(otp)
 * @param {number} [length] จำนวนหลัก (ค่าเริ่มต้น config.otp.length)
 * @returns {string} เช่น '483920'
 */
function generateOtp(length = config.otp.length) {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length);
  return crypto.randomInt(min, max).toString();
}

// key สำหรับ HMAC ของ OTP — derive จาก JWT_SECRET แบบแยกโดเมน (ไม่ใช้ secret ตัวเดียวกับที่เซ็น token ตรงๆ)
// และไม่ต้องเพิ่ม env ใหม่ตอน deploy
const OTP_HMAC_KEY = crypto.createHmac('sha256', config.jwt.secret).update('otp-hash:v1').digest();

/**
 * Hash OTP ด้วย HMAC-SHA256 (key ฝั่งเซิร์ฟเวอร์)
 * OTP 6 หลักมีแค่ 10^6 ค่า ถ้าใช้ SHA-256 ล้วน ใครได้ตาราง otp_requests ไปไล่เดาเจอทั้งหมดในพริบตา
 * HMAC ทำให้ต้องมี secret ด้วยจึงจะไล่ได้ — ไม่ใช้ bcrypt เพราะ ~250ms ต่อ verify ไม่คุ้ม
 * (ความปลอดภัยหลักมาจาก expiry 10 นาที + จำกัดจำนวนครั้งที่ลอง)
 * หมายเหตุ: OTP ที่ออกก่อนเปลี่ยนมาใช้ HMAC จะ verify ไม่ผ่าน (อายุ ≤ 10 นาที) ผู้ใช้ขอ OTP ใหม่ได้
 *
 * เรียกจาก: services/AuthService ก่อนส่งให้ models/OtpModel บันทึกลง otp_requests.otp_hash
 * @param {string|number} otp รหัสแบบ plain
 * @returns {string} hex 64 ตัว
 */
function hashOtp(otp) {
  return crypto.createHmac('sha256', OTP_HMAC_KEY).update(String(otp)).digest('hex');
}

/**
 * เปรียบเทียบ hash แบบ constant-time
 * ป้องกัน timing attack ที่อาจเดา hash ได้จากเวลาที่ใช้
 *
 * เรียกจาก: services/AuthService (ขั้น verify OTP ของ login และ reset-password) — เอา hash จากแถวใน DB มาเทียบกับรหัสที่ผู้ใช้กรอก
 * @param {string} plainOtp รหัสที่ผู้ใช้ส่งมา
 * @param {string} hashedOtp hash ที่เก็บใน DB
 * @returns {boolean}
 */
function compareOtpHash(plainOtp, hashedOtp) {
  const computed = hashOtp(plainOtp);
  if (typeof hashedOtp !== 'string' || computed.length !== hashedOtp.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hashedOtp));
}

module.exports = {
  generateOtp,
  hashOtp,
  compareOtpHash,
};
