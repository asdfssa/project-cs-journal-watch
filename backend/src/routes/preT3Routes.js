/**
 * Pre-T3 Routes
 * Base path: /api/pre-t3
 */
const express    = require('express');
const router     = express.Router();
const PreT3Controller = require('../controllers/PreT3Controller');
const { requireAuth, requireRole } = require('../middlewares/auth');

// -------------------------------------------------------
// นิสิตยื่น Pre-T3 ใหม่
// POST /api/pre-t3
// -------------------------------------------------------
router.post(
  '/',
  requireAuth,
  requireRole('Student'),
  PreT3Controller.submit
);

// -------------------------------------------------------
// นิสิตดูประวัติของตัวเอง
// GET /api/pre-t3/my
// -------------------------------------------------------
router.get(
  '/my',
  requireAuth,
  requireRole('Student'),
  PreT3Controller.getMyRequests
);

// -------------------------------------------------------
// Advisor/Staff ดูรายการที่รออนุมัติ
// GET /api/pre-t3/pending
// -------------------------------------------------------
router.get(
  '/pending',
  requireAuth,
  requireRole('Supervisor', 'Staff'),
  PreT3Controller.getPending
);

// -------------------------------------------------------
// Advisor/Staff ดูประวัติการอนุมัติ/ปฏิเสธของตัวเอง
// Supervisor → เฉพาะที่ตัวเองเคย review
// Staff      → ทั้งหมดที่ Faculty Com เคยตัดสินแล้ว
// GET /api/pre-t3/history?status=Approved|Rejected&page=1&limit=20
// -------------------------------------------------------
router.get(
  '/history',
  requireAuth,
  requireRole('Supervisor', 'Staff'),
  PreT3Controller.getHistory
);

// -------------------------------------------------------
// ดูรายละเอียด Pre-T3 ตาม ID
// GET /api/pre-t3/:id
// -------------------------------------------------------
router.get(
  '/:id',
  requireAuth,
  requireRole('Student', 'Supervisor', 'Staff', 'Admin', 'SuperAdmin'),
  PreT3Controller.getById
);

// -------------------------------------------------------
// Advisor อนุมัติ/ปฏิเสธ
// PATCH /api/pre-t3/:id/advisor-review
// Body: { action: 'approve'|'reject', remark?: string }
// -------------------------------------------------------
router.patch(
  '/:id/advisor-review',
  requireAuth,
  requireRole('Supervisor'),
  PreT3Controller.advisorReview
);

// -------------------------------------------------------
// Staff/Faculty Com อนุมัติ/ปฏิเสธขั้นสุดท้าย
// PATCH /api/pre-t3/:id/faculty-review
// Body: { action: 'approve'|'reject', meeting_no?, meeting_date?, remark? }
// -------------------------------------------------------
router.patch(
  '/:id/faculty-review',
  requireAuth,
  requireRole('Staff'),
  PreT3Controller.facultyReview
);

// -------------------------------------------------------
// นิสิตยื่นซ้ำหลังถูกปฏิเสธ
// PATCH /api/pre-t3/:id/resubmit
// Body: { journal_snapshot, checklist_data }
// -------------------------------------------------------
router.patch(
  '/:id/resubmit',
  requireAuth,
  requireRole('Student'),
  PreT3Controller.resubmit
);

// -------------------------------------------------------
// นิสิตยกเลิกคำขอของตัวเอง (Pending หรือ Rejected เท่านั้น)
// PATCH /api/pre-t3/:id/cancel
// -------------------------------------------------------
router.patch(
  '/:id/cancel',
  requireAuth,
  requireRole('Student'),
  PreT3Controller.cancel
);

module.exports = router;