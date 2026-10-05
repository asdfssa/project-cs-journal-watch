/**
 * PreT3Controller
 * จัดการ request/response สำหรับ Pre-T3 workflow
 *
 * Endpoints:
 *   POST   /api/pre-t3                     → นิสิตยื่นใหม่
 *   GET    /api/pre-t3/my                  → นิสิตดูประวัติของตัวเอง
 *   GET    /api/pre-t3/pending             → Advisor/Staff ดูรายการรออนุมัติ
 *   GET    /api/pre-t3/:id                 → ดูรายละเอียด
 *   PATCH  /api/pre-t3/:id/advisor-review  → Advisor อนุมัติ/ปฏิเสธ
 *   PATCH  /api/pre-t3/:id/faculty-review  → Staff อนุมัติ/ปฏิเสธ ขั้นสุดท้าย
 *   PATCH  /api/pre-t3/:id/resubmit        → นิสิตยื่นซ้ำหลัง Rejected
 */
const PreT3Model  = require('../models/PreT3Model');
const UserModel   = require('../models/UserModel');
const MailService = require('../services/MailService');
const db          = require('../config/database');
const { serverError } = require('../utils/errorResponse');
const { parsePagination } = require('../utils/input');
const { toMysqlDate } = require('../utils/date');

class PreT3Controller {
  // ============================================================
  // POST /api/pre-t3
  // Role: Student
  // ============================================================
  static async submit(req, res) {
    try {
      const studentId = req.user.sub;
      const { journal_snapshot, checklist_data, article_info } = req.body;

      // --- Validate required fields ---
      if (!journal_snapshot || !checklist_data) {
        return res.status(400).json({
          success: false,
          code: 'MISSING_FIELDS',
          message: 'journal_snapshot และ checklist_data จำเป็นต้องระบุ',
        });
      }

      // ตรวจ checklist ต้องมีครบ item1–item9 และเป็น boolean
      for (let i = 1; i <= 9; i++) {
        if (typeof checklist_data[`item${i}`] !== 'boolean') {
          return res.status(400).json({
            success: false,
            code: 'INVALID_CHECKLIST',
            message: `checklist_data.item${i} ต้องเป็น boolean`,
          });
        }
      }

      // ดึงข้อมูลนิสิตจาก DB (ไม่เชื่อ Frontend)
      const student = await UserModel.findById(studentId);
      if (!student) {
        return res.status(404).json({
          success: false,
          code: 'USER_NOT_FOUND',
          message: 'ไม่พบข้อมูลผู้ใช้',
        });
      }

      // --- ตรวจว่าโปรไฟล์นิสิตครบก่อนยื่น ---
      if (!student.degree_level || !student.curriculum_year || !student.study_plan_code) {
        const missing = {};
        if (!student.degree_level)    missing.degree_level    = 'ระดับการศึกษา (Master/Doctoral)';
        if (!student.curriculum_year) missing.curriculum_year = 'เกณฑ์หลักสูตร (2560/2566)';
        if (!student.study_plan_code) missing.study_plan_code = 'แผนการศึกษา (เช่น Doc_2_1, Master_A1)';

        return res.status(400).json({
          success: false,
          code: 'INCOMPLETE_STUDENT_PROFILE',
          message: 'ข้อมูลโปรไฟล์ไม่ครบ กรุณาระบุระดับการศึกษา หลักสูตร และแผนการศึกษาก่อนยื่น Pre-T3',
          missing,
        });
      }

      // ดึง Advisor จาก DB
      const [advisorRows] = await db.query(
        `SELECT aa.advisor_id, aa.advisor_type,
                u.prefix, u.first_name, u.last_name, u.role
           FROM advisor_assignments aa
           JOIN users u ON u.user_id = aa.advisor_id
          WHERE aa.student_id = ? AND aa.is_active = TRUE`,
        [studentId]
      );

      if (advisorRows.length === 0) {
        return res.status(400).json({
          success: false,
          code: 'NO_ADVISOR',
          message: 'บัญชีนี้ยังไม่มีที่ปรึกษา กรุณาติดต่อ Admin เพื่อผูกอาจารย์ที่ปรึกษาก่อนยื่น Pre-T3',
        });
      }

      const majorAdvisor = advisorRows.find(a => a.advisor_type === 'Major');
      const co1Advisor   = advisorRows.find(a => a.advisor_type === 'Co_1');
      const co2Advisor   = advisorRows.find(a => a.advisor_type === 'Co_2');

      if (!majorAdvisor) {
        return res.status(400).json({
          success: false,
          code: 'NO_MAJOR_ADVISOR',
          message: 'บัญชีนี้ยังไม่มีที่ปรึกษาหลัก (Major Advisor) กรุณาติดต่อ Admin',
        });
      }

      // article_info — รับจาก Frontend (นิสิตกรอกเอง)
      const articleInfoData = {
        title_en:     article_info?.title_en     || null,
        title_th:     article_info?.title_th     || null,
        authors:      article_info?.authors      || null,
        publish_year: article_info?.publish_year || null,
        doi:          article_info?.doi          || null,
        abstract:     article_info?.abstract     || null,
      };

      const preT3Id = await PreT3Model.create(
        studentId,
        journal_snapshot,
        checklist_data,
        {
          majorAdvisorId: majorAdvisor.advisor_id,
          coAdvisor1Id:   co1Advisor?.advisor_id || null,
          coAdvisor2Id:   co2Advisor?.advisor_id || null,
        },
        articleInfoData,
      );

      // แจ้ง Advisor ทางอีเมล
      const advisorUser = await UserModel.findById(majorAdvisor.advisor_id);
      if (advisorUser) {
        MailService.sendPreT3Notification(advisorUser.msu_mail, 'advisor_pending', {
          studentName: `${student.first_name} ${student.last_name}`,
          journalName: journal_snapshot.journal_name,
          issn:        journal_snapshot.issn,
          preT3Id,
        });
      }

      return res.status(201).json({
        success: true,
        message: 'ยื่น Pre-T3 สำเร็จ กรุณารอการอนุมัติจากอาจารย์ที่ปรึกษา',
        data: { pre_t3_id: preT3Id },
      });
    } catch (err) {
      return serverError(res, err, 'PreT3Controller.submit');
    }
  }

  // ============================================================
  // GET /api/pre-t3/my
  // Role: Student
  // ============================================================
  static async getMyRequests(req, res) {
    try {
      const studentId = req.user.sub;
      const rows = await PreT3Model.findByStudentId(studentId);

      return res.json({
        success: true,
        data: rows.map(r => PreT3Controller._formatRow(r)),
      });
    } catch (err) {
      return serverError(res, err, 'PreT3Controller.getMyRequests');
    }
  }

  // ============================================================
  // GET /api/pre-t3/pending
  // Role: Supervisor → เห็นแค่ของนิสิตตัวเอง
  //       Staff      → เห็นทั้งหมดที่ advisor approve แล้ว
  // ============================================================
  static async getPending(req, res) {
    try {
      const { role, sub: userId } = req.user;

      let rows;
      if (role === 'Supervisor') {
        rows = await PreT3Model.findPendingForAdvisor(userId);
      } else {
        // Staff
        rows = await PreT3Model.findPendingForFaculty();
      }

      return res.json({
        success: true,
        data: rows.map(r => PreT3Controller._formatRow(r)),
      });
    } catch (err) {
      return serverError(res, err, 'PreT3Controller.getPending');
    }
  }

  // ============================================================
  // GET /api/pre-t3/:id
  // Role: Student (ของตัวเอง), Supervisor (ของนิสิตตัวเอง), Staff (ทุกคน)
  // ============================================================
  static async getById(req, res) {
    try {
      const preT3Id = parseInt(req.params.id);
      const { role, sub: userId } = req.user;

      const row = await PreT3Model.findById(preT3Id);
      if (!row) {
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'ไม่พบ Pre-T3 นี้' });
      }

      // ตรวจสิทธิ์
      if (role === 'Student' && row.student_id !== userId) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์ดูรายการนี้' });
      }

      if (role === 'Supervisor') {
        const approval = row.advisor_approval;
        const co1      = row.co_advisor_1_approval;
        const co2      = row.co_advisor_2_approval;
        const isMyStudent =
          String(approval?.user_id) === String(userId) ||
          String(co1?.user_id)      === String(userId) ||
          String(co2?.user_id)      === String(userId);

        if (!isMyStudent) {
          return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์ดูรายการนี้' });
        }
      }

      return res.json({ success: true, data: PreT3Controller._formatRow(row) });
    } catch (err) {
      return serverError(res, err, 'PreT3Controller.getById');
    }
  }

  // ============================================================
  // PATCH /api/pre-t3/:id/advisor-review
  // Role: Supervisor
  // ============================================================
  static async advisorReview(req, res) {
    try {
      const preT3Id   = parseInt(req.params.id);
      const advisorId = req.user.sub;
      const { action, remark } = req.body;

      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ success: false, code: 'INVALID_ACTION', message: 'action ต้องเป็น approve หรือ reject' });
      }

      if (action === 'reject' && !remark) {
        return res.status(400).json({ success: false, code: 'REMARK_REQUIRED', message: 'กรุณาระบุเหตุผลการปฏิเสธ' });
      }

      const row = await PreT3Model.findById(preT3Id);
      if (!row) {
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'ไม่พบ Pre-T3 นี้' });
      }

      if (row.overall_status !== 'Pending') {
        return res.status(400).json({ success: false, code: 'INVALID_STATE', message: `Pre-T3 นี้อยู่ในสถานะ ${row.overall_status} แล้ว` });
      }

      // ตรวจว่า advisor นี้เป็นคนที่รับผิดชอบ slot ไหน
      const slots  = [row.advisor_approval, row.co_advisor_1_approval, row.co_advisor_2_approval];
      const mySlot = slots.find(s => String(s?.user_id) === String(advisorId) && s.status === 'Pending');
      if (!mySlot) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'คุณไม่ใช่อาจารย์ที่ปรึกษาของ Pre-T3 นี้ หรืออนุมัติแล้ว' });
      }

      const result = await PreT3Model.advisorReview(preT3Id, advisorId, action, remark || null);
      if (!result) {
        return res.status(409).json({ success: false, code: 'INVALID_STATE', message: 'Pre-T3 นี้ถูกเปลี่ยนสถานะไปแล้ว (เช่น นิสิตยกเลิกคำขอ) กรุณารีเฟรชหน้า' });
      }

      // ส่งอีเมลแจ้งนิสิต / Staff ตามผล
      const student     = await UserModel.findById(row.student_id);
      const journalName = row.journal_snapshot?.journal_name || '-';

      if (result.anyRejected) {
        MailService.sendPreT3Notification(student.msu_mail, 'advisor_rejected', {
          studentName: `${student.first_name} ${student.last_name}`,
          journalName,
          preT3Id,
          remark,
        });
      } else if (result.allApproved) {
        MailService.sendPreT3Notification(student.msu_mail, 'advisor_approved', {
          studentName: `${student.first_name} ${student.last_name}`,
          journalName,
          preT3Id,
        });
        const [staffRows] = await db.query(
          `SELECT msu_mail FROM users WHERE role = 'Staff' AND account_status = 'Active'`
        );
        for (const staff of staffRows) {
          MailService.sendPreT3Notification(staff.msu_mail, 'faculty_pending', {
            studentName: `${student.first_name} ${student.last_name}`,
            journalName,
            preT3Id,
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
          MailService.sendPreT3Notification(coAdvisor.msu_mail, notifyEvent, {
            studentName: `${student.first_name} ${student.last_name}`,
            journalName,
            preT3Id,
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
      return serverError(res, err, 'PreT3Controller.advisorReview');
    }
  }

  // ============================================================
  // PATCH /api/pre-t3/:id/faculty-review
  // Role: Staff
  // ============================================================
  static async facultyReview(req, res) {
    try {
      const preT3Id = parseInt(req.params.id);
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

      const row = await PreT3Model.findById(preT3Id);
      if (!row) {
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'ไม่พบ Pre-T3 นี้' });
      }

      // ต้องรอให้ advisor approve ครบก่อน
      const advisorStatus = row.advisor_approval?.status;
      if (advisorStatus !== 'Approved') {
        return res.status(400).json({ success: false, code: 'ADVISOR_NOT_APPROVED', message: 'อาจารย์ที่ปรึกษายังไม่อนุมัติ' });
      }

      if (row.overall_status !== 'Pending') {
        return res.status(400).json({ success: false, code: 'INVALID_STATE', message: `Pre-T3 นี้อยู่ในสถานะ ${row.overall_status} แล้ว` });
      }

      const result = await PreT3Model.facultyReview(preT3Id, action, meeting_no, toMysqlDate(meeting_date), remark);
      if (!result) {
        return res.status(409).json({ success: false, code: 'INVALID_STATE', message: 'Pre-T3 นี้ถูกเปลี่ยนสถานะไปแล้ว กรุณารีเฟรชหน้า' });
      }

      // แจ้งนิสิตผลสุดท้าย
      const student     = await UserModel.findById(row.student_id);
      const journalName = row.journal_snapshot?.journal_name || '-';

      const event = action === 'approve' ? 'faculty_approved' : 'faculty_rejected';
      MailService.sendPreT3Notification(student.msu_mail, event, {
        studentName: `${student.first_name} ${student.last_name}`,
        journalName,
        preT3Id,
        meetingNo:   meeting_no,
        meetingDate: meeting_date,
        remark,
      });

      return res.json({
        success: true,
        message: action === 'approve' ? 'อนุมัติ Pre-T3 เรียบร้อย' : 'ปฏิเสธ Pre-T3 เรียบร้อย',
        data: { overall_status: result.newOverallStatus },
      });
    } catch (err) {
      return serverError(res, err, 'PreT3Controller.facultyReview');
    }
  }

  // ============================================================
  // PATCH /api/pre-t3/:id/resubmit
  // Role: Student
  // ============================================================
  static async resubmit(req, res) {
    try {
      const preT3Id   = parseInt(req.params.id);
      const studentId = req.user.sub;
      const { journal_snapshot, checklist_data, article_info } = req.body;

      if (!journal_snapshot || !checklist_data) {
        return res.status(400).json({
          success: false,
          code: 'MISSING_FIELDS',
          message: 'journal_snapshot และ checklist_data จำเป็นต้องระบุ',
        });
      }

      const row = await PreT3Model.findById(preT3Id);
      if (!row) {
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'ไม่พบ Pre-T3 นี้' });
      }
      if (row.student_id !== studentId) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์แก้ไขรายการนี้' });
      }
      if (row.overall_status !== 'Rejected') {
        return res.status(400).json({ success: false, code: 'INVALID_STATE', message: 'สามารถยื่นซ้ำได้เฉพาะรายการที่ถูกปฏิเสธเท่านั้น' });
      }

      // article_info — รับจาก Frontend (นิสิตกรอกเอง)
      const articleInfoData = {
        title_en:     article_info?.title_en     || null,
        title_th:     article_info?.title_th     || null,
        authors:      article_info?.authors      || null,
        publish_year: article_info?.publish_year || null,
        doi:          article_info?.doi          || null,
        abstract:     article_info?.abstract     || null,
      };

      const ok = await PreT3Model.resubmit(preT3Id, journal_snapshot, checklist_data, articleInfoData);
      if (!ok) {
        return res.status(400).json({ success: false, code: 'INVALID_STATE', message: 'สามารถยื่นซ้ำได้เฉพาะรายการที่ถูกปฏิเสธเท่านั้น' });
      }

      // แจ้ง advisor ว่านิสิตยื่นซ้ำ
      const student   = await UserModel.findById(studentId);
      const advisorId = row.advisor_approval?.user_id;
      if (advisorId) {
        const advisor = await UserModel.findById(advisorId);
        if (advisor) {
          MailService.sendPreT3Notification(advisor.msu_mail, 'advisor_pending', {
            studentName: `${student.first_name} ${student.last_name}`,
            journalName: journal_snapshot.journal_name,
            issn:        journal_snapshot.issn,
            preT3Id,
          });
        }
      }

      return res.json({ success: true, message: 'ยื่น Pre-T3 ซ้ำเรียบร้อย กรุณารอการอนุมัติ' });
    } catch (err) {
      return serverError(res, err, 'PreT3Controller.resubmit');
    }
  }

  // ============================================================
  // PATCH /api/pre-t3/:id/cancel
  // Role: Student (เฉพาะของตัวเอง)
  // อนุญาตตอน Pending/Rejected เสมอ หรือ Approved ก็ได้ถ้ายังไม่มี T3 ที่ Approved
  // ผูกอยู่ — เผื่อ Pre-T3 ใช้งานต่อไม่ได้จริง (ตามที่ reject T3 ระบุ) นิสิตจะได้
  // เริ่ม flow ใหม่ทั้งหมดได้ (Pre-T3 ใหม่ → T3 ใหม่)
  // ============================================================
  static async cancel(req, res) {
    try {
      const preT3Id   = parseInt(req.params.id);
      const studentId = req.user.sub;

      const row = await PreT3Model.findById(preT3Id);
      if (!row) {
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'ไม่พบ Pre-T3 นี้' });
      }
      if (row.student_id !== studentId) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์ยกเลิกรายการนี้' });
      }
      if (!['Pending', 'Rejected', 'Approved'].includes(row.overall_status)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_STATE',
          message: `ไม่สามารถยกเลิกได้ Pre-T3 อยู่ในสถานะ ${row.overall_status}`,
        });
      }
      if (row.overall_status === 'Approved' && await PreT3Model.hasApprovedT3(preT3Id)) {
        return res.status(400).json({
          success: false,
          code: 'T3_ALREADY_APPROVED',
          message: 'ไม่สามารถยกเลิกได้ เนื่องจากมี T3 ที่ได้รับการอนุมัติแล้วผูกกับ Pre-T3 นี้',
        });
      }

      const cancelled = await PreT3Model.cancel(preT3Id);
      if (!cancelled) {
        return res.status(400).json({ success: false, code: 'CANCEL_FAILED', message: 'ไม่สามารถยกเลิกได้ในขณะนี้' });
      }

      return res.json({ success: true, message: 'ยกเลิก Pre-T3 เรียบร้อยแล้ว' });
    } catch (err) {
      return serverError(res, err, 'PreT3Controller.cancel');
    }
  }

  // ============================================================
  // GET /api/pre-t3/history
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
        ({ rows, total } = await PreT3Model.findReviewedByAdvisor(userId, { status, page, limit }));
      } else {
        // Staff
        ({ rows, total } = await PreT3Model.findReviewedByFaculty({ status, page, limit }));
      }

      return res.json({
        success: true,
        data: {
          items:      rows.map(r => PreT3Controller._formatRow(r)),
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      return serverError(res, err, 'PreT3Controller.getHistory');
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
      pre_t3_id:              row.pre_t3_id,
      student_id:             row.student_id,
      student_name:           row.first_name ? `${row.first_name} ${row.last_name}` : undefined,
      student_email:          row.msu_mail,
      overall_status:         row.overall_status,
      resubmit_count:         row.resubmit_count,
      last_rejected_at:       row.last_rejected_at,
      journal_snapshot:       parseJson(row.journal_snapshot),
      student_snapshot:       parseJson(row.student_snapshot),
      student_info:           parseJson(row.student_info),
      advisor_info:           parseJson(row.advisor_info),
      article_info:           parseJson(row.article_info),
      checklist_data:         parseJson(row.checklist_data),
      advisor_approval:       parseJson(row.advisor_approval),
      co_advisor_1_approval:  parseJson(row.co_advisor_1_approval),
      co_advisor_2_approval:  parseJson(row.co_advisor_2_approval),
      program_chair_approval: parseJson(row.program_chair_approval),
      faculty_com_approval:   parseJson(row.faculty_com_approval),
      created_at:             row.created_at,
      updated_at:             row.updated_at,
    };
  }
}

module.exports = PreT3Controller;