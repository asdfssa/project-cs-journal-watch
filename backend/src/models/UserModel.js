/**
 * User Model
 * Data access layer สำหรับ table `users`
 * ใช้ fully-qualified table name เพื่อหลีกเลี่ยงปัญหา session-level database
 */
const db = require('../config/database');

class UserModel {
  /**
   * ค้นผู้ใช้ด้วย username (รวม password_hash สำหรับตรวจรหัสผ่าน — ห้ามส่งออกไปทาง response)
   * เรียกจาก: AuthService.login, AuthService.requestPasswordReset
   * @param {string} username
   * @returns {Promise<object|null>}
   */
  static async findByUsername(username) {
    const [rows] = await db.query(
      `SELECT user_id, username, password_hash, msu_mail, role, first_name, last_name,
              account_status
         FROM users
        WHERE username = ?
        LIMIT 1`,
      [username.toLowerCase()]
    );
    return rows[0] || null;
  }

/**
 * ค้นผู้ใช้ด้วย user_id (ข้อมูลโปรไฟล์/สถานะ ไม่มี password_hash)
 * เรียกจาก: AuthService (verifyOtp, resendOtp, refreshToken, _refreshWithinGrace, resetPassword), AuthController.me, UserController.getProfile/updateProfile,
 *   PreT3Controller + T3Controller (ดึงข้อมูลนิสิต/อาจารย์ที่ปรึกษาเพื่อทำ snapshot และส่งอีเมลแจ้งเตือน)
 * @param {number} userId
 * @returns {Promise<object|null>}
 */
static async findById(userId) {
  const [rows] = await db.query(
    `SELECT user_id, username, msu_mail, role, prefix,
            first_name, last_name, department,
            degree_level, study_plan_code, curriculum_year,
            phone, facebook_id, line_id,
            account_status
       FROM users
      WHERE user_id = ?
      LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}
  /**
   * ค้นผู้ใช้ด้วยอีเมล มมส. (ใช้ตอน login/สมัครด้วย Google)
   * เรียกจาก: AuthService.googleLogin, AuthService.registerStaff
   * @param {string} msuMail
   * @returns {Promise<object|null>}
   */
  static async findByMsuMail(msuMail) {
    const [rows] = await db.query(
      `SELECT user_id, username, msu_mail,
              role, first_name, last_name,
              degree_level, account_status
         FROM users
        WHERE msu_mail = ?
        LIMIT 1`,
      [msuMail.toLowerCase()]
    );
    return rows[0] || null;
  }

  /**
   * สร้างบัญชี Staff สถานะ Pending (รอ Admin อนุมัติ) — ไม่มี username/password เพราะ Staff เข้าทาง Google
   * เรียกจาก: AuthService.registerStaff
   * @param {{msuMail:string, firstName:string, lastName:string}} p
   */
  static async createPendingStaff({ msuMail, firstName, lastName }) {
    await db.query(
      `INSERT INTO users
         (msu_mail, role, first_name, last_name, account_status)
       VALUES (?, 'Staff', ?, ?, 'Pending')`,
      [msuMail, firstName, lastName]
    );
  }

  /**
   * ตั้ง password_hash ใหม่ (ผู้เรียกต้อง bcrypt มาแล้ว)
   * เรียกจาก: AuthService.resetPassword
   * @param {number} userId
   * @param {string} passwordHash
   */
  static async updatePassword(userId, passwordHash) {
    await db.query(
      `UPDATE users SET password_hash = ? WHERE user_id = ?`,
      [passwordHash, userId]
    );
  }

  /**
   * รายชื่ออาจารย์ที่ปรึกษาที่ active ของนิสิต เรียง Major → Co_1 → Co_2 (join advisor_assignments กับ users)
   * เรียกจาก: AuthController.me, UserController.getProfile (เมื่อ role เป็น Student)
   * @param {number} studentId
   * @returns {Promise<object[]>} แต่ละแถวมี advisor_type, user_id, prefix, first_name, last_name, msu_mail, role
   */
  static async findAdvisorsByStudentId(studentId) {
  const [rows] = await db.query(
    `SELECT aa.advisor_type,
            u.user_id, u.prefix, u.first_name, u.last_name,
            u.msu_mail, u.role
       FROM advisor_assignments aa
       JOIN users u ON u.user_id = aa.advisor_id
      WHERE aa.student_id = ?
        AND aa.is_active = TRUE
      ORDER BY FIELD(aa.advisor_type, 'Major', 'Co_1', 'Co_2')`,
    [studentId]
  );
  return rows;
}

}

module.exports = UserModel;