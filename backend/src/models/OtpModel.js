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

  static async markAsUsed(otpId) {
    await db.query(
      `UPDATE otp_requests SET used_at = NOW() WHERE otp_id = ?`,
      [otpId]
    );
  }

  static async incrementAttempts(otpId) {
    await db.query(
      `UPDATE otp_requests SET attempt_count = attempt_count + 1 WHERE otp_id = ?`,
      [otpId]
    );
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