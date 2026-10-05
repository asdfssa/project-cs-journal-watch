const db = require('../config/database');

class OtpModel {
  static async create({ userId, otpHash, purpose, expiresAt }) {
    const [result] = await db.query(
      `INSERT INTO otp_requests
          (user_id, otp_hash, purpose, expires_at)
       VALUES (?, ?, ?, ?)`,
      [userId, otpHash, purpose, expiresAt]
    );
    return result.insertId;
  }

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
   * ใช้ OTP — คืน true เฉพาะ request แรกที่ใช้สำเร็จ (กันกรอก OTP ถูกพร้อมกันแล้วได้ token 2 ชุด)
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
   */
  static async consumeAttempt(otpId, maxAttempts) {
    const [result] = await db.query(
      `UPDATE otp_requests SET attempt_count = attempt_count + 1
        WHERE otp_id = ? AND used_at IS NULL AND attempt_count < ?`,
      [otpId, maxAttempts]
    );
    return result.affectedRows === 1;
  }


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