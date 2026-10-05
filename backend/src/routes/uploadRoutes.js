/**
 * Upload Routes
 * Base path: /api/upload
 */
const express          = require('express');
const router           = express.Router();
const UploadController = require('../controllers/UploadController');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { uploadT3Fields } = require('../middlewares/upload');

// multer error handler
const handleMulterError = (err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      code: 'FILE_TOO_LARGE',
      message: 'ไฟล์มีขนาดเกิน 10 MB',
    });
  }
  if (err.message && err.message.includes('ประเภทไฟล์')) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_FILE_TYPE',
      message: err.message,
    });
  }
  if (err.message === 't3 id ไม่ถูกต้อง') {
    return res.status(400).json({
      success: false,
      code: 'INVALID_T3_ID',
      message: err.message,
    });
  }
  next(err);
};

// -------------------------------------------------------
// อัปโหลดไฟล์แนบ T3 (หลายไฟล์พร้อมกันได้)
// POST /api/upload/t3/:id/files
// Content-Type: multipart/form-data
// Fields: acceptance_letter, full_paper, journal_cover,
//         table_of_contents, database_evidence, peer_review_result
// -------------------------------------------------------
router.post(
  '/t3/:id/files',
  requireAuth,
  requireRole('Student'),
  uploadT3Fields,
  handleMulterError,
  UploadController.uploadFiles
);

// -------------------------------------------------------
// ลบไฟล์แนบ field ที่ระบุ
// DELETE /api/upload/t3/:id/files/:field
// -------------------------------------------------------
router.delete(
  '/t3/:id/files/:field',
  requireAuth,
  requireRole('Student'),
  UploadController.deleteFile
);

// -------------------------------------------------------
// ดาวน์โหลด/ดูไฟล์
// GET /api/upload/t3/:id/files/:field
// -------------------------------------------------------
router.get(
  '/t3/:id/files/:field',
  requireAuth,
  requireRole('Student', 'Supervisor', 'Staff', 'Admin', 'SuperAdmin'),
  UploadController.downloadFile
);

module.exports = router;