/**
 * User Model
 * Data access layer สำหรับ table `users`
 * ใช้ fully-qualified table name เพื่อหลีกเลี่ยงปัญหา session-level database
 */
const db = require('../config/database');

class UserModel {
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

  static async createPendingStaff({ msuMail, firstName, lastName }) {
    await db.query(
      `INSERT INTO users
         (msu_mail, role, first_name, last_name, account_status)
       VALUES (?, 'Staff', ?, ?, 'Pending')`,
      [msuMail, firstName, lastName]
    );
  }

  static async updatePassword(userId, passwordHash) {
    await db.query(
      `UPDATE users SET password_hash = ? WHERE user_id = ?`,
      [passwordHash, userId]
    );
  }

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