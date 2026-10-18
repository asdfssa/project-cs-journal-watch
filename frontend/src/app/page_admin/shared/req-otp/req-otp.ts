import { Component, signal, ViewChildren, QueryList, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Constants } from '../../../comfig/constants';
import { VerifyOtpRes } from '../../../model_admin/res/verify-otp_res';
import { AuthService } from '../../../auth.service';

@Component({
  selector: 'app-req-otp',
  imports: [CommonModule, RouterLink],
  templateUrl: './req-otp.html',
  styleUrl: './req-otp.scss',
})
export class ReqOTP implements AfterViewInit, OnDestroy {
  @ViewChildren('otpInput') otpInputs!: QueryList<ElementRef<HTMLInputElement>>;

  digits = signal<string[]>(['', '', '', '', '', '']);
  maskedEmail = signal<string>((history.state?.maskedEmail as string) ?? '');

  loading = signal(false);
  errorMsg = signal('');
  resendCooldown = signal(0);


  private cooldownTimer?: ReturnType<typeof setInterval>;

  constructor(
    private http: HttpClient,
    private router: Router,
    private constants: Constants,
    private authService: AuthService,
  ) {
    // เข้าหน้านี้ตรงๆ โดยไม่ได้ผ่าน login (ไม่มี otpToken) → กลับไปหน้า login
    if (!localStorage.getItem('otp_token')) {
      this.router.navigate(['/login-admin']);
    }
    // เพิ่งส่ง OTP ตอน login — ไม่ให้กดส่งซ้ำทันที (backend ไม่มี cooldown ให้ FE ทำเอง)
    this.startCooldown(60);
  }

  ngAfterViewInit() {
    this.focusBox(0);
  }

  /** otpToken หมดอายุ (10 นาทีนับจาก login ไม่ต่ออายุตอน resend) → ต้อง login ใหม่ */
  private handleOtpTokenGone(err: any): boolean {
    const code = err?.error?.code;
    if (code !== 'OTP_TOKEN_EXPIRED' && code !== 'NO_OTP_TOKEN') return false;
    this.errorMsg.set('หมดเวลายืนยันตัวตน กรุณาเข้าสู่ระบบใหม่อีกครั้ง');
    localStorage.removeItem('otp_token');
    setTimeout(() => this.router.navigate(['/login-admin']), 2000);
    return true;
  }

  private rateLimitMsg(err: any, fallback: string): string {
    const wait = Number(err?.headers?.get?.('Retry-After'));
    const base = err?.error?.message || fallback;
    return wait > 0 ? `${base} (ลองใหม่ได้ในอีก ${Math.ceil(wait / 60)} นาที)` : base;
  }

  get otpValue(): string {
    return this.digits().join('');
  }

  get isComplete(): boolean {
    return this.digits().every(d => d !== '');
  }

  focusBox(index: number) {
    const inputs = this.otpInputs.toArray();
    if (inputs[index]) {
      inputs[index].nativeElement.focus();
    }
  }

  onInput(event: Event, index: number) {
    const input = event.target as HTMLInputElement;
    const val = input.value.replace(/\D/g, '').slice(-1);
    input.value = val;

    const arr = [...this.digits()];
    arr[index] = val;
    this.digits.set(arr);

    if (val && index < 5) {
      this.focusBox(index + 1);
    }
  }

  onKeyDown(event: KeyboardEvent, index: number) {
    if (event.key === 'Backspace') {
      const arr = [...this.digits()];
      if (arr[index] === '' && index > 0) {
        arr[index - 1] = '';
        this.digits.set(arr);
        this.focusBox(index - 1);
      } else {
        arr[index] = '';
        this.digits.set(arr);
      }
      event.preventDefault();
    }
  }

  onPaste(event: ClipboardEvent) {
    event.preventDefault();
    const text = event.clipboardData?.getData('text') ?? '';
    const nums = text.replace(/\D/g, '').slice(0, 6).split('');
    const arr = ['', '', '', '', '', ''];
    nums.forEach((n, i) => (arr[i] = n));
    this.digits.set(arr);
    this.focusBox(Math.min(nums.length, 5));
  }

  onSubmit() {
    if (!this.isComplete || this.loading()) return;

    this.loading.set(true);
    this.errorMsg.set('');

    const token = localStorage.getItem('otp_token') ?? '';
    const url = `${this.constants.API_ENDPOINT}/auth/verify-otp`;

    this.http.post<VerifyOtpRes>(url, { otpCode: this.otpValue }, {
      headers: { Authorization: `Bearer ${token}` },
    }).subscribe({
      next: (res) => {
        // X29: ผ่าน AuthService ให้ isLoggedIn เป็น true ทันที — interceptor จะ refresh token ให้เมื่อหมดอายุ
        // (เดิมเขียน localStorage เอง ต้อง reload ก่อน ไม่งั้นหลัง 60 นาทีจะเจอแต่ error ทุกหน้า)
        this.authService.setAdminSession(res.data.accessToken, res.data.user);

        const role = res.data.user.role;
        if (role === 'SuperAdmin') {
          this.router.navigate(['/super-admin/dashboard']);
        } else if (role === 'Admin') {
          this.router.navigate(['/admin/dashboard']);
        } else {
          // F15: ล้าง session นี้ให้หมด (ฝั่ง client + revoke ที่ backend)
          this.authService.logout();
          this.errorMsg.set('ไม่มีสิทธิ์เข้าถึงระบบนี้');
        }
        this.loading.set(false);
      },
      error: (err) => {
        if (this.handleOtpTokenGone(err)) { this.loading.set(false); return; }
        this.errorMsg.set(err?.status === 429
          ? this.rateLimitMsg(err, 'ลองยืนยันบ่อยเกินไป')
          : (err?.error?.message || 'รหัส OTP ไม่ถูกต้องหรือหมดอายุ'));
        this.digits.set(['', '', '', '', '', '']);
        this.focusBox(0);
        this.loading.set(false);
      },
    });
  }

  resendOtp() {
    if (this.resendCooldown() > 0) return;

    // POST /auth/resend-otp — otpToken ใน header (ไม่มี body) / response ไม่มี otpToken ใหม่ ใช้ตัวเดิมต่อ
    const token = localStorage.getItem('otp_token') ?? '';
    const url = `${this.constants.API_ENDPOINT}/auth/resend-otp`;

    this.http.post<{ success: boolean; data?: { maskedEmail?: string; expiresIn?: number } }>(url, null, {
      headers: { Authorization: `Bearer ${token}` },
    }).subscribe({
      next: (res) => {
        if (res?.data?.maskedEmail) this.maskedEmail.set(res.data.maskedEmail);
        this.errorMsg.set('');
        this.digits.set(['', '', '', '', '', '']);   // OTP เก่าใช้ไม่ได้แล้ว
        this.focusBox(0);
        this.startCooldown(60);
      },
      error: (err) => {
        if (this.handleOtpTokenGone(err)) return;
        // B15: backend มี cooldown ขอ OTP ซ้ำ 60 วิ ต่อผู้ใช้ — นับถอยหลังตามเวลาที่ backend บอก
        if (err?.error?.code === 'OTP_COOLDOWN') this.startCooldown(Number(err.error.retryAfter) || 60);
        this.errorMsg.set(err?.status === 429
          ? this.rateLimitMsg(err, 'ขอรหัสบ่อยเกินไป')
          : (err?.error?.message || 'ไม่สามารถส่งรหัสได้ในขณะนี้'));
      },
    });
  }

  // F15: ออกจากหน้าแล้วหยุดนับถอยหลัง
  ngOnDestroy() {
    clearInterval(this.cooldownTimer);
  }

  private startCooldown(seconds: number) {
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
