/**
 * Unwanted Journal Routes
 * Base path: /api/unwanted-journals
 * GET     — ทุก role ที่ login แล้ว (Student, Supervisor, Staff, Admin, SuperAdmin)
 * POST / PATCH / DELETE — เฉพาะ Admin, SuperAdmin, Staff
 */
const express = require('express');
const UnwantedJournalController = require('../controllers/UnwantedJournalController');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

router.use(requireAuth);

// ทุก role ดูได้
router.get('/', UnwantedJournalController.getAll);

// ตรวจสอบ ISSN ก่อนกดตรวจสอบ (Student, Supervisor, Staff, Admin, SuperAdmin)
router.get('/check/:issn', UnwantedJournalController.checkByIssn);

// ดาวน์โหลด/ดูไฟล์หลักฐาน
router.get('/:id/evidence', UnwantedJournalController.getEvidenceFile);

// เฉพาะ Admin, SuperAdmin, Staff แก้ได้
router.post('/single',  requireRole('Admin', 'SuperAdmin', 'Staff'), UnwantedJournalController.createOne);
router.post('/import',  requireRole('Admin', 'SuperAdmin', 'Staff'), UnwantedJournalController.importCsv);
router.patch('/:id',    requireRole('Admin', 'SuperAdmin', 'Staff'), UnwantedJournalController.updateOne);
router.delete('/:id',   requireRole('Admin', 'SuperAdmin', 'Staff'), UnwantedJournalController.deleteOne);

module.exports = router;