/**
 * T3Model
 * Data access layer สำหรับ table `t3_requests` (schema: db/init/001_schema.sql)
 *
 * เช่นเดียวกับ PreT3Model — schema v2 แปลง JSON blob columns เป็น plain typed
 * columns + `request_approvals` (หนึ่งแถวต่อหนึ่ง approval step) +
 * `t3_evidence_files` (หนึ่งแถวต่อหนึ่งไฟล์แนบ แทน journal_evidence_files JSON)
 *
 * Model นี้ประกอบ object รูปแบบเดิม (journal_snapshot, paper_and_research_details,
 * publication_details, journal_metrics, journal_evidence_files, advisor_approval, ...)
 * กลับมาให้ตอน read เพื่อให้ Controller เดิมใช้งานต่อได้โดยไม่ต้องแก้ response shape
 *
 * A6: t3_requests ไม่เก็บ issn/journal_name/degree_level/curriculum_year/
 * study_plan_code ของตัวเองอีกต่อไป (ซ้ำกับ pre_t3_requests/users) — อ่านสด
 * ผ่าน JOIN pre_t3_requests (โดย pre_t3_id) และ JOIN users (โดย student_id)
 * แทนทุกจุด เพราะ T3 ต้องอ้าง pre_t3_id ที่ Approved แล้วเสมอ ค่าพวกนี้ไม่มีทาง
 * เปลี่ยนหลังยื่นจริง (ต่างจาก pre_t3_requests ที่เป็น snapshot ตอนยื่น)
 *
 * grad_school / submission_date / submission_round_cutoff: ตัดออกทั้งหมดใน A6
 * เพราะไม่มีโค้ดจุดไหนอ่าน/เขียนจริง (endpoint grad-school-review ไม่มีอยู่จริง
 * ในระบบ — ดู master_list.md A7)
 */
const db = require('../config/database');
const { slotFromApproval, fetchApprovalsMap, reviewAdvisorSlot, withTransaction, advisorNotAllApprovedSql } = require('./_approvalHelpers');

const FILE_TYPE_TO_KEY = {
  Acceptance_Letter:   'acceptance_letter_path',
  Full_Paper:          'full_paper_path',
  Journal_Cover:       'journal_cover_path',
  Table_Of_Contents:   'table_of_contents_path',
  Database_Evidence:   'database_evidence_path',
  Peer_Review_Result:  'peer_review_result_path',
};

const KEY_TO_FILE_TYPE = Object.fromEntries(
  Object.entries(FILE_TYPE_TO_KEY).map(([fileType, key]) => [key, fileType])
);

class T3Model {
  // ============================================================
  // CREATE
  // ============================================================

  /**
   * นิสิตยื่น T3 ใหม่
   * @param {number} studentId
   * @param {number} preT3Id               - ต้องมี Pre-T3 Approved ก่อน (issn/journal_name อ่านจาก record นี้ตอน read)
   * @param {object} paperAndResearchDetails - title_thai, title_english, first_author, corresponding_author, innovation_type, innovation_detail
   * @param {object} publicationDetails    - type, weight_score, specified_database, status, volume, issue, publish_year
   * @param {object} journalMetrics        - has_impact_score, impact_factor, citescore, score_year
   * @param {object} advisorIds            - majorAdvisorId, coAdvisor1Id, coAdvisor2Id
   * @param {Function} [afterInsert]       - async (conn, t3Id) รันใน transaction เดียวกัน (เช่น เขียนไฟล์แนบ + แถว evidence)
   *                                         ถ้า throw → rollback ทั้ง T3 (B30)
   * @returns {number} t3_id ที่สร้างใหม่
   *
   * เรียกจาก: T3Controller._validateAndCreate (ซึ่งถูกเรียกจาก T3Controller.submitWithFiles) หลัง validate และ derive ชนิด/น้ำหนักวารสารแล้ว
   * ใน transaction เดียว: ล็อกแถว Pre-T3 (ต้อง Approved) → กัน T3 ซ้ำบน Pre-T3 เดียวกัน → INSERT t3_requests → INSERT request_approvals ทุก step
   *   → afterInsert(conn, t3Id) ถ้ามี (controller ใช้เขียนไฟล์แนบ + upsertEvidenceFile ในทรานแซกชันนี้) · afterInsert throw = rollback ทั้งหมด
   * throw Error code 'PRE_T3_NOT_APPROVED' หรือ 'T3_ALREADY_EXISTS' — controller แปลงเป็น 400 / 409
   */
  static async create(
    studentId,
    preT3Id,
    paperAndResearchDetails,
    publicationDetails,
    journalMetrics,
    advisorIds,
    afterInsert = null
  ) {
    const { majorAdvisorId, coAdvisor1Id = null, coAdvisor2Id = null } = advisorIds;

    return withTransaction(async (conn) => {
      // lock แถว Pre-T3 ก่อน — กดซ้ำพร้อมกัน/ชนกับ cancel จะต่อคิวที่นี่ (B29)
      const [preRows] = await conn.query(
        `SELECT overall_status FROM pre_t3_requests WHERE pre_t3_id = ? FOR UPDATE`,
        [preT3Id]
      );
      if (!preRows.length || preRows[0].overall_status !== 'Approved') {
        throw Object.assign(new Error('Pre-T3 is not Approved'), { code: 'PRE_T3_NOT_APPROVED' });
      }
      // Rejected/Cancelled ไม่นับ → ยื่น T3 ใหม่บน Pre-T3 เดิมได้
      const [dup] = await conn.query(
        `SELECT 1 FROM t3_requests
          WHERE pre_t3_id = ? AND overall_status IN ('Pending', 'Approved') LIMIT 1`,
        [preT3Id]
      );
      if (dup.length) {
        throw Object.assign(new Error('T3 already exists for this Pre-T3'), { code: 'T3_ALREADY_EXISTS' });
      }

      const [result] = await conn.query(
        `INSERT INTO t3_requests
           (pre_t3_id, student_id,
            title_thai, title_english, first_author, corresponding_author,
            innovation_type, innovation_detail,
            publication_type, weight_score, specified_database, publication_status,
            volume, issue, publish_year,
            has_impact_score, impact_factor, citescore, score_year,
            overall_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')`,
        [
          preT3Id,
          studentId,
          paperAndResearchDetails.title_thai,
          paperAndResearchDetails.title_english,
          paperAndResearchDetails.first_author,
          paperAndResearchDetails.corresponding_author,
          paperAndResearchDetails.innovation_type || 'None',
          paperAndResearchDetails.innovation_detail || null,
          publicationDetails.type,
          publicationDetails.weight_score,
          publicationDetails.specified_database || null,
          publicationDetails.status,
          publicationDetails.volume || null,
          publicationDetails.issue || null,
          publicationDetails.publish_year || null,
          journalMetrics.has_impact_score ? 1 : 0,
          journalMetrics.impact_factor ?? null,
          journalMetrics.citescore ?? null,
          journalMetrics.score_year || null,
        ]
      );

      const t3Id = result.insertId;

      const approvalRows = [['Advisor', majorAdvisorId]];
      if (coAdvisor1Id) approvalRows.push(['Co_Advisor_1', coAdvisor1Id]);
      if (coAdvisor2Id) approvalRows.push(['Co_Advisor_2', coAdvisor2Id]);
      approvalRows.push(['Faculty_Committee', null]);

      for (const [step, approverId] of approvalRows) {
        await conn.query(
          `INSERT INTO request_approvals (request_type, request_id, step, approver_id, status)
           VALUES ('T3', ?, ?, ?, 'Pending')`,
          [t3Id, step, approverId]
        );
      }

      if (afterInsert) await afterInsert(conn, t3Id);

      return t3Id;
    });
  }

  // ============================================================
  // Internal helpers — ประกอบ row จาก DB columns กลับเป็น shape เดิม
  // ============================================================

  static _buildJournalSnapshot(row) {
    return { issn: row.issn, journal_name: row.journal_name };
  }

  static _buildStudentSnapshot(row) {
    return {
      degree_level:    row.degree_level,
      study_plan_code: row.study_plan_code,
      curriculum_year: row.curriculum_year,
    };
  }

  static _buildPaperAndResearchDetails(row) {
    return {
      title_thai:            row.title_thai,
      title_english:         row.title_english,
      first_author:          row.first_author,
      corresponding_author:  row.corresponding_author,
      innovation_type:       row.innovation_type,
      innovation_detail:     row.innovation_detail,
    };
  }

  static _buildPublicationDetails(row) {
    return {
      type:               row.publication_type,
      weight_score:       row.weight_score,
      specified_database: row.specified_database,
      status:             row.publication_status,
      volume:             row.volume,
      issue:              row.issue,
      publish_year:       row.publish_year,
    };
  }

  static _buildJournalMetrics(row) {
    return {
      has_impact_score: !!row.has_impact_score,
      impact_factor:    row.impact_factor,
      citescore:        row.citescore,
      score_year:       row.score_year,
    };
  }

  /**
   * ดึง path ไฟล์แนบของหลาย T3 รวดเดียวจาก t3_evidence_files แล้วจัดเป็น { [t3_id]: { acceptance_letter_path, full_paper_path, ... } } (ไม่มีไฟล์ = null)
   * เรียกจาก: T3Model._attachDerived · ผลกลายเป็น journal_evidence_files ใน response (ดาวน์โหลดจริงผ่าน UploadController.downloadFile)
   */
  static async _fetchEvidenceFilesMap(t3Ids) {
    if (!t3Ids.length) return {};
    const [rows] = await db.query(
      `SELECT t3_id, file_type, file_path FROM t3_evidence_files WHERE t3_id IN (?)`,
      [t3Ids]
    );
    const map = {};
    for (const id of t3Ids) {
      map[id] = {
        acceptance_letter_path:  null,
        full_paper_path:         null,
        journal_cover_path:      null,
        table_of_contents_path:  null,
        database_evidence_path:  null,
        peer_review_result_path: null,
      };
    }
    for (const r of rows) {
      const key = FILE_TYPE_TO_KEY[r.file_type];
      if (key) map[r.t3_id][key] = r.file_path;
    }
    return map;
  }

  /**
   * ทางผ่านเดียวของผลอ่านทุก method ใน Model นี้ ก่อนส่งให้ T3Controller._formatRow
   * ประกอบ journal_snapshot, student_snapshot, paper_and_research_details, publication_details, journal_metrics, journal_evidence_files และช่อง *_approval ของแต่ละแถว
   * @param {object[]} rows แถวจาก t3_requests (JOIN users/pre_t3_requests แล้ว)
   * @returns {Promise<object[]>}
   */
  static async _attachDerived(rows) {
    if (!rows.length) return rows;
    const ids = rows.map(r => r.t3_id);
    const [approvalsMap, evidenceMap] = await Promise.all([
      fetchApprovalsMap('T3', ids),
      T3Model._fetchEvidenceFilesMap(ids),
    ]);

    return rows.map(row => {
      const steps = approvalsMap[row.t3_id] || {};
      return {
        ...row,
        journal_snapshot:           T3Model._buildJournalSnapshot(row),
        student_snapshot:           T3Model._buildStudentSnapshot(row),
        paper_and_research_details: T3Model._buildPaperAndResearchDetails(row),
        publication_details:        T3Model._buildPublicationDetails(row),
        journal_metrics:            T3Model._buildJournalMetrics(row),
        journal_evidence_files:     evidenceMap[row.t3_id],
        advisor_approval:           slotFromApproval(steps.Advisor),
        co_advisor_1_approval:      slotFromApproval(steps.Co_Advisor_1),
        co_advisor_2_approval:      slotFromApproval(steps.Co_Advisor_2),
        faculty_com_approval:       slotFromApproval(steps.Faculty_Committee, { withMeeting: true }),
      };
    });
  }

  // ============================================================
  // Evidence files (t3_evidence_files)
  // ============================================================

  /**
   * บันทึก/แทนที่ path ไฟล์แนบ 1 ชนิดของ T3
   * เรียกจาก: T3Controller.submitWithFiles (ผ่าน callback afterInsert ของ T3Model.create — ส่ง conn ของ transaction เข้ามาเพื่อให้ rollback ได้)
   * @param {number} t3Id
   * @param {string} fieldName ชื่อ field ของ multipart เช่น 'full_paper' (หรือรูป *_path)
   * @param {string} filePath path แบบ relative จาก process.cwd() เช่น uploads/t3/12/full_paper/<uuid>.pdf
   * @param {object} [conn] connection ของ transaction (ค่าเริ่มต้น pool)
   * @returns {Promise<boolean>} false = ชื่อ field ไม่รู้จัก
   */
  static async upsertEvidenceFile(t3Id, fieldName, filePath, conn = db) {
    const fileType = KEY_TO_FILE_TYPE[fieldName] || KEY_TO_FILE_TYPE[`${fieldName}_path`];
    if (!fileType) return false;
    await conn.query(
      `INSERT INTO t3_evidence_files (t3_id, file_type, file_path)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE file_path = VALUES(file_path)`,
      [t3Id, fileType, filePath]
    );
    return true;
  }

  /**
   * ลบแถวไฟล์แนบ 1 ชนิด — ปัจจุบันยังไม่มีที่ไหนเรียกใช้ (เตรียมไว้สำหรับเปลี่ยน/ลบไฟล์ภายหลัง) และไม่ได้ลบไฟล์บนดิสก์
   * @param {number} t3Id
   * @param {string} fieldName
   */
  static async removeEvidenceFile(t3Id, fieldName) {
    const fileType = KEY_TO_FILE_TYPE[fieldName] || KEY_TO_FILE_TYPE[`${fieldName}_path`];
    if (!fileType) return false;
    await db.query(
      `DELETE FROM t3_evidence_files WHERE t3_id = ? AND file_type = ?`,
      [t3Id, fileType]
    );
    return true;
  }

  // ============================================================
  // READ
  // ============================================================

  /**
   * ดึง T3 ตาม ID (พร้อมชื่อนิสิต)
   *
   * เรียกจาก: T3Controller (getById, advisorReview, facultyReview, cancel) และ UploadController.downloadFile (ตรวจสิทธิ์ก่อนส่งไฟล์)
   * @returns {Promise<object|null>} ผ่าน _attachDerived แล้ว
   */
  static async findById(t3Id) {
    const [rows] = await db.query(
      `SELECT t.*,
              u.first_name, u.last_name, u.msu_mail,
              u.degree_level, u.curriculum_year, u.study_plan_code,
              p.issn, p.journal_name
         FROM t3_requests t
         JOIN users u ON u.user_id = t.student_id
         JOIN pre_t3_requests p ON p.pre_t3_id = t.pre_t3_id
        WHERE t.t3_id = ?
        LIMIT 1`,
      [t3Id]
    );
    if (!rows[0]) return null;
    const [attached] = await T3Model._attachDerived(rows);
    return attached;
  }

  /**
   * ดึง T3 ทั้งหมดของนิสิตคนนึง (เรียงใหม่สุดก่อน)
   *
   * เรียกจาก: T3Controller.getMyRequests (GET /t3/my)
   * @param {number} studentId req.user.sub ของนิสิต
   */
  static async findByStudentId(studentId) {
    const [rows] = await db.query(
      `SELECT t.*,
              u.degree_level, u.curriculum_year, u.study_plan_code,
              p.issn, p.journal_name
         FROM t3_requests t
         JOIN users u ON u.user_id = t.student_id
         JOIN pre_t3_requests p ON p.pre_t3_id = t.pre_t3_id
        WHERE t.student_id = ?
        ORDER BY t.created_at DESC
        LIMIT 100`,
      [studentId]
    );
    return T3Model._attachDerived(rows);
  }

  /**
   * ดึงรายการที่อยู่ในคิวของอาจารย์คนนี้ — อาจารย์หลัก (กดตัดสินได้) และอาจารย์ร่วม (ดูอย่างเดียว)
   * แยกสิทธิ์ด้วย my_role / can_review ที่ controller แนบให้ (advisorViewFields) ไม่ใช่ด้วยการซ่อนรายการ
   *
   * เรียกจาก: T3Controller.getPending เมื่อ role = Supervisor (GET /t3/pending)
   * @param {number} advisorId req.user.sub ของอาจารย์
   */
  static async findPendingForAdvisor(advisorId) {
    const [rows] = await db.query(
      `SELECT t.*, u.first_name, u.last_name, u.msu_mail,
              u.degree_level, u.curriculum_year, u.study_plan_code,
              p.issn, p.journal_name
         FROM t3_requests t
         JOIN users u ON u.user_id = t.student_id
         JOIN pre_t3_requests p ON p.pre_t3_id = t.pre_t3_id
        WHERE t.overall_status = 'Pending'
          AND EXISTS (
            SELECT 1 FROM request_approvals ra
             WHERE ra.request_type = 'T3' AND ra.request_id = t.t3_id
               AND ra.step IN ('Advisor','Co_Advisor_1','Co_Advisor_2')
               AND ra.approver_id = ? AND ra.status = 'Pending'
          )
        ORDER BY t.created_at ASC`,
      [advisorId]
    );
    return T3Model._attachDerived(rows);
  }

  /**
   * ดึงประวัติที่อาจารย์ที่ปรึกษา (หลักหรือร่วม) ของคำร้องนี้ — นับตามผลที่อาจารย์หลักตัดสินแล้ว
   * (อนุมัติ/ปฏิเสธเป็นสิทธิ์ของอาจารย์หลักคนเดียว อาจารย์ร่วมจึงเห็นผลเดียวกัน ทั้งอนุมัติและปฏิเสธ)
   * ใช้ EXISTS → ไม่ซ้ำแถว แม้อาจารย์คนเดียวถือหลายช่อง (เช่น เป็นทั้ง Co_1 และ Co_2)
   * @param {number} advisorId
   * @param {object} opts - { status: 'Approved'|'Rejected'|null, page, limit } — status = ผลของอาจารย์หลัก
   *
   * เรียกจาก: T3Controller.getHistory เมื่อ role = Supervisor (GET /t3/history)
   * @returns {Promise<{rows:object[], total:number}>}
   */
  static async findReviewedByAdvisor(advisorId, { status = null, page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;

    const statusCondition = status ? `maj.status = ?` : `maj.status IN ('Approved','Rejected')`;
    const params = [advisorId, ...(status ? [status] : [])];
    const where = `
        WHERE EXISTS (
                SELECT 1 FROM request_approvals me
                 WHERE me.request_type = 'T3' AND me.request_id = t.t3_id
                   AND me.step IN ('Advisor','Co_Advisor_1','Co_Advisor_2')
                   AND me.approver_id = ?)
          AND EXISTS (
                SELECT 1 FROM request_approvals maj
                 WHERE maj.request_type = 'T3' AND maj.request_id = t.t3_id
                   AND maj.step = 'Advisor' AND ${statusCondition})`;

    const [rows] = await db.query(
      `SELECT t.*, u.first_name, u.last_name, u.msu_mail,
              u.degree_level, u.curriculum_year, u.study_plan_code,
              p.issn, p.journal_name
         FROM t3_requests t
         JOIN users u ON u.user_id = t.student_id
         JOIN pre_t3_requests p ON p.pre_t3_id = t.pre_t3_id
        ${where}
        -- เรียงตามเวลาที่อาจารย์หลักตัดสิน (updated_at เปลี่ยนตามการแก้อย่างอื่นด้วย เช่น ยกเลิก/ยื่นซ้ำ)
        ORDER BY (SELECT maj_o.decided_at FROM request_approvals maj_o
                   WHERE maj_o.request_type = 'T3' AND maj_o.request_id = t.t3_id
                     AND maj_o.step = 'Advisor') DESC, t.t3_id DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM t3_requests t ${where}`,
      params
    );

    return { rows: await T3Model._attachDerived(rows), total: countRows[0].total };
  }

  /**
   * ดึงประวัติที่ Staff (Faculty Com) เคยอนุมัติ/ปฏิเสธแล้ว
   * @param {object} opts - { status: 'Approved'|'Rejected'|null, page, limit }
   *
   * เรียกจาก: T3Controller.getHistory เมื่อ role = Staff (GET /t3/history)
   * @returns {Promise<{rows:object[], total:number}>}
   */
  static async findReviewedByFaculty({ status = null, page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;

    const statusCondition = status ? `AND ra.status = ?` : `AND ra.status IN ('Approved','Rejected')`;
    const statusParams = status ? [status] : [];

    const [rows] = await db.query(
      `SELECT t.*, u.first_name, u.last_name, u.msu_mail,
              u.degree_level, u.curriculum_year, u.study_plan_code,
              p.issn, p.journal_name
         FROM t3_requests t
         JOIN users u ON u.user_id = t.student_id
         JOIN pre_t3_requests p ON p.pre_t3_id = t.pre_t3_id
         JOIN request_approvals ra
           ON ra.request_type = 'T3' AND ra.request_id = t.t3_id
          AND ra.step = 'Faculty_Committee'
        WHERE 1=1
          ${statusCondition}
        ORDER BY ra.decided_at DESC, t.t3_id DESC
        LIMIT ? OFFSET ?`,
      [...statusParams, limit, offset]
    );

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total
         FROM t3_requests t
         JOIN request_approvals ra
           ON ra.request_type = 'T3' AND ra.request_id = t.t3_id
          AND ra.step = 'Faculty_Committee'
        WHERE 1=1
          ${statusCondition}`,
      statusParams
    );

    return { rows: await T3Model._attachDerived(rows), total: countRows[0].total };
  }

  /**
   * ดึงรายการที่ advisor approve ครบแล้ว รอ Faculty Com
   *
   * เรียกจาก: T3Controller.getPending เมื่อ role = Staff (GET /t3/pending) · เฉพาะ T3 ที่อาจารย์อนุมัติครบและรอ Faculty Com
   */
  static async findPendingForFaculty() {
    const [rows] = await db.query(
      `SELECT t.*, u.first_name, u.last_name, u.msu_mail,
              u.degree_level, u.curriculum_year, u.study_plan_code,
              p.issn, p.journal_name
         FROM t3_requests t
         JOIN users u ON u.user_id = t.student_id
         JOIN pre_t3_requests p ON p.pre_t3_id = t.pre_t3_id
         JOIN request_approvals fac
           ON fac.request_type = 'T3' AND fac.request_id = t.t3_id
          AND fac.step = 'Faculty_Committee' AND fac.status = 'Pending'
        WHERE t.overall_status = 'Pending'
          AND NOT EXISTS (
            SELECT 1 FROM request_approvals ra
             WHERE ra.request_type = 'T3' AND ra.request_id = t.t3_id
               AND ra.step IN ('Advisor','Co_Advisor_1','Co_Advisor_2')
               AND ra.status <> 'Approved'
          )
        ORDER BY t.created_at ASC
        LIMIT 1000`
    );
    return T3Model._attachDerived(rows);
  }

  // ============================================================
  // UPDATE — Advisor Review
  // ============================================================

  /**
   * เรียกจาก: T3Controller.advisorReview (หลังตรวจแล้วว่าผู้กดเป็นอาจารย์หลักที่ยังไม่ตัดสิน)
   * ใน transaction: ล็อกแถว T3 → reviewAdvisorSlot → ถ้ามีคน reject ตั้ง overall_status = 'Rejected'
   * @param {number} t3Id
   * @param {number} advisorId req.user.sub
   * @param {'approve'|'reject'} action
   * @param {string|null} remark
   * @returns {Promise<{anyRejected:boolean, allApproved:boolean, newOverallStatus:string}|null>} null = สถานะเปลี่ยนไปแล้ว (controller ตอบ 409)
   */
  static async advisorReview(t3Id, advisorId, action, remark) {
    return withTransaction(async (conn) => {
      // ล็อค row + เช็ค overall_status สดในทรานแซกชันนี้ กัน race กับ cancel()/
      // action อื่นที่อาจเปลี่ยนสถานะไปแล้วตั้งแต่ controller อ่านมาก่อนหน้านี้
      const [reqRows] = await conn.query(
        `SELECT overall_status FROM t3_requests WHERE t3_id = ? FOR UPDATE`,
        [t3Id]
      );
      if (!reqRows.length || reqRows[0].overall_status !== 'Pending') return null;

      const result = await reviewAdvisorSlot(conn, 'T3', t3Id, advisorId, action, remark);
      if (!result) return null;
      const { anyRejected, allApproved } = result;

      const newOverallStatus = anyRejected ? 'Rejected' : 'Pending';
      if (anyRejected) {
        await conn.query(`UPDATE t3_requests SET overall_status = 'Rejected' WHERE t3_id = ?`, [t3Id]);
      }

      return { anyRejected, allApproved, newOverallStatus };
    });
  }

  // ============================================================
  // UPDATE — Faculty Com Review
  // ============================================================

  /**
   * Faculty Com อนุมัติ/ปฏิเสธ พร้อม meeting_no, meeting_date — ผลนี้เป็นผลสุดท้าย
   * ของ T3 (A6: ตัด grad_school_* ออกทั้งหมด ไม่มี step ถัดจากนี้อีกแล้ว)
   *
   * เรียกจาก: T3Controller.facultyReview
   * @param {number} t3Id
   * @param {'approve'|'reject'} action
   * @param {string|null} meetingNo เลขที่ประชุม (ตอน approve)
   * @param {string|null} meetingDate 'YYYY-MM-DD' ที่ผ่าน utils/date.toMysqlDate แล้ว
   * @param {string|null} remark
   * @returns {Promise<{newOverallStatus:string, facultyApproved:boolean}|null>} null = สถานะเปลี่ยนไปแล้ว (controller ตอบ 409)
   */
  static async facultyReview(t3Id, action, meetingNo, meetingDate, remark) {
    if (!['approve', 'reject'].includes(action)) {
      throw new Error(`T3Model.facultyReview: invalid action "${action}"`);
    }
    const status = action === 'approve' ? 'Approved' : 'Rejected';

    return withTransaction(async (conn) => {
      const [reqRows] = await conn.query(
        `SELECT overall_status FROM t3_requests WHERE t3_id = ? FOR UPDATE`,
        [t3Id]
      );
      if (!reqRows.length || reqRows[0].overall_status !== 'Pending') return null;

      await conn.query(
        `UPDATE request_approvals
            SET status = ?, meeting_no = ?, meeting_date = ?, remark = ?, decided_at = NOW()
          WHERE request_type = 'T3' AND request_id = ? AND step = 'Faculty_Committee'`,
        [status, meetingNo || null, meetingDate || null, remark || null, t3Id]
      );

      await conn.query(
        `UPDATE t3_requests SET overall_status = ? WHERE t3_id = ?`,
        [status, t3Id]
      );

      return { newOverallStatus: status, facultyApproved: action === 'approve' };
    });
  }

  // ============================================================
  // CANCEL (นิสิตยกเลิกคำขอของตัวเอง)
  // ============================================================

  /**
   * เปลี่ยน overall_status เป็น 'Cancelled'
   * ทำได้เฉพาะตอน Rejected หรือ Pending ที่ advisor ยังอนุมัติไม่ครบ
   *
   * เรียกจาก: T3Controller.cancel (เงื่อนไขจริงอยู่ใน WHERE ของ UPDATE เพื่อกัน race กับอาจารย์กดอนุมัติ)
   * @param {number} t3Id
   * @returns {Promise<boolean>} false = เงื่อนไขไม่ผ่านในจังหวะที่ update
   */
  static async cancel(t3Id) {
    const [result] = await db.query(
      `UPDATE t3_requests
          SET overall_status = 'Cancelled'
        WHERE t3_id = ?
          AND (overall_status = 'Rejected'
               OR (overall_status = 'Pending' AND ${advisorNotAllApprovedSql('T3', 't3_id')}))`,
      [t3Id]
    );
    return result.affectedRows > 0;
  }
}

module.exports = T3Model;
