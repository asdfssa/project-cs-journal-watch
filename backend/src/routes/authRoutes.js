/**
 * Auth Routes
 * Base path: /api/auth
 */
const express = require('express');
const AuthController = require('../controllers/AuthController');
const { loginValidator, verifyOtpValidator, googleLoginValidator, forgotPasswordValidator, resetPasswordValidator } = require('../validators/authValidator');
const handleValidation = require('../middlewares/validation');
const { requireAuth, requireOtpToken, requirePasswordResetToken } = require('../middlewares/auth');
const { loginLimiter, googleLimiter, otpLimiter, registerLimiter, forgotPasswordLimiter, refreshLimiter } = require('../middlewares/rateLimit');
const router = express.Router();

// Step 1: ส่ง username + password → รับ OTP token
router.post('/login', loginLimiter, loginValidator, handleValidation, AuthController.login);

// Step 2: ส่ง OTP code (พร้อม OTP token) → รับ access token + set refresh cookie
router.post(
  '/verify-otp',
  otpLimiter,
  requireOtpToken,
  verifyOtpValidator,
  handleValidation,
  AuthController.verifyOtp
);

// ส่ง OTP ใหม่
router.post('/resend-otp', otpLimiter, requireOtpToken, AuthController.resendOtp);

// Google OAuth Login → รับ access token + set refresh cookie
router.post('/google', googleLimiter, googleLoginValidator, handleValidation, AuthController.googleLogin);
router.post('/register-staff', registerLimiter, googleLoginValidator, handleValidation, AuthController.registerStaff);
// Refresh access token ด้วย refresh token จาก cookie
router.post('/refresh', refreshLimiter, AuthController.refresh);

// ดึงข้อมูล user ปัจจุบัน
router.get('/me', requireAuth, AuthController.me);

// Logout → revoke refresh token + clear cookie
router.post('/logout', AuthController.logout);

// Password Reset ด้วย 2FA Email (Admin / SuperAdmin เท่านั้น)
// Step 1: ส่ง username → รับ OTP ทาง email + resetOtpToken
router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  forgotPasswordValidator,
  handleValidation,
  AuthController.forgotPassword
);
// Step 2: ส่ง OTP + รหัสผ่านใหม่ → รีเซ็ตรหัสผ่าน
router.post(
  '/reset-password',
  otpLimiter,
  requirePasswordResetToken,
  resetPasswordValidator,
  handleValidation,
  AuthController.resetPassword
);

module.exports = router;