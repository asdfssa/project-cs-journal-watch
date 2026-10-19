/**
 * User Model
 * Data access layer สำหรับ table `users`
 * ใช้ fully-qualified table name เพื่อหลีกเลี่ยงปัญหา session-level database
 */
const db = require('../config/database');
const { likeContains } = require('../utils/input');

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

  /**
   * อาจารย์ที่ปรึกษาที่ active ของนิสิตพร้อมชื่อ/role/สถานะบัญชี (ใช้ตรวจสิทธิ์ยื่นคำขอและสร้างแถวอนุมัติ)
   * เรียกจาก: PreT3Controller.submit, T3Controller (ตอนยื่น T3)
   * @param {number} studentId
   * @returns {Promise<object[]>} แต่ละแถวมี advisor_id, advisor_type, prefix, first_name, last_name, role, account_status
   */
  static async findActiveAdvisorAssignments(studentId) {
    const [rows] = await db.query(
      `SELECT aa.advisor_id, aa.advisor_type,
                u.prefix, u.first_name, u.last_name, u.role, u.account_status
           FROM advisor_assignments aa
           JOIN users u ON u.user_id = aa.advisor_id
          WHERE aa.student_id = ? AND aa.is_active = TRUE`,
      [studentId]
    );
    return rows;
  }

  /**
   * อีเมลของ Staff ที่ Active ทุกคน (ใช้ส่งแจ้งเตือนว่ามีคำขอรอฝ่ายคณะ) · เรียกจาก: PreT3Controller, T3Controller
   * @returns {Promise<{msu_mail:string}[]>}
   */
  static async findActiveStaffMails() {
    const [rows] = await db.query(
      `SELECT msu_mail FROM users WHERE role = 'Staff' AND account_status = 'Active'`
    );
    return rows;
  }

  /** แก้ช่องทางติดต่อของผู้ใช้ (ค่าว่างเป็น null แล้ว) · เรียกจาก: UserController.updateProfile */
  static async updateContact(userId, { phone, facebook_id, line_id }) {
    await db.query(
      `UPDATE users
            SET phone       = ?,
                facebook_id = ?,
                line_id     = ?
          WHERE user_id = ?`,
      [phone, facebook_id, line_id, userId]
    );
  }

  /**
   * รายชื่อ Staff ที่ Active พร้อมช่องทางติดต่อ ค้นด้วยชื่อ/นามสกุล/อีเมลได้ · เรียกจาก: UserController.getStaffDirectory
   * @param {string} [search]
   */
  static async findActiveStaff(search) {
    const where = [
      "u.role = 'Staff'",
      "u.account_status = 'Active'",
    ];
    const params = [];

    if (search) {
      where.push('(u.first_name LIKE ? OR u.last_name LIKE ? OR u.msu_mail LIKE ?)');
      const like = likeContains(search);
      params.push(like, like, like);
    }

    const whereSQL = where.join(' AND ');

    const [rows] = await db.query(
      `SELECT
           u.user_id,
           u.prefix,
           u.first_name,
           u.last_name,
           u.department,
           u.msu_mail,
           u.phone,
           u.facebook_id,
           u.line_id
         FROM users u
         WHERE ${whereSQL}
         ORDER BY u.first_name ASC, u.last_name ASC`,
      params
    );
    return rows;
  }

}

module.exports = UserModel;