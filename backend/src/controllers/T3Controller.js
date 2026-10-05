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
const fs   = require('fs/promises');
const T3Model     = require('../models/T3Model');
const PreT3Model  = require('../models/PreT3Model');
const UserModel   = require('../models/UserModel');
const MailService = require('../services/MailService');
const db          = require('../config/database');
const { serverError } = require('../utils/errorResponse');
const { parsePagination } = require('../utils/input');
const { toMysqlDate } = require('../utils/date');
const { verifyFileType, MIME_TO_EXT } = require('../middlewares/upload');

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

function normalizeInnovationType(value) {
  if (!value) return 'None';
  const match = INNOVATION_TYPE_MAP.find(([pattern]) => pattern.test(value));
  return match ? match[1] : 'None';
}

// Frontend "journalType" dropdown only has 2 options (international/national Thai
// labels), but publication_type has 6 values distinguishing TCI tier / conference.
// For the national case, derive the tier from the journal's own Pre-T3 record
// (quartile_or_tier, e.g. "กลุ่มที่ 1") instead of guessing from the submit body.
const NATIONAL_TIER_MAP = {
  '1': 'National_TCI_Tier1',
  '2': 'National_TCI_Tier2',
};

function normalizePublicationType(rawType, preT3) {
  if (rawType && /นานาชาติ|international/i.test(rawType)) {
    return 'International_Journal';
  }
  const tierMatch = String(preT3?.quartile_or_tier || '').match(/(\d+)/);
  const tier = tierMatch ? tierMatch[1] : null;
  if (!NATIONAL_TIER_MAP[tier]) {
    // แปลงจาก quartile_or_tier ไม่ได้ — เดา Tier2 ให้ แต่ log ไว้เพราะกระทบเครดิตนิสิตโดยตรง
    console.warn(`[T3Controller] normalizePublicationType: parse tier ไม่ได้จาก quartile_or_tier="${preT3?.quartile_or_tier}" defaulting เป็น National_TCI_Tier2`);
  }
  return NATIONAL_TIER_MAP[tier] || 'National_TCI_Tier2';
}

// Frontend sends lowercase 'accepted'/'published'; the DB enum is capitalized.
function normalizePubStatus(value) {
  return value && /published/i.test(value) ? 'Published' : 'Accepted';
}

class T3Controller {
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
  }) {
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

    // ตรวจ publication_details
    const pubRequired = ['type', 'weight_score'];
    for (const field of pubRequired) {
      if (publication_details[field] === undefined) {
        return { error: {
          status: 400, code: 'MISSING_PUB_FIELD',
          message: `publication_details.${field} จำเป็นต้องระบุ`,
        } };
      }
    }

    // ตรวจ has_impact_score + impact_factor
    if (journal_metrics.has_impact_score === undefined) {
      return { error: {
        status: 400, code: 'MISSING_METRICS',
        message: 'journal_metrics.has_impact_score จำเป็นต้องระบุ',
      } };
    }

    // ตรวจ Pre-T3 ต้อง Approved และเป็นของนิสิตคนนี้
    const preT3 = await PreT3Model.findById(pre_t3_id);
    if (!preT3) {
      return { error: { status: 404, code: 'PRE_T3_NOT_FOUND', message: 'ไม่พบ Pre-T3 นี้' } };
    }
    if (preT3.student_id !== studentId) {
      return { error: { status: 403, code: 'FORBIDDEN', message: 'Pre-T3 นี้ไม่ใช่ของคุณ' } };
    }
    if (preT3.overall_status !== 'Approved') {
      return { error: {
        status: 400, code: 'PRE_T3_NOT_APPROVED',
        message: `Pre-T3 ต้องได้รับการอนุมัติก่อน (สถานะปัจจุบัน: ${preT3.overall_status})`,
      } };
    }
    publication_details.type   = normalizePublicationType(publication_details.type, preT3);
    publication_details.status = normalizePubStatus(publication_details.status);

    // ดึงข้อมูลนิสิต
    const student = await UserModel.findById(studentId);
    if (!student) {
      return { error: { status: 404, code: 'USER_NOT_FOUND', message: 'ไม่พบข้อมูลผู้ใช้' } };
    }

    // ดึง Advisor ของนิสิต
    const [advisorRows] = await db.query(
      `SELECT advisor_id, advisor_type
         FROM advisor_assignments
        WHERE student_id = ? AND is_active = TRUE`,
      [studentId]
    );

    const majorAdvisor = advisorRows.find(a => a.advisor_type === 'Major');
    const co1Advisor   = advisorRows.find(a => a.advisor_type === 'Co_1');
    const co2Advisor   = advisorRows.find(a => a.advisor_type === 'Co_2');

    if (!majorAdvisor) {
      return { error: { status: 400, code: 'NO_MAJOR_ADVISOR', message: 'บัญชีนี้ยังไม่มีที่ปรึกษาหลัก (Major Advisor) กรุณาติดต่อ Admin' } };
    }

    const t3Id = await T3Model.create(
      studentId,
      pre_t3_id,
      paper_and_research_details,
      publication_details,
      journal_metrics,
      {
        majorAdvisorId: majorAdvisor.advisor_id,
        coAdvisor1Id:   co1Advisor?.advisor_id || null,
        coAdvisor2Id:   co2Advisor?.advisor_id || null,
      }
    );

    return { t3Id, student, majorAdvisor, journal_snapshot, paper_and_research_details };
  }

  // ============================================================
  // POST /api/t3
  // Role: Student
  // ============================================================
  static async submit(req, res) {
    try {
      const studentId = req.user.sub;
      const result = await T3Controller._validateAndCreate(studentId, req.body);
      if (result.error) {
        const { status, ...body } = result.error;
        return res.status(status).json({ success: false, ...body });
      }
      const { t3Id, student, majorAdvisor, journal_snapshot, paper_and_research_details } = result;

      // แจ้ง Advisor ทางอีเมล
      const advisorUser = await UserModel.findById(majorAdvisor.advisor_id);
      if (advisorUser) {
        MailService.sendT3Notification(advisorUser.msu_mail, 'advisor_pending', {
          studentName: `${student.first_name} ${student.last_name}`,
          journalName: journal_snapshot.journal_name,
          articleTitle: paper_and_research_details.title_english || paper_and_research_details.title_thai,
          t3Id,
        });
      }

      return res.status(201).json({
        success: true,
        message: 'ยื่น T3 สำเร็จ กรุณารอการอนุมัติจากอาจารย์ที่ปรึกษา',
        data: { t3_id: t3Id },
      });
    } catch (err) {
      return serverError(res, err, 'T3Controller.submit');
    }
  }

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
        data: rows.map(r => T3Controller._formatRow(r)),
      });
    } catch (err) {
      return serverError(res, err, 'T3Controller.getPending');
    }
  }

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
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'ไม่พบ T3 นี้' });
      }

      if (role === 'Student' && row.student_id !== userId) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์ดูรายการนี้' });
      }

      if (role === 'Supervisor') {
        const isMyStudent =
          String(row.advisor_approval?.user_id)    === String(userId) ||
          String(row.co_advisor_1_approval?.user_id) === String(userId) ||
          String(row.co_advisor_2_approval?.user_id) === String(userId);

        if (!isMyStudent) {
          return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์ดูรายการนี้' });
        }
      }

      return res.json({ success: true, data: T3Controller._formatRow(row) });
    } catch (err) {
      return serverError(res, err, 'T3Controller.getById');
    }
  }

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
      if (!row) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'ไม่พบ T3 นี้' });

      if (row.overall_status !== 'Pending') {
        return res.status(400).json({ success: false, code: 'INVALID_STATE', message: `T3 นี้อยู่ในสถานะ ${row.overall_status} แล้ว` });
      }

      const slots = [row.advisor_approval, row.co_advisor_1_approval, row.co_advisor_2_approval];
      const mySlot = slots.find(s => String(s?.user_id) === String(advisorId) && s.status === 'Pending');
      if (!mySlot) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'คุณไม่ใช่อาจารย์ที่ปรึกษาของ T3 นี้ หรืออนุมัติแล้ว' });
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
        const [staffRows] = await db.query(
          `SELECT msu_mail FROM users WHERE role = 'Staff' AND account_status = 'Active'`
        );
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
      if (mySlot === row.advisor_approval) {
        const notifyEvent = action === 'approve' ? 'major_advisor_approved' : 'major_advisor_rejected';
        const coAdvisorSlots = [row.co_advisor_1_approval, row.co_advisor_2_approval];
        for (const slot of coAdvisorSlots) {
          if (!slot?.user_id) continue;
          const coAdvisor = await UserModel.findById(slot.user_id);
          if (!coAdvisor) continue;
          MailService.sendT3Notification(coAdvisor.msu_mail, notifyEvent, {
            studentName: `${student.first_name} ${student.last_name}`,
            journalName,
            articleTitle,
            t3Id,
            remark,
          });
        }
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
      if (action === 'approve' && (!meeting_no || !meeting_date)) {
        return res.status(400).json({ success: false, code: 'MEETING_REQUIRED', message: 'กรุณาระบุ meeting_no และ meeting_date' });
      }
      if (action === 'reject' && !remark) {
        return res.status(400).json({ success: false, code: 'REMARK_REQUIRED', message: 'กรุณาระบุเหตุผลการปฏิเสธ' });
      }

      const row = await T3Model.findById(t3Id);
      if (!row) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'ไม่พบ T3 นี้' });

      if (row.advisor_approval?.status !== 'Approved') {
        return res.status(400).json({ success: false, code: 'ADVISOR_NOT_APPROVED', message: 'อาจารย์ที่ปรึกษายังไม่อนุมัติ' });
      }
      if (row.overall_status !== 'Pending') {
        return res.status(400).json({ success: false, code: 'INVALID_STATE', message: `T3 นี้อยู่ในสถานะ ${row.overall_status} แล้ว` });
      }

      const result = await T3Model.facultyReview(t3Id, action, meeting_no, toMysqlDate(meeting_date), remark);
      if (!result) {
        return res.status(409).json({ success: false, code: 'INVALID_STATE', message: 'T3 นี้ถูกเปลี่ยนสถานะไปแล้ว กรุณารีเฟรชหน้า' });
      }

      const student    = await UserModel.findById(row.student_id);
      const journalName = row.journal_snapshot?.journal_name || '-';
      const articleTitle = row.paper_and_research_details?.title_english || row.paper_and_research_details?.title_thai || '-';

      if (action === 'approve') {
        // ผลสุดท้าย: อนุมัติ → แจ้งนิสิตว่า T3 ผ่านแล้ว เสร็จสิ้นกระบวนการ
        MailService.sendT3Notification(student.msu_mail, 'grad_school_approved', {
          studentName: `${student.first_name} ${student.last_name}`,
          journalName,
          articleTitle,
          t3Id,
          meetingNo: meeting_no,
          meetingDate: meeting_date,
        });
      } else {
        // ผลสุดท้าย: ปฏิเสธ → แจ้งนิสิตว่าไม่ผ่าน
        MailService.sendT3Notification(student.msu_mail, 'grad_school_rejected', {
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

  // ============================================================
  // PATCH /api/t3/:id/cancel
  // Role: Student (เฉพาะของตัวเอง, สถานะ Pending หรือ Rejected)
  // ============================================================
  static async cancel(req, res) {
    try {
      const t3Id      = parseInt(req.params.id);
      const studentId = req.user.sub;

      const row = await T3Model.findById(t3Id);
      if (!row) {
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'ไม่พบ T3 นี้' });
      }
      if (row.student_id !== studentId) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์ยกเลิกรายการนี้' });
      }
      if (!['Pending', 'Rejected'].includes(row.overall_status)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_STATE',
          message: `ไม่สามารถยกเลิกได้ T3 อยู่ในสถานะ ${row.overall_status}`,
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

  // ============================================================
  // POST /api/t3/with-files
  // Role: Student
  // Content-Type: multipart/form-data
  // Text fields (JSON string): pre_t3_id, journal_snapshot,
  //   paper_and_research_details, publication_details, journal_metrics
  // File fields (optional): acceptance_letter, full_paper, journal_cover,
  //   table_of_contents, database_evidence, peer_review_result
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

      // --- จัดการไฟล์ (ถ้ามี) ---
      // เช็ค magic bytes ของทุกไฟล์ก่อนสร้าง T3 และก่อนเขียนไฟล์ ถ้ามีไฟล์ไหนไม่ผ่าน
      // จะไม่มี T3 ค้างใน DB และไม่มีไฟล์ที่เขียนไปแล้วบางส่วน
      const evidenceFiles = {};
      const uploaded = {};
      const entries = req.files ? Object.entries(req.files).filter(([f]) => FIELD_TO_KEY[f]) : [];

      for (const [fieldName, fileArr] of entries) {
        const file = fileArr[0];
        // เช็ค magic bytes จริง — fileFilter เช็คได้แค่ Content-Type ที่ client ส่งมา ปลอมได้
        const isValidType = await verifyFileType(file.buffer);
        if (!isValidType) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_FILE_CONTENT',
            message: `ไฟล์ "${fieldName}" มีเนื้อหาไม่ตรงกับประเภทไฟล์ที่ประกาศไว้ (รองรับเฉพาะ PDF, JPG, PNG, WEBP)`,
          });
        }
      }

      const result = await T3Controller._validateAndCreate(studentId, body);
      if (result.error) {
        const { status, ...errBody } = result.error;
        return res.status(status).json({ success: false, ...errBody });
      }
      const { t3Id, student, majorAdvisor, journal_snapshot, paper_and_research_details } = result;

      for (const [fieldName, fileArr] of entries) {
        const key  = FIELD_TO_KEY[fieldName];
        const file = fileArr[0];

        // นามสกุลไฟล์ที่เก็บจริง ยึดตาม MIME ที่ fileFilter อนุมัติ ไม่ใช้นามสกุลจาก client
        const ext      = MIME_TO_EXT[file.mimetype] || '.bin';
        const filename = `${Date.now()}${ext}`;
        const dir      = path.join(process.cwd(), 'uploads', 't3', String(t3Id), fieldName);

        await fs.mkdir(dir, { recursive: true });
        const filePath = path.join(dir, filename);
        await fs.writeFile(filePath, file.buffer);

        const relativePath   = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
        evidenceFiles[key]   = relativePath;
        uploaded[fieldName]  = relativePath;

        await T3Model.upsertEvidenceFile(t3Id, fieldName, relativePath);
      }

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
          items:      rows.map(r => T3Controller._formatRow(r)),
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