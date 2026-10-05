/**
 * Admin Controller
 * รับ HTTP request → เรียก DB โดยตรง → ส่ง response
 * เฉพาะ Admin และ SuperAdmin เท่านั้น
 */
const db          = require('../config/database');
const { parsePagination, nonStringField } = require('../utils/input');
const MailService = require('../services/MailService');
const OtpModel    = require('../models/OtpModel');

// Staff จัดการได้เฉพาะ Student/Supervisor — แก้/ระงับ/คืนสถานะ Staff คนอื่นต้องเป็น Admin
const staffTouchingStaff = (req, target) => req.user.role === 'Staff' && target.role === 'Staff';
const mailOf = (v) => String(v ?? '').trim().toLowerCase();

class AdminController {

  // ============================================================
  // GET /api/admin/stats
  // ============================================================
  static async getStats(req, res, next) {
    try {
      const [
        [userRows],
        [preT3Rows],
        [t3Rows],
        [unwantedRows],
      ] = await Promise.all([
        db.query(`
          SELECT
            COUNT(*)                                              AS total,
            SUM(role = 'Student')                                AS students,
            SUM(role = 'Supervisor')                             AS supervisors,
            SUM(role = 'Staff')                                  AS staff,
            SUM(role IN ('Admin','SuperAdmin'))                  AS admins,
            SUM(account_status = 'Pending')                     AS pending,
            SUM(account_status = 'Active')                      AS active,
            SUM(account_status = 'Suspended')                   AS suspended
          FROM users
        `),
        db.query(`
          SELECT COUNT(*) AS total,
            SUM(overall_status = 'Pending')  AS pending,
            SUM(overall_status = 'Approved') AS approved,
            SUM(overall_status = 'Rejected') AS rejected
          FROM pre_t3_requests
        `),
        db.query(`
          SELECT COUNT(*) AS total,
            SUM(overall_status = 'Pending')  AS pending,
            SUM(overall_status = 'Approved') AS approved,
            SUM(overall_status = 'Rejected') AS rejected
          FROM t3_requests
        `),
        db.query(`
          SELECT COUNT(*) AS total
          FROM msu_unwanted_journals
        `),
      ]);

      let apiKeyStats = [];
      try {
        const scopusProxy = require('../services/ScopusProxyService');
        apiKeyStats = scopusProxy.getStatus();
      } catch (_) {}

      return res.json({
        success: true,
        data: {
          users: {
            total:       Number(userRows[0].total),
            students:    Number(userRows[0].students),
            supervisors: Number(userRows[0].supervisors),
            staff:       Number(userRows[0].staff),
            admins:      Number(userRows[0].admins),
            pending:     Number(userRows[0].pending),
            active:      Number(userRows[0].active),
            suspended:   Number(userRows[0].suspended),
          },
          pre_t3:  { total: Number(preT3Rows[0].total), pending: Number(preT3Rows[0].pending), approved: Number(preT3Rows[0].approved), rejected: Number(preT3Rows[0].rejected) },
          t3:      { total: Number(t3Rows[0].total),    pending: Number(t3Rows[0].pending),    approved: Number(t3Rows[0].approved),    rejected: Number(t3Rows[0].rejected) },
          msu_unwanted: { total: Number(unwantedRows[0].total) },
          api_keys: apiKeyStats,
        },
      });
    } catch (err) { next(err); }
  }

  // ============================================================
  // GET /api/manage/users
  // Query params: role, status, search, page, limit
  // ============================================================
  static async getUsers(req, res, next) {
    try {
      const { role, status, search } = req.query;
      // ponytail: เพดาน 1000 เพราะหน้า staff manage-users ดึง limit=1000 แล้วกรองฝั่ง client — ลดได้เมื่อ FE ทำ pagination จริง
      const { page, limit, offset } = parsePagination(req.query, 1000);

      let where = ["u.role NOT IN ('Admin','SuperAdmin')"];
      const params = [];

      if (role)   { where.push('u.role = ?');           params.push(role); }
      if (status) { where.push('u.account_status = ?'); params.push(status); }
      if (search) {
        where.push('(u.first_name LIKE ? OR u.last_name LIKE ? OR u.msu_mail LIKE ?)');
        const like = `%${search}%`;
        params.push(like, like, like);
      }

      const whereSQL = where.join(' AND ');

      const [countRows] = await db.query(
        `SELECT COUNT(*) AS total FROM users u WHERE ${whereSQL}`,
        params
      );

const [rows] = await db.query(
        `SELECT
          u.user_id, u.prefix, u.first_name, u.last_name,
          u.msu_mail, u.role, u.degree_level, u.account_status,
          u.phone, u.facebook_id, u.line_id,
          u.curriculum_year, u.study_plan_code,
          u.created_at
         FROM users u
         WHERE ${whereSQL}
         ORDER BY u.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, Number(limit), offset]
      );

      // ดึง advisor ของ student แต่ละคน
      const studentIds = rows.filter(r => r.role === 'Student').map(r => r.user_id);
      let advisorMap = {};
      if (studentIds.length > 0) {
        const [advRows] = await db.query(
          `SELECT aa.student_id, aa.advisor_type,
                  u.msu_mail AS advisor_mail, u.first_name, u.last_name
           FROM advisor_assignments aa
           JOIN users u ON u.user_id = aa.advisor_id
           WHERE aa.student_id IN (?) AND aa.is_active = 1`,
          [studentIds]
        );
        for (const a of advRows) {
          if (!advisorMap[a.student_id]) advisorMap[a.student_id] = {};
          advisorMap[a.student_id][a.advisor_type] = {
            mail: a.advisor_mail,
            name: `${a.first_name} ${a.last_name}`,
          };
        }
      }

      const usersWithAdvisors = rows.map(u => ({
        ...u,
        advisors: advisorMap[u.user_id] || {},
      }));

      return res.json({
        success: true,
        data: {
          users: usersWithAdvisors,
          pagination: {
            total: Number(countRows[0].total),
            page:  Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(Number(countRows[0].total) / Number(limit)),
          },
        },
      });
    } catch (err) { next(err); }
  }

  // ============================================================
  // PATCH /api/manage/users/:id/approve  (Pending → Active)
  // ============================================================
  static async approveUser(req, res, next) {
    try {
      const { id } = req.params;
      const [target] = await db.query(
        `SELECT user_id, account_status, role, msu_mail, first_name, last_name
           FROM users WHERE user_id = ?`,
        [id]
      );
      if (!target.length) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });
      if (target[0].account_status !== 'Pending')
        return res.status(400).json({ success: false, message: 'สถานะต้องเป็น Pending เท่านั้น' });

      await db.query(
        `UPDATE users SET account_status = 'Active' WHERE user_id = ?`,
        [id]
      );

      const { msu_mail, first_name, last_name } = target[0];
      const fullName = `${first_name || ''} ${last_name || ''}`.trim();
      MailService.sendAccountApproved(msu_mail, fullName).catch(() => {});

      return res.json({ success: true, message: 'อนุมัติผู้ใช้เรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }

  // ============================================================
  // PATCH /api/manage/users/:id/suspend
  // ============================================================
  static async suspendUser(req, res, next) {
    try {
      const { id } = req.params;
      if (Number(id) === req.user.sub)
        return res.status(400).json({ success: false, message: 'ไม่สามารถระงับบัญชีตัวเองได้' });

      const [target] = await db.query(
        `SELECT user_id, account_status, role FROM users WHERE user_id = ?`,
        [id]
      );
      if (!target.length) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });
      if (['Admin','SuperAdmin'].includes(target[0].role))
        return res.status(403).json({ success: false, message: 'ไม่สามารถระงับ Admin ได้' });
      if (staffTouchingStaff(req, target[0]))
        return res.status(403).json({ success: false, message: 'Staff ไม่สามารถระงับบัญชี Staff ได้ กรุณาติดต่อ Admin' });
      // ระงับได้เฉพาะบัญชีที่ใช้งานอยู่ — บัญชี Pending (เช่น Staff ที่สมัครรออนุมัติ) ต้องอนุมัติหรือปฏิเสธแทน
      if (target[0].account_status !== 'Active')
        return res.status(400).json({ success: false, message: 'ระงับได้เฉพาะบัญชีที่มีสถานะ Active เท่านั้น' });

      await db.query(
        `UPDATE users SET account_status = 'Suspended' WHERE user_id = ?`,
        [id]
      );
      return res.json({ success: true, message: 'ระงับบัญชีเรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }

  // ============================================================
  // PATCH /api/manage/users/:id/activate  (Suspended → Active)
  // ============================================================
  static async activateUser(req, res, next) {
    try {
      const { id } = req.params;
      const [target] = await db.query(
        `SELECT user_id, account_status, role FROM users WHERE user_id = ?`,
        [id]
      );
      if (!target.length) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });
      if (['Admin', 'SuperAdmin'].includes(target[0].role))
        return res.status(403).json({ success: false, message: 'ไม่สามารถคืนสถานะ Admin ผ่านหน้านี้ได้' });
      if (staffTouchingStaff(req, target[0]))
        return res.status(403).json({ success: false, message: 'Staff ไม่สามารถคืนสถานะบัญชี Staff ได้ กรุณาติดต่อ Admin' });
      if (target[0].account_status !== 'Suspended')
        return res.status(400).json({ success: false, message: 'สถานะต้องเป็น Suspended เท่านั้น' });

      await db.query(
        `UPDATE users SET account_status = 'Active' WHERE user_id = ?`,
        [id]
      );
      return res.json({ success: true, message: 'คืนสถานะบัญชีเรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }

  // ============================================================
  // PATCH /api/manage/users/:id  — แก้ไขข้อมูล
  // Body: { prefix, first_name, last_name, phone, degree_level }
  // ============================================================
  static async updateUser(req, res, next) {
    try {
      const { id } = req.params;

      // ดึงข้อมูลเดิมมาก่อน เพื่อทำ merge
      const [target] = await db.query(
        `SELECT user_id, prefix, first_name, last_name, msu_mail,
                phone, facebook_id, line_id,
                degree_level, curriculum_year, study_plan_code, role
         FROM users
         WHERE user_id = ?`,
        [id]
      );
      if (!target.length) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });
      if (['Admin', 'SuperAdmin'].includes(target[0].role))
        return res.status(403).json({ success: false, message: 'ไม่สามารถแก้ไขข้อมูล Admin ผ่านหน้านี้ได้' });
      if (staffTouchingStaff(req, target[0]))
        return res.status(403).json({ success: false, message: 'Staff ไม่สามารถแก้ไขข้อมูล Staff ได้ กรุณาติดต่อ Admin' });

      const badField = nonStringField(req.body, ['first_name', 'last_name', 'msu_mail']);
      if (badField) return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: `${badField} ต้องเป็นข้อความ` });

      const current = target[0];
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
      };

      // Validate required fields
      if (!merged.first_name?.trim()) return res.status(400).json({ success: false, message: 'ชื่อห้ามว่าง' });
      if (!merged.last_name?.trim())  return res.status(400).json({ success: false, message: 'นามสกุลห้ามว่าง' });
      if (!merged.msu_mail?.trim())   return res.status(400).json({ success: false, message: 'อีเมลห้ามว่าง' });

      // msu_mail คือ key ของ Google login — เปลี่ยนได้เฉพาะ Admin (กัน Staff เปลี่ยนเป็นอีเมลตัวเองแล้วสวมรอยเข้าระบบ)
      const mailChanged = mailOf(merged.msu_mail) !== mailOf(current.msu_mail);
      if (mailChanged && req.user.role === 'Staff')
        return res.status(403).json({ success: false, message: 'การเปลี่ยนอีเมลต้องทำโดย Admin' });

      // degree_level/curriculum_year/study_plan_code เฉพาะนิสิต
      if (!['Student'].includes(current.role)) {
        merged.degree_level    = null;
        merged.curriculum_year = null;
        merged.study_plan_code = null;
      }

      await db.query(
        `UPDATE users SET
          prefix = ?, first_name = ?, last_name = ?, msu_mail = ?,
          phone = ?, facebook_id = ?, line_id = ?,
          degree_level = ?, curriculum_year = ?, study_plan_code = ?
         WHERE user_id = ?`,
        [
          merged.prefix || null,
          merged.first_name,
          merged.last_name,
          mailOf(merged.msu_mail),
          merged.phone || null,
          merged.facebook_id || null,
          merged.line_id || null,
          merged.degree_level || null,
          merged.curriculum_year || null,
          merged.study_plan_code || null,
          id,
        ]
      );
      if (mailChanged) await OtpModel.invalidateActive(id, 'password_reset');

      return res.json({ success: true, message: 'แก้ไขข้อมูลเรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }
  
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
        phone, degree_level, curriculum_year, study_plan_code,
        advisor_major_mail, advisor_co1_mail,
      } = req.body;

      const badField = nonStringField(req.body, ['first_name', 'last_name', 'msu_mail', 'advisor_major_mail', 'advisor_co1_mail']);
      if (badField) return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: `${badField} ต้องเป็นข้อความ` });

      // ===== Validate required =====
      if (!role)       return res.status(400).json({ success: false, message: 'กรุณาระบุ Role' });
      if (!first_name) return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อ' });
      if (!last_name)  return res.status(400).json({ success: false, message: 'กรุณาระบุนามสกุล' });
      if (!msu_mail)   return res.status(400).json({ success: false, message: 'กรุณาระบุ MSU Mail' });

      const allowedRoles = ['Student', 'Supervisor'];
      if (!allowedRoles.includes(role))
        return res.status(400).json({ success: false, message: `Role ต้องเป็น ${allowedRoles.join(', ')}` });

      const mailLower = msu_mail.toLowerCase().trim();

      // ===== เช็ก msu_mail ซ้ำ =====
      const [existing] = await db.query(
        `SELECT user_id FROM users WHERE msu_mail = ?`,
        [mailLower]
      );
      if (existing.length)
        return res.status(400).json({ success: false, message: `MSU Mail ${mailLower} มีอยู่ในระบบแล้ว` });

      // ===== เช็ก advisor (เฉพาะ Student) =====
      let advisorMajorId = null;
      let advisorCo1Id   = null;

if (role === 'Student') {
        // advisor เป็น optional — ไม่บังคับ
        if (advisor_major_mail) {
          const [majRows] = await db.query(
            `SELECT user_id FROM users
             WHERE msu_mail = ? AND role = 'Supervisor'`,
            [advisor_major_mail.toLowerCase().trim()]
          );
          if (!majRows.length)
            return res.status(400).json({ success: false, message: `ไม่พบอาจารย์ที่ปรึกษาหลัก: ${advisor_major_mail}` });
          advisorMajorId = majRows[0].user_id;
        }

        if (advisor_co1_mail) {
          const [co1Rows] = await db.query(
            `SELECT user_id FROM users
             WHERE msu_mail = ? AND role = 'Supervisor'`,
            [advisor_co1_mail.toLowerCase().trim()]
          );
          if (!co1Rows.length)
            return res.status(400).json({ success: false, message: `ไม่พบอาจารย์ที่ปรึกษาร่วม: ${advisor_co1_mail}` });
          advisorCo1Id = co1Rows[0].user_id;
        }
      }

      // ===== Insert user + advisor_assignments ในทรานแซกชันเดียว =====
      // กัน user ถูกสร้างค้างไว้แบบไม่มี advisor ถ้า insert assignment พังกลางทาง
      let newUserId;
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();

        const [result] = await conn.query(
          `INSERT INTO users
             (msu_mail,
              role, prefix, first_name, last_name,
              phone, degree_level, curriculum_year, study_plan_code,
              account_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')`,
          [
            mailLower, role,
            prefix || null, first_name.trim(), last_name.trim(),
            phone || null,
            degree_level || null, curriculum_year || null, study_plan_code || null,
          ]
        );
        newUserId = result.insertId;

        if (advisorMajorId) {
          await conn.query(
            `INSERT INTO advisor_assignments
               (student_id, advisor_id, advisor_type) VALUES (?, ?, 'Major')`,
            [newUserId, advisorMajorId]
          );
        }
        if (advisorCo1Id) {
          await conn.query(
            `INSERT INTO advisor_assignments
               (student_id, advisor_id, advisor_type) VALUES (?, ?, 'Co_1')`,
            [newUserId, advisorCo1Id]
          );
        }

        await conn.commit();
      } catch (txErr) {
        await conn.rollback();
        throw txErr;
      } finally {
        conn.release();
      }

      return res.status(201).json({
        success: true,
        message: `เพิ่ม ${role} ${first_name} ${last_name} เรียบร้อยแล้ว`,
        data: { user_id: newUserId },
      });
    } catch (err) { next(err); }
  }

  // ============================================================
  // POST /api/manage/users/import — import CSV
  // multipart/form-data: file = CSV file
  // ============================================================
  static async importUsers(req, res, next) {
    const multer  = require('multer');
    const { parse } = require('csv-parse/sync');

    // รับไฟล์ใน memory
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } }).single('file');

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

        const errors = [];

        // Batch prefetch: ดึงข้อมูลที่ต้องตรวจสอบทั้งหมดใน 2 queries แทนการ query ต่อ row
        const allMails = records
          .map(r => r.msu_mail?.toLowerCase().trim())
          .filter(Boolean);

        const allAdvisorMails = [
          ...records.map(r => r.advisor_major_mail?.toLowerCase().trim()),
          ...records.map(r => r.advisor_co1_mail?.toLowerCase().trim()),
        ].filter(Boolean);

        let existingMailSet = new Set();
        if (allMails.length) {
          const [existingRows] = await db.query(
            `SELECT msu_mail FROM users WHERE msu_mail IN (?)`,
            [allMails]
          );
          existingMailSet = new Set(existingRows.map(r => r.msu_mail));
        }

        let advisorMailMap = {};
        if (allAdvisorMails.length) {
          const [advisorRows] = await db.query(
            `SELECT user_id, msu_mail FROM users
             WHERE msu_mail IN (?) AND role = 'Supervisor'`,
            [allAdvisorMails]
          );
          for (const a of advisorRows) advisorMailMap[a.msu_mail] = a.user_id;
        }

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
            if (existingMailSet.has(mail))
              errors.push(`Row ${rowNum}: MSU Mail ${row.msu_mail} มีอยู่ในระบบแล้ว`);

            const dupInFile = records.filter((r, idx) =>
              idx !== i && r.msu_mail?.toLowerCase().trim() === mail
            );
            if (dupInFile.length) errors.push(`Row ${rowNum}: MSU Mail ${row.msu_mail} ซ้ำในไฟล์`);
          }

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
        let imported = 0;
        const conn = await db.getConnection();
        try {
          await conn.beginTransaction();

          for (const row of records) {
            const mailLower = row.msu_mail.toLowerCase().trim();

            const [result] = await conn.query(
              `INSERT INTO users
                 (msu_mail,
                  role, prefix, first_name, last_name,
                  phone, degree_level, curriculum_year, study_plan_code,
                  account_status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')`,
              [
                mailLower, row.role,
                row.prefix || null, row.first_name.trim(), row.last_name.trim(),
                row.phone || null,
                row.degree_level || null, row.curriculum_year || null, row.study_plan_code || null,
              ]
            );
            const newUserId = result.insertId;

            // ใช้ advisorMailMap ที่ fetch ไว้แล้ว ไม่ต้อง query ซ้ำ
            // เช็ค major/co1 แยกอิสระจากกัน (เหมือนตอน validate) กัน row ที่มีแค่
            // advisor_co1_mail แต่ไม่มี advisor_major_mail ไม่ได้ insert assignment เลย
            if (row.role === 'Student') {
              if (row.advisor_major_mail) {
                const majorAdvisorId = advisorMailMap[row.advisor_major_mail.toLowerCase().trim()];
                if (majorAdvisorId) {
                  await conn.query(
                    `INSERT INTO advisor_assignments
                       (student_id, advisor_id, advisor_type) VALUES (?, ?, 'Major')`,
                    [newUserId, majorAdvisorId]
                  );
                }
              }

              if (row.advisor_co1_mail) {
                const co1AdvisorId = advisorMailMap[row.advisor_co1_mail.toLowerCase().trim()];
                if (co1AdvisorId) {
                  await conn.query(
                    `INSERT INTO advisor_assignments
                       (student_id, advisor_id, advisor_type) VALUES (?, ?, 'Co_1')`,
                    [newUserId, co1AdvisorId]
                  );
                }
              }
            }

            imported++;
          }

          await conn.commit();
        } catch (txErr) {
          await conn.rollback();
          throw txErr;
        } finally {
          conn.release();
        }

        return res.json({
          success: true,
          message: `Import สำเร็จ ${imported} รายการ`,
          data: { imported },
        });

      } catch (err) { next(err); }
    });
  }

  // ============================================================
  // PATCH /api/manage/users/:id/advisors
  // Body: { advisor_major_mail?, advisor_co1_mail?, advisor_co2_mail? }
  // ============================================================
  static async updateAdvisors(req, res, next) {
    try {
      const { id } = req.params;
      const { advisor_major_mail, advisor_co1_mail, advisor_co2_mail } = req.body;
      const badField = nonStringField(req.body, ['advisor_major_mail', 'advisor_co1_mail', 'advisor_co2_mail']);
      if (badField) return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: `${badField} ต้องเป็นข้อความ` });

      // เช็กว่า student มีอยู่จริง
      const [target] = await db.query(
        `SELECT user_id, role FROM users WHERE user_id = ?`,
        [id]
      );
      if (!target.length) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });
      if (target[0].role !== 'Student')
        return res.status(400).json({ success: false, message: 'ผู้ใช้นี้ไม่ใช่นิสิต' });

      // helper: lookup advisor by mail
      const lookupAdvisor = async (mail) => {
        if (!mail || !mail.trim()) return null;
        const [rows] = await db.query(
          `SELECT user_id FROM users
           WHERE msu_mail = ? AND role = 'Supervisor'`,
          [mail.toLowerCase().trim()]
        );
        if (!rows.length) throw new Error(`ไม่พบอาจารย์ที่ปรึกษา: ${mail}`);
        return rows[0].user_id;
      };

      let majorId, co1Id, co2Id;
      try {
        majorId = await lookupAdvisor(advisor_major_mail);
        co1Id   = await lookupAdvisor(advisor_co1_mail);
        co2Id   = await lookupAdvisor(advisor_co2_mail);
      } catch (e) {
        return res.status(400).json({ success: false, message: e.message });
      }

      // ลบ assignments เดิม + insert ใหม่ ในทรานแซกชันเดียว กันเหลือ student
      // ไม่มีที่ปรึกษาเลยถ้า insert พังกลางทาง
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();

        await conn.query(`DELETE FROM advisor_assignments WHERE student_id = ?`, [id]);

        if (majorId) {
          await conn.query(
            `INSERT INTO advisor_assignments (student_id, advisor_id, advisor_type) VALUES (?, ?, 'Major')`,
            [id, majorId]
          );
        }
        if (co1Id) {
          await conn.query(
            `INSERT INTO advisor_assignments (student_id, advisor_id, advisor_type) VALUES (?, ?, 'Co_1')`,
            [id, co1Id]
          );
        }
        if (co2Id) {
          await conn.query(
            `INSERT INTO advisor_assignments (student_id, advisor_id, advisor_type) VALUES (?, ?, 'Co_2')`,
            [id, co2Id]
          );
        }

        await conn.commit();
      } catch (txErr) {
        await conn.rollback();
        throw txErr;
      } finally {
        conn.release();
      }

      return res.json({ success: true, message: 'อัปเดตอาจารย์ที่ปรึกษาเรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }

  // ============================================================
  // GET /api/admin/admins
  // Query params: status, search, page, limit
  // ============================================================
  static async getAdmins(req, res, next) {
    try {
      const { status, search } = req.query;
      const { page, limit, offset } = parsePagination(req.query);

      let where = ["u.role IN ('Admin','SuperAdmin')"];
      const params = [];

      if (status) { where.push('u.account_status = ?'); params.push(status); }
      if (search) {
        where.push('(u.username LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR u.msu_mail LIKE ?)');
        const like = `%${search}%`;
        params.push(like, like, like, like);
      }

      const whereSQL = where.join(' AND ');

      const [[countRow]] = await db.query(
        `SELECT COUNT(*) AS total FROM users u WHERE ${whereSQL}`,
        params
      );

      const [rows] = await db.query(
        `SELECT
          u.user_id, u.username, u.first_name, u.last_name,
          u.msu_mail, u.role, u.account_status,
          u.created_at
         FROM users u
         WHERE ${whereSQL}
         ORDER BY u.role DESC, u.created_at ASC
         LIMIT ? OFFSET ?`,
        [...params, Number(limit), offset]
      );

      return res.json({
        success: true,
        data: {
          admins: rows,
          pagination: {
            total:      Number(countRow.total),
            page:       Number(page),
            limit:      Number(limit),
            totalPages: Math.ceil(Number(countRow.total) / Number(limit)),
          },
        },
      });
    } catch (err) { next(err); }
  }

  // ============================================================
  // POST /api/admin/admins
  // สร้าง Admin ใหม่ (username + password)
  // Body: { username, password, first_name, last_name, msu_mail }
  // เฉพาะ Admin และ SuperAdmin
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

      // เช็ค username ซ้ำ
      const [dupUser] = await db.query(
        `SELECT user_id FROM users WHERE username = ?`,
        [username.trim().toLowerCase()]
      );
      if (dupUser.length)
        return res.status(400).json({ success: false, message: `Username "${username}" มีอยู่ในระบบแล้ว` });

      // เช็ค msu_mail ซ้ำ
      const [dupMail] = await db.query(
        `SELECT user_id FROM users WHERE msu_mail = ?`,
        [msu_mail.trim().toLowerCase()]
      );
      if (dupMail.length)
        return res.status(400).json({ success: false, message: `Email "${msu_mail}" มีอยู่ในระบบแล้ว` });

      const bcrypt = require('bcrypt');
      const passwordHash = await bcrypt.hash(password, 12);

      const [result] = await db.query(
        `INSERT INTO users
           (username, password_hash, msu_mail, role,
            first_name, last_name, account_status)
         VALUES (?, ?, ?, 'Admin', ?, ?, 'Active')`,
        [
          username.trim().toLowerCase(),
          passwordHash,
          msu_mail.trim().toLowerCase(),
          first_name.trim(),
          last_name.trim(),
        ]
      );

      return res.status(201).json({
        success: true,
        message: `สร้าง Admin "${username}" เรียบร้อยแล้ว`,
        data: { user_id: result.insertId },
      });
    } catch (err) { next(err); }
  }

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

      const [target] = await db.query(
        `SELECT user_id, role, account_status FROM users
         WHERE user_id = ?`,
        [id]
      );
      if (!target.length)
        return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });

      // Admin แตะ SuperAdmin ไม่ได้
      if (callerRole === 'Admin' && target[0].role === 'SuperAdmin')
        return res.status(403).json({ success: false, message: 'ไม่สามารถระงับ SuperAdmin ได้' });

      if (!['Admin', 'SuperAdmin'].includes(target[0].role))
        return res.status(400).json({ success: false, message: 'ผู้ใช้นี้ไม่ใช่ Admin' });

      await db.query(
        `UPDATE users SET account_status = 'Suspended' WHERE user_id = ?`,
        [id]
      );
      return res.json({ success: true, message: 'ระงับบัญชี Admin เรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }

  // ============================================================
  // PATCH /api/admin/admins/:id/activate  (Suspended → Active)
  // ============================================================
  static async activateAdmin(req, res, next) {
    try {
      const { id } = req.params;
      const callerRole = req.user.role;

      const [target] = await db.query(
        `SELECT user_id, role, account_status FROM users
         WHERE user_id = ?`,
        [id]
      );
      if (!target.length)
        return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });

      if (callerRole === 'Admin' && target[0].role === 'SuperAdmin')
        return res.status(403).json({ success: false, message: 'ไม่สามารถแก้ไข SuperAdmin ได้' });

      if (!['Admin', 'SuperAdmin'].includes(target[0].role))
        return res.status(400).json({ success: false, message: 'ผู้ใช้นี้ไม่ใช่ Admin' });

      await db.query(
        `UPDATE users SET account_status = 'Active' WHERE user_id = ?`,
        [id]
      );
      return res.json({ success: true, message: 'คืนสถานะ Admin เรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }

  // ============================================================
  // PATCH /api/admin/admins/:id  — แก้ไขข้อมูล Admin
  // Body: { first_name?, last_name?, msu_mail? }
  // ============================================================
  static async updateAdmin(req, res, next) {
    try {
      const { id } = req.params;
      const callerRole = req.user.role;

      const [target] = await db.query(
        `SELECT user_id, role, first_name, last_name, msu_mail
         FROM users
         WHERE user_id = ?`,
        [id]
      );
      if (!target.length)
        return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });

      if (callerRole === 'Admin' && target[0].role === 'SuperAdmin')
        return res.status(403).json({ success: false, message: 'ไม่สามารถแก้ไข SuperAdmin ได้' });

      if (!['Admin', 'SuperAdmin'].includes(target[0].role))
        return res.status(400).json({ success: false, message: 'ผู้ใช้นี้ไม่ใช่ Admin' });

      const badField = nonStringField(req.body, ['first_name', 'last_name', 'msu_mail']);
      if (badField) return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: `${badField} ต้องเป็นข้อความ` });

      const cur  = target[0];
      const body = req.body;

      const merged = {
        first_name: body.first_name != null ? body.first_name.trim() : cur.first_name,
        last_name:  body.last_name  != null ? body.last_name.trim()  : cur.last_name,
        msu_mail:   body.msu_mail   != null ? body.msu_mail.trim().toLowerCase() : cur.msu_mail,
      };

      if (!merged.first_name) return res.status(400).json({ success: false, message: 'ชื่อห้ามว่าง' });
      if (!merged.last_name)  return res.status(400).json({ success: false, message: 'นามสกุลห้ามว่าง' });
      if (!merged.msu_mail)   return res.status(400).json({ success: false, message: 'อีเมลห้ามว่าง' });

      // อีเมลของ Admin ใช้รับ OTP login/รีเซ็ตรหัสผ่าน — เปลี่ยนได้เฉพาะ SuperAdmin หรือเจ้าของบัญชี
      // (กัน Admin เปลี่ยนอีเมล Admin คนอื่นเป็นของตัวเองแล้ว forgot-password ยึดบัญชี)
      const mailChanged = mailOf(merged.msu_mail) !== mailOf(cur.msu_mail);
      if (mailChanged && callerRole !== 'SuperAdmin' && Number(id) !== req.user.sub)
        return res.status(403).json({ success: false, message: 'เปลี่ยนอีเมลของ Admin คนอื่นได้เฉพาะ SuperAdmin' });

      await db.query(
        `UPDATE users
         SET first_name = ?, last_name = ?, msu_mail = ?
         WHERE user_id = ?`,
        [merged.first_name, merged.last_name, merged.msu_mail, id]
      );
      if (mailChanged) await OtpModel.invalidateActive(id, 'password_reset');

      return res.json({ success: true, message: 'แก้ไขข้อมูล Admin เรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }

  // ============================================================
  // DELETE /api/admin/admins/:id  (hard delete — SuperAdmin only)
  // ============================================================
  static async deleteAdmin(req, res, next) {
    try {
      const { id } = req.params;
      const callerId   = req.user.sub;
      const callerRole = req.user.role;

      // เฉพาะ SuperAdmin เท่านั้น
      if (callerRole !== 'SuperAdmin')
        return res.status(403).json({ success: false, message: 'เฉพาะ SuperAdmin เท่านั้นที่ลบ Admin ได้' });

      if (Number(id) === callerId)
        return res.status(400).json({ success: false, message: 'ไม่สามารถลบบัญชีตัวเองได้' });

      const [target] = await db.query(
        `SELECT user_id, role FROM users
         WHERE user_id = ?`,
        [id]
      );
      if (!target.length)
        return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });

      if (target[0].role === 'SuperAdmin')
        return res.status(403).json({ success: false, message: 'ไม่สามารถลบ SuperAdmin ได้' });

      if (target[0].role !== 'Admin')
        return res.status(400).json({ success: false, message: 'ผู้ใช้นี้ไม่ใช่ Admin' });

      await db.query(
        `DELETE FROM users WHERE user_id = ?`,
        [id]
      );
      return res.json({ success: true, message: 'ลบ Admin เรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }

  
}

module.exports = AdminController;