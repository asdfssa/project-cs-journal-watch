/**
 * UserController
 * จัดการ request/response สำหรับ user ทั่วไป (ดูและแก้ไขโปรไฟล์ตัวเอง)
 *
 * Endpoints:
 *   GET   /api/user/profile        → ดูโปรไฟล์ตัวเอง (ทุก role)
 *   PATCH /api/user/profile        → แก้ไขโปรไฟล์ตัวเอง (ทุก role)
 *                                    แก้ได้เฉพาะ: phone, facebook_id, line_id
 *   GET   /api/user/staff          → รายชื่อบุคลากร Staff พร้อมช่องทางติดต่อ (ทุก role)
 */
const db        = require('../config/database');
const UserModel = require('../models/UserModel');
const { serverError } = require('../utils/errorResponse');
const { nonScalarField } = require('../utils/input');

class UserController {

  // ============================================================
  // GET /api/user/profile
  // Role: Student, Supervisor, Staff, Admin, SuperAdmin
  // ============================================================
  static async getProfile(req, res, next) {
    try {
      const userId = req.user.sub;

      const user = await UserModel.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, code: 'USER_NOT_FOUND', message: 'ไม่พบข้อมูลผู้ใช้' });
      }

      // Base data — ทุก role
      const data = {
        userId:        user.user_id,
        role:          user.role,
        prefix:        user.prefix        || null,
        firstName:     user.first_name,
        lastName:      user.last_name,
        department:    user.department     || null,
        msuMail:       user.msu_mail,
        phone:         user.phone         || null,
        facebookId:    user.facebook_id   || null,
        lineId:        user.line_id       || null,
        accountStatus: user.account_status,
      };

      // Admin / SuperAdmin — เพิ่ม username
      if (['Admin', 'SuperAdmin'].includes(user.role)) {
        data.username = user.username || null;
      }

      // Student — เพิ่ม degree info + advisors
      if (user.role === 'Student') {
        data.degreeLevel    = user.degree_level    || null;
        data.curriculumYear = user.curriculum_year || null;
        data.studyPlanCode  = user.study_plan_code || null;

        const advisorRows = await UserModel.findAdvisorsByStudentId(user.user_id);
        data.advisors = advisorRows.map(a => ({
          advisorType: a.advisor_type,
          userId:      a.user_id,
          prefix:      a.prefix    || null,
          firstName:   a.first_name,
          lastName:    a.last_name,
          msuMail:     a.msu_mail,
        }));
      }

      return res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  // ============================================================
  // PATCH /api/user/profile
  // Role: Student, Supervisor, Staff, Admin, SuperAdmin
  // Body: { phone?, facebook_id?, line_id? }
  //
  // แก้ได้เฉพาะ: phone, facebook_id, line_id
  // field อื่น (prefix, first_name, last_name, msu_mail, degree_level ฯลฯ)
  // ต้องติดต่อ Admin ผ่าน PATCH /api/manage/users/:id
  // ============================================================
  static async updateProfile(req, res, next) {
    try {
      const userId = req.user.sub;

      const user = await UserModel.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, code: 'USER_NOT_FOUND', message: 'ไม่พบข้อมูลผู้ใช้' });
      }

      const badField = nonScalarField(req.body, ['phone', 'facebook_id', 'line_id']);
      if (badField) return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: `${badField} รูปแบบไม่ถูกต้อง` });

      const { phone, facebook_id, line_id } = req.body;

      // Merge: ถ้า field ไม่ได้ส่งมา ใช้ค่าเดิม
      const merged = {
        phone:       phone       !== undefined ? phone       : user.phone,
        facebook_id: facebook_id !== undefined ? facebook_id : user.facebook_id,
        line_id:     line_id     !== undefined ? line_id     : user.line_id,
      };

      await db.query(
        `UPDATE users
            SET phone       = ?,
                facebook_id = ?,
                line_id     = ?
          WHERE user_id = ?`,
        [
          merged.phone       || null,
          merged.facebook_id || null,
          merged.line_id     || null,
          userId,
        ]
      );

      return res.json({
        success: true,
        message: 'แก้ไขข้อมูลเรียบร้อยแล้ว',
      });
    } catch (err) {
      next(err);
    }
  }

  // ============================================================
  // GET /api/user/staff
  // Role: ทุก role ที่ login แล้ว
  // แสดงรายชื่อบุคลากร Staff พร้อมช่องทางติดต่อ (สำหรับ Frontend แสดงหน้าบุคลากร)
  // ============================================================
  static async getStaffDirectory(req, res, next) {
    try {
      const { search } = req.query;

      let where = [
        "u.role = 'Staff'",
        "u.account_status = 'Active'",
      ];
      const params = [];

      if (search) {
        where.push('(u.first_name LIKE ? OR u.last_name LIKE ? OR u.msu_mail LIKE ?)');
        const like = `%${search}%`;
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

      const staff = rows.map(u => ({
        userId:     u.user_id,
        prefix:     u.prefix      || null,
        firstName:  u.first_name,
        lastName:   u.last_name,
        department: u.department  || null,
        msuMail:    u.msu_mail,
        phone:      u.phone       || null,
        facebookId: u.facebook_id || null,
        lineId:     u.line_id     || null,
      }));

      return res.json({ success: true, data: { staff, total: staff.length } });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = UserController;