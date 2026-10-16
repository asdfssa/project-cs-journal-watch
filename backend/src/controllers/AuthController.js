/**
 * Auth Controller
 * รับ HTTP request → เรียก AuthService → ส่ง response
 *
 * Refresh token เก็บใน httpOnly cookie (JS อ่านไม่ได้)
 * Access token ส่งใน response body (Frontend เก็บใน memory)
 */
const { AuthService } = require('../services/AuthService');
const UserModel = require('../models/UserModel');
// Cookie options สำหรับ refresh token
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,          // JS อ่านไม่ได้ ป้องกัน XSS
  secure: process.env.NODE_ENV === 'production', // HTTPS only ใน production
  sameSite: 'strict',      // ป้องกัน CSRF
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 วัน (ms)
  path: '/api/v3/auth', // ส่ง cookie เฉพาะ /api/v3/auth routes
};

class AuthController {
  /**
   * POST /api/auth/login
   * Body: { username, password }
   *
   * เรียกจาก: routes/authRoutes.js — loginLimiter → loginValidator → handleValidation → ที่นี่ (path จริงคือ /api/v3/auth/login)
   * รับจาก req.body: username, password (validator trim/ตัวพิมพ์เล็กให้แล้ว)
   * ส่งต่อ: AuthService.login({ username, password }) · ตอบ { otpToken, maskedEmail, expiresIn } · error → next(err) → errorHandler
   */
  static async login(req, res, next) {
    try {
      const { username, password } = req.body;
      const result = await AuthService.login({
        username,
        password,
      });

      return res.json({
        success: true,
        message: 'OTP sent to email',
        data: {
          otpToken: result.otpToken,
          maskedEmail: result.maskedEmail,
          expiresIn: result.expiresIn,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/verify-otp
   * Header: Authorization: Bearer <otpToken>
   * Body:   { otpCode }
   * → set refresh token ใน httpOnly cookie
   * → return access token ใน body
   *
   * เรียกจาก: routes/authRoutes.js — otpLimiter → requireOtpToken → verifyOtpValidator → handleValidation → ที่นี่
   * รับ: req.otpUserId (จาก requireOtpToken), req.body.otpCode
   * ส่งต่อ: AuthService.verifyOtp({ userId, otpCode }) · refreshToken ที่ได้ใส่ cookie jw_refresh_token, accessToken + user ตอบใน body
   */
  static async verifyOtp(req, res, next) {
    try {
      const { otpCode } = req.body;
      const result = await AuthService.verifyOtp({
        userId: req.otpUserId,
        otpCode,
      });

      // เก็บ refresh token ใน httpOnly cookie
      res.cookie('jw_refresh_token', result.refreshToken, REFRESH_COOKIE_OPTIONS);

      return res.json({
        success: true,
        message: 'Login successful',
        data: {
          accessToken: result.accessToken,
          user: result.user,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/resend-otp
   *
   * เรียกจาก: routes/authRoutes.js — otpLimiter → requireOtpToken → ที่นี่
   * ส่งต่อ: AuthService.resendOtp({ userId: req.otpUserId }) · ตอบ { maskedEmail, expiresIn } · ติด cooldown จะได้ OTP_COOLDOWN (429 + retryAfter) ผ่าน errorHandler
   */
  static async resendOtp(req, res, next) {
    try {
      const result = await AuthService.resendOtp({
        userId: req.otpUserId,
      });

      return res.json({
        success: true,
        message: 'OTP resent',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/google
   * Body: { idToken }
   * → set refresh token ใน httpOnly cookie
   * → return access token ใน body
   *
   * เรียกจาก: routes/authRoutes.js — googleLimiter → googleLoginValidator → handleValidation → ที่นี่ (นิสิต/อาจารย์/เจ้าหน้าที่ — Admin ต้องใช้ login ปกติ)
   * ส่งต่อ: AuthService.googleLogin({ idToken }) · ผลตอบเหมือน verifyOtp (cookie refresh + accessToken/user ใน body)
   */
  static async googleLogin(req, res, next) {
    try {
      const { idToken } = req.body;
      const result = await AuthService.googleLogin({
        idToken,
      });

      // เก็บ refresh token ใน httpOnly cookie
      res.cookie('jw_refresh_token', result.refreshToken, REFRESH_COOKIE_OPTIONS);

      return res.json({
        success: true,
        message: 'Google login successful',
        data: {
          accessToken: result.accessToken,
          user: result.user,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/refresh
   * Cookie: jw_refresh_token
   * → ออก access token ใหม่ + rotate refresh token
   *
   * เรียกจาก: routes/authRoutes.js — refreshLimiter → ที่นี่ (ไม่ผ่าน requireAuth เพราะเรียกตอน access token หมดอายุ)
   * รับ: cookie jw_refresh_token ส่งต่อ AuthService.refreshToken({ refreshToken })
   * ผล: accessToken ใหม่ใน body · result.refreshToken ไม่ null = rotate cookie ใหม่ · null = ช่วงผ่อนผัน ไม่แตะ cookie · AuthError 401 → ล้าง cookie
   */
  static async refresh(req, res, next) {
    try {
      const refreshToken = req.cookies?.jw_refresh_token;

      const result = await AuthService.refreshToken({
        refreshToken,
      });

      // Rotate: set refresh token ใหม่ใน cookie
      // (null = refresh ซ้อนในช่วงผ่อนผัน — ไม่แตะ cookie ที่ request ที่ชนะเพิ่งตั้งไว้)
      if (result.refreshToken) {
        res.cookie('jw_refresh_token', result.refreshToken, REFRESH_COOKIE_OPTIONS);
      }

      return res.json({
        success: true,
        data: {
          accessToken: result.accessToken,
        },
      });
    } catch (err) {
      // clear cookie เฉพาะตอน token ใช้ไม่ได้จริง (AuthError 401) — DB สะดุด/500 ไม่ควรเตะ user ออก
      if (err.statusCode === 401) {
        res.clearCookie('jw_refresh_token', { path: '/api/v3/auth' });
      }
      next(err);
    }
  }

  /**
 * GET /api/auth/me
 *
 * เรียกจาก: routes/authRoutes.js — requireAuth → ที่นี่ (ฝั่ง frontend เรียกหลัง login/refresh เพื่อรู้ข้อมูลผู้ใช้ปัจจุบัน)
 * รับ: req.user.sub (จาก requireAuth) → UserModel.findById · ถ้าเป็น Student เรียก UserModel.findAdvisorsByStudentId เพิ่มแล้วตอบ advisors[]
 * ตอบข้อมูลไม่เท่ากันตาม role: ทุก role ได้ข้อมูลพื้นฐาน, Admin/SuperAdmin เพิ่ม username, Student เพิ่มระดับปริญญา/หลักสูตร/อาจารย์ที่ปรึกษา
 */
static async me(req, res, next) {
  try {
    const user = await UserModel.findById(req.user.sub);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Base data — ทุก role
    const data = {
      userId:        user.user_id,
      role:          user.role,
      prefix:        user.prefix        || null,
      firstName:     user.first_name,
      lastName:      user.last_name,
      msuMail:       user.msu_mail,
      phone:         user.phone         || null,
      accountStatus: user.account_status,
    };

    // Admin / SuperAdmin — เพิ่ม username
    if (['Admin', 'SuperAdmin'].includes(user.role)) {
      data.username = user.username;
    }

    // Student — เพิ่ม degree info + advisors
    if (user.role === 'Student') {
      data.degreeLevel    = user.degree_level    || null;
      data.curriculumYear = user.curriculum_year || null;
      data.studyPlanCode  = user.study_plan_code || null;

      const advisorRows = await UserModel.findAdvisorsByStudentId(user.user_id);
      data.advisors = advisorRows.map(a => ({
        advisorType: a.advisor_type,   // Major | Co_1 | Co_2
        userId:      a.user_id,
        prefix:      a.prefix      || null,
        firstName:   a.first_name,
        lastName:    a.last_name,
        msuMail:     a.msu_mail,
      }));
    }

    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

  /**
   * POST /api/auth/logout
   * → revoke refresh token + clear cookie
   *
   * เรียกจาก: routes/authRoutes.js (ไม่มี requireAuth — logout ได้แม้ access token หมดอายุแล้ว)
   * ส่งต่อ: AuthService.logout({ refreshToken จาก cookie }) แล้วล้าง cookie เสมอ
   */
  static async logout(req, res, next) {
    try {
      const refreshToken = req.cookies?.jw_refresh_token;
      await AuthService.logout({ refreshToken });

      res.clearCookie('jw_refresh_token', { path: '/api/v3/auth' });

      return res.json({
        success: true,
        message: 'Logged out successfully',
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/forgot-password
   * Body: { username }
   *
   * เรียกจาก: routes/authRoutes.js — forgotPasswordLimiter → forgotPasswordValidator → handleValidation → ที่นี่
   * ส่งต่อ: AuthService.requestPasswordReset({ username }) · ตอบ resetOtpToken + expiresIn เหมือนกันทุกกรณี (ไม่บอกว่ามี username นี้หรือไม่)
   */
  static async forgotPassword(req, res, next) {
    try {
      const { username } = req.body;
      const result = await AuthService.requestPasswordReset({
        username,
      });

      return res.json({
        success: true,
        message: 'ถ้ามีบัญชีนี้ในระบบ เราได้ส่ง OTP ไปยังอีเมลที่ลงทะเบียนไว้แล้ว',
        data: {
          resetOtpToken: result.resetOtpToken,
          expiresIn: result.expiresIn,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/reset-password
   * Header: Authorization: Bearer <resetOtpToken>
   * Body: { otpCode, newPassword, confirmPassword }
   *
   * เรียกจาก: routes/authRoutes.js — otpLimiter → requirePasswordResetToken → resetPasswordValidator → handleValidation → ที่นี่
   * รับ: req.resetUserId (จาก requirePasswordResetToken), req.body.otpCode + newPassword
   * ส่งต่อ: AuthService.resetPassword({ userId, otpCode, newPassword }) · สำเร็จแล้วล้าง cookie refresh ของ session ปัจจุบัน
   */
  static async resetPassword(req, res, next) {
    try {
      const { otpCode, newPassword } = req.body;
      await AuthService.resetPassword({
        userId: req.resetUserId,
        otpCode,
        newPassword,
      });

      // Clear refresh token cookie ถ้ามี (บังคับ logout session ปัจจุบันด้วย)
      res.clearCookie('jw_refresh_token', { path: '/api/v3/auth' });

      return res.json({
        success: true,
        message: 'รีเซ็ตรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่',
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/register-staff
   *
   * เรียกจาก: routes/authRoutes.js — registerLimiter → googleLoginValidator → handleValidation → ที่นี่
   * ส่งต่อ: AuthService.registerStaff({ idToken }) · สร้างบัญชี Staff สถานะ Pending แล้วตอบ 201 — ยังไม่ออก token (ต้องรอ Admin อนุมัติผ่าน AdminController.approveUser)
   */
  static async registerStaff(req, res, next) {
    try {
      const { idToken } = req.body;
      const result = await AuthService.registerStaff({
        idToken,
      });

return res.status(201).json({
  success: true,
  message: 'สมัครสมาชิกสำเร็จ บัญชีของคุณอยู่ระหว่างรอการอนุมัติจากผู้ดูแลระบบ',
  data: {
    email: result.email,
    firstName: result.firstName,
    lastName: result.lastName,
    role: result.role,
    createdAt: result.createdAt,
  },
});
    } catch (err) {
      next(err);
    }
  }
}

module.exports = AuthController;