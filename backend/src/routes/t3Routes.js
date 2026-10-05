/**
 * T3 Routes
 * Base path: /api/t3
 */
const express       = require('express');
const router        = express.Router();
const T3Controller  = require('../controllers/T3Controller');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { uploadT3FieldsMemory } = require('../middlewares/upload');

// multer error handler (เหมือนกับใน uploadRoutes)
const handleMulterError = (err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, code: 'FILE_TOO_LARGE', message: 'ไฟล์มีขนาดเกิน 10 MB' });
  }
  if (err.message && err.message.includes('ประเภทไฟล์')) {
    return res.status(400).json({ success: false, code: 'INVALID_FILE_TYPE', message: err.message });
  }
  next(err);
};

// -------------------------------------------------------
// นิสิตยื่น T3 ใหม่
// POST /api/t3
// -------------------------------------------------------
router.post(
  '/',
  requireAuth,
  requireRole('Student'),
  T3Controller.submit
);

// -------------------------------------------------------
// นิสิตยื่น T3 + อัปโหลดไฟล์แนบพร้อมกันในคำขอเดียว
// POST /api/t3/with-files
// Content-Type: multipart/form-data
// Text fields (JSON string): pre_t3_id, journal_snapshot,
//   paper_and_research_details, publication_details, journal_metrics
// File fields (optional): acceptance_letter, full_paper, journal_cover,
//   table_of_contents, database_evidence, peer_review_result
// -------------------------------------------------------
router.post(
  '/with-files',
  requireAuth,
  requireRole('Student'),
  uploadT3FieldsMemory,
  handleMulterError,
  T3Controller.submitWithFiles
);

// -------------------------------------------------------
// นิสิตดูประวัติของตัวเอง
// GET /api/t3/my
// -------------------------------------------------------
router.get(
  '/my',
  requireAuth,
  requireRole('Student'),
  T3Controller.getMyRequests
);

// -------------------------------------------------------
// Advisor/Staff ดูรายการที่รออนุมัติ
// GET /api/t3/pending
// -------------------------------------------------------
router.get(
  '/pending',
  requireAuth,
  requireRole('Supervisor', 'Staff'),
  T3Controller.getPending
);

// -------------------------------------------------------
// Advisor/Staff ดูประวัติการอนุมัติ/ปฏิเสธของตัวเอง
// Supervisor → เฉพาะที่ตัวเองเคย review
// Staff      → ทั้งหมดที่ Faculty Com เคยตัดสินแล้ว
// GET /api/t3/history?status=Approved|Rejected&page=1&limit=20
// -------------------------------------------------------
router.get(
  '/history',
  requireAuth,
  requireRole('Supervisor', 'Staff'),
  T3Controller.getHistory
);

// -------------------------------------------------------
// ดูรายละเอียด T3 ตาม ID
// GET /api/t3/:id
// -------------------------------------------------------
router.get(
  '/:id',
  requireAuth,
  requireRole('Student', 'Supervisor', 'Staff', 'Admin', 'SuperAdmin'),
  T3Controller.getById
);

// -------------------------------------------------------
// Advisor อนุมัติ/ปฏิเสธ
// PATCH /api/t3/:id/advisor-review
// Body: { action: 'approve'|'reject', remark?: string }
// -------------------------------------------------------
router.patch(
  '/:id/advisor-review',
  requireAuth,
  requireRole('Supervisor'),
  T3Controller.advisorReview
);

// -------------------------------------------------------
// Staff บันทึกมติ Faculty Com
// PATCH /api/t3/:id/faculty-review
// Body: { action: 'approve'|'reject', meeting_no?, meeting_date?, remark? }
// -------------------------------------------------------
router.patch(
  '/:id/faculty-review',
  requireAuth,
  requireRole('Staff'),
  T3Controller.facultyReview
);

// -------------------------------------------------------
// นิสิตยกเลิกคำขอของตัวเอง (Pending หรือ Rejected เท่านั้น)
// PATCH /api/t3/:id/cancel
// -------------------------------------------------------
router.patch(
  '/:id/cancel',
  requireAuth,
  requireRole('Student'),
  T3Controller.cancel
);

module.exports = router;