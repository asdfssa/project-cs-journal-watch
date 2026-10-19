/**
 * Admin Controller
 * รับ HTTP request → ตรวจข้อมูล → เรียก model (AdminUserModel/AdminStatsModel) → ส่ง response
 * เฉพาะ Admin และ SuperAdmin เท่านั้น
 */
const AdminStatsModel = require('../models/AdminStatsModel');
const AdminUserModel  = require('../models/AdminUserModel');
const config      = require('../config');
const { phoneError, parsePagination, nonStringField, nonScalarField } = require('../utils/input');

// field ของผู้ใช้ที่ลง SQL ตรงๆ แต่ไม่บังคับว่าต้องเป็นข้อความ — ห้ามเป็น object/array (B45)
// CSV import: จำกัดจำนวนแถว + ค่า enum ที่คอลัมน์ users รับ (ผิด → แจ้งรายแถว ไม่ปล่อยไปชน MySQL แล้ว 500 ทั้งก้อน)
const MAX_IMPORT_ROWS = 2000;
const DEGREE_LEVELS = ['Master', 'Doctoral'];
const CURRICULUM_YEARS = ['2560', '2566'];
const STUDY_PLAN_CODES = [
  'Master_A1', 'Master_A2', 'Master_B', 'Master_P1A1', 'Master_P1A2', 'Master_P2B',
  'Doc_1_1', 'Doc_1_2', 'Doc_2_1', 'Doc_2_2', 'Doc_P1_1_1', 'Doc_P1_1_2', 'Doc_P2_2_1', 'Doc_P2_2_2',
];
// สาขาวิชาของนิสิต (users.department เป็น ENUM) — ปริญญาเอกมีเฉพาะ 3 สาขาแรก
const DOCTORAL_DEPARTMENTS = ['วิทยาการคอมพิวเตอร์', 'เทคโนโลยีสารสนเทศ', 'สื่อนฤมิต'];
const DEPARTMENTS = [...DOCTORAL_DEPARTMENTS, 'สารสนเทศและนวัตกรรมดิจิทัล', 'นิเทศศาสตร์สร้างสรรค์ดิจิทัล'];
/**
 * ตรวจชื่อสาขาวิชาของนิสิตให้อยู่ในรายการ DEPARTMENTS และปริญญาเอกต้องอยู่ใน DOCTORAL_DEPARTMENTS
 * เรียกจาก: AdminController.updateUser, createUser, importUsers (เฉพาะแถวที่เป็น Student)
 * @param {string|null} department
 * @param {string|null} degreeLevel 'Master' | 'Doctoral'
 * @returns {string|null} ข้อความ error (ผู้เรียกตอบ 400) · null = ผ่าน
 */
// คืนข้อความ error หรือ null ถ้าผ่าน (ไม่ระบุสาขา = ผ่าน)
function departmentError(department, degreeLevel) {
  if (!department) return null;
  if (!DEPARTMENTS.includes(department))
    return `department "${department}" ไม่ถูกต้อง (ใช้ ${DEPARTMENTS.join(' / ')})`;
  if (degreeLevel === 'Doctoral' && !DOCTORAL_DEPARTMENTS.includes(department))
    return `สาขา "${department}" ไม่มีในระดับปริญญาเอก (ใช้ ${DOCTORAL_DEPARTMENTS.join(' / ')})`;
  return null;
}
/**
 * รหัสแผนการศึกษาต้องตรงกับระดับ: Master ใช้ Master_..., Doctoral ใช้ Doc_...
 * เรียกจาก: AdminController.updateUser, createUser, importUsers (เฉพาะแถวที่เป็น Student)
 * @returns {string|null} ข้อความ error (ผู้เรียกตอบ 400) · null = ผ่าน (ไม่ระบุรหัสหรือระดับ = ผ่าน เหมือน departmentError)
 */
function studyPlanError(studyPlanCode, degreeLevel) {
  const prefix = { Master: 'Master_', Doctoral: 'Doc_' }[degreeLevel];
  if (!studyPlanCode || !prefix) return null;
  if (String(studyPlanCode).startsWith(prefix)) return null;
  return `study_plan_code "${studyPlanCode}" ไม่ตรงกับ degree_level ${degreeLevel} (ปริญญาโทใช้ Master_..., ปริญญาเอกใช้ Doc_...)`;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/**
 * ตรวจรูปแบบอีเมลและโดเมนต้องอยู่ใน config.google.allowedDomains (ไม่งั้นผู้ใช้ล็อกอินด้วย Google ไม่ได้)
 * เรียกจาก: AdminController.updateUser (เมื่ออีเมลเปลี่ยน), createUser, importUsers (ทุกแถว)
 * @param {string} raw อีเมลตามที่ผู้ใช้กรอก
 * @returns {string|null} ข้อความ error · null = ผ่าน
 */
// อีเมลผู้ใช้ (Student/Supervisor) ต้องเป็นรูปแบบอีเมลและอยู่ในโดเมนที่ล็อกอินด้วย Google ได้ (GOOGLE_ALLOWED_DOMAIN)
// ไม่งั้นสร้างบัญชีที่ล็อกอินไม่ได้ (เช่นพิมพ์แค่รหัสนิสิตไม่มี @โดเมน) คืนข้อความ error หรือ null ถ้าผ่าน
function msuMailError(raw) {
  const mail = String(raw ?? '').toLowerCase().trim();
  if (!EMAIL_RE.test(mail)) return `รูปแบบ msu_mail ไม่ถูกต้อง (${raw}) ต้องมี @ และโดเมน เช่น name@${config.google.allowedDomain}`;
  const domain = mail.split('@')[1];
  if (!config.google.allowedDomains.map(d => d.toLowerCase()).includes(domain))
    return `โดเมนของ msu_mail ไม่ได้รับอนุญาต (${raw}) ต้องเป็น @${config.google.allowedDomains.join(' หรือ @')}`;
  return null;
}
const USER_SCALAR_FIELDS = ['prefix', 'phone', 'facebook_id', 'line_id', 'degree_level', 'curriculum_year', 'study_plan_code', 'department'];
const MailService = require('../services/MailService');
const OtpModel    = require('../models/OtpModel');
const RefreshTokenModel = require('../models/RefreshTokenModel');
const bcryptjs    = require('bcryptjs');

/**
 * กฎ: Staff จัดการได้เฉพาะ Student/Supervisor — ถ้าผู้ทำเป็น Staff และเป้าหมายเป็น Staff ด้วยให้ปฏิเสธ (ต้องให้ Admin ทำ)
 * เรียกจาก: AdminController.suspendUser, activateUser, updateUser
 * @param {import('express').Request} req ใช้ req.user.role
 * @param {{role:string}} target แถวผู้ใช้ที่ถูกแตะ
 */
// Staff จัดการได้เฉพาะ Student/Supervisor — แก้/ระงับ/คืนสถานะ Staff คนอื่นต้องเป็น Admin
const staffTouchingStaff = (req, target) => req.user.role === 'Staff' && target.role === 'Staff';
/**
 * ทำให้อีเมลเป็นรูปเทียบกันได้ (trim + ตัวพิมพ์เล็ก) · เรียกจาก: updateUser, updateAdvisors, updateAdmin
 */
const mailOf = (v) => String(v ?? '').trim().toLowerCase();

/**
 * Controller ฝั่งผู้ดูแล — ผูกใน 2 router: routes/adminRoutes.js (/api/v3/admin: stats + จัดการ Admin, เฉพาะ Admin/SuperAdmin)
 *   และ routes/userManageRoutes.js (/api/v3/manage/users: จัดการผู้ใช้ทั่วไป, Admin/SuperAdmin/Staff — approve จำกัด Admin/SuperAdmin)
 * ทุก method อ่านผู้ทำจาก req.user (sub, role) ที่ requireAuth ใส่ไว้ และ req.params.id ที่ requireNumericId ตรวจแล้ว
 * ข้อมูลอ่าน/เขียนผ่าน models/AdminUserModel (users/advisor_assignments/request_approvals) และ models/AdminStatsModel · error ส่ง next(err) ไป middlewares/errorHandler
 * ผลข้างเคียงที่ออกนอกตาราง: OtpModel / RefreshTokenModel (ตัด OTP และ session เมื่อเปลี่ยนอีเมลบัญชี), MailService (อีเมลแจ้งอนุมัติ)
 */
class AdminController {

  /**
   * เรียกจาก: routes/adminRoutes.js — GET /stats (Admin, SuperAdmin) · ใช้แสดงหน้า dashboard ของผู้ดูแล
   * รวมสถิติด้วย query ขนานกัน: จำนวนผู้ใช้ตาม role/สถานะ, Pre-T3 และ T3 ตามสถานะ, จำนวนวารสารไม่พึงประสงค์
   * และสถานะ Scopus API key จาก ScopusProxyService.getStatus() (ถ้าดึงไม่ได้ ตอบรายการว่าง)
   */
  // ============================================================
  // GET /api/admin/stats
  // ============================================================
  static async getStats(req, res, next) {
    try {
      const { users: userRow, preT3: preT3Row, t3: t3Row, unwanted: unwantedRow } = await AdminStatsModel.getOverview();

      let apiKeyStats = [];
      try {
        const scopusProxy = require('../services/ScopusProxyService');
        apiKeyStats = scopusProxy.getStatus();
      } catch (_) {}

      return res.json({
        success: true,
        data: {
          users: {
            total:       Number(userRow.total),
            students:    Number(userRow.students),
            supervisors: Number(userRow.supervisors),
            staff:       Number(userRow.staff),
            admins:      Number(userRow.admins),
            pending:     Number(userRow.pending),
            active:      Number(userRow.active),
            suspended:   Number(userRow.suspended),
          },
          pre_t3:  { total: Number(preT3Row.total), pending: Number(preT3Row.pending), approved: Number(preT3Row.approved), rejected: Number(preT3Row.rejected), cancelled: Number(preT3Row.cancelled) },
          t3:      { total: Number(t3Row.total),    pending: Number(t3Row.pending),    approved: Number(t3Row.approved),    rejected: Number(t3Row.rejected), cancelled: Number(t3Row.cancelled) },
          msu_unwanted: { total: Number(unwantedRow.total) },
          api_keys: apiKeyStats,
        },
      });
    } catch (err) { next(err); }
  }

  /**
   * เรียกจาก: routes/userManageRoutes.js — GET / (Admin, SuperAdmin, Staff)
   * รับ query: role?, status?, search? (ชื่อ/อีเมล ผ่าน likeContains), page, limit (parsePagination เพดาน 1000) · ไม่รวม Admin/SuperAdmin
   * เติมอาจารย์ที่ปรึกษาของนิสิตแต่ละคน (advisors) และจำนวนนิสิตในความดูแลของอาจารย์ (student_count)
   * ตอบ { data: { users, pagination } }
   */
  // ============================================================
  // GET /api/manage/users
  // Query params: role, status, search, page, limit
  // ============================================================
  static async getUsers(req, res, next) {
    try {
      const { role, status, search } = req.query;
      // ponytail: เพดาน 1000 เพราะหน้า staff manage-users ดึง limit=1000 แล้วกรองฝั่ง client — ลดได้เมื่อ FE ทำ pagination จริง
      const { page, limit, offset } = parsePagination(req.query, 1000);

      const { rows, total } = await AdminUserModel.findPage({ role, status, search, limit, offset });

      // ดึง advisor ของ student แต่ละคน
      const studentIds = rows.filter(r => r.role === 'Student').map(r => r.user_id);
      let advisorMap = {};
      if (studentIds.length > 0) {
        const advRows = await AdminUserModel.findAdvisorsOfStudents(studentIds);
        for (const a of advRows) {
          if (!advisorMap[a.student_id]) advisorMap[a.student_id] = {};
          advisorMap[a.student_id][a.advisor_type] = {
            mail: a.advisor_mail,
            name: `${a.first_name} ${a.last_name}`,
          };
        }
      }

      // จำนวนนิสิตในความดูแลของอาจารย์แต่ละคน (Major + Co_1 + Co_2) — นับคนละครั้งแม้ถือหลายช่อง (X44)
      const supervisorIds = rows.filter(r => r.role === 'Supervisor').map(r => r.user_id);
      const studentCount = {};
      if (supervisorIds.length > 0) {
        const cntRows = await AdminUserModel.countStudentsPerAdvisor(supervisorIds);
        for (const c of cntRows) studentCount[c.advisor_id] = Number(c.n);
      }

      const usersWithAdvisors = rows.map(u => ({
        ...u,
        advisors: advisorMap[u.user_id] || {},
        ...(u.role === 'Supervisor' && { student_count: studentCount[u.user_id] || 0 }),
      }));

      return res.json({
        success: true,
        data: {
          users: usersWithAdvisors,
          pagination: {
            total,
            page:  Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (err) { next(err); }
  }

  /**
   * เรียกจาก: routes/userManageRoutes.js — PATCH /:id/approve (เฉพาะ Admin, SuperAdmin)
   * เปลี่ยนสถานะ Pending → Active (เช่น Staff ที่สมัครผ่าน AuthService.registerStaff) แล้วส่งอีเมลแจ้ง MailService.sendAccountApproved แบบไม่รอผล
   */
  // ============================================================
  // PATCH /api/manage/users/:id/approve  (Pending → Active)
  // ============================================================
  static async approveUser(req, res, next) {
    try {
      const { id } = req.params;
      const target = await AdminUserModel.findForApproval(id);
      if (!target) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });
      if (target.account_status !== 'Pending')
        return res.status(400).json({ success: false, message: 'สถานะต้องเป็น Pending เท่านั้น' });

      await AdminUserModel.setActive(id);

      const { msu_mail, first_name, last_name } = target;
      const fullName = `${first_name || ''} ${last_name || ''}`.trim();
      MailService.sendAccountApproved(msu_mail, fullName).catch(() => {});

      return res.json({ success: true, message: 'อนุมัติผู้ใช้เรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }

  /**
   * เรียกจาก: routes/userManageRoutes.js — PATCH /:id/suspend
   * ห้ามระงับตัวเอง/Admin · Staff ระงับ Staff ไม่ได้ · ระงับได้จาก Active หรือ Pending (Pending = ปฏิเสธคำสมัคร)
   * ถ้าเป็นอาจารย์ (Supervisor) จะนับคำขอที่ยังรออาจารย์คนนี้ แล้วส่ง data.pending_approvals กลับเพื่อให้ไปเปลี่ยนอาจารย์ที่ปรึกษา
   */
  // ============================================================
  // PATCH /api/manage/users/:id/suspend
  // ============================================================
  static async suspendUser(req, res, next) {
    try {
      const { id } = req.params;
      if (Number(id) === req.user.sub)
        return res.status(400).json({ success: false, message: 'ไม่สามารถระงับบัญชีตัวเองได้' });

      const target = await AdminUserModel.findStatusAndRole(id);
      if (!target) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });
      if (['Admin','SuperAdmin'].includes(target.role))
        return res.status(403).json({ success: false, message: 'ไม่สามารถระงับ Admin ได้' });
      if (staffTouchingStaff(req, target))
        return res.status(403).json({ success: false, message: 'Staff ไม่สามารถระงับบัญชี Staff ได้ กรุณาติดต่อ Admin' });
      // ระงับได้เฉพาะ Active · บัญชี Pending (Staff ที่สมัครรออนุมัติ) ใช้ endpoint นี้เป็น "ปฏิเสธ" ได้ด้วย (X39)
      // ผลคือ Suspended — คนที่ถูกปฏิเสธสมัครซ้ำด้วยอีเมลเดิมไม่ได้ (register-staff ตอบ ACCOUNT_SUSPENDED)
      const wasPending = target.account_status === 'Pending';
      if (target.account_status !== 'Active' && !wasPending)
        return res.status(400).json({ success: false, message: 'ระงับได้เฉพาะบัญชีที่มีสถานะ Active หรือ Pending เท่านั้น' });

      await AdminUserModel.setSuspended(id);

      // อาจารย์ที่ถูกระงับตัดสินคำขอไม่ได้ — บอกจำนวนที่ค้างให้แอดมินไปเปลี่ยนอาจารย์ของนิสิต (B32)
      const pendingApprovals = target.role === 'Supervisor' ? await AdminUserModel.countPendingApprovalsOf(id) : 0;
      return res.json({
        success: true,
        message: pendingApprovals
          ? `ระงับบัญชีเรียบร้อยแล้ว แต่ยังมี ${pendingApprovals} คำขอที่รออาจารย์ท่านนี้อยู่ กรุณาเปลี่ยนอาจารย์ที่ปรึกษาของนิสิตที่เกี่ยวข้อง`
          : (wasPending ? 'ปฏิเสธบัญชีที่รออนุมัติเรียบร้อยแล้ว' : 'ระงับบัญชีเรียบร้อยแล้ว'),
        data: { pending_approvals: pendingApprovals },
      });
    } catch (err) { next(err); }
  }

  /**
   * เรียกจาก: routes/userManageRoutes.js — PATCH /:id/activate · คืนสถานะ Suspended → Active (ไม่ใช้กับ Admin · Staff แตะ Staff ไม่ได้)
   */
  // ============================================================
  // PATCH /api/manage/users/:id/activate  (Suspended → Active)
  // ============================================================
  static async activateUser(req, res, next) {
    try {
      const { id } = req.params;
      const target = await AdminUserModel.findStatusAndRole(id);
      if (!target) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });
      if (['Admin', 'SuperAdmin'].includes(target.role))
        return res.status(403).json({ success: false, message: 'ไม่สามารถคืนสถานะ Admin ผ่านหน้านี้ได้' });
      if (staffTouchingStaff(req, target))
        return res.status(403).json({ success: false, message: 'Staff ไม่สามารถคืนสถานะบัญชี Staff ได้ กรุณาติดต่อ Admin' });
      if (target.account_status !== 'Suspended')
        return res.status(400).json({ success: false, message: 'สถานะต้องเป็น Suspended เท่านั้น' });

      await AdminUserModel.setActive(id);
      return res.json({ success: true, message: 'คืนสถานะบัญชีเรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }

  /**
   * เรียกจาก: routes/userManageRoutes.js — PATCH /:id (Admin/SuperAdmin/Staff) — ใช้กับ Student/Supervisor/Staff ไม่ใช้กับ Admin
   * รับ req.body (ส่งเฉพาะ field ที่แก้ ที่ไม่ส่งใช้ค่าเดิม): prefix, first_name, last_name, msu_mail, phone, facebook_id, line_id, degree_level, curriculum_year, study_plan_code, department
   * เปลี่ยน msu_mail ได้เฉพาะ Admin (เป็นกุญแจของ Google login) และทำให้ OTP 'password_reset' ที่ค้างอยู่ใช้ไม่ได้ (OtpModel.invalidateActive)
   * ข้อมูลระดับปริญญา/หลักสูตร/สาขาเก็บเฉพาะ Student — role อื่นถูกตั้งเป็น null
   */
  // ============================================================
  // PATCH /api/manage/users/:id  — แก้ไขข้อมูล
  // Body: { prefix, first_name, last_name, phone, degree_level }
  // ============================================================
  static async updateUser(req, res, next) {
    try {
      const { id } = req.params;

      // ดึงข้อมูลเดิมมาก่อน เพื่อทำ merge
      const target = await AdminUserModel.findEditable(id);
      if (!target) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });
      if (['Admin', 'SuperAdmin'].includes(target.role))
        return res.status(403).json({ success: false, message: 'ไม่สามารถแก้ไขข้อมูล Admin ผ่านหน้านี้ได้' });
      if (staffTouchingStaff(req, target))
        return res.status(403).json({ success: false, message: 'Staff ไม่สามารถแก้ไขข้อมูล Staff ได้ กรุณาติดต่อ Admin' });

      const badField = nonStringField(req.body, ['first_name', 'last_name', 'msu_mail']) || nonScalarField(req.body, USER_SCALAR_FIELDS);
      if (badField) return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: `${badField} ต้องเป็นข้อความ` });

      const phoneErr = phoneError(req.body.phone);
      if (phoneErr) return res.status(400).json({ success: false, code: 'INVALID_PHONE', message: phoneErr });

      const current = target;
      const body = req.body;

      // Merge: ถ้า field นั้นไม่ได้ส่งมา ใช้ค่าเดิม
      const merged = {
        prefix:          body.prefix          !== undefined ? body.prefix          : current.prefix,
        first_name:      body.first_name      !== undefined ? body.first_name      : current.first_name,
        last_name:       body.last_name       !== undefined ? body.last_name       : current.last_name,
        msu_mail:        body.msu_mail        !== undefined ? body.msu_mail        : current.msu_mail,
        phone:           body.phone           !== undefined ? body.phone           : current.phone,
        facebook_id:     body.facebook_id     !== undefined ? body.facebook_id     : current.facebook_id,
        line_id:         body.line_id         !== undefined ? body.line_id         : current.line_id,
        degree_level:    body.degree_level    !== undefined ? body.degree_level    : current.degree_level,
        curriculum_year: body.curriculum_year !== undefined ? body.curriculum_year : current.curriculum_year,
        study_plan_code: body.study_plan_code !== undefined ? body.study_plan_code : current.study_plan_code,
        department:      body.department      !== undefined ? body.department      : current.department,
      };

      // Validate required fields
      if (!merged.first_name?.trim()) return res.status(400).json({ success: false, message: 'ชื่อห้ามว่าง' });
      if (!merged.last_name?.trim())  return res.status(400).json({ success: false, message: 'นามสกุลห้ามว่าง' });
      if (!merged.msu_mail?.trim())   return res.status(400).json({ success: false, message: 'อีเมลห้ามว่าง' });

      // msu_mail คือ key ของ Google login — เปลี่ยนได้เฉพาะ Admin (กัน Staff เปลี่ยนเป็นอีเมลตัวเองแล้วสวมรอยเข้าระบบ)
      const mailChanged = mailOf(merged.msu_mail) !== mailOf(current.msu_mail);
      if (mailChanged && req.user.role === 'Staff')
        return res.status(403).json({ success: false, message: 'การเปลี่ยนอีเมลต้องทำโดย Admin' });
      if (mailChanged) {
        const mailErr = msuMailError(merged.msu_mail);
        if (mailErr) return res.status(400).json({ success: false, code: 'INVALID_EMAIL', message: mailErr });
      }

      // degree_level/curriculum_year/study_plan_code เฉพาะนิสิต
      if (!['Student'].includes(current.role)) {
        merged.degree_level    = null;
        merged.curriculum_year = null;
        merged.study_plan_code = null;
        merged.department      = null;
      } else if (body.department !== undefined || body.degree_level !== undefined) {
        const deptErr = departmentError(merged.department, merged.degree_level);
        if (deptErr) return res.status(400).json({ success: false, code: 'INVALID_DEPARTMENT', message: deptErr });
      }
      if (current.role === 'Student' && (body.study_plan_code !== undefined || body.degree_level !== undefined)) {
        const planErr = studyPlanError(merged.study_plan_code, merged.degree_level);
        if (planErr) return res.status(400).json({ success: false, code: 'INVALID_STUDY_PLAN', message: planErr });
      }

      await AdminUserModel.updateProfile(id, {
        prefix: merged.prefix || null,
        first_name: merged.first_name,
        last_name: merged.last_name,
        msu_mail: mailOf(merged.msu_mail),
        phone: merged.phone || null,
        facebook_id: merged.facebook_id || null,
        line_id: merged.line_id || null,
        degree_level: merged.degree_level || null,
        curriculum_year: merged.curriculum_year || null,
        study_plan_code: merged.study_plan_code || null,
        department: merged.department || null,
      });
      if (mailChanged) await OtpModel.invalidateActive(id, 'password_reset');

      return res.json({ success: true, message: 'แก้ไขข้อมูลเรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }
  
  /**
   * เรียกจาก: routes/userManageRoutes.js — POST /single (Admin/SuperAdmin/Staff)
   * รับ req.body: role (Student|Supervisor), first_name, last_name, msu_mail (+ prefix, phone, degree_level, curriculum_year, study_plan_code, department, advisor_major_mail, advisor_co1_mail)
   * ตรวจ msuMailError/departmentError → อีเมลต้องไม่ซ้ำ → (Student) หา user_id อาจารย์จากอีเมล
   *   → ใน transaction เดียว: INSERT users (Active) + INSERT advisor_assignments ของ Major/Co_1 (ถ้าระบุ) · ตอบ 201 { user_id }
   */
// ============================================================
  // POST /api/manage/users/single — เพิ่ม user ทีละคน
  // Body: { role, first_name, last_name, msu_mail, prefix?,
  //         phone?, degree_level?, curriculum_year?,
  //         study_plan_code?, advisor_major_mail?, advisor_co1_mail? }
  // ============================================================
  static async createUser(req, res, next) {
    try {
      const {
        role, first_name, last_name, msu_mail, prefix,
        phone, degree_level, curriculum_year, study_plan_code, department,
        advisor_major_mail, advisor_co1_mail,
      } = req.body;

      const badField = nonStringField(req.body, ['first_name', 'last_name', 'msu_mail', 'advisor_major_mail', 'advisor_co1_mail'])
        || nonScalarField(req.body, [...USER_SCALAR_FIELDS, 'role']);
      if (badField) return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: `${badField} ต้องเป็นข้อความ` });

      // ===== Validate required =====
      const phoneErr = phoneError(phone);
      if (phoneErr) return res.status(400).json({ success: false, code: 'INVALID_PHONE', message: phoneErr });
      if (!role)       return res.status(400).json({ success: false, message: 'กรุณาระบุ Role' });
      if (!first_name) return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อ' });
      if (!last_name)  return res.status(400).json({ success: false, message: 'กรุณาระบุนามสกุล' });
      if (!msu_mail)   return res.status(400).json({ success: false, message: 'กรุณาระบุ MSU Mail' });

      const allowedRoles = ['Student', 'Supervisor'];
      if (!allowedRoles.includes(role))
        return res.status(400).json({ success: false, message: `Role ต้องเป็น ${allowedRoles.join(', ')}` });

      const mailErr = msuMailError(msu_mail);
      if (mailErr) return res.status(400).json({ success: false, code: 'INVALID_EMAIL', message: mailErr });

      const deptErr = role === 'Student' ? departmentError(department, degree_level) : null;
      if (deptErr) return res.status(400).json({ success: false, code: 'INVALID_DEPARTMENT', message: deptErr });
      const planErr = role === 'Student' ? studyPlanError(study_plan_code, degree_level) : null;
      if (planErr) return res.status(400).json({ success: false, code: 'INVALID_STUDY_PLAN', message: planErr });

      const mailLower = msu_mail.toLowerCase().trim();

      // ===== เช็ก msu_mail ซ้ำ =====
      if (await AdminUserModel.mailExists(mailLower))
        return res.status(400).json({ success: false, message: `MSU Mail ${mailLower} มีอยู่ในระบบแล้ว` });

      // ===== เช็ก advisor (เฉพาะ Student) =====
      let advisorMajorId = null;
      let advisorCo1Id   = null;

      if (role === 'Student') {
        // advisor เป็น optional — ไม่บังคับ
        if (advisor_major_mail) {
          advisorMajorId = await AdminUserModel.findSupervisorIdByMail(advisor_major_mail.toLowerCase().trim());
          if (!advisorMajorId)
            return res.status(400).json({ success: false, message: `ไม่พบอาจารย์ที่ปรึกษาหลัก: ${advisor_major_mail}` });
        }

        if (advisor_co1_mail) {
          advisorCo1Id = await AdminUserModel.findSupervisorIdByMail(advisor_co1_mail.toLowerCase().trim());
          if (!advisorCo1Id)
            return res.status(400).json({ success: false, message: `ไม่พบอาจารย์ที่ปรึกษาร่วม: ${advisor_co1_mail}` });
        }
      }

      // ===== Insert user + advisor_assignments ในทรานแซกชันเดียว =====
      // กัน user ถูกสร้างค้างไว้แบบไม่มี advisor ถ้า insert assignment พังกลางทาง
      const [newUserId] = await AdminUserModel.createUsersWithAdvisors([{
        mail: mailLower, role,
        prefix: prefix || null, first_name: first_name.trim(), last_name: last_name.trim(),
        phone: phone || null,
        degree_level: degree_level || null, curriculum_year: curriculum_year || null, study_plan_code: study_plan_code || null,
        department: role === 'Student' ? (department || null) : null,
        majorAdvisorId: advisorMajorId, co1AdvisorId: advisorCo1Id,
      }]);

      return res.status(201).json({
        success: true,
        message: `เพิ่ม ${role} ${first_name} ${last_name} เรียบร้อยแล้ว`,
        data: { user_id: newUserId },
      });
    } catch (err) { next(err); }
  }

  /**
   * เรียกจาก: routes/userManageRoutes.js — POST /import (Admin/SuperAdmin/Staff)
   * รับ multipart: ไฟล์ CSV field 'file' (≤ 2 MB, ≤ MAX_IMPORT_ROWS แถว) คอลัมน์ role, first_name, last_name, msu_mail, (prefix, phone, degree_level, curriculum_year, study_plan_code, department, advisor_major_mail, advisor_co1_mail)
   * ลำดับ: parse → prefetch อีเมลที่มีอยู่แล้วและอาจารย์ที่อ้างถึง (2 query) → ตรวจทุกแถว all-or-nothing (เก็บ errors[] รายแถว)
   *   → ไม่มี error จึง INSERT ทุกแถว (users + advisor_assignments) ใน transaction เดียว · ตอบ { data: { imported } }
   */
  // ============================================================
  // POST /api/manage/users/import — import CSV
  // multipart/form-data: file = CSV file
  // ============================================================
  static async importUsers(req, res, next) {
    const multer  = require('multer');
    const { parse } = require('csv-parse/sync');

    // รับไฟล์ใน memory
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 10, fieldSize: 10 * 1024 } }).single('file');

    upload(req, res, async (err) => {
      if (err) return res.status(400).json({ success: false, message: 'อัปโหลดไฟล์ไม่สำเร็จ: ' + err.message });
      if (!req.file) return res.status(400).json({ success: false, message: 'กรุณาแนบไฟล์ CSV' });

      try {
        // ===== Parse CSV =====
        let records;
        try {
records = parse(req.file.buffer, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            bom: true,
            encoding: 'utf8',
          });
        } catch (parseErr) {
          return res.status(400).json({ success: false, message: 'ไฟล์ CSV ไม่ถูกต้อง: ' + parseErr.message });
        }

        if (!records.length)
          return res.status(400).json({ success: false, message: 'ไฟล์ CSV ว่างเปล่า' });
        if (records.length > MAX_IMPORT_ROWS)
          return res.status(400).json({ success: false, code: 'TOO_MANY_ROWS', message: `ไฟล์มี ${records.length} แถว เกินที่รองรับ (สูงสุด ${MAX_IMPORT_ROWS} แถวต่อไฟล์) กรุณาแบ่งไฟล์` });

        const errors = [];

        // นับ msu_mail ในไฟล์ครั้งเดียว (เดิม filter ทั้งไฟล์ต่อแถว = O(n²))
        const mailCount = new Map();
        for (const r of records) {
          const m = r.msu_mail?.toLowerCase().trim();
          if (m) mailCount.set(m, (mailCount.get(m) || 0) + 1);
        }

        // Batch prefetch: ดึงข้อมูลที่ต้องตรวจสอบทั้งหมดใน 2 queries แทนการ query ต่อ row
        const allMails = records
          .map(r => r.msu_mail?.toLowerCase().trim())
          .filter(Boolean);

        const allAdvisorMails = [
          ...records.map(r => r.advisor_major_mail?.toLowerCase().trim()),
          ...records.map(r => r.advisor_co1_mail?.toLowerCase().trim()),
        ].filter(Boolean);

        const existingMailSet = await AdminUserModel.findExistingMails(allMails);
        const advisorMailMap = await AdminUserModel.findSupervisorIdsByMails(allAdvisorMails);

        // ===== Validate ทุก row ก่อน (all-or-nothing) =====
        for (let i = 0; i < records.length; i++) {
          const row = records[i];
          const rowNum = i + 2; // +2 เพราะ row 1 = header

          if (!row.role)       errors.push(`Row ${rowNum}: ไม่มี role`);
          if (!row.first_name) errors.push(`Row ${rowNum}: ไม่มี first_name`);
          if (!row.last_name)  errors.push(`Row ${rowNum}: ไม่มี last_name`);
          if (!row.msu_mail)   errors.push(`Row ${rowNum}: ไม่มี msu_mail`);

          const allowedRoles = ['Student', 'Supervisor'];
          if (row.role && !allowedRoles.includes(row.role))
            errors.push(`Row ${rowNum}: role "${row.role}" ไม่ถูกต้อง`);

          if (row.msu_mail) {
            const mail = row.msu_mail.toLowerCase().trim();
            const mailErr = msuMailError(row.msu_mail);
            if (mailErr) errors.push(`Row ${rowNum}: ${mailErr}`);
            if (existingMailSet.has(mail))
              errors.push(`Row ${rowNum}: MSU Mail ${row.msu_mail} มีอยู่ในระบบแล้ว`);
            if (mailCount.get(mail) > 1) errors.push(`Row ${rowNum}: MSU Mail ${row.msu_mail} ซ้ำในไฟล์`);
          }

          // ค่า enum/ความยาวของคอลัมน์ users — ผิดแล้วบอกแถวที่ผิด (เดิม MySQL error 1265 → 500 ทั้งก้อน)
          if (row.degree_level && !DEGREE_LEVELS.includes(row.degree_level))
            errors.push(`Row ${rowNum}: degree_level "${row.degree_level}" ไม่ถูกต้อง (ใช้ ${DEGREE_LEVELS.join(' / ')})`);
          if (row.curriculum_year && !CURRICULUM_YEARS.includes(row.curriculum_year))
            errors.push(`Row ${rowNum}: curriculum_year "${row.curriculum_year}" ไม่ถูกต้อง (ใช้ ${CURRICULUM_YEARS.join(' / ')})`);
          if (row.study_plan_code && !STUDY_PLAN_CODES.includes(row.study_plan_code))
            errors.push(`Row ${rowNum}: study_plan_code "${row.study_plan_code}" ไม่ถูกต้อง`);
          if (row.role === 'Student') {
            const deptErr = departmentError(row.department, row.degree_level);
            if (deptErr) errors.push(`Row ${rowNum}: ${deptErr}`);
            const planErr = studyPlanError(row.study_plan_code, row.degree_level);
            if (planErr) errors.push(`Row ${rowNum}: ${planErr}`);
          }
          { const pe = phoneError(row.phone); if (pe) errors.push(`Row ${rowNum}: ${pe}`); }
          if (row.prefix && row.prefix.length > 50) errors.push(`Row ${rowNum}: prefix ยาวเกิน 50 ตัวอักษร`);

          if (row.role === 'Student') {
            if (row.advisor_major_mail) {
              const mail = row.advisor_major_mail.toLowerCase().trim();
              if (!advisorMailMap[mail])
                errors.push(`Row ${rowNum}: ไม่พบอาจารย์ที่ปรึกษาหลัก "${row.advisor_major_mail}" ในระบบ`);
            }
            if (row.advisor_co1_mail) {
              const mail = row.advisor_co1_mail.toLowerCase().trim();
              if (!advisorMailMap[mail])
                errors.push(`Row ${rowNum}: ไม่พบอาจารย์ที่ปรึกษาร่วม "${row.advisor_co1_mail}" ในระบบ`);
            }
          }
        }

        // ===== ถ้ามี error หยุดทันที =====
        if (errors.length) {
          return res.status(400).json({
            success: false,
            message: `พบ ${errors.length} ปัญหาใน CSV — ไม่มีข้อมูลถูก import`,
            errors,
          });
        }

        // ===== ผ่านทั้งหมด → Insert (transaction เดียว — all-or-nothing จริง) =====
        const imported = (await AdminUserModel.createUsersWithAdvisors(records.map(row => {
          const isStudent = row.role === 'Student';
          return {
            mail: row.msu_mail.toLowerCase().trim(),
            role: row.role,
            prefix: row.prefix || null,
            first_name: row.first_name.trim(),
            last_name: row.last_name.trim(),
            phone: row.phone || null,
            degree_level: row.degree_level || null,
            curriculum_year: row.curriculum_year || null,
            study_plan_code: row.study_plan_code || null,
            department: isStudent ? (row.department || null) : null,
            // ใช้ advisorMailMap ที่ fetch ไว้แล้ว ไม่ต้อง query ซ้ำ · major/co1 เช็คแยกอิสระจากกัน
            majorAdvisorId: isStudent && row.advisor_major_mail ? advisorMailMap[row.advisor_major_mail.toLowerCase().trim()] : null,
            co1AdvisorId: isStudent && row.advisor_co1_mail ? advisorMailMap[row.advisor_co1_mail.toLowerCase().trim()] : null,
          };
        }))).length;

        return res.json({
          success: true,
          message: `Import สำเร็จ ${imported} รายการ`,
          data: { imported },
        });

      } catch (err) { next(err); }
    });
  }

  /**
   * เรียกจาก: routes/userManageRoutes.js — PATCH /:id/advisors (Admin/SuperAdmin/Staff) · :id คือนิสิต
   * รับ req.body: advisor_major_mail?, advisor_co1_mail?, advisor_co2_mail? (ไม่ส่ง = คงเดิม, '' เฉพาะ Co = ถอด, Major ถอดไม่ได้)
   * ใน transaction: ล็อกนิสิต → แก้ advisor_assignments → ย้าย approver_id ของคำขอ Pre-T3/T3 ที่ยัง Pending ในขั้นนั้นตามไปด้วย (request_approvals)
   * ถอด Co ที่ยังมีคำขอรออยู่ → 409 ADVISOR_HAS_PENDING_REQUESTS · ตอบ { data: { requests_reassigned } }
   */
  // ============================================================
  // PATCH /api/manage/users/:id/advisors
  // Body: { advisor_major_mail?, advisor_co1_mail?, advisor_co2_mail? }
  //  - ฟิลด์ที่ไม่ส่ง = คงค่าเดิม · ส่ง "" เฉพาะ co1/co2 = ถอดออก · Major ถอดไม่ได้ (ต้องมีเสมอ)
  //  - อาจารย์ต้องเป็น Supervisor ที่ Active และห้ามซ้ำกันระหว่างช่อง
  //  - ช่องที่เปลี่ยนจะย้าย approver ของคำขอ Pending ตามไปด้วย (เฉพาะขั้นที่ยังไม่ตัดสิน)
  //  - ถอด Co ที่ยังมีคำขอ Pending รออยู่ → 409 (B32)
  // ============================================================
  static async updateAdvisors(req, res, next) {
    try {
      const { id } = req.params;
      const MAIL_FIELDS = { Major: 'advisor_major_mail', Co_1: 'advisor_co1_mail', Co_2: 'advisor_co2_mail' };
      const badField = nonStringField(req.body, Object.values(MAIL_FIELDS));
      if (badField) return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: `${badField} ต้องเป็นข้อความ` });

      const sent = Object.entries(MAIL_FIELDS).filter(([, f]) => req.body[f] != null);
      if (!sent.length) {
        return res.status(400).json({ success: false, code: 'NOTHING_TO_UPDATE', message: 'ต้องระบุอาจารย์อย่างน้อยหนึ่งช่อง' });
      }

      const target = await AdminUserModel.findRole(id);
      if (!target) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });
      if (target.role !== 'Student')
        return res.status(400).json({ success: false, message: 'ผู้ใช้นี้ไม่ใช่นิสิต' });

      // ช่องที่ส่งมา → user_id ใหม่ (null = ถอดออก); ช่องที่ไม่ส่งไม่อยู่ใน changes
      const changes = {};
      for (const [slot, field] of sent) {
        const mail = mailOf(req.body[field]);
        if (!mail) {
          if (slot === 'Major') {
            return res.status(400).json({ success: false, code: 'MAJOR_REQUIRED', message: 'ต้องมีอาจารย์ที่ปรึกษาหลักเสมอ ถอดออกไม่ได้' });
          }
          changes[slot] = null;
          continue;
        }
        const advisor = await AdminUserModel.findSupervisorByMail(mail);
        if (!advisor) return res.status(400).json({ success: false, message: `ไม่พบอาจารย์ที่ปรึกษา: ${mail}` });
        if (advisor.account_status !== 'Active')
          return res.status(400).json({ success: false, code: 'ADVISOR_NOT_ACTIVE', message: `อาจารย์ ${mail} ไม่ได้อยู่ในสถานะ Active` });
        changes[slot] = advisor.user_id;
      }

      const result = await AdminUserModel.reassignAdvisors(id, changes);
      if (result.error) {
        return res.status(result.error.status).json({ success: false, code: result.error.code, message: result.error.message });
      }
      return res.json({
        success: true,
        message: 'อัปเดตอาจารย์ที่ปรึกษาเรียบร้อยแล้ว',
        data: { requests_reassigned: result.reassigned },
      });
    } catch (err) { next(err); }
  }

  /**
   * เรียกจาก: routes/adminRoutes.js — GET /admins (Admin, SuperAdmin)
   * รับ query: status?, search? (username/ชื่อ/อีเมล), page, limit · แสดงเฉพาะ role Admin และ SuperAdmin
   */
  // ============================================================
  // GET /api/admin/admins
  // Query params: status, search, page, limit
  // ============================================================
  static async getAdmins(req, res, next) {
    try {
      const { status, search } = req.query;
      const { page, limit, offset } = parsePagination(req.query);

      const { rows, total } = await AdminUserModel.findAdminPage({ status, search, limit, offset });

      return res.json({
        success: true,
        data: {
          admins: rows,
          pagination: {
            total,
            page:       Number(page),
            limit:      Number(limit),
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (err) { next(err); }
  }

  /**
   * เรียกจาก: routes/adminRoutes.js — POST /admins (Admin, SuperAdmin) — สร้างได้เฉพาะ role Admin
   * รับ req.body: username (4-50 ตัว), password (8-128 ตัว มีพิมพ์ใหญ่/เล็ก/ตัวเลข — กฎเดียวกับ validators/authValidator), first_name, last_name, msu_mail
   * username/อีเมลต้องไม่ซ้ำ → bcrypt (12 รอบ) → INSERT users (Active) · ตอบ 201 { user_id } · บัญชีนี้เข้าสู่ระบบด้วย AuthService.login (รหัสผ่าน + OTP)
   */
  // ============================================================
  // POST /api/admin/admins
  // สร้าง Admin ใหม่ (username + password)
  // Body: { username, password, first_name, last_name, msu_mail }
  // Admin และ SuperAdmin ทำได้ (สร้างได้แค่ role Admin)
  // ============================================================
  static async createAdmin(req, res, next) {
    try {
      const { username, password, first_name, last_name, msu_mail } = req.body;
      const badField = nonStringField(req.body, ['username', 'password', 'first_name', 'last_name', 'msu_mail']);
      if (badField) return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: `${badField} ต้องเป็นข้อความ` });

      if (!username?.trim())   return res.status(400).json({ success: false, message: 'กรุณาระบุ username' });
      if (!password?.trim())   return res.status(400).json({ success: false, message: 'กรุณาระบุ password' });
      if (!first_name?.trim()) return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อ' });
      if (!last_name?.trim())  return res.status(400).json({ success: false, message: 'กรุณาระบุนามสกุล' });
      if (!msu_mail?.trim())   return res.status(400).json({ success: false, message: 'กรุณาระบุอีเมล' });

      // กฎเดียวกับ loginValidator / resetPasswordValidator — ไม่งั้นสร้างแล้ว login ไม่ได้ หรือรหัสอ่อนกว่าตอน reset
      if (!/^[a-zA-Z0-9_.-]{4,50}$/.test(username.trim()))
        return res.status(400).json({ success: false, code: 'INVALID_USERNAME', message: 'username ต้องยาว 4-50 ตัว ใช้ได้เฉพาะ a-z, A-Z, 0-9, _ . -' });
      if (password.length < 8 || password.length > 128 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password))
        return res.status(400).json({ success: false, code: 'WEAK_PASSWORD', message: 'รหัสผ่านต้องยาว 8-128 ตัว มีตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก และตัวเลข' });

      // เช็ค username ซ้ำ
      if (await AdminUserModel.usernameExists(username.trim().toLowerCase()))
        return res.status(400).json({ success: false, message: `Username "${username}" มีอยู่ในระบบแล้ว` });

      // เช็ค msu_mail ซ้ำ
      if (await AdminUserModel.mailExists(msu_mail.trim().toLowerCase()))
        return res.status(400).json({ success: false, message: `Email "${msu_mail}" มีอยู่ในระบบแล้ว` });

      const bcrypt = require('bcrypt');
      const passwordHash = await bcrypt.hash(password, 12);

      const userId = await AdminUserModel.createAdmin({
        username: username.trim().toLowerCase(),
        passwordHash,
        msu_mail: msu_mail.trim().toLowerCase(),
        first_name: first_name.trim(),
        last_name: last_name.trim(),
      });

      return res.status(201).json({
        success: true,
        message: `สร้าง Admin "${username}" เรียบร้อยแล้ว`,
        data: { user_id: userId },
      });
    } catch (err) { next(err); }
  }

  /**
   * เรียกจาก: routes/adminRoutes.js — PATCH /admins/:id/suspend · ห้ามระงับตัวเอง · Admin ระงับ SuperAdmin ไม่ได้ · ระงับได้เฉพาะ Active
   */
  // ============================================================
  // PATCH /api/admin/admins/:id/suspend  (Admin → Suspended)
  // Admin และ SuperAdmin ทำได้ แต่แตะ SuperAdmin ไม่ได้
  // ============================================================
  static async suspendAdmin(req, res, next) {
    try {
      const { id } = req.params;
      const callerId   = req.user.sub;
      const callerRole = req.user.role;

      if (Number(id) === callerId)
        return res.status(400).json({ success: false, message: 'ไม่สามารถระงับบัญชีตัวเองได้' });

      const target = await AdminUserModel.findRoleAndStatus(id);
      if (!target)
        return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });

      // Admin แตะ SuperAdmin ไม่ได้
      if (callerRole === 'Admin' && target.role === 'SuperAdmin')
        return res.status(403).json({ success: false, message: 'ไม่สามารถระงับ SuperAdmin ได้' });

      if (!['Admin', 'SuperAdmin'].includes(target.role))
        return res.status(400).json({ success: false, message: 'ผู้ใช้นี้ไม่ใช่ Admin' });

      if (target.account_status !== 'Active')
        return res.status(400).json({ success: false, message: 'ระงับได้เฉพาะบัญชีที่มีสถานะ Active เท่านั้น' });

      await AdminUserModel.setSuspended(id);
      return res.json({ success: true, message: 'ระงับบัญชี Admin เรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }

  /**
   * เรียกจาก: routes/adminRoutes.js — PATCH /admins/:id/activate · คืนสถานะ Suspended → Active · Admin แตะ SuperAdmin ไม่ได้
   */
  // ============================================================
  // PATCH /api/admin/admins/:id/activate  (Suspended → Active)
  // ============================================================
  static async activateAdmin(req, res, next) {
    try {
      const { id } = req.params;
      const callerRole = req.user.role;

      const target = await AdminUserModel.findRoleAndStatus(id);
      if (!target)
        return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });

      if (callerRole === 'Admin' && target.role === 'SuperAdmin')
        return res.status(403).json({ success: false, message: 'ไม่สามารถแก้ไข SuperAdmin ได้' });

      if (!['Admin', 'SuperAdmin'].includes(target.role))
        return res.status(400).json({ success: false, message: 'ผู้ใช้นี้ไม่ใช่ Admin' });

      if (target.account_status !== 'Suspended')
        return res.status(400).json({ success: false, message: 'คืนสถานะได้เฉพาะบัญชีที่ถูกระงับเท่านั้น' });

      await AdminUserModel.setActive(id);
      return res.json({ success: true, message: 'คืนสถานะ Admin เรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }

  /**
   * เรียกจาก: routes/adminRoutes.js — PATCH /admins/:id (หลัง passwordConfirmLimiter) · Admin แก้ SuperAdmin ไม่ได้
   * รับ req.body: prefix?, first_name?, last_name?, msu_mail?, current_password? (บังคับเมื่อเปลี่ยนอีเมล — ตรวจกับรหัสผ่านของผู้กด ไม่ใช่เจ้าของบัญชีที่ถูกแก้)
   * เปลี่ยนอีเมล → OtpModel.invalidateActive + RefreshTokenModel.revokeAllByUserId (ตัดทุก session) · ตอบ data.relogin_required
   */
  // ============================================================
  // PATCH /api/admin/admins/:id  — แก้ไขข้อมูล Admin
  // Body: { prefix?, first_name?, last_name?, msu_mail? }
  // ============================================================
  static async updateAdmin(req, res, next) {
    try {
      const { id } = req.params;
      const cur = await AdminUserModel.findAdminEditable(id);
      if (!cur)
        return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });

      // Admin แก้ SuperAdmin ไม่ได้ (ยกเว้นบัญชีตัวเอง) — SuperAdmin เป็นตำแหน่งสูงสุด
      if (req.user.role === 'Admin' && cur.role === 'SuperAdmin')
        return res.status(403).json({ success: false, message: 'ไม่สามารถแก้ไข SuperAdmin ได้' });

      if (!['Admin', 'SuperAdmin'].includes(cur.role))
        return res.status(400).json({ success: false, message: 'ผู้ใช้นี้ไม่ใช่ Admin' });

      const badField = nonStringField(req.body, ['prefix', 'first_name', 'last_name', 'msu_mail', 'current_password']);
      if (badField) return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: `${badField} ต้องเป็นข้อความ` });

      const body = req.body;

      const merged = {
        prefix:     body.prefix != null ? body.prefix.trim() : cur.prefix,
        first_name: body.first_name != null ? body.first_name.trim() : cur.first_name,
        last_name:  body.last_name  != null ? body.last_name.trim()  : cur.last_name,
        msu_mail:   body.msu_mail   != null ? body.msu_mail.trim().toLowerCase() : cur.msu_mail,
      };

      if (!merged.first_name) return res.status(400).json({ success: false, message: 'ชื่อห้ามว่าง' });
      if (!merged.last_name)  return res.status(400).json({ success: false, message: 'นามสกุลห้ามว่าง' });
      if (!merged.msu_mail)   return res.status(400).json({ success: false, message: 'อีเมลห้ามว่าง' });

      const mailChanged = mailOf(merged.msu_mail) !== mailOf(cur.msu_mail);

      // อีเมลนี้คือช่องทางรับ OTP ของ login/รีเซ็ตรหัสผ่าน — เปลี่ยนแล้วใครคุมอีเมลใหม่ก็ยึดบัญชีได้
      // access token อย่างเดียวจึงไม่พอ (token หลุด = ยึดบัญชีถาวร): ต้องยืนยันรหัสผ่านของผู้ทำรายการ (B34)
      if (mailChanged) {
        const password = req.body.current_password;
        if (!password) {
          return res.status(400).json({ success: false, code: 'PASSWORD_REQUIRED', message: 'การเปลี่ยนอีเมลต้องยืนยันด้วยรหัสผ่านปัจจุบันของคุณ (current_password)' });
        }
        const actorHash = await AdminUserModel.findPasswordHash(req.user.sub);
        const ok = actorHash && await bcryptjs.compare(password, actorHash);
        if (!ok) {
          return res.status(403).json({ success: false, code: 'INVALID_PASSWORD', message: 'รหัสผ่านไม่ถูกต้อง' });
        }
      }

      await AdminUserModel.updateAdminProfile(id, {
        prefix: merged.prefix || null,
        first_name: merged.first_name,
        last_name: merged.last_name,
        msu_mail: merged.msu_mail,
      });
      if (mailChanged) {
        await OtpModel.invalidateActive(id, 'password_reset');
        // ตัดทุก session ของเจ้าของอีเมล — refresh token ที่อาจหลุดอยู่จะใช้ต่อไม่ได้ (access token เดิมอยู่ได้จนหมดอายุ)
        await RefreshTokenModel.revokeAllByUserId(id);
      }

      return res.json({
        success: true,
        message: mailChanged
          ? 'แก้ไขข้อมูล Admin เรียบร้อยแล้ว เซสชันเดิมของบัญชีนี้จะสิ้นสุด ต้องเข้าสู่ระบบใหม่'
          : 'แก้ไขข้อมูล Admin เรียบร้อยแล้ว',
        data: { relogin_required: mailChanged },
      });
    } catch (err) { next(err); }
  }

  /**
   * เรียกจาก: routes/adminRoutes.js — DELETE /admins/:id · ลบถาวร เฉพาะ role Admin (ห้ามลบตัวเอง/SuperAdmin)
   */
  // ============================================================
  // DELETE /api/admin/admins/:id  (hard delete — Admin/SuperAdmin ลบ Admin ได้ แต่ลบ SuperAdmin ไม่ได้)
  // ============================================================
  static async deleteAdmin(req, res, next) {
    try {
      const { id } = req.params;
      const callerId   = req.user.sub;

      if (Number(id) === callerId)
        return res.status(400).json({ success: false, message: 'ไม่สามารถลบบัญชีตัวเองได้' });

      const target = await AdminUserModel.findRole(id);
      if (!target)
        return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });

      if (target.role === 'SuperAdmin')
        return res.status(403).json({ success: false, message: 'ไม่สามารถลบ SuperAdmin ได้' });

      if (target.role !== 'Admin')
        return res.status(400).json({ success: false, message: 'ผู้ใช้นี้ไม่ใช่ Admin' });

      await AdminUserModel.deleteById(id);
      return res.json({ success: true, message: 'ลบ Admin เรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }

  /**
   * เรียกจาก: routes/userManageRoutes.js — DELETE /:id (Admin/SuperAdmin) · ลบถาวร Student/Supervisor/Staff (Admin/SuperAdmin ใช้ DELETE /admin/admins/:id)
   * ลบไม่ได้ (409 USER_HAS_DATA) ถ้ามีข้อมูลผูกอยู่ เพื่อไม่ให้ประวัติคำขอหาย: นิสิตที่มี Pre-T3/T3 · อาจารย์ที่ยังเป็นที่ปรึกษา/เคยตัดสินคำขอ
   * นิสิตที่มีแค่การมอบหมายอาจารย์ (advisor_assignments) → ลบแถวนั้นทิ้งพร้อมกัน · token/OTP ถูกลบตาม FK CASCADE
   */
  // ============================================================
  // DELETE /api/manage/users/:id  (hard delete)
  // ============================================================
  static async deleteUser(req, res, next) {
    try {
      const { id } = req.params;
      if (Number(id) === req.user.sub)
        return res.status(400).json({ success: false, message: 'ไม่สามารถลบบัญชีตัวเองได้' });

      const target = await AdminUserModel.findRole(id);
      if (!target) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });
      if (['Admin', 'SuperAdmin'].includes(target.role))
        return res.status(403).json({ success: false, message: 'ไม่สามารถลบ Admin ผ่านหน้านี้ได้ ใช้ DELETE /api/admin/admins/:id' });

      const used = await AdminUserModel.countRelatedData(id);
      const reasons = [
        used.pre_t3 && `มีคำขอ Pre-T3 ${used.pre_t3} รายการ`,
        used.t3 && `มีคำขอ T3 ${used.t3} รายการ`,
        used.advisor_of && `เป็นอาจารย์ที่ปรึกษาของนิสิต ${used.advisor_of} คน`,
        used.approvals && `เคยมีรายการอนุมัติ ${used.approvals} รายการ`,
      ].filter(Boolean);
      if (reasons.length)
        return res.status(409).json({
          success: false,
          code: 'USER_HAS_DATA',
          message: `ลบไม่ได้เพราะมีข้อมูลผูกอยู่ (${reasons.join(', ')}) ใช้ระงับบัญชีแทน`,
        });

      await AdminUserModel.deleteWithAssignments(id);
      return res.json({ success: true, message: 'ลบผู้ใช้เรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }
}

module.exports = AdminController;