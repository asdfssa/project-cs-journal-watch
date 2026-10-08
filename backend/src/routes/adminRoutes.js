/**
 * Admin Routes
 * Base path: /api/admin
 * เฉพาะ Admin และ SuperAdmin เท่านั้น
 * หมายเหตุ: user management ย้ายไป /api/manage/users แล้ว (Admin + Staff เข้าได้)
 */
const express = require('express');
const AdminController = require('../controllers/AdminController');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();
const { requireNumericId } = require('../middlewares/validation');
router.param('id', requireNumericId);

router.use(requireAuth);
router.use(requireRole('Admin', 'SuperAdmin'));

// ภาพรวมสถิติ
router.get('/stats', AdminController.getStats);

// จัดการ Admin (Admin/SuperAdmin เท่านั้น)
router.get('/admins',                AdminController.getAdmins);
router.post('/admins',               AdminController.createAdmin);
router.patch('/admins/:id/suspend',  AdminController.suspendAdmin);
router.patch('/admins/:id/activate', AdminController.activateAdmin);
router.patch('/admins/:id',          AdminController.updateAdmin);
router.delete('/admins/:id',         AdminController.deleteAdmin);

module.exports = router;