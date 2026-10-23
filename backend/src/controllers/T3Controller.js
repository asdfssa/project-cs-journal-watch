/**
 * T3Controller
 * จัดการ request/response สำหรับ T3 workflow
 *
 * Endpoints:
 *   POST   /api/t3                          → นิสิตยื่น T3 ใหม่
 *   GET    /api/t3/my                       → นิสิตดูประวัติของตัวเอง
 *   GET    /api/t3/pending                  → Advisor/Staff ดูรายการรออนุมัติ
 *   GET    /api/t3/:id                      → ดูรายละเอียด
 *   PATCH  /api/t3/:id/advisor-review       → Advisor อนุมัติ/ปฏิเสธ
 *   PATCH  /api/t3/:id/faculty-review       → Staff บันทึกมติ Faculty Com (ผลสุดท้ายของ T3)
 */
const path = require('path');
const { randomUUID } = require('crypto');
const fs   = require('fs/promises');
const T3Model     = require('../models/T3Model');
const PreT3Model  = require('../models/PreT3Model');
const UserModel   = require('../models/UserModel');
const { advisorViewFields, advisorsAllApproved, MAJOR_ADVISOR_INACTIVE } = require('../models/_approvalHelpers');
const MailService = require('../services/MailService');
const { serverError } = require('../utils/errorResponse');
const { parsePagination, optionalDecimal } = require('../utils/input');
const { toMysqlDate } = require('../utils/date');
const { detectAllowedMime, MIME_TO_EXT } = require('../middlewares/upload');

const FIELD_TO_KEY = {
  acceptance_letter:  'acceptance_letter_path',
  full_paper:         'full_paper_path',
  journal_cover:      'journal_cover_path',
  table_of_contents:  'table_of_contents_path',
  database_evidence:  'database_evidence_path',
  peer_review_result: 'peer_review_result_path',
};

// Frontend sends full Thai labels with an English hint in parentheses
// (e.g. "การนำไปใช้ประโยชน์เชิงพาณิชย์ (Commercial)") instead of the raw
// enum token, so match on the English hint rather than requiring an exact string.
const INNOVATION_TYPE_MAP = [
  [/commercial/i,       'Commercial'],
  [/social.*econom/i,   'Social_Economic'],
  [/policy.*public/i,   'Policy_Public'],
];

/**
 * แปลงข้อความ innovation_type ที่ frontend ส่งมา (label ไทยพร้อมคำอังกฤษในวงเล็บ) เป็นค่า enum ของฐานข้อมูล
 * เรียกจาก: T3Controller._validateAndCreate
 * @param {*} value
 * @returns {'Commercial'|'Social_Economic'|'Policy_Public'|'None'}
 */
function normalizeInnovationType(value) {
  if (typeof value !== 'string' || !value) return 'None';
  // label จริงของ FE สั้นกว่านี้มาก — ตัดไว้กัน `.*` backtrack แบบ O(n²) กับ input ยาว (ReDoS)
  const v = value.slice(0, 200);
  const match = INNOVATION_TYPE_MAP.find(([pattern]) => pattern.test(v));
  return match ? match[1] : 'None';
}

// ชนิดวารสารของ T3 derive จาก Pre-T3 ที่อนุมัติแล้วเท่านั้น (indexed_database + กลุ่ม TCI) —
// ไม่อ่าน publication_details.type ที่ client ส่งมา เพราะกำหนดน้ำหนักคะแนนโดยตรง (B31)
//   Scopus → International_Journal · TCI กลุ่ม 1/2 → National_TCI_Tier1/2 · อ่านไม่ได้ → null (ผู้เรียกตอบ 400)
// คำตอบเดียวกันทั้ง "ไม่มีรายการ" และ "ไม่ใช่ของคุณ" — คนนอกแยกไม่ได้ว่า ID นั้นมีอยู่จริง (report-1 ข้อ 2)
const NOT_FOUND_BODY = { code: 'NOT_FOUND', message: 'ไม่พบ T3 นี้' };
const PRE_T3_NOT_FOUND = { status: 404, code: 'PRE_T3_NOT_FOUND', message: 'ไม่พบ Pre-T3 นี้' };

const NATIONAL_TIER_MAP = {
  '1': 'National_TCI_Tier1',
  '2': 'National_TCI_Tier2',
};

/**
 * หาชนิดวารสารของ T3 จาก Pre-T3 ที่ Approved แล้ว (ไม่เชื่อค่าจาก client) — ผลใช้เป็น publication_details.type และหา weight_score จาก WEIGHT_BY_TYPE
 * เรียกจาก: T3Controller._validateAndCreate
 * @param {object} preT3 ผลจาก PreT3Model.findById (อ่าน indexed_database, quartile_or_tier)
 * @returns {string|null} null = ระบุไม่ได้ (controller ตอบ 400 INVALID_TIER)
 */
function derivePublicationType(preT3) {
  if (preT3?.indexed_database === 'Scopus') return 'International_Journal';
  if (preT3?.indexed_database === 'TCI') {
    const tier = String(preT3.quartile_or_tier || '').match(/(\d+)/)?.[1];
    return NATIONAL_TIER_MAP[tier] || null;
  }
  return null;
}

// น้ำหนักคะแนนตามเกณฑ์ใน schema (001_schema.sql publication_type) — backend คำนวณเอง ไม่เชื่อค่าจาก client
// (เดิมใช้ weight_score ที่ FE ส่งมา 1.0/0.5 ตรงๆ ได้ Tier1 + 0.5 ขัดกันเอง และ client ใส่เลขอะไรก็ได้)
const WEIGHT_BY_TYPE = {
  International_Journal:           1.0,
  National_TCI_Tier1:              0.8,
  National_TCI_Tier2:              0.6,
  International_Conference:        0.4,
  National_Conference:             0.2,
  Intl_Journal_Faculty_Recognized: 0.1,
};

/**
 * แปลงสถานะการตีพิมพ์จาก client ('accepted' | 'published') เป็นค่า enum ของฐานข้อมูล
 * เรียกจาก: T3Controller._validateAndCreate และ T3Controller.submitWithFiles (เลือกชุดไฟล์ที่บังคับจาก REQUIRED_FILES)
 * @returns {'Published'|'Accepted'}
 */
// Frontend sends lowercase 'accepted'/'published'; the DB enum is capitalized.
function normalizePubStatus(value) {
  return value && /published/i.test(value) ? 'Published' : 'Accepted';
}

// ไฟล์หลักฐานที่ต้องแนบตามสถานะการตีพิมพ์ (ที่เหลือเป็นทางเลือก)
// Accepted → หนังสือตอบรับ + ฉบับเต็ม; Published → ฉบับเต็ม + หน้าปกวารสาร + สารบัญ (ไม่ต้องมีหนังสือตอบรับ)
const REQUIRED_FILES = {
  Accepted:  ['acceptance_letter', 'full_paper'],
  Published: ['full_paper', 'journal_cover', 'table_of_contents'],
};

/**
 * Controller ของ T3 — ถูกผูกใน routes/t3Routes.js (base path /api/v3/t3) หลัง requireAuth → requireRole
 * ทุก method: อ่านผู้ใช้จาก req.user (sub, role) → เรียก T3Model (ข้อมูล) / PreT3Model (ตรวจ Pre-T3 ที่อ้างถึง) / UserModel / MailService (อีเมลแจ้งเตือน ไม่รอผล)
 * ตอบ JSON รูป { success, data | code, message } · error ที่ไม่คาดคิดส่งเข้า utils/errorResponse.serverError
 */
class T3Controller {
  /**
   * ตรวจข้อมูลและสร้าง T3 — แยกออกมาจาก submitWithFiles
   * เรียกจาก: T3Controller.submitWithFiles เท่านั้น (ส่ง studentId = req.user.sub, body ที่ parse JSON แล้ว, และ afterInsert สำหรับเขียนไฟล์)
   * ลำดับ: ตรวจ field จำเป็น → optionalDecimal ของ impact_factor/citescore → PreT3Model.findById (ต้องเป็นของนิสิตและ Approved)
   *   → derive type/weight_score จาก Pre-T3 → UserModel.findById → หาอาจารย์หลักจาก advisor_assignments → T3Model.create(…, afterInsert)
   * แก้ค่าใน body ตรงๆ (innovation_type, type, weight_score, status) — ค่าที่แก้คือค่าที่ส่งต่อให้ T3Model.create
   * @returns {Promise<{error:{status:number,code:string,message:string}}|{t3Id:number, student:object, majorAdvisor:object, journal_snapshot:object, paper_and_research_details:object}>}
   *   error = ให้ผู้เรียกตอบ HTTP ตาม status · สำเร็จ = ผู้เรียกใช้ส่งอีเมลหาอาจารย์หลักต่อ
   */
  // ============================================================
  // Shared validation + creation ใช้ร่วมกันโดย submit() และ submitWithFiles()
  // คืน { error: {status, code, message} } ถ้า validate ไม่ผ่าน
  // หรือ { t3Id, student, majorAdvisor, journal_snapshot, paper_and_research_details } ถ้าสำเร็จ
  // ============================================================
  static async _validateAndCreate(studentId, {
    pre_t3_id,
    journal_snapshot,
    paper_and_research_details,
    publication_details,
    journal_metrics,
  }, afterInsert = null) {
    // --- Validate required fields ---
    if (!pre_t3_id || !journal_snapshot || !paper_and_research_details || !publication_details || !journal_metrics) {
      return { error: {
        status: 400, code: 'MISSING_FIELDS',
        message: 'กรุณาระบุ pre_t3_id, journal_snapshot, paper_and_research_details, publication_details, journal_metrics',
      } };
    }

    // ตรวจ paper_and_research_details fields
    const paperRequired = ['title_thai', 'title_english', 'first_author', 'corresponding_author'];
    for (const field of paperRequired) {
      if (!paper_and_research_details[field]) {
        return { error: {
          status: 400, code: 'MISSING_PAPER_FIELD',
          message: `paper_and_research_details.${field} จำเป็นต้องระบุ`,
        } };
      }
    }
    paper_and_research_details.innovation_type = normalizeInnovationType(paper_and_research_details.innovation_type);

    // ตรวจ has_impact_score + impact_factor
    if (journal_metrics.has_impact_score === undefined) {
      return { error: {
        status: 400, code: 'MISSING_METRICS',
        message: 'journal_metrics.has_impact_score จำเป็นต้องระบุ',
      } };
    }

    // impact_factor / citescore: ช่องว่าง ("" / null / ไม่ส่ง) = ไม่มีค่า → null; ไม่ใช่ตัวเลข / ติดลบ / ใหญ่เกินคอลัมน์ → 400
    // (เดิม "" หรือ "abc" ชน DECIMAL ใน MySQL แล้วตอบ 500)
    for (const field of ['impact_factor', 'citescore']) {
      journal_metrics[field] = optionalDecimal(journal_metrics[field], 1e6);
      if (Number.isNaN(journal_metrics[field])) {
        return { error: {
          status: 400, code: 'INVALID_METRICS',
          message: `journal_metrics.${field} ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป หรือเว้นว่าง`,
        } };
      }
    }

    // ตรวจ Pre-T3 ต้อง Approved และเป็นของนิสิตคนนี้
    const preT3 = await PreT3Model.findById(pre_t3_id);
    if (!preT3) {
      return { error: { ...PRE_T3_NOT_FOUND } };
    }
    if (preT3.student_id !== studentId) {
      return { error: { ...PRE_T3_NOT_FOUND } };
    }
    if (preT3.overall_status !== 'Approved') {
      return { error: {
        status: 400, code: 'PRE_T3_NOT_APPROVED',
        message: `Pre-T3 ต้องได้รับการอนุมัติก่อน (สถานะปัจจุบัน: ${preT3.overall_status})`,
      } };
    }
    // type/weight_score derive จาก Pre-T3 ทั้งคู่ — ค่าที่ client ส่งมาถูกเมิน
    const pubType = derivePublicationType(preT3);
    if (!pubType) {
      return { error: {
        status: 400, code: 'INVALID_TIER',
        message: 'ระบุประเภท/กลุ่มวารสารจาก Pre-T3 ไม่ได้ กรุณาติดต่อเจ้าหน้าที่หรือยื่น Pre-T3 ใหม่',
      } };
    }
    publication_details.type   = pubType;
    publication_details.weight_score = WEIGHT_BY_TYPE[publication_details.type];
    publication_details.status = normalizePubStatus(publication_details.status);

    // ดึงข้อมูลนิสิต
    const student = await UserModel.findById(studentId);
    if (!student) {
      return { error: { status: 404, code: 'USER_NOT_FOUND', message: 'ไม่พบข้อมูลผู้ใช้' } };
    }

    // ดึง Advisor ของนิสิต
    const advisorRows = await UserModel.findActiveAdvisorAssignments(studentId);

    const majorAdvisor = advisorRows.find(a => a.advisor_type === 'Major');
    const co1Advisor   = advisorRows.find(a => a.advisor_type === 'Co_1');
    const co2Advisor   = advisorRows.find(a => a.advisor_type === 'Co_2');

    if (!majorAdvisor) {
      return { error: { status: 400, code: 'NO_MAJOR_ADVISOR', message: 'บัญชีนี้ยังไม่มีที่ปรึกษาหลัก (Major Advisor) กรุณาติดต่อ Admin' } };
    }

    if (majorAdvisor.account_status !== 'Active') {
      return { error: { status: 400, ...MAJOR_ADVISOR_INACTIVE } };
    }

    let t3Id;
    try {
      t3Id = await T3Model.create(
        studentId,
        pre_t3_id,
        paper_and_research_details,
        publication_details,
        journal_metrics,
        {
          majorAdvisorId: majorAdvisor.advisor_id,
          coAdvisor1Id:   co1Advisor?.advisor_id || null,
          coAdvisor2Id:   co2Advisor?.advisor_id || null,
        },
        afterInsert
      );
    } catch (err) {
      if (err.code === 'T3_ALREADY_EXISTS') {
        return { error: { status: 409, code: err.code, message: 'Pre-T3 นี้มีคำขอ T3 ที่รออนุมัติหรืออนุมัติแล้ว ไม่สามารถยื่นซ้ำได้' } };
      }
      if (err.code === 'PRE_T3_NOT_APPROVED') {
        return { error: { status: 400, code: err.code, message: 'Pre-T3 ต้องได้รับการอนุมัติก่อน' } };
      }
      throw err;
    }

    return { t3Id, student, majorAdvisor, journal_snapshot, paper_and_research_details };
  }

  /**
   * เรียกจาก: routes/t3Routes.js — GET /my (Student) · T3Model.findByStudentId(req.user.sub) → _formatRow ทีละแถว
   */
  // ============================================================
  // GET /api/t3/my
  // Role: Student
  // ============================================================
  static async getMyRequests(req, res) {
    try {
      const studentId = req.user.sub;
      const rows = await T3Model.findByStudentId(studentId);

      return res.json({
        success: true,
        data: rows.map(r => T3Controller._formatRow(r)),
      });
    } catch (err) {
      return serverError(res, err, 'T3Controller.getMyRequests');
    }
  }

  /**
   * เรียกจาก: routes/t3Routes.js — GET /pending (Supervisor, Staff)
   * Supervisor → T3Model.findPendingForAdvisor แล้วแนบ my_role/can_review (advisorViewFields) · Staff → T3Model.findPendingForFaculty
   */
  // ============================================================
  // GET /api/t3/pending
  // Role: Supervisor → ของนิสิตตัวเอง
  //       Staff      → ทั้งหมดที่ advisor approve แล้ว
  // ============================================================
  static async getPending(req, res) {
    try {
      const { role, sub: userId } = req.user;

      let rows;
      if (role === 'Supervisor') {
        rows = await T3Model.findPendingForAdvisor(userId);
      } else {
        rows = await T3Model.findPendingForFaculty();
      }

      return res.json({
        success: true,
        data: rows.map(r => ({ ...T3Controller._formatRow(r), ...(role === 'Supervisor' ? advisorViewFields(r, userId) : {}) })),
      });
    } catch (err) {
      return serverError(res, err, 'T3Controller.getPending');
    }
  }

  /**
   * เรียกจาก: routes/t3Routes.js — GET /:id (ทุก role ที่ login)
   * รับ req.params.id (requireNumericId ตรวจแล้ว) → T3Model.findById · Student ต้องเป็นเจ้าของ, Supervisor ต้องเป็นอาจารย์ในคำร้องนี้ (หลักหรือร่วม)
   */
  // ============================================================
  // GET /api/t3/:id
  // Role: Student (ของตัวเอง), Supervisor (ของนิสิตตัวเอง), Staff/Admin (ทุกคน)
  // ============================================================
  static async getById(req, res) {
    try {
      const t3Id = parseInt(req.params.id);
      const { role, sub: userId } = req.user;

      const row = await T3Model.findById(t3Id);
      if (!row) {
        return res.status(404).json({ success: false, ...NOT_FOUND_BODY });
      }

      if (role === 'Student' && row.student_id !== userId) {
        return res.status(404).json({ success: false, ...NOT_FOUND_BODY });
      }

      if (role === 'Supervisor') {
        const isMyStudent =
          String(row.advisor_approval?.user_id)    === String(userId) ||
          String(row.co_advisor_1_approval?.user_id) === String(userId) ||
          String(row.co_advisor_2_approval?.user_id) === String(userId);

        if (!isMyStudent) {
          return res.status(404).json({ success: false, ...NOT_FOUND_BODY });
        }
      }

      return res.json({ success: true, data: { ...T3Controller._formatRow(row), ...(role === 'Supervisor' ? advisorViewFields(row, userId) : {}) } });
    } catch (err) {
      return serverError(res, err, 'T3Controller.getById');
    }
  }

  /**
   * เรียกจาก: routes/t3Routes.js — PATCH /:id/advisor-review (Supervisor)
   * รับ req.body: { action: 'approve'|'reject', remark? (บังคับตอน reject) }
   * ลำดับ: T3Model.findById → สถานะต้อง Pending → advisorViewFields (ต้องเป็นอาจารย์หลักที่ยังไม่ตัดสิน) → T3Model.advisorReview
   *   → อีเมล: reject แจ้งนิสิต · approve ครบแจ้งนิสิตและ Staff ทุกคน · แจ้งอาจารย์ร่วมว่าอาจารย์หลักตัดสินแล้ว (MailService.sendT3Notification)
   * ตอบ { data: { overall_status, all_advisor_approved } } · สถานะเปลี่ยนระหว่างทาง 409
   */
  // ============================================================
  // PATCH /api/t3/:id/advisor-review
  // Role: Supervisor
  // ============================================================
  static async advisorReview(req, res) {
    try {
      const t3Id     = parseInt(req.params.id);
      const advisorId = req.user.sub;
      const { action, remark } = req.body;

      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ success: false, code: 'INVALID_ACTION', message: 'action ต้องเป็น approve หรือ reject' });
      }
      if (action === 'reject' && !remark) {
        return res.status(400).json({ success: false, code: 'REMARK_REQUIRED', message: 'กรุณาระบุเหตุผลการปฏิเสธ' });
      }

      const row = await T3Model.findById(t3Id);
      if (!row) return res.status(404).json({ success: false, ...NOT_FOUND_BODY });

      // ไม่ใช่อาจารย์ของรายการนี้ = ตอบเหมือนไม่มีรายการ และต้องเช็คก่อนสถานะ (ไม่งั้นสถานะหลุดให้คนนอก)
      const { my_role, can_review } = advisorViewFields(row, advisorId);
      if (my_role === null) {
        return res.status(404).json({ success: false, ...NOT_FOUND_BODY });
      }

      if (row.overall_status !== 'Pending') {
        return res.status(400).json({ success: false, code: 'INVALID_STATE', message: `T3 นี้อยู่ในสถานะ ${row.overall_status} แล้ว` });
      }

      // อนุมัติ/ปฏิเสธเป็นสิทธิ์ของอาจารย์ที่ปรึกษาหลักคนเดียว — อาจารย์ร่วมไม่มีสิทธิ์ตัดสิน (ผลขึ้นกับอาจารย์หลัก)
      if (my_role !== 'Major') {
        return res.status(403).json({ success: false, code: 'NOT_MAJOR_ADVISOR', message: 'เฉพาะอาจารย์ที่ปรึกษาหลักเท่านั้นที่อนุมัติหรือปฏิเสธได้ (หากเห็นต่างกรุณาปรึกษาอาจารย์ที่ปรึกษาหลัก)' });
      }
      if (!can_review) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'คุณอนุมัติหรือปฏิเสธ T3 นี้ไปแล้ว' });
      }

      const result = await T3Model.advisorReview(t3Id, advisorId, action, remark || null);
      if (!result) {
        return res.status(409).json({ success: false, code: 'INVALID_STATE', message: 'T3 นี้ถูกเปลี่ยนสถานะไปแล้ว (เช่น นิสิตยกเลิกคำขอ) กรุณารีเฟรชหน้า' });
      }

      const student    = await UserModel.findById(row.student_id);
      const journalName = row.journal_snapshot?.journal_name || '-';
      const articleTitle = row.paper_and_research_details?.title_english || row.paper_and_research_details?.title_thai || '-';

      if (result.anyRejected) {
        MailService.sendT3Notification(student.msu_mail, 'advisor_rejected', {
          studentName: `${student.first_name} ${student.last_name}`,
          journalName,
          articleTitle,
          t3Id,
          remark,
        });
      } else if (result.allApproved) {
        MailService.sendT3Notification(student.msu_mail, 'advisor_approved', {
          studentName: `${student.first_name} ${student.last_name}`,
          journalName,
          articleTitle,
          t3Id,
        });
        // แจ้ง Staff ทุกคน
        const staffRows = await UserModel.findActiveStaffMails();
        for (const staff of staffRows) {
          MailService.sendT3Notification(staff.msu_mail, 'faculty_pending', {
            studentName: `${student.first_name} ${student.last_name}`,
            journalName,
            articleTitle,
            t3Id,
          });
        }
      }

      // ถ้าคนที่เพิ่งอนุมัติ/ปฏิเสธคือที่ปรึกษาหลัก → แจ้งเตือน co-advisor (ถ้ามี) เฉยๆ
      // ว่าที่ปรึกษาหลักตัดสินใจแล้ว เผื่อทั้ง 3 คนคุยกันนอกระบบไปแล้วแต่ที่ปรึกษาหลัก
      // ลืมกดในระบบ — co-advisor จะได้รู้และไปทวงถามได้
      const notifyEvent = action === 'approve' ? 'major_advisor_approved' : 'major_advisor_rejected';
      // คนเดียวอาจถือทั้งช่อง Co_1 และ Co_2 → ส่งเมลครั้งเดียว
      const coIds = new Set([row.co_advisor_1_approval?.user_id, row.co_advisor_2_approval?.user_id].filter(Boolean));
      for (const coId of coIds) {
        const coAdvisor = await UserModel.findById(coId);
        if (!coAdvisor) continue;
        MailService.sendT3Notification(coAdvisor.msu_mail, notifyEvent, {
          studentName: `${student.first_name} ${student.last_name}`,
          journalName,
          articleTitle,
          t3Id,
          remark,
        });
      }

      return res.json({
        success: true,
        message: action === 'approve' ? 'อนุมัติเรียบร้อย' : 'ปฏิเสธเรียบร้อย',
        data: { overall_status: result.newOverallStatus, all_advisor_approved: result.allApproved },
      });
    } catch (err) {
      return serverError(res, err, 'T3Controller.advisorReview');
    }
  }

  /**
   * เรียกจาก: routes/t3Routes.js — PATCH /:id/faculty-review (Staff) — ผลสุดท้ายของ T3 ไม่มีขั้นถัดไป
   * รับ req.body: { action, meeting_no?, meeting_date?, remark? } · meeting_date ผ่าน utils/date.toMysqlDate แล้วส่งต่อ T3Model.facultyReview
   * แล้วส่งอีเมลผลสุดท้ายให้นิสิต (faculty_approved / faculty_rejected)
   */
  // ============================================================
  // PATCH /api/t3/:id/faculty-review
  // Role: Staff
  // Body: { action, meeting_no, meeting_date, remark? }
  // ============================================================
  static async facultyReview(req, res) {
    try {
      const t3Id = parseInt(req.params.id);
      const { action, meeting_no, meeting_date, remark } = req.body;

      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ success: false, code: 'INVALID_ACTION', message: 'action ต้องเป็น approve หรือ reject' });
      }
      // วันที่ผิดรูปแบบ/ไม่มีจริง → 400 (เดิมชน MySQL แล้วได้ 500)
      const meetingDate = toMysqlDate(meeting_date);
      if (meetingDate === undefined) {
        return res.status(400).json({ success: false, code: 'INVALID_DATE', message: 'meeting_date ต้องเป็นวันที่รูปแบบ YYYY-MM-DD' });
      }

      if (action === 'approve' && (!meeting_no || !meeting_date)) {
        return res.status(400).json({ success: false, code: 'MEETING_REQUIRED', message: 'กรุณาระบุ meeting_no และ meeting_date' });
      }
      if (action === 'reject' && !remark) {
        return res.status(400).json({ success: false, code: 'REMARK_REQUIRED', message: 'กรุณาระบุเหตุผลการปฏิเสธ' });
      }

      const row = await T3Model.findById(t3Id);
      if (!row) return res.status(404).json({ success: false, ...NOT_FOUND_BODY });

      if (row.advisor_approval?.status !== 'Approved') {
        return res.status(400).json({ success: false, code: 'ADVISOR_NOT_APPROVED', message: 'อาจารย์ที่ปรึกษายังไม่อนุมัติ' });
      }
      if (row.overall_status !== 'Pending') {
        return res.status(400).json({ success: false, code: 'INVALID_STATE', message: `T3 นี้อยู่ในสถานะ ${row.overall_status} แล้ว` });
      }

      const result = await T3Model.facultyReview(t3Id, action, meeting_no, meetingDate, remark);
      if (!result) {
        return res.status(409).json({ success: false, code: 'INVALID_STATE', message: 'T3 นี้ถูกเปลี่ยนสถานะไปแล้ว กรุณารีเฟรชหน้า' });
      }

      const student    = await UserModel.findById(row.student_id);
      const journalName = row.journal_snapshot?.journal_name || '-';
      const articleTitle = row.paper_and_research_details?.title_english || row.paper_and_research_details?.title_thai || '-';

      if (action === 'approve') {
        // ผลสุดท้าย: อนุมัติ → แจ้งนิสิตว่า T3 ผ่านแล้ว เสร็จสิ้นกระบวนการ
        MailService.sendT3Notification(student.msu_mail, 'faculty_approved', {
          studentName: `${student.first_name} ${student.last_name}`,
          journalName,
          articleTitle,
          t3Id,
          meetingNo: meeting_no,
          meetingDate: meeting_date,
        });
      } else {
        // ผลสุดท้าย: ปฏิเสธ → แจ้งนิสิตว่าไม่ผ่าน
        MailService.sendT3Notification(student.msu_mail, 'faculty_rejected', {
          studentName: `${student.first_name} ${student.last_name}`,
          journalName,
          articleTitle,
          t3Id,
          remark,
        });
      }

      return res.json({
        success: true,
        message: action === 'approve'
          ? 'อนุมัติ T3 เรียบร้อย — เสร็จสิ้นกระบวนการ'
          : 'ปฏิเสธ T3 เรียบร้อย',
        data: { overall_status: result.newOverallStatus },
      });
    } catch (err) {
      return serverError(res, err, 'T3Controller.facultyReview');
    }
  }

  /**
   * เรียกจาก: routes/t3Routes.js — PATCH /:id/cancel (Student เจ้าของ)
   * ตรวจ: สถานะต้อง Pending/Rejected · Pending ที่อาจารย์อนุมัติครบแล้วยกเลิกไม่ได้ (advisorsAllApproved) → T3Model.cancel
   */
  // ============================================================
  // PATCH /api/t3/:id/cancel
  // Role: Student (เฉพาะของตัวเอง, Rejected หรือ Pending ที่ advisor ยังอนุมัติไม่ครบ)
  // ============================================================
  static async cancel(req, res) {
    try {
      const t3Id      = parseInt(req.params.id);
      const studentId = req.user.sub;

      const row = await T3Model.findById(t3Id);
      if (!row) {
        return res.status(404).json({ success: false, ...NOT_FOUND_BODY });
      }
      if (row.student_id !== studentId) {
        return res.status(404).json({ success: false, ...NOT_FOUND_BODY });
      }
      if (!['Pending', 'Rejected'].includes(row.overall_status)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_STATE',
          message: `ไม่สามารถยกเลิกได้ T3 อยู่ในสถานะ ${row.overall_status}`,
        });
      }

      if (row.overall_status === 'Pending' && await advisorsAllApproved('T3', t3Id)) {
        return res.status(400).json({
          success: false,
          code: 'ADVISOR_APPROVED',
          message: 'อาจารย์ที่ปรึกษาอนุมัติแล้ว ไม่สามารถยกเลิกได้ หากมีเหตุจำเป็นกรุณาติดต่อเจ้าหน้าที่',
        });
      }

      const ok = await T3Model.cancel(t3Id);
      if (!ok) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_STATE',
          message: 'ไม่สามารถยกเลิกได้ T3 ถูกเปลี่ยนสถานะไปแล้ว',
        });
      }

      return res.json({ success: true, message: 'ยกเลิก T3 เรียบร้อยแล้ว' });
    } catch (err) {
      return serverError(res, err, 'T3Controller.cancel');
    }
  }

  /**
   * เรียกจาก: routes/t3Routes.js — POST /with-files (requireAuth → requireRole('Student') → submitLimiter → uploadT3FieldsMemory → handleMulterError)
   * รับ: req.body (ค่า JSON เป็น string → tryParse) + req.files[ชื่อ field][0].buffer จาก multer (อยู่ใน RAM)
   * ลำดับ: เช็คไฟล์บังคับตาม REQUIRED_FILES → ตรวจ magic bytes ทุกไฟล์ด้วย middlewares/upload.detectAllowedMime (เลือกนามสกุลจาก MIME_TO_EXT)
   *   → _validateAndCreate พร้อม afterInsert ที่เขียนไฟล์ลง uploads/t3/{t3_id}/{field}/{uuid}.{ext} และ T3Model.upsertEvidenceFile ใน transaction เดียวกัน
   *   → ถ้าล้ม: rollback T3 และลบโฟลเดอร์ไฟล์ · สำเร็จ: อีเมลหาอาจารย์หลัก (advisor_pending) ตอบ 201 { t3_id, uploaded }
   */
  // ============================================================
  // POST /api/t3/with-files
  // Role: Student
  // Content-Type: multipart/form-data
  // Text fields (JSON string): pre_t3_id, journal_snapshot,
  //   paper_and_research_details, publication_details, journal_metrics
  // File fields: บังคับตาม publication_details.status (ดู REQUIRED_FILES);
  //   ที่เหลือใน acceptance_letter, full_paper, journal_cover,
  //   table_of_contents, database_evidence, peer_review_result เป็นทางเลือก
  // ============================================================
  static async submitWithFiles(req, res) {
    try {
      const studentId = req.user.sub;

      // multipart/form-data → ค่า JSON ส่งมาเป็น string ต้อง parse
      const tryParse = (val) => {
        if (typeof val === 'string') { try { return JSON.parse(val); } catch { return val; } }
        return val;
      };

      const body = {
        pre_t3_id:                  tryParse(req.body.pre_t3_id),
        journal_snapshot:           tryParse(req.body.journal_snapshot),
        paper_and_research_details: tryParse(req.body.paper_and_research_details),
        publication_details:        tryParse(req.body.publication_details),
        journal_metrics:            tryParse(req.body.journal_metrics),
      };

      // ไฟล์หลักฐานบังคับ 2 ไฟล์ (X32) — เช็คฝั่ง server ไม่พึ่ง FE
      const missing = REQUIRED_FILES[normalizePubStatus(body.publication_details?.status)].filter(f => !req.files?.[f]?.[0]);
      if (missing.length) {
        return res.status(400).json({
          success: false,
          code: 'MISSING_REQUIRED_FILES',
          message: `ต้องแนบไฟล์ให้ครบ: ${missing.join(', ')}`,
          missing,
        });
      }

      // --- จัดการไฟล์ ---
      // ตรวจ magic bytes ของทุกไฟล์ก่อนสร้าง T3 และเก็บ MIME ที่ตรวจจริงไว้เลือกนามสกุล
      // (ไม่ใช้ MIME ที่ client ประกาศ)
      const uploaded = {};
      const toWrite = [];
      const entries = req.files ? Object.entries(req.files).filter(([f]) => FIELD_TO_KEY[f]) : [];

      for (const [fieldName, fileArr] of entries) {
        const file = fileArr[0];
        const mime = await detectAllowedMime(file.buffer);
        if (!mime) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_FILE_CONTENT',
            message: `ไฟล์ "${fieldName}" มีเนื้อหาไม่ตรงกับประเภทไฟล์ที่ประกาศไว้ (รองรับเฉพาะ PDF, JPG, PNG, WEBP)`,
          });
        }
        toWrite.push({ fieldName, buffer: file.buffer, ext: MIME_TO_EXT[mime] });
      }

      // เขียนไฟล์ + แถว evidence ใน transaction เดียวกับ T3 (B30): อันไหนล้ม → rollback T3 ทั้งก้อน
      // แล้วลบโฟลเดอร์ไฟล์ทิ้ง ไม่เหลือ T3 ค้างหรือไฟล์กำพร้า (retry จึงไม่ได้ T3 ซ้ำ)
      let t3Dir = null;
      let result;
      try {
        result = await T3Controller._validateAndCreate(studentId, body, async (conn, t3Id) => {
          if (!toWrite.length) return;
          t3Dir = path.join(process.cwd(), 'uploads', 't3', String(t3Id));
          for (const { fieldName, buffer, ext } of toWrite) {
            const dir = path.join(t3Dir, fieldName);
            await fs.mkdir(dir, { recursive: true });
            const filePath = path.join(dir, `${randomUUID()}${ext}`);
            await fs.writeFile(filePath, buffer);
            const relativePath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
            await T3Model.upsertEvidenceFile(t3Id, fieldName, relativePath, conn);
            uploaded[fieldName] = relativePath;
          }
        });
      } catch (err) {
        if (t3Dir) await fs.rm(t3Dir, { recursive: true, force: true }).catch(() => {});
        throw err;
      }
      if (result.error) {
        const { status, ...errBody } = result.error;
        return res.status(status).json({ success: false, ...errBody });
      }
      const { t3Id, student, majorAdvisor, journal_snapshot, paper_and_research_details } = result;

      // แจ้ง Advisor ทางอีเมล
      const advisorUser = await UserModel.findById(majorAdvisor.advisor_id);
      if (advisorUser) {
        MailService.sendT3Notification(advisorUser.msu_mail, 'advisor_pending', {
          studentName:  `${student.first_name} ${student.last_name}`,
          journalName:  journal_snapshot.journal_name,
          articleTitle: paper_and_research_details.title_english || paper_and_research_details.title_thai,
          t3Id,
        });
      }

      const uploadedCount = Object.keys(uploaded).length;
      return res.status(201).json({
        success: true,
        message: uploadedCount > 0
          ? `ยื่น T3 และอัปโหลด ${uploadedCount} ไฟล์สำเร็จ กรุณารอการอนุมัติจากอาจารย์ที่ปรึกษา`
          : 'ยื่น T3 สำเร็จ กรุณารอการอนุมัติจากอาจารย์ที่ปรึกษา',
        data: {
          t3_id:    t3Id,
          uploaded: uploadedCount > 0 ? uploaded : undefined,
        },
      });
    } catch (err) {
      return serverError(res, err, 'T3Controller.submitWithFiles');
    }
  }

  /**
   * เรียกจาก: routes/t3Routes.js — GET /history (Supervisor, Staff)
   * รับ query: status=Approved|Rejected, page, limit (parsePagination) · Supervisor → T3Model.findReviewedByAdvisor · Staff → T3Model.findReviewedByFaculty
   * ตอบ { data: { items, total, page, limit, totalPages } }
   */
  // ============================================================
  // GET /api/t3/history
  // Role: Supervisor → เห็นเฉพาะที่ตัวเองเคย approve/reject
  //       Staff      → เห็นทั้งหมดที่ Faculty Com เคยตัดสินแล้ว
  // Query: ?status=Approved|Rejected  ?page=1  ?limit=20
  // ============================================================
  static async getHistory(req, res) {
    try {
      const { role, sub: userId } = req.user;
      const status = ['Approved', 'Rejected'].includes(req.query.status) ? req.query.status : null;
      const { page, limit } = parsePagination(req.query);

      let rows, total;
      if (role === 'Supervisor') {
        ({ rows, total } = await T3Model.findReviewedByAdvisor(userId, { status, page, limit }));
      } else {
        // Staff
        ({ rows, total } = await T3Model.findReviewedByFaculty({ status, page, limit }));
      }

      return res.json({
        success: true,
        data: {
          items:      rows.map(r => ({ ...T3Controller._formatRow(r), ...(role === 'Supervisor' ? advisorViewFields(r, userId) : {}) })),
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      return serverError(res, err, 'T3Controller.getHistory');
    }
  }

  /**
   * จัดรูปแถวจาก T3Model เป็น response (เลือกเฉพาะ field ที่ frontend ใช้ · parseJson รองรับค่าที่อาจเป็น JSON string)
   * เรียกจาก: getMyRequests, getPending, getById, getHistory
   * @param {object} row ผลจาก T3Model.find* (ผ่าน _attachDerived แล้ว)
   */
  // ============================================================
  // Helper
  // ============================================================
  static _formatRow(row) {
    const parseJson = (val) => {
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return val; }
      }
      return val;
    };

    return {
      t3_id:                      row.t3_id,
      pre_t3_id:                  row.pre_t3_id,
      student_id:                 row.student_id,
      student_name:               row.first_name ? `${row.first_name} ${row.last_name}` : undefined,
      student_email:              row.msu_mail,
      issn:                       row.issn,
      overall_status:             row.overall_status,
      journal_snapshot:           parseJson(row.journal_snapshot),
      student_snapshot:           parseJson(row.student_snapshot),
      paper_and_research_details: parseJson(row.paper_and_research_details),
      publication_details:        parseJson(row.publication_details),
      journal_metrics:            parseJson(row.journal_metrics),
      journal_evidence_files:     parseJson(row.journal_evidence_files),
      advisor_approval:           parseJson(row.advisor_approval),
      co_advisor_1_approval:      parseJson(row.co_advisor_1_approval),
      co_advisor_2_approval:      parseJson(row.co_advisor_2_approval),
      faculty_com_approval:       parseJson(row.faculty_com_approval),
      created_at:                 row.created_at,
      updated_at:                 row.updated_at,
    };
  }
}

module.exports = T3Controller;