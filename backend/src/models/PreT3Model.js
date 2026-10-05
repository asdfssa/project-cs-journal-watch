/**
 * PreT3Model
 * Data access layer สำหรับ table `pre_t3_requests` (schema: db/init/001_schema.sql)
 *
 * Schema v2 เปลี่ยนจาก JSON blob columns (journal_snapshot, checklist_data,
 * advisor_approval, co_advisor_1_approval, co_advisor_2_approval,
 * program_chair_approval, faculty_com_approval) เป็น:
 *   - plain typed columns บน pre_t3_requests (journal/student snapshot, article info)
 *   - 9 boolean columns (chk_*) สำหรับ checklist
 *   - หนึ่งแถวต่อหนึ่ง approval step ใน `request_approvals`
 *
 * Model นี้ยัง "ประกอบ" object รูปแบบเดิม (journal_snapshot, checklist_data,
 * advisor_approval, ...) กลับมาให้ตอน read เพื่อให้ Controller เดิมใช้งานต่อได้
 * โดยไม่ต้องแก้ไข response shape ที่ frontend คุ้นเคย
 *
 * หมายเหตุ: schema v2 ไม่มีคอลัมน์เก็บ student_info/advisor_info snapshot อีกต่อไป
 * (ข้อมูลเหล่านี้ query สดจาก users/advisor_assignments ได้อยู่แล้ว) จึงไม่ persist
 * และไม่ return สอง field นี้อีกต่อไป
 *
 * program_chair_approval: business logic เดิม (advisorReview → facultyReview ตรง ๆ)
 * ไม่เคยใช้ step 'Program_Chair' จริง (ของเดิม hardcode เป็น 'N/A' เสมอ) — A6 เลยตัด
 * step นี้ออกจาก enum ของ request_approvals ไปเลย เพราะไม่มีโค้ดจุดไหน insert แถวนี้
 */
const db = require('../config/database');
const { slotFromApproval, fetchApprovalsMap, reviewAdvisorSlot, withTransaction } = require('./_approvalHelpers');

const CHECKLIST_COLUMNS = [
  'chk_scope_match',
  'chk_website_verified',
  'chk_publication_regular',
  'chk_publisher_stated',
  'chk_editorial_board_intl',
  'chk_peer_review',
  'chk_standard_template',
  'chk_not_hijacked',
  'chk_still_indexed',
];

class PreT3Model {
  // ============================================================
  // CREATE
  // ============================================================

  /**
   * นิสิตยื่น Pre-T3 ใหม่
   * @param {number} studentId
   * @param {object} journalSnapshot  - issn, journal_name, journal_url, indexed_database, quartile_or_tier, is_discontinued, is_hijacked
   * @param {object} checklistData    - item1–item9: true/false
   * @param {object} advisorIds       - majorAdvisorId, coAdvisor1Id (null), coAdvisor2Id (null)
   * @param {object} articleInfo      - title_en, title_th, authors, doi
   * @returns {number} pre_t3_id ที่สร้างใหม่
   */
  static async create(studentId, journalSnapshot, checklistData, advisorIds, articleInfo) {
    const { majorAdvisorId, coAdvisor1Id = null, coAdvisor2Id = null } = advisorIds;

    return withTransaction(async (conn) => {
      const [result] = await conn.query(
        `INSERT INTO pre_t3_requests
           (student_id,
            issn, journal_name, journal_url, indexed_database, quartile_or_tier,
            is_discontinued, is_hijacked,
            article_title_en, article_title_th, article_authors, article_doi,
            ${CHECKLIST_COLUMNS.join(', ')},
            overall_status, resubmit_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${CHECKLIST_COLUMNS.map(() => '?').join(', ')}, 'Pending', 0)`,
        [
          studentId,
          journalSnapshot.issn,
          journalSnapshot.journal_name,
          journalSnapshot.journal_url || null,
          journalSnapshot.indexed_database,
          journalSnapshot.quartile_or_tier || null,
          journalSnapshot.is_discontinued ? 1 : 0,
          journalSnapshot.is_hijacked ? 1 : 0,
          articleInfo?.title_en || null,
          articleInfo?.title_th || null,
          articleInfo?.authors || null,
          articleInfo?.doi || null,
          ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => (checklistData[`item${i}`] ? 1 : 0)),
        ]
      );

      const preT3Id = result.insertId;

      const approvalRows = [['Advisor', majorAdvisorId]];
      if (coAdvisor1Id) approvalRows.push(['Co_Advisor_1', coAdvisor1Id]);
      if (coAdvisor2Id) approvalRows.push(['Co_Advisor_2', coAdvisor2Id]);
      approvalRows.push(['Faculty_Committee', null]);

      for (const [step, approverId] of approvalRows) {
        await conn.query(
          `INSERT INTO request_approvals (request_type, request_id, step, approver_id, status)
           VALUES ('Pre_T3', ?, ?, ?, 'Pending')`,
          [preT3Id, step, approverId]
        );
      }

      return preT3Id;
    });
  }

  // ============================================================
  // Internal helpers — ประกอบ row จาก DB columns กลับเป็น shape เดิม
  // ============================================================

  static _buildJournalSnapshot(row) {
    return {
      issn:             row.issn,
      journal_name:     row.journal_name,
      journal_url:      row.journal_url,
      indexed_database: row.indexed_database,
      quartile_or_tier: row.quartile_or_tier,
      is_discontinued:  !!row.is_discontinued,
      is_hijacked:      !!row.is_hijacked,
    };
  }

  static _buildStudentSnapshot(row) {
    return {
      degree_level:    row.degree_level,
      study_plan_code: row.study_plan_code,
      curriculum_year: row.curriculum_year,
    };
  }

  static _buildChecklistData(row) {
    const map = {
      item1: 'chk_scope_match',
      item2: 'chk_website_verified',
      item3: 'chk_publication_regular',
      item4: 'chk_publisher_stated',
      item5: 'chk_editorial_board_intl',
      item6: 'chk_peer_review',
      item7: 'chk_standard_template',
      item8: 'chk_not_hijacked',
      item9: 'chk_still_indexed',
    };
    const out = {};
    for (const [item, col] of Object.entries(map)) out[item] = !!row[col];
    return out;
  }

  static _buildArticleInfo(row) {
    return {
      title_en:     row.article_title_en,
      title_th:     row.article_title_th,
      authors:      row.article_authors,
      doi:          row.article_doi,
      publish_year: null,
      abstract:     null,
    };
  }

  /**
   * แนบ journal_snapshot / student_snapshot / checklist_data / article_info /
   * advisor_approval / co_advisor_1_approval / co_advisor_2_approval /
   * faculty_com_approval / program_chair_approval เข้ากับแต่ละ row
   */
  static async _attachDerived(rows) {
    if (!rows.length) return rows;
    const approvalsMap = await fetchApprovalsMap('Pre_T3', rows.map(r => r.pre_t3_id));

    return rows.map(row => {
      const steps = approvalsMap[row.pre_t3_id] || {};
      return {
        ...row,
        journal_snapshot:       PreT3Model._buildJournalSnapshot(row),
        student_snapshot:       PreT3Model._buildStudentSnapshot(row),
        checklist_data:         PreT3Model._buildChecklistData(row),
        article_info:           PreT3Model._buildArticleInfo(row),
        advisor_approval:       slotFromApproval(steps.Advisor),
        co_advisor_1_approval:  slotFromApproval(steps.Co_Advisor_1),
        co_advisor_2_approval:  slotFromApproval(steps.Co_Advisor_2),
        faculty_com_approval:   slotFromApproval(steps.Faculty_Committee, { withMeeting: true }),
        program_chair_approval: { status: 'N/A', user_id: null, remark: null, approved_at: null },
      };
    });
  }

  // ============================================================
  // READ
  // ============================================================

  /**
   * ดึง Pre-T3 ตาม ID (พร้อมชื่อนิสิต)
   */
  static async findById(preT3Id) {
    const [rows] = await db.query(
      `SELECT p.*,
              u.first_name, u.last_name, u.msu_mail,
              u.degree_level, u.curriculum_year, u.study_plan_code
         FROM pre_t3_requests p
         JOIN users u ON u.user_id = p.student_id
        WHERE p.pre_t3_id = ?
        LIMIT 1`,
      [preT3Id]
    );
    if (!rows[0]) return null;
    const [attached] = await PreT3Model._attachDerived(rows);
    return attached;
  }

  /**
   * ดึง Pre-T3 ทั้งหมดของนิสิตคนนึง (เรียงใหม่สุดก่อน)
   */
  static async findByStudentId(studentId) {
    const [rows] = await db.query(
      `SELECT p.*, u.degree_level, u.curriculum_year, u.study_plan_code
         FROM pre_t3_requests p
         JOIN users u ON u.user_id = p.student_id
        WHERE p.student_id = ?
        ORDER BY p.created_at DESC
        LIMIT 100`,
      [studentId]
    );
    return PreT3Model._attachDerived(rows);
  }

  /**
   * ดึงรายการที่รอ Advisor คนนี้อนุมัติ
   * ตรวจทั้ง major advisor และ co_advisor_1/2
   */
  static async findPendingForAdvisor(advisorId) {
    const [rows] = await db.query(
      `SELECT p.*, u.first_name, u.last_name, u.msu_mail, u.degree_level, u.curriculum_year, u.study_plan_code
         FROM pre_t3_requests p
         JOIN users u ON u.user_id = p.student_id
        WHERE p.overall_status = 'Pending'
          AND EXISTS (
            SELECT 1 FROM request_approvals ra
             WHERE ra.request_type = 'Pre_T3' AND ra.request_id = p.pre_t3_id
               AND ra.step IN ('Advisor','Co_Advisor_1','Co_Advisor_2')
               AND ra.approver_id = ? AND ra.status = 'Pending'
          )
        ORDER BY p.created_at ASC`,
      [advisorId]
    );
    return PreT3Model._attachDerived(rows);
  }

  /**
   * ดึงประวัติที่ Advisor คนนี้เคยอนุมัติ/ปฏิเสธแล้ว
   * @param {number} advisorId
   * @param {object} opts - { status: 'Approved'|'Rejected'|null, page, limit }
   */
  static async findReviewedByAdvisor(advisorId, { status = null, page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;

    const statusCondition = status
      ? `AND ra.status = ?`
      : `AND ra.status IN ('Approved','Rejected')`;
    const statusParams = status ? [status] : [];

    const [rows] = await db.query(
      `SELECT p.*, u.first_name, u.last_name, u.msu_mail, u.degree_level, u.curriculum_year, u.study_plan_code
         FROM pre_t3_requests p
         JOIN users u ON u.user_id = p.student_id
         JOIN request_approvals ra
           ON ra.request_type = 'Pre_T3' AND ra.request_id = p.pre_t3_id
          AND ra.step IN ('Advisor','Co_Advisor_1','Co_Advisor_2')
          AND ra.approver_id = ?
        WHERE 1=1
          ${statusCondition}
        ORDER BY p.updated_at DESC
        LIMIT ? OFFSET ?`,
      [advisorId, ...statusParams, limit, offset]
    );

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total
         FROM pre_t3_requests p
         JOIN request_approvals ra
           ON ra.request_type = 'Pre_T3' AND ra.request_id = p.pre_t3_id
          AND ra.step IN ('Advisor','Co_Advisor_1','Co_Advisor_2')
          AND ra.approver_id = ?
        WHERE 1=1
          ${statusCondition}`,
      [advisorId, ...statusParams]
    );

    return { rows: await PreT3Model._attachDerived(rows), total: countRows[0].total };
  }

  /**
   * ดึงประวัติที่ Staff (Faculty Com) เคยอนุมัติ/ปฏิเสธแล้ว
   * @param {object} opts - { status: 'Approved'|'Rejected'|null, page, limit }
   */
  static async findReviewedByFaculty({ status = null, page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;

    const statusCondition = status ? `AND ra.status = ?` : `AND ra.status IN ('Approved','Rejected')`;
    const statusParams = status ? [status] : [];

    const [rows] = await db.query(
      `SELECT p.*, u.first_name, u.last_name, u.msu_mail, u.degree_level, u.curriculum_year, u.study_plan_code
         FROM pre_t3_requests p
         JOIN users u ON u.user_id = p.student_id
         JOIN request_approvals ra
           ON ra.request_type = 'Pre_T3' AND ra.request_id = p.pre_t3_id
          AND ra.step = 'Faculty_Committee'
        WHERE 1=1
          ${statusCondition}
        ORDER BY p.updated_at DESC
        LIMIT ? OFFSET ?`,
      [...statusParams, limit, offset]
    );

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total
         FROM pre_t3_requests p
         JOIN request_approvals ra
           ON ra.request_type = 'Pre_T3' AND ra.request_id = p.pre_t3_id
          AND ra.step = 'Faculty_Committee'
        WHERE 1=1
          ${statusCondition}`,
      statusParams
    );

    return { rows: await PreT3Model._attachDerived(rows), total: countRows[0].total };
  }

  /**
   * ดึงรายการที่รอ Faculty Com อนุมัติ
   * (advisor step ทุกตัว Approved หมดแล้ว และ faculty_committee ยัง Pending)
   */
  static async findPendingForFaculty() {
    const [rows] = await db.query(
      `SELECT p.*, u.first_name, u.last_name, u.msu_mail, u.degree_level, u.curriculum_year, u.study_plan_code
         FROM pre_t3_requests p
         JOIN users u ON u.user_id = p.student_id
         JOIN request_approvals fac
           ON fac.request_type = 'Pre_T3' AND fac.request_id = p.pre_t3_id
          AND fac.step = 'Faculty_Committee' AND fac.status = 'Pending'
        WHERE p.overall_status = 'Pending'
          AND NOT EXISTS (
            SELECT 1 FROM request_approvals ra
             WHERE ra.request_type = 'Pre_T3' AND ra.request_id = p.pre_t3_id
               AND ra.step IN ('Advisor','Co_Advisor_1','Co_Advisor_2')
               AND ra.status <> 'Approved'
          )
        ORDER BY p.created_at ASC`
    );
    return PreT3Model._attachDerived(rows);
  }

  // ============================================================
  // UPDATE — Advisor Review
  // ============================================================

  /**
   * Advisor (major/co) อนุมัติหรือปฏิเสธ
   * ถ้า reject → overall_status = 'Rejected' ทันที
   * ถ้า approve ทุกคน → ส่งต่อ faculty_com
   */
  static async advisorReview(preT3Id, advisorId, action, remark) {
    return withTransaction(async (conn) => {
      // ล็อค row + เช็ค overall_status สดในทรานแซกชันนี้ กัน race กับ cancel()/
      // action อื่นที่อาจเปลี่ยนสถานะไปแล้วตั้งแต่ controller อ่านมาก่อนหน้านี้
      const [reqRows] = await conn.query(
        `SELECT overall_status FROM pre_t3_requests WHERE pre_t3_id = ? FOR UPDATE`,
        [preT3Id]
      );
      if (!reqRows.length || reqRows[0].overall_status !== 'Pending') return null;

      const result = await reviewAdvisorSlot(conn, 'Pre_T3', preT3Id, advisorId, action, remark);
      if (!result) return null;
      const { anyRejected, allApproved } = result;

      let newOverallStatus = 'Pending';
      if (anyRejected) {
        newOverallStatus = 'Rejected';
        await conn.query(
          `UPDATE pre_t3_requests SET overall_status = 'Rejected', last_rejected_at = NOW() WHERE pre_t3_id = ?`,
          [preT3Id]
        );
      }
      // ถ้า approve ครบ → overall ยังเป็น Pending รอ faculty_com (ไม่เปลี่ยน)

      return { anyRejected, allApproved, newOverallStatus };
    });
  }

  // ============================================================
  // UPDATE — Faculty Com Review
  // ============================================================

  /**
   * Staff/Faculty Com อนุมัติหรือปฏิเสธขั้นสุดท้าย
   * @param {number} preT3Id
   * @param {string} action       - 'approve' | 'reject'
   * @param {string|null} meetingNo   - เฉพาะตอน approve
   * @param {string|null} meetingDate - เฉพาะตอน approve (YYYY-MM-DD)
   * @param {string|null} remark
   */
  static async facultyReview(preT3Id, action, meetingNo, meetingDate, remark) {
    if (!['approve', 'reject'].includes(action)) {
      throw new Error(`PreT3Model.facultyReview: invalid action "${action}"`);
    }
    const status = action === 'approve' ? 'Approved' : 'Rejected';

    return withTransaction(async (conn) => {
      const [reqRows] = await conn.query(
        `SELECT overall_status FROM pre_t3_requests WHERE pre_t3_id = ? FOR UPDATE`,
        [preT3Id]
      );
      if (!reqRows.length || reqRows[0].overall_status !== 'Pending') return null;

      await conn.query(
        `UPDATE request_approvals
            SET status = ?, meeting_no = ?, meeting_date = ?, remark = ?, decided_at = NOW()
          WHERE request_type = 'Pre_T3' AND request_id = ? AND step = 'Faculty_Committee'`,
        [status, meetingNo || null, meetingDate || null, remark || null, preT3Id]
      );

      const newOverallStatus = status;
      await conn.query(
        `UPDATE pre_t3_requests
            SET overall_status   = ?,
                last_rejected_at = CASE WHEN ? = 'Rejected' THEN NOW() ELSE last_rejected_at END
          WHERE pre_t3_id = ?`,
        [newOverallStatus, status, preT3Id]
      );

      return { newOverallStatus };
    });
  }

  // ============================================================
  // RESUBMIT (นิสิตยื่นซ้ำหลัง Rejected)
  // ============================================================

  /**
   * Reset request ให้กลับมา Pending อีกครั้ง (resubmit)
   * นิสิตแก้ไข checklist + journal แล้วยื่นใหม่
   */
  static async resubmit(preT3Id, journalSnapshot, checklistData, articleInfo) {
    return withTransaction(async (conn) => {
      const [result] = await conn.query(
        `UPDATE pre_t3_requests
            SET issn              = ?,
                journal_name      = ?,
                journal_url       = ?,
                indexed_database  = ?,
                quartile_or_tier  = ?,
                is_discontinued   = ?,
                is_hijacked       = ?,
                article_title_en  = ?,
                article_title_th  = ?,
                article_authors   = ?,
                article_doi       = ?,
                ${CHECKLIST_COLUMNS.map(c => `${c} = ?`).join(', ')},
                overall_status    = 'Pending',
                resubmit_count    = resubmit_count + 1
          WHERE pre_t3_id = ?
            AND overall_status = 'Rejected'`,
        [
          journalSnapshot.issn,
          journalSnapshot.journal_name,
          journalSnapshot.journal_url || null,
          journalSnapshot.indexed_database,
          journalSnapshot.quartile_or_tier || null,
          journalSnapshot.is_discontinued ? 1 : 0,
          journalSnapshot.is_hijacked ? 1 : 0,
          articleInfo?.title_en || null,
          articleInfo?.title_th || null,
          articleInfo?.authors || null,
          articleInfo?.doi || null,
          ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => (checklistData[`item${i}`] ? 1 : 0)),
          preT3Id,
        ]
      );

      if (result.affectedRows === 0) return false;

      // reset ทุก approval step ที่เคยสร้างไว้กลับเป็น Pending
      await conn.query(
        `UPDATE request_approvals
            SET status = 'Pending', remark = NULL, meeting_no = NULL, meeting_date = NULL, decided_at = NULL
          WHERE request_type = 'Pre_T3' AND request_id = ?`,
        [preT3Id]
      );

      return true;
    });
  }

  // ============================================================
  // CANCEL (นิสิตยกเลิกคำขอของตัวเอง)
  // ============================================================

  /**
   * เปลี่ยน overall_status เป็น 'Cancelled'
   * ทำได้ตอน Pending/Rejected เสมอ หรือ Approved ก็ได้ถ้ายังไม่มี T3 ที่ Approved
   * ผูกอยู่ (กัน record ที่สำเร็จสมบูรณ์แล้วถูกลบทิ้งโดยไม่ตั้งใจ — race-safe เพราะ
   * เช็คในเงื่อนไข UPDATE เดียวกันแบบ atomic ไม่ใช่เช็คแยกก่อน)
   */
  static async cancel(preT3Id) {
    const [result] = await db.query(
      `UPDATE pre_t3_requests p
          SET overall_status = 'Cancelled'
        WHERE p.pre_t3_id = ?
          AND (
            p.overall_status IN ('Pending', 'Rejected')
            OR (
              p.overall_status = 'Approved'
              AND NOT EXISTS (
                SELECT 1 FROM t3_requests t
                 WHERE t.pre_t3_id = p.pre_t3_id AND t.overall_status IN ('Pending', 'Approved')
              )
            )
          )`,
      [preT3Id]
    );
    return result.affectedRows > 0;
  }

  /**
   * เช็คว่า Pre-T3 นี้มี T3 ที่ยังรอพิจารณาหรืออนุมัติแล้วผูกอยู่ไหม (ใช้ตัดสินใจก่อนยกเลิก)
   */
  static async hasActiveT3(preT3Id) {
    const [rows] = await db.query(
      `SELECT 1 FROM t3_requests WHERE pre_t3_id = ? AND overall_status IN ('Pending', 'Approved') LIMIT 1`,
      [preT3Id]
    );
    return rows.length > 0;
  }
}

module.exports = PreT3Model;
