/**
 * Auth Service
 * รวม business logic ของการ authentication:
 *   - login        : verify username/password + ออก OTP token
 *   - verifyOtp    : ตรวจ OTP + ออก access + refresh token
 *   - googleLogin  : verify Google ID token + ออก access + refresh token
 *   - refreshToken : ใช้ refresh token ออก access token ใหม่
 *   - logout       : revoke refresh token
 */
const bcrypt = require('bcryptjs');
const UserModel = require('../models/UserModel');
const OtpModel = require('../models/OtpModel');
const RefreshTokenModel = require('../models/RefreshTokenModel');
const MailService = require('./MailService');
const cryptoUtil = require('../utils/crypto');
const jwtUtil = require('../utils/jwt');
const config = require('../config');
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(config.google.clientId);

// hash ปลอมสำหรับ compare ตอนไม่พบ user — ให้ใช้เวลาเท่ากับกรณีพบ user (กันเดา username จากเวลาตอบ)
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);
class AuthError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode; 
  }
}

class AuthService {
  /**
   * Step 1: ตรวจ username + password → ออก OTP token + ส่ง OTP
   */
  static async login({ username, password }) {
    const user = await UserModel.findByUsername(username);

    // ตรวจรหัสผ่านก่อนเสมอ (ใช้ hash ปลอมถ้าไม่มี user) แล้วค่อยบอกสถานะบัญชี —
    // คนที่ไม่รู้รหัสผ่านจะได้ 401 แบบเดียวกันทุกกรณี เดาไม่ได้ว่ามี username นี้ไหม
    const passwordOk = await bcrypt.compare(String(password ?? ''), user?.password_hash || DUMMY_HASH);
    if (!user || !user.password_hash || !['Admin', 'SuperAdmin'].includes(user.role) || !passwordOk) {
      throw new AuthError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 'INVALID_CREDENTIALS', 401);
    }

    if (user.account_status === 'Suspended') {
      throw new AuthError('บัญชีนี้ถูกระงับการใช้งาน', 'ACCOUNT_SUSPENDED', 403);
    }
    if (user.account_status === 'Pending') {
      throw new AuthError('บัญชีของคุณรอการอนุมัติจากผู้ดูแลระบบ', 'ACCOUNT_PENDING', 403);
    }

    await this._issueOtpForUser(user);

    const otpToken = jwtUtil.issueOtpToken(user.user_id);

    return {
      otpToken,
      maskedEmail: this._maskEmail(user.msu_mail),
      expiresIn: config.otp.expiresMinutes * 60,
    };
  }

  /**
   * Step 2: ตรวจ OTP + ออก access token + refresh token
   */
  static async verifyOtp({ userId, otpCode }) {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new AuthError('ไม่พบบัญชีผู้ใช้ในระบบ', 'USER_NOT_FOUND', 404);
    }
    // บัญชีอาจถูกระงับระหว่างขั้น login กับขั้นกรอก OTP
    if (user.account_status !== 'Active') {
      throw new AuthError('บัญชีนี้ไม่สามารถใช้งานได้ในขณะนี้', 'ACCOUNT_UNAVAILABLE', 403);
    }

    const activeOtp = await OtpModel.findActive(userId, 'login_2fa');
    if (!activeOtp) {
      throw new AuthError('OTP หมดอายุหรือไม่พบในระบบ กรุณาเข้าสู่ระบบใหม่', 'OTP_EXPIRED', 400);
    }

    if (activeOtp.attempt_count >= config.otp.maxAttempts) {
      await OtpModel.markAsUsed(activeOtp.otp_id);
      throw new AuthError('ป้อน OTP เกินจำนวนครั้ง กรุณาเข้าสู่ระบบใหม่', 'OTP_MAX_ATTEMPTS', 429);
    }

    const isValid = cryptoUtil.compareOtpHash(otpCode, activeOtp.otp_hash);

    if (!isValid) {
      await OtpModel.incrementAttempts(activeOtp.otp_id);
      const attemptsLeft = config.otp.maxAttempts - (activeOtp.attempt_count + 1);
      throw new AuthError(`OTP ไม่ถูกต้อง เหลืออีก ${attemptsLeft} ครั้ง`, 'OTP_INVALID', 400);
    }

    await OtpModel.markAsUsed(activeOtp.otp_id);

    const accessToken = jwtUtil.issueAccessToken(user);
    const { token: refreshToken, hash, expiresAt } = jwtUtil.issueRefreshToken();

    await RefreshTokenModel.create({
      userId: user.user_id,
      tokenHash: hash,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        userId: user.user_id,
        username: user.username,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
      },
    };
  }

  /**
   * ส่ง OTP ใหม่
   */
  static async resendOtp({ userId }) {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new AuthError('ไม่พบบัญชีผู้ใช้ในระบบ', 'USER_NOT_FOUND', 404);
    }
    await this._issueOtpForUser(user);
    return {
      maskedEmail: this._maskEmail(user.msu_mail),
      expiresIn: config.otp.expiresMinutes * 60,
    };
  }

  /**
   * Google OAuth Login → ออก access token + refresh token
   */
  static async googleLogin({ idToken }) {
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: config.google.clientId,
      });
      payload = ticket.getPayload();
    } catch (err) {
      throw new AuthError('Google Token ไม่ถูกต้อง', 'INVALID_GOOGLE_TOKEN', 401);
    }

    const email = payload.email;
    const emailVerified = payload.email_verified;

    if (!emailVerified) {
      throw new AuthError('อีเมล Google ยังไม่ได้รับการยืนยัน', 'EMAIL_NOT_VERIFIED', 401);
    }

    const domain = email.split('@')[1];
    if (!config.google.allowedDomains.includes(domain)) {
      throw new AuthError(
        `อนุญาตเฉพาะอีเมล @${config.google.allowedDomain} เท่านั้น`,
        'INVALID_DOMAIN',
        403
      );
    }

    const user = await UserModel.findByMsuMail(email);
    if (!user) {
      throw new AuthError(
        'ไม่พบบัญชีผู้ใช้ในระบบ กรุณาติดต่อเจ้าหน้าที่',
        'USER_NOT_FOUND',
        404
      );
    }

    if (user.account_status === 'Suspended') {
      throw new AuthError('บัญชีนี้ถูกระงับการใช้งาน', 'ACCOUNT_SUSPENDED', 403);
    }
    if (user.account_status === 'Pending') {
      throw new AuthError(
        'บัญชีของคุณรอการอนุมัติจากผู้ดูแลระบบ',
        'ACCOUNT_PENDING',
        403
      );
    }

    if (['Admin', 'SuperAdmin'].includes(user.role)) {
      throw new AuthError(
        'บัญชี Admin ต้องเข้าสู่ระบบผ่านหน้า Admin Login',
        'USE_ADMIN_LOGIN',
        403
      );
    }

    const accessToken = jwtUtil.issueAccessToken(user);
    const { token: refreshToken, hash, expiresAt } = jwtUtil.issueRefreshToken();

    await RefreshTokenModel.create({
      userId: user.user_id,
      tokenHash: hash,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        userId: user.user_id,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
        msuMail: user.msu_mail,
        degreeLevel: user.degree_level || null,
      },
    };
  }

  /**
   * Refresh — ใช้ refresh token ออก access token ใหม่
   * เรียกเมื่อ access token หมดอายุ (401)
   */
  static async refreshToken({ refreshToken }) {
    if (!refreshToken) {
      throw new AuthError('ไม่พบ Refresh Token กรุณาเข้าสู่ระบบใหม่', 'NO_REFRESH_TOKEN', 401);
    }

    const tokenHash = jwtUtil.hashRefreshToken(refreshToken);
    const stored = await RefreshTokenModel.findByHash(tokenHash);

    if (!stored) {
      throw new AuthError('Refresh Token ไม่ถูกต้องหรือหมดอายุ', 'INVALID_REFRESH_TOKEN', 401);
    }

    const user = await UserModel.findById(stored.user_id);
    if (!user || user.account_status !== 'Active') {
      await RefreshTokenModel.revokeByHash(tokenHash);
      throw new AuthError('บัญชีนี้ไม่สามารถใช้งานได้ในขณะนี้', 'ACCOUNT_UNAVAILABLE', 401);
    }

    // Rotate: revoke token เก่า ออก token ใหม่
    await RefreshTokenModel.revokeByHash(tokenHash);

    const newAccessToken = jwtUtil.issueAccessToken(user);
    const { token: newRefreshToken, hash: newHash, expiresAt } = jwtUtil.issueRefreshToken();

    await RefreshTokenModel.create({
      userId: user.user_id,
      tokenHash: newHash,
      expiresAt,
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * Logout — revoke refresh token
   */
  static async logout({ refreshToken }) {
    if (!refreshToken) return;
    const tokenHash = jwtUtil.hashRefreshToken(refreshToken);
    await RefreshTokenModel.revokeByHash(tokenHash);
  }

  // ===== Private helpers =====

  static async _issueOtpForUser(user) {
    await OtpModel.invalidateActive(user.user_id, 'login_2fa');

    const otpCode = cryptoUtil.generateOtp();
    const otpHash = cryptoUtil.hashOtp(otpCode);
    const expiresAt = new Date(Date.now() + config.otp.expiresMinutes * 60 * 1000);

    await OtpModel.create({
      userId: user.user_id,
      otpHash,
      purpose: 'login_2fa',
      expiresAt,
    });

    const mailResult = await MailService.sendOtp(user.msu_mail, otpCode, 'login_2fa');
    if (!mailResult.success) {
      throw new AuthError('ส่ง OTP ไม่สำเร็จ กรุณาลองใหม่ภายหลัง', 'OTP_SEND_FAILED', 502);
    }
  }

  static _maskEmail(email) {
    const [local, domain] = email.split('@');
    if (!local || !domain) return email;
    const visible = local.slice(0, 2);
    const masked = '*'.repeat(Math.max(local.length - 2, 1));
    return `${visible}${masked}@${domain}`;
  }

  /**
   * Step 1: ขอรีเซ็ตรหัสผ่าน — ส่ง OTP ไปยัง email
   * เฉพาะ Admin / SuperAdmin ที่มี username + password
   */
  static async requestPasswordReset({ username }) {
    const user = await UserModel.findByUsername(username);
    const expiresIn = config.otp.expiresMinutes * 60;

    // ตอบแบบเดียวกันทุกกรณี (กัน enumerate username) — บัญชีที่รีเซ็ตไม่ได้จะได้
    // token ที่ไม่ผูกกับ user จริง ขั้น reset-password จะตอบ OTP_EXPIRED เหมือน OTP หมดอายุ
    if (!user || !['Admin', 'SuperAdmin'].includes(user.role) || user.account_status !== 'Active') {
      return { resetOtpToken: jwtUtil.issuePasswordResetOtpToken(0), expiresIn };
    }

    await OtpModel.invalidateActive(user.user_id, 'password_reset');

    const otpCode = cryptoUtil.generateOtp();
    const otpHash = cryptoUtil.hashOtp(otpCode);
    const expiresAt = new Date(Date.now() + config.otp.expiresMinutes * 60 * 1000);

    await OtpModel.create({
      userId: user.user_id,
      otpHash,
      purpose: 'password_reset',
      expiresAt,
    });

    const mailResult = await MailService.sendOtp(user.msu_mail, otpCode, 'password_reset');
    if (!mailResult.success) {
      throw new AuthError('ส่ง OTP ไม่สำเร็จ กรุณาลองใหม่ภายหลัง', 'OTP_SEND_FAILED', 502);
    }

    return { resetOtpToken: jwtUtil.issuePasswordResetOtpToken(user.user_id), expiresIn };
  }

  /**
   * Step 2: ยืนยัน OTP + ตั้งรหัสผ่านใหม่
   */
  static async resetPassword({ userId, otpCode, newPassword }) {
    const user = await UserModel.findById(userId);
    const activeOtp = user && ['Admin', 'SuperAdmin'].includes(user.role)
      ? await OtpModel.findActive(userId, 'password_reset')
      : null;
    if (!activeOtp) {
      throw new AuthError('OTP หมดอายุหรือไม่พบในระบบ กรุณาขอรีเซ็ตรหัสผ่านใหม่', 'OTP_EXPIRED', 400);
    }

    if (activeOtp.attempt_count >= config.otp.maxAttempts) {
      await OtpModel.markAsUsed(activeOtp.otp_id);
      throw new AuthError('ป้อน OTP เกินจำนวนครั้ง กรุณาขอรีเซ็ตรหัสผ่านใหม่', 'OTP_MAX_ATTEMPTS', 429);
    }

    const isValid = cryptoUtil.compareOtpHash(otpCode, activeOtp.otp_hash);

    if (!isValid) {
      await OtpModel.incrementAttempts(activeOtp.otp_id);
      const attemptsLeft = config.otp.maxAttempts - (activeOtp.attempt_count + 1);
      throw new AuthError(`OTP ไม่ถูกต้อง เหลืออีก ${attemptsLeft} ครั้ง`, 'OTP_INVALID', 400);
    }

    await OtpModel.markAsUsed(activeOtp.otp_id);

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await UserModel.updatePassword(userId, passwordHash);

    // บังคับ logout ทุก session
    await RefreshTokenModel.revokeAllByUserId(userId);
  }

  /**
   * POST /api/auth/register-staff
   * Staff สมัครด้วย Google OAuth — เช็ค email pattern ก่อน
   */
  static async registerStaff({ idToken }) {
    // Verify Google token
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: config.google.clientId,
      });
      payload = ticket.getPayload();
    } catch (err) {
      throw new AuthError('Google Token ไม่ถูกต้อง', 'INVALID_GOOGLE_TOKEN', 401);
    }

    const email = payload.email;
    if (!payload.email_verified) {
      throw new AuthError('อีเมล Google ยังไม่ได้รับการยืนยัน', 'EMAIL_NOT_VERIFIED', 401);
    }

    // เช็ค domain
    const domain = email.split('@')[1];
    if (!config.google.allowedDomains.includes(domain)) {
      throw new AuthError(
        `เฉพาะ @${config.google.allowedDomain} เท่านั้น`,
        'INVALID_DOMAIN',
        403
      );
    }

    // เช็ค pattern — ถ้าเป็นตัวเลขล้วนก่อน @ = นิสิต ห้ามสมัครเป็น Staff
    const localPart = email.split('@')[0];
    if (/^\d+$/.test(localPart)) {
      throw new AuthError(
        'อีเมลนิสิตไม่สามารถสมัครเป็นเจ้าหน้าที่ได้ กรุณาเข้าสู่ระบบด้วยปุ่ม "เข้าสู่ระบบ" แทน',
        'STUDENT_EMAIL_NOT_ALLOWED',
        403
      );
    }

    // เช็คว่ามี account อยู่แล้วไหม
    const existing = await UserModel.findByMsuMail(email);
    if (existing) {
      if (existing.account_status === 'Pending') {
        throw new AuthError(
          'บัญชีของคุณอยู่ระหว่างรอการอนุมัติจากผู้ดูแลระบบ',
          'ACCOUNT_PENDING',
          403
        );
      }
      if (existing.account_status === 'Active') {
        throw new AuthError(
          'อีเมลนี้มีบัญชีในระบบแล้ว กรุณาเข้าสู่ระบบด้วยปุ่ม "เข้าสู่ระบบ" แทน',
          'EMAIL_ALREADY_EXISTS',
          409
        );
      }
      if (existing.account_status === 'Suspended') {
        throw new AuthError('บัญชีนี้ถูกระงับการใช้งาน', 'ACCOUNT_SUSPENDED', 403);
      }
    }

    // สร้าง account ใหม่ role=Staff, status=Pending
    const firstName = payload.given_name || localPart;
    const lastName = payload.family_name || '';
    await UserModel.createPendingStaff({ msuMail: email, firstName, lastName });

    return {
      email,
      firstName,
      lastName,
      role: 'Staff',
      createdAt: new Date().toISOString(),
    };
  }
}

module.exports = { AuthService, AuthError };