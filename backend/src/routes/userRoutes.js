/**
 * User Routes
 * Base path: /api/user
 * ทุก role ที่ login แล้วเข้าได้ (Student, Supervisor, Staff, Admin, SuperAdmin)
 */
const express        = require('express');
const router         = express.Router();
const UserController = require('../controllers/UserController');
const { requireAuth, requireRole } = require('../middlewares/auth');

const ALL_ROLES = ['Student', 'Supervisor', 'Staff', 'Admin', 'SuperAdmin'];

// -------------------------------------------------------
// ดูโปรไฟล์ตัวเอง
// GET /api/user/profile
// -------------------------------------------------------
router.get(
  '/profile',
  requireAuth,
  requireRole(...ALL_ROLES),
  UserController.getProfile
);

// -------------------------------------------------------
// รายชื่อบุคลากร Staff (หน้าบุคลากร / ช่องทางติดต่อ)
// GET /api/user/staff?search=...
// -------------------------------------------------------
router.get(
  '/staff',
  requireAuth,
  requireRole(...ALL_ROLES),
  UserController.getStaffDirectory
);

// -------------------------------------------------------
// แก้ไขโปรไฟล์ตัวเอง
// PATCH /api/user/profile
// Body: { prefix?, first_name?, last_name?, phone?, facebook_id?, line_id? }
// -------------------------------------------------------
router.patch(
  '/profile',
  requireAuth,
  requireRole(...ALL_ROLES),
  UserController.updateProfile
);

module.exports = router;