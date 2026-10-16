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
   *
   * เรียกจาก: AuthService.verifyOtp, googleLogin, refreshToken (ทุกครั้งที่ออก refresh token ใหม่)
   * @param {{userId:number, tokenHash:string, expiresAt:Date}} p hash มาจาก jwtUtil.issueRefreshToken
   * @returns {Promise<number>} token_id
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
   *
   * เรียกจาก: AuthService.refreshToken — เจอเฉพาะ token ที่ยังไม่ถูก consume และยังไม่หมดอายุ
   * @param {string} tokenHash
   * @returns {Promise<{token_id:number, user_id:number}|null>}
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
   * หา token ที่เพิ่งถูก rotate ภายใน graceSeconds และยังไม่ถูก logout/revoke
   * (logout/revoke ตั้ง expires_at = NOW() จึงหลุดเงื่อนไขนี้) — ใช้กับ refresh ซ้อนจาก 2 แท็บ
   *
   * เรียกจาก: AuthService._refreshWithinGrace
   * @param {string} tokenHash
   * @param {number} graceSeconds
   * @returns {Promise<{token_id:number, user_id:number}|null>}
   */
  static async findRecentlyRotated(tokenHash, graceSeconds) {
    const [rows] = await db.query(
      `SELECT token_id, user_id
         FROM auth_tokens
        WHERE token_hash = ?
          AND token_type = 'Refresh'
          AND consumed_at > NOW() - INTERVAL ? SECOND
          AND expires_at > NOW()
        LIMIT 1`,
      [tokenHash, graceSeconds]
    );
    return rows[0] || null;
  }

  /**
   * Rotate token เดียว — คืน true เฉพาะ request แรกที่ revoke สำเร็จ
   * (ไม่แตะ expires_at เพื่อให้ findRecentlyRotated ผ่อนผัน request ที่ยิงซ้อนได้)
   *
   * เรียกจาก: AuthService.refreshToken (ขั้น rotate) · false = มี request อื่นใช้ token นี้ไปแล้ว
   * @param {string} tokenHash
   * @returns {Promise<boolean>}
   */
  static async revokeByHash(tokenHash) {
    const [result] = await db.query(
      `UPDATE auth_tokens
       SET consumed_at = NOW()
       WHERE token_hash = ? AND token_type = 'Refresh' AND consumed_at IS NULL`,
      [tokenHash]
    );
    return result.affectedRows > 0;
  }

  /**
   * Revoke ถาวร (logout / บัญชีถูกระงับ) — ตั้ง expires_at = NOW() ด้วย เพื่อปิดช่วงผ่อนผันของ rotate
   *
   * เรียกจาก: AuthService.logout, AuthService.refreshToken (เมื่อบัญชีถูกระงับ)
   * @param {string} tokenHash
   */
  static async revokeForLogout(tokenHash) {
    await db.query(
      `UPDATE auth_tokens
       SET consumed_at = COALESCE(consumed_at, NOW()), expires_at = NOW()
       WHERE token_hash = ? AND token_type = 'Refresh' AND expires_at > NOW()`,
      [tokenHash]
    );
  }

  /**
   * Revoke ทุก token ของ user (logout all devices) — รวม token ที่เพิ่ง rotate (ปิดช่วงผ่อนผัน)
   *
   * เรียกจาก: AuthService.resetPassword (หลังเปลี่ยนรหัสผ่าน) และ AdminController.updateAdmin (เมื่อเปลี่ยนอีเมลของแอดมิน ตัดทุก session ของเจ้าของ)
   * @param {number} userId
   */
  static async revokeAllByUserId(userId) {
    await db.query(
      `UPDATE auth_tokens
       SET consumed_at = COALESCE(consumed_at, NOW()), expires_at = NOW()
       WHERE user_id = ? AND token_type = 'Refresh' AND expires_at > NOW()`,
      [userId]
    );
  }

  /**
   * ลบ token ที่หมดอายุแล้วออก (cleanup)
   *
   * เรียกจาก: server.js runCleanup (ทุก 1 ชั่วโมง)
   * @returns {Promise<number>} จำนวนแถวที่ลบ
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
