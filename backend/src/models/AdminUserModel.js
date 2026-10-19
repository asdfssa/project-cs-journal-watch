/**
 * Admin User Model
 * Data access layer ฝั่งผู้ดูแลสำหรับ table `users` และ `advisor_assignments`/`request_approvals` ที่เกี่ยวกับการจัดการผู้ใช้
 * (UserModel ใช้กับการล็อกอิน/โปรไฟล์ของผู้ใช้เอง ส่วนไฟล์นี้ใช้กับหน้าจัดการผู้ใช้และบัญชี Admin)
 * ผู้เรียก: AdminController เท่านั้น
 */
const db = require('../config/database');
const { likeContains } = require('../utils/input');

// ขั้นอนุมัติของแต่ละช่องอาจารย์ที่ปรึกษา
const STEP_OF = { Major: 'Advisor', Co_1: 'Co_Advisor_1', Co_2: 'Co_Advisor_2' };
// คำขอ Pending ของนิสิตคนหนึ่ง ที่ขั้น step ยังรอตัดสิน (ใช้ทั้งนับและย้าย approver)
const PENDING_JOIN = (table, idCol, type) =>
  `request_approvals ra JOIN ${table} r ON ra.request_type = '${type}' AND ra.request_id = r.${idCol}`;
const PENDING_WHERE = `r.student_id = ? AND r.overall_status = 'Pending' AND ra.step = ? AND ra.status = 'Pending'`;

class AdminUserModel {
  // ===== อ่านรายการ =====

  /**
   * ผู้ใช้ทั่วไป (ไม่รวม Admin/SuperAdmin) แบบแบ่งหน้า · เรียกจาก: AdminController.getUsers
   * @param {{role?:string, status?:string, search?:string, limit:number|string, offset:number}} p
   * @returns {Promise<{rows:object[], total:number}>}
   */
  static async findPage({ role, status, search, limit, offset }) {
    const where = ["u.role NOT IN ('Admin','SuperAdmin')"];
    const params = [];

    if (role)   { where.push('u.role = ?');           params.push(role); }
    if (status) { where.push('u.account_status = ?'); params.push(status); }
    if (search) {
      where.push('(u.first_name LIKE ? OR u.last_name LIKE ? OR u.msu_mail LIKE ?)');
      const like = likeContains(search);
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
          u.curriculum_year, u.study_plan_code, u.department,
          u.created_at
         FROM users u
         WHERE ${whereSQL}
         ORDER BY u.created_at DESC
         LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );

    return { rows, total: Number(countRows[0].total) };
  }

  /** อาจารย์ที่ปรึกษา (active) ของนิสิตตามรายการ id · เรียกจาก: getUsers */
  static async findAdvisorsOfStudents(studentIds) {
    const [rows] = await db.query(
      `SELECT aa.student_id, aa.advisor_type,
                  u.msu_mail AS advisor_mail, u.first_name, u.last_name
           FROM advisor_assignments aa
           JOIN users u ON u.user_id = aa.advisor_id
           WHERE aa.student_id IN (?) AND aa.is_active = 1`,
      [studentIds]
    );
    return rows;
  }

  /** จำนวนนิสิตในความดูแลของอาจารย์แต่ละคน (นับคนละครั้งแม้ถือหลายช่อง) · เรียกจาก: getUsers · @returns {Promise<{advisor_id:number,n:number}[]>} */
  static async countStudentsPerAdvisor(advisorIds) {
    const [rows] = await db.query(
      `SELECT advisor_id, COUNT(DISTINCT student_id) AS n
             FROM advisor_assignments
            WHERE advisor_id IN (?) AND is_active = 1
            GROUP BY advisor_id`,
      [advisorIds]
    );
    return rows;
  }

  /** บัญชี Admin/SuperAdmin แบบแบ่งหน้า · เรียกจาก: getAdmins */
  static async findAdminPage({ status, search, limit, offset }) {
    const where = ["u.role IN ('Admin','SuperAdmin')"];
    const params = [];

    if (status) { where.push('u.account_status = ?'); params.push(status); }
    if (search) {
      where.push('(u.username LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR u.msu_mail LIKE ?)');
      const like = likeContains(search);
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

    return { rows, total: Number(countRow.total) };
  }

  // ===== อ่านแถวเดียว (ไม่พบ = null) =====

  /** ข้อมูลที่ใช้ตอนอนุมัติ/แจ้งอีเมล · เรียกจาก: approveUser */
  static async findForApproval(id) {
    const [rows] = await db.query(
      `SELECT user_id, account_status, role, msu_mail, first_name, last_name
           FROM users WHERE user_id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  /** user_id + role + สถานะบัญชี (ลำดับคอลัมน์ role ก่อน status) · เรียกจาก: suspendAdmin, activateAdmin */
  static async findRoleAndStatus(id) {
    const [rows] = await db.query(
      `SELECT user_id, role, account_status FROM users
         WHERE user_id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  /** user_id + สถานะบัญชี + role · เรียกจาก: suspendUser, activateUser */
  static async findStatusAndRole(id) {
    const [rows] = await db.query(
      `SELECT user_id, account_status, role FROM users WHERE user_id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  /** user_id + role · เรียกจาก: updateAdvisors, deleteAdmin, deleteUser */
  static async findRole(id) {
    const [rows] = await db.query(`SELECT user_id, role FROM users WHERE user_id = ?`, [id]);
    return rows[0] || null;
  }

  /** ข้อมูลโปรไฟล์ที่แก้ได้ของผู้ใช้ทั่วไป ใช้ทำ merge · เรียกจาก: updateUser */
  static async findEditable(id) {
    const [rows] = await db.query(
      `SELECT user_id, prefix, first_name, last_name, msu_mail,
                phone, facebook_id, line_id,
                degree_level, curriculum_year, study_plan_code, department, role
         FROM users
         WHERE user_id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  /** ข้อมูลของ Admin ที่แก้ได้ ใช้ทำ merge · เรียกจาก: updateAdmin */
  static async findAdminEditable(id) {
    const [rows] = await db.query(
      `SELECT user_id, role, prefix, first_name, last_name, msu_mail
         FROM users
         WHERE user_id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  /** password_hash ของผู้ใช้ (ไม่มี = null) · เรียกจาก: updateAdmin (ยืนยันรหัสผ่านผู้กดก่อนเปลี่ยนอีเมล) */
  static async findPasswordHash(userId) {
    const [rows] = await db.query(`SELECT password_hash FROM users WHERE user_id = ?`, [userId]);
    return rows[0]?.password_hash || null;
  }

  /** msu_mail นี้มีใน users แล้วไหม · เรียกจาก: createUser, createAdmin */
  static async mailExists(mail) {
    const [rows] = await db.query(`SELECT user_id FROM users WHERE msu_mail = ?`, [mail]);
    return rows.length > 0;
  }

  /** username นี้มีใน users แล้วไหม · เรียกจาก: createAdmin */
  static async usernameExists(username) {
    const [rows] = await db.query(`SELECT user_id FROM users WHERE username = ?`, [username]);
    return rows.length > 0;
  }

  /** user_id ของอาจารย์ (role Supervisor) จากอีเมล (ไม่พบ = null) · เรียกจาก: createUser */
  static async findSupervisorIdByMail(mail) {
    const [rows] = await db.query(
      `SELECT user_id FROM users
             WHERE msu_mail = ? AND role = 'Supervisor'`,
      [mail]
    );
    return rows[0]?.user_id ?? null;
  }

  /** อาจารย์ (role Supervisor) จากอีเมล พร้อมสถานะบัญชี (ไม่พบ = null) · เรียกจาก: updateAdvisors */
  static async findSupervisorByMail(mail) {
    const [rows] = await db.query(
      `SELECT user_id, account_status FROM users WHERE msu_mail = ? AND role = 'Supervisor'`, [mail]
    );
    return rows[0] || null;
  }

  /** อีเมลในรายการที่มีอยู่ใน DB แล้ว (lowercase) — query ครั้งเดียว · เรียกจาก: importUsers */
  static async findExistingMails(mails) {
    if (!mails.length) return new Set();
    const [rows] = await db.query(
      `SELECT msu_mail FROM users WHERE msu_mail IN (?)`,
      [mails]
    );
    // collation ของ DB ไม่สนตัวพิมพ์ จึงเจอแถวที่เก็บ "Somchai@msu.ac.th" — ต้อง lowercase ก่อนเทียบกับค่าที่ lowercase แล้วในไฟล์
    return new Set(rows.map(r => r.msu_mail.toLowerCase()));
  }

  /** แผนที่ อีเมล(lowercase) → user_id ของอาจารย์ตามอีเมลที่ให้ — query ครั้งเดียว · เรียกจาก: importUsers */
  static async findSupervisorIdsByMails(mails) {
    const map = {};
    if (!mails.length) return map;
    const [rows] = await db.query(
      `SELECT user_id, msu_mail FROM users
             WHERE msu_mail IN (?) AND role = 'Supervisor'`,
      [mails]
    );
    for (const a of rows) map[a.msu_mail.toLowerCase()] = a.user_id;
    return map;
  }

  /**
   * จำนวนข้อมูลที่ผูกกับผู้ใช้ (กันลบจนประวัติคำขอหาย) · เรียกจาก: deleteUser
   * @returns {Promise<{pre_t3:number, t3:number, advisor_of:number, approvals:number}>}
   */
  static async countRelatedData(id) {
    const [[used]] = await db.query(
      `SELECT
           (SELECT COUNT(*) FROM pre_t3_requests WHERE student_id = ?)        AS pre_t3,
           (SELECT COUNT(*) FROM t3_requests WHERE student_id = ?)            AS t3,
           (SELECT COUNT(*) FROM advisor_assignments WHERE advisor_id = ?)    AS advisor_of,
           (SELECT COUNT(*) FROM request_approvals WHERE approver_id = ?)     AS approvals`,
      [id, id, id, id]
    );
    return used;
  }

  /**
   * จำนวนคำขอ Pre-T3 + T3 ที่ยังรออาจารย์คนนี้ตัดสิน · เรียกจาก: suspendUser (เตือนให้เปลี่ยนอาจารย์ที่ปรึกษา)
   * @returns {Promise<number>}
   */
  static async countPendingApprovalsOf(approverId) {
    const count = async (table, idCol, type) => {
      const [[row]] = await db.query(
        `SELECT COUNT(*) AS n FROM request_approvals ra
               JOIN ${table} r ON ra.request_type = '${type}' AND ra.request_id = r.${idCol}
              WHERE ra.approver_id = ? AND ra.status = 'Pending' AND r.overall_status = 'Pending'`,
        [approverId]
      );
      return row.n;
    };
    return (await count('pre_t3_requests', 'pre_t3_id', 'Pre_T3')) + (await count('t3_requests', 't3_id', 'T3'));
  }

  // ===== เขียน =====

  /** เปลี่ยนสถานะบัญชีเป็น Active · เรียกจาก: approveUser, activateUser, activateAdmin */
  static async setActive(id) {
    await db.query(`UPDATE users SET account_status = 'Active' WHERE user_id = ?`, [id]);
  }

  /** เปลี่ยนสถานะบัญชีเป็น Suspended · เรียกจาก: suspendUser, suspendAdmin */
  static async setSuspended(id) {
    await db.query(`UPDATE users SET account_status = 'Suspended' WHERE user_id = ?`, [id]);
  }

  /** แก้โปรไฟล์ผู้ใช้ทั่วไป (ผู้เรียก merge ค่าเดิมและแปลงค่าว่างเป็น null มาแล้ว) · เรียกจาก: updateUser */
  static async updateProfile(id, f) {
    await db.query(
      `UPDATE users SET
          prefix = ?, first_name = ?, last_name = ?, msu_mail = ?,
          phone = ?, facebook_id = ?, line_id = ?,
          degree_level = ?, curriculum_year = ?, study_plan_code = ?, department = ?
         WHERE user_id = ?`,
      [f.prefix, f.first_name, f.last_name, f.msu_mail, f.phone, f.facebook_id, f.line_id,
       f.degree_level, f.curriculum_year, f.study_plan_code, f.department, id]
    );
  }

  /** แก้ข้อมูล Admin · เรียกจาก: updateAdmin */
  static async updateAdminProfile(id, { prefix, first_name, last_name, msu_mail }) {
    await db.query(
      `UPDATE users
         SET prefix = ?, first_name = ?, last_name = ?, msu_mail = ?
         WHERE user_id = ?`,
      [prefix, first_name, last_name, msu_mail, id]
    );
  }

  /** สร้างบัญชี Admin (Active) คืน user_id ใหม่ · เรียกจาก: createAdmin */
  static async createAdmin({ username, passwordHash, msu_mail, first_name, last_name }) {
    const [result] = await db.query(
      `INSERT INTO users
           (username, password_hash, msu_mail, role,
            first_name, last_name, account_status)
         VALUES (?, ?, ?, 'Admin', ?, ?, 'Active')`,
      [username, passwordHash, msu_mail, first_name, last_name]
    );
    return result.insertId;
  }

  /** ลบผู้ใช้ถาวรแถวเดียว (ใช้กับ Admin) · เรียกจาก: deleteAdmin */
  static async deleteById(id) {
    await db.query(`DELETE FROM users WHERE user_id = ?`, [id]);
  }

  /** ลบนิสิต/อาจารย์/Staff พร้อมการมอบหมายอาจารย์ของนิสิตใน transaction เดียว · เรียกจาก: deleteUser */
  static async deleteWithAssignments(id) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`DELETE FROM advisor_assignments WHERE student_id = ?`, [id]);
      await conn.query(`DELETE FROM users WHERE user_id = ?`, [id]);
      await conn.commit();
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }

  /**
   * เพิ่มผู้ใช้ (Active) พร้อมการมอบหมายอาจารย์ใน transaction เดียว — พังกลางทางแล้ว rollback ทั้งหมด (all-or-nothing)
   * เรียกจาก: createUser (1 แถว), importUsers (หลายแถว)
   * @param {{mail:string, role:string, prefix:string|null, first_name:string, last_name:string, phone:string|null,
   *          degree_level:string|null, curriculum_year:string|null, study_plan_code:string|null, department:string|null,
   *          majorAdvisorId?:number|null, co1AdvisorId?:number|null}[]} rows
   * @returns {Promise<number[]>} user_id ที่สร้างตามลำดับของ rows
   */
  static async createUsersWithAdvisors(rows) {
    const ids = [];
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      for (const u of rows) {
        const [result] = await conn.query(
          `INSERT INTO users
             (msu_mail,
              role, prefix, first_name, last_name,
              phone, degree_level, curriculum_year, study_plan_code, department,
              account_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')`,
          [
            u.mail, u.role,
            u.prefix, u.first_name, u.last_name,
            u.phone,
            u.degree_level, u.curriculum_year, u.study_plan_code,
            u.department,
          ]
        );
        const newUserId = result.insertId;
        ids.push(newUserId);

        // major/co1 แยกอิสระจากกัน (row ที่มีแค่ co1 ก็ต้องได้ assignment ของ co1)
        if (u.majorAdvisorId) {
          await conn.query(
            `INSERT INTO advisor_assignments
               (student_id, advisor_id, advisor_type) VALUES (?, ?, 'Major')`,
            [newUserId, u.majorAdvisorId]
          );
        }
        if (u.co1AdvisorId) {
          await conn.query(
            `INSERT INTO advisor_assignments
               (student_id, advisor_id, advisor_type) VALUES (?, ?, 'Co_1')`,
            [newUserId, u.co1AdvisorId]
          );
        }
      }

      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }
    return ids;
  }

  /**
   * แก้อาจารย์ที่ปรึกษาของนิสิต: ล็อกนิสิต → แก้ advisor_assignments → ย้าย approver ของคำขอ Pending (ขั้นที่ยังไม่ตัดสิน) ตามไป
   * ทั้งหมดใน transaction เดียว · เรียกจาก: updateAdvisors
   * @param {number|string} id นิสิต
   * @param {Object<string, number|null>} changes ช่อง (Major/Co_1/Co_2) → advisor_id ใหม่ (null = ถอด) เฉพาะช่องที่ส่งมา
   * @returns {Promise<{reassigned:number}|{error:{status:number, code:string, message:string}}>}
   *   error = เหตุผลทางธุรกิจที่ผู้เรียกตอบกลับ (rollback แล้ว) ส่วน error ของระบบ (DB พัง) จะ throw
   */
  static async reassignAdvisors(id, changes) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      // lock นิสิต ให้ admin สองคนแก้พร้อมกันต่อคิว
      await conn.query(`SELECT user_id FROM users WHERE user_id = ? FOR UPDATE`, [id]);

      const [currentRows] = await conn.query(
        `SELECT advisor_id, advisor_type FROM advisor_assignments WHERE student_id = ?`, [id]
      );
      const current = {};
      for (const r of currentRows) current[r.advisor_type] = r.advisor_id;
      const final = { ...current, ...changes };

      if (!final.Major) {
        await conn.rollback();
        return { error: { status: 400, code: 'MAJOR_REQUIRED', message: 'ต้องมีอาจารย์ที่ปรึกษาหลักเสมอ' } };
      }
      const ids = ['Major', 'Co_1', 'Co_2'].map(s => final[s]).filter(Boolean);
      if (new Set(ids).size !== ids.length) {
        await conn.rollback();
        return { error: { status: 400, code: 'DUPLICATE_ADVISOR', message: 'อาจารย์คนเดียวกันใส่ได้ช่องเดียว' } };
      }

      let reassigned = 0;
      for (const slot of Object.keys(changes)) {
        if ((current[slot] ?? null) === (final[slot] ?? null)) continue;
        const step = STEP_OF[slot];

        if (!final[slot]) {
          // ถอด Co: ถ้ายังมีคำขอ Pending รอขั้นนี้อยู่ → บล็อก ไม่งั้นแถว approval จะค้างไม่มีใครตัดสิน
          const [[a]] = await conn.query(`SELECT COUNT(*) AS n FROM ${PENDING_JOIN('pre_t3_requests', 'pre_t3_id', 'Pre_T3')} WHERE ${PENDING_WHERE}`, [id, step]);
          const [[b]] = await conn.query(`SELECT COUNT(*) AS n FROM ${PENDING_JOIN('t3_requests', 't3_id', 'T3')} WHERE ${PENDING_WHERE}`, [id, step]);
          if (a.n + b.n > 0) {
            await conn.rollback();
            return { error: {
              status: 409, code: 'ADVISOR_HAS_PENDING_REQUESTS',
              message: 'ถอดอาจารย์ร่วมไม่ได้ เพราะยังมีคำขอที่รอการอนุมัติจากอาจารย์ท่านนี้อยู่ กรุณารอให้ตัดสินก่อน หรือเปลี่ยนเป็นอาจารย์คนอื่นแทน',
            } };
          }
        } else {
          const [ra] = await conn.query(`UPDATE ${PENDING_JOIN('pre_t3_requests', 'pre_t3_id', 'Pre_T3')} SET ra.approver_id = ? WHERE ${PENDING_WHERE}`, [final[slot], id, step]);
          const [rb] = await conn.query(`UPDATE ${PENDING_JOIN('t3_requests', 't3_id', 'T3')} SET ra.approver_id = ? WHERE ${PENDING_WHERE}`, [final[slot], id, step]);
          reassigned += ra.affectedRows + rb.affectedRows;
        }

        await conn.query(`DELETE FROM advisor_assignments WHERE student_id = ? AND advisor_type = ?`, [id, slot]);
        if (final[slot]) {
          await conn.query(
            `INSERT INTO advisor_assignments (student_id, advisor_id, advisor_type) VALUES (?, ?, ?)`,
            [id, final[slot], slot]
          );
        }
      }

      await conn.commit();
      return { reassigned };
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }
  }
}

module.exports = AdminUserModel;
