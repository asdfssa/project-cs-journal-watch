/**
 * RefreshTokenModel
 * จัดการ refresh token โดยใช้ table `auth_tokens` (token_type = 'Refresh')
 * auth_tokens รวม refresh_tokens + password_reset_tokens เดิมเข้าด้วยกัน
 * โดยใช้ `consumed_at` แทน revoked_at/used_at (NULL = ยังใช้ได้)
 */
const db = require('../config/database');

class RefreshTokenModel {

  /**
   * บันทึก refresh token ใหม่ลง DB
   */
  static async create({ userId, tokenHash, expiresAt }) {
    const [result] = await db.query(
      `INSERT INTO auth_tokens
        (user_id, token_type, token_hash, expires_at)
       VALUES (?, 'Refresh', ?, ?)`,
      [userId, tokenHash, expiresAt]
    );
    return result.insertId;
  }

  /**
   * หา token จาก hash — ใช้ตอน verify refresh
   */
  static async findByHash(tokenHash) {
    const [rows] = await db.query(
      `SELECT token_id, user_id, token_hash, expires_at
         FROM auth_tokens
        WHERE token_hash = ?
          AND token_type = 'Refresh'
          AND consumed_at IS NULL
          AND expires_at > NOW()
        LIMIT 1`,
      [tokenHash]
    );
    return rows[0] || null;
  }

  /**
   * Revoke token เดียว (logout)
   */
  static async revokeByHash(tokenHash) {
    await db.query(
      `UPDATE auth_tokens
       SET consumed_at = NOW()
       WHERE token_hash = ? AND token_type = 'Refresh'`,
      [tokenHash]
    );
  }

  /**
   * Revoke ทุก token ของ user (logout all devices)
   */
  static async revokeAllByUserId(userId) {
    await db.query(
      `UPDATE auth_tokens
       SET consumed_at = NOW()
       WHERE user_id = ? AND token_type = 'Refresh' AND consumed_at IS NULL`,
      [userId]
    );
  }

  /**
   * ลบ token ที่หมดอายุแล้วออก (cleanup)
   */
  static async deleteExpired() {
    const [result] = await db.query(
      `DELETE FROM auth_tokens
       WHERE token_type = 'Refresh' AND expires_at < NOW()`
    );
    return result.affectedRows;
  }
}

module.exports = RefreshTokenModel;
