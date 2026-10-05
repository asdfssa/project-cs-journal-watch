/**
 * User Management Routes
 * Base path: /api/manage/users
 * เข้าได้: Admin, SuperAdmin, Staff  (บางเส้นจำกัดเฉพาะ Admin, SuperAdmin)
 */
const express = require('express');
const AdminController = require('../controllers/AdminController');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

router.use(requireAuth);
router.use(requireRole('Admin', 'SuperAdmin', 'Staff'));

router.get('/',                AdminController.getUsers);
router.post('/single',         AdminController.createUser);
router.post('/import',         AdminController.importUsers);
// เฉพาะ Admin, SuperAdmin เท่านั้น — Staff ไม่มีสิทธิ์อนุมัติผู้ใช้
router.patch('/:id/approve',   requireRole('Admin', 'SuperAdmin'), AdminController.approveUser);
router.patch('/:id/suspend',   AdminController.suspendUser);
router.patch('/:id/activate',  AdminController.activateUser);
router.patch('/:id/advisors',  AdminController.updateAdvisors);
router.patch('/:id',           AdminController.updateUser);

module.exports = router;
