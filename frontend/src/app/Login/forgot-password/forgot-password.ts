import { Component, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { Constants } from '../../comfig/constants';
import { AuthService } from '../../auth.service';
import { PASSWORD_PATTERN, passwordProblem } from '../../password-policy';

// ลืมรหัสผ่าน (Admin / SuperAdmin) — 2 ขั้นในหน้าเดียว
//   1) กรอก username → POST /auth/forgot-password → ได้ resetOtpToken (เก็บใน memory เท่านั้น)
//   2) กรอก OTP จากอีเมล + รหัสใหม่ → POST /auth/reset-password (Bearer resetOtpToken, body camelCase)
// backend ตอบเหมือนกันทุกกรณีแม้ไม่มี username นี้ (กันเดา) จึงเขียนข้อความแบบทั่วไป
@Component({
  selector: 'app-forgot-password',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './forgot-password.html',
  styleUrls: ['../login_admin/login.scss', './forgot-password.scss'],
})
export class ForgotPassword implements OnDestroy {
  private http      = inject(HttpClient);
  private router    = inject(Router);
  private constants = inject(Constants);
  private auth      = inject(AuthService);


  step     = signal<1 | 2 | 'done'>(1);
  loading  = signal(false);
  errorMsg = signal('');
  fieldErrors = signal<string[]>([]);
  showPassword = signal(false);
  resendCooldown = signal(0);

  username        = '';
  otpCode         = '';
  newPassword     = '';
  confirmPassword = '';

  private resetOtpToken = '';
  private cooldownTimer?: ReturnType<typeof setInterval>;

  // X48: เดิมเช็คแค่ความยาว ผู้ใช้กรอกผ่านฟอร์มแล้วโดน backend ปฏิเสธ — ใช้กฎเดียวกับ backend
  get passwordError(): string { return passwordProblem(this.newPassword); }
  get passwordMismatch(): boolean { return !!this.confirmPassword && this.newPassword !== this.confirmPassword; }
  get canReset(): boolean {
    return /^\d{6}$/.test(this.otpCode) && PASSWORD_PATTERN.test(this.newPassword)
        && this.newPassword === this.confirmPassword && !this.loading();
  }

  // ── ขั้นที่ 1: ขอ OTP ─────────────────────────────────────────────
  requestOtp(): void {
    const username = this.username.trim();
    if (!username || this.loading()) return;
    this.loading.set(true);
    this.errorMsg.set('');

    this.http.post<{ data?: { resetOtpToken?: string } }>(
      `${this.constants.API_ENDPOINT}/auth/forgot-password`, { username },
    ).subscribe({
      next: res => {
        this.loading.set(false);
        this.resetOtpToken = res?.data?.resetOtpToken ?? '';
        this.otpCode = '';
        this.step.set(2);
        this.startCooldown(60);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        // B15: ขอ OTP ซ้ำภายใน 60 วิ → 429 OTP_COOLDOWN พร้อม retryAfter (วินาที)
        if (err?.error?.code === 'OTP_COOLDOWN') this.startCooldown(Number(err.error.retryAfter) || 60);
        this.errorMsg.set(this.describe(err, 'ไม่สามารถส่งรหัส OTP ได้ในขณะนี้'));
      },
    });
  }

  resendOtp(): void {
    if (this.resendCooldown() > 0 || this.loading()) return;
    this.requestOtp();
  }

  // ── ขั้นที่ 2: ตั้งรหัสผ่านใหม่ ───────────────────────────────────
  resetPassword(): void {
    if (!this.canReset) return;
    this.loading.set(true);
    this.errorMsg.set('');
    this.fieldErrors.set([]);

    this.http.post(
      `${this.constants.API_ENDPOINT}/auth/reset-password`,
      { otpCode: this.otpCode, newPassword: this.newPassword, confirmPassword: this.confirmPassword },
      { headers: { Authorization: `Bearer ${this.resetOtpToken}` } },
    ).subscribe({
      next: () => {
        this.loading.set(false);
        this.resetOtpToken = '';
        // reset สำเร็จ = ทุก session ของบัญชีนี้ถูกออกจากระบบ → ล้างของในเครื่องแล้วพาไปหน้า login
        this.auth.logout();
        this.step.set('done');
        setTimeout(() => this.router.navigate(['/login-admin']), 2500);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        const code = err?.error?.code;
        // token หมด / OTP หมดอายุ / ผิดครบ 5 ครั้ง → ต้องเริ่มขอ OTP ใหม่
        if (['NO_RESET_TOKEN', 'RESET_TOKEN_EXPIRED', 'OTP_EXPIRED', 'OTP_MAX_ATTEMPTS'].includes(code)) {
          this.step.set(1);
          this.resetOtpToken = '';
          this.errorMsg.set(code === 'OTP_MAX_ATTEMPTS'
            ? 'กรอก OTP ผิดเกินจำนวนครั้งที่กำหนด กรุณาขอรหัสใหม่'
            : 'รหัส OTP หมดอายุแล้ว กรุณาขอรหัสใหม่');
          return;
        }
        if (code === 'VALIDATION_ERROR' && Array.isArray(err?.error?.errors)) {
          // ข้อความรายช่องจาก backend เป็นภาษาอังกฤษ — แสดงพร้อมชื่อช่องภาษาไทย
          const label: Record<string, string> = { otpCode: 'รหัส OTP', newPassword: 'รหัสผ่านใหม่', confirmPassword: 'ยืนยันรหัสผ่าน' };
          this.fieldErrors.set(err.error.errors.map((e: { field: string; message: string }) => `${label[e.field] ?? e.field}: ${e.message}`));
          this.errorMsg.set('รหัสผ่านใหม่ไม่ตรงตามเงื่อนไข');
          return;
        }
        this.errorMsg.set(this.describe(err, 'ตั้งรหัสผ่านใหม่ไม่สำเร็จ'));
      },
    });
  }

  backToStep1(): void {
    this.step.set(1);
    this.errorMsg.set('');
    this.fieldErrors.set([]);
    this.resetOtpToken = '';
  }

  private describe(err: HttpErrorResponse, fallback: string): string {
    if (!err?.status) return 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ในขณะนี้ กรุณาลองใหม่ภายหลัง';
    const msg = err?.error?.message || fallback;
    const wait = Number(err?.headers?.get?.('Retry-After'));
    return err.status === 429 && wait > 0 ? `${msg} (ลองใหม่ได้ในอีก ${Math.ceil(wait / 60)} นาที)` : msg;
  }

  // X48: ออกจากหน้าแล้วหยุดนับถอยหลัง (เดิม setInterval ทำงานค้างต่อ)
  ngOnDestroy(): void {
    clearInterval(this.cooldownTimer);
  }

  private startCooldown(seconds: number): void {
    this.resendCooldown.set(seconds);
    clearInterval(this.cooldownTimer);
    this.cooldownTimer = setInterval(() => {
      this.resendCooldown.update(v => {
        if (v <= 1) { clearInterval(this.cooldownTimer); return 0; }
        return v - 1;
      });
    }, 1000);
  }
}
