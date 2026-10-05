/**
 * Upload Routes
 * Base path: /api/upload
 */
const express          = require('express');
const router           = express.Router();
const UploadController = require('../controllers/UploadController');
const { requireAuth, requireRole } = require('../middlewares/auth');

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