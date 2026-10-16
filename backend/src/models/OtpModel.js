const db = require('../config/database');

/**
 * Data access ของตาราง otp_requests — เก็บเฉพาะ hash ของ OTP (hash ด้วย utils/crypto.hashOtp)
 * purpose ที่ใช้อยู่: 'login_2fa' (ตอน login ของ Admin) และ 'password_reset'
 * ผู้ใช้หลักคือ services/AuthService · เรียกเพิ่มจาก AdminController (ล้าง OTP รีเซ็ตรหัสผ่านค้างเมื่ออีเมลของบัญชีถูกเปลี่ยน) และ server.js (deleteExpired ทุก 1 ชม.)
 */
class OtpModel {
  /**
   * บันทึก OTP ใหม่ — เรียกจาก: AuthService._issueOtpForUser, AuthService.requestPasswordReset
   * @param {{userId:number, otpHash:string, purpose:string, expiresAt:Date}} p
   * @returns {Promise<number>} otp_id
   */
  static async create({ userId, otpHash, purpose, expiresAt }) {
    const [result] = await db.query(
      `INSERT INTO otp_requests
          (user_id, otp_hash, purpose, expires_at)
       VALUES (?, ?, ?, ?)`,
      [userId, otpHash, purpose, expiresAt]
    );
    return result.insertId;
  }

  /**
   * หา OTP ล่าสุดที่ยังไม่ถูกใช้และยังไม่หมดอายุ — เรียกจาก: AuthService.verifyOtp, AuthService.resetPassword
   * @returns {Promise<{otp_id:number, otp_hash:string, expires_at:Date, attempt_count:number}|null>}
   */
  static async findActive(userId, purpose) {
    const [rows] = await db.query(
      `SELECT otp_id, otp_hash, expires_at, attempt_count
         FROM otp_requests
        WHERE user_id = ?
          AND purpose = ?
          AND used_at IS NULL
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId, purpose]
    );
    return rows[0] || null;
  }

  /**
   * จำนวนวินาทีนับจาก OTP ล่าสุดของ purpose นี้ (null = ไม่เคยออก) — ใช้ทำ cooldown ต่อบัญชี
   *
   * เรียกจาก: AuthService.resendOtp, AuthService.requestPasswordReset (เทียบกับ OTP_RESEND_COOLDOWN_SECONDS = 60)
   * @returns {Promise<number|null>}
   */
  static async secondsSinceLast(userId, purpose) {
    const [rows] = await db.query(
      `SELECT TIMESTAMPDIFF(SECOND, MAX(created_at), NOW()) AS secs
         FROM otp_requests
        WHERE user_id = ? AND purpose = ?`,
      [userId, purpose]
    );
    return rows[0]?.secs ?? null;
  }

  /**
   * ใช้ OTP — คืน true เฉพาะ request แรกที่ใช้สำเร็จ (กันกรอก OTP ถูกพร้อมกันแล้วได้ token 2 ชุด)
   *
   * เรียกจาก: AuthService.verifyOtp (หลัง OTP ถูก, หรือหลังลองเกินจำนวนเพื่อปิดใบนี้), AuthService.resetPassword
   * @param {number} otpId
   * @returns {Promise<boolean>}
   */
  static async markAsUsed(otpId) {
    const [result] = await db.query(
      `UPDATE otp_requests SET used_at = NOW() WHERE otp_id = ? AND used_at IS NULL`,
      [otpId]
    );
    return result.affectedRows === 1;
  }

  /**
   * จองสิทธิ์ลอง OTP 1 ครั้งแบบ atomic — ต้องเรียกก่อนเทียบ OTP ทุกครั้ง
   * คืน false ถ้าใช้ครบ maxAttempts แล้ว (ยิงพร้อมกันกี่ request ก็ได้ลองไม่เกิน maxAttempts)
   *
   * เรียกจาก: AuthService.verifyOtp, AuthService.resetPassword — ก่อน compareOtpHash ทุกครั้ง
   * @param {number} otpId
   * @param {number} maxAttempts ค่า config.otp.maxAttempts
   * @returns {Promise<boolean>} false = ลองครบแล้ว (ผู้เรียกปิด OTP และตอบ OTP_MAX_ATTEMPTS)
   */
  static async consumeAttempt(otpId, maxAttempts) {
    const [result] = await db.query(
      `UPDATE otp_requests SET attempt_count = attempt_count + 1
        WHERE otp_id = ? AND used_at IS NULL AND attempt_count < ?`,
      [otpId, maxAttempts]
    );
    return result.affectedRows === 1;
  }


  /**
   * ทำให้ OTP ที่ยังค้างอยู่ของ user+purpose ใช้ไม่ได้ (ตั้ง used_at)
   * เรียกจาก: AuthService._issueOtpForUser / requestPasswordReset (ก่อนออกใบใหม่) และ AdminController.updateUser / updateAdmin (เมื่อเปลี่ยน msu_mail ต้องทิ้ง OTP 'password_reset' ที่ส่งไปอีเมลเก่า)
   * @param {number} userId
   * @param {string} purpose
   */
  static async invalidateActive(userId, purpose) {
    await db.query(
      `UPDATE otp_requests
          SET used_at = NOW()
        WHERE user_id = ?
          AND purpose = ?
          AND used_at IS NULL`,
      [userId, purpose]
    );
  }

  /**
   * ลบ OTP ที่ไม่มีประโยชน์แล้วออก (cleanup กัน DB บวม) — ลบทั้งแถวที่หมดอายุ
   * (ไม่ว่าจะเคยใช้หรือไม่) และแถวที่ใช้ไปแล้วนานพอ (เผื่อ retention สำหรับ debug)
   *
   * เรียกจาก: server.js runCleanup (ทุก 1 ชั่วโมง)
   * @returns {Promise<number>} จำนวนแถวที่ลบ
   */
  static async deleteExpired() {
    const RETENTION_DAYS = 7; // ponytail: ตัวเลขเผื่อ debug ย้อนหลัง ปรับได้ถ้าต้องการ
    const [result] = await db.query(
      `DELETE FROM otp_requests
        WHERE expires_at < NOW()
           OR (used_at IS NOT NULL AND used_at < DATE_SUB(NOW(), INTERVAL ? DAY))`,
      [RETENTION_DAYS]
    );
    return result.affectedRows;
  }
}

module.exports = OtpModel;