import { Component, signal, ViewChildren, QueryList, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Constants } from '../../../comfig/constants';
import { VerifyOtpRes } from '../../../model_admin/res/verify-otp_res';
import { PostLoginRes } from '../../../model_admin/req/post_login_res';

@Component({
  selector: 'app-req-otp',
  imports: [CommonModule, RouterLink],
  templateUrl: './req-otp.html',
  styleUrl: './req-otp.scss',
})
export class ReqOTP implements AfterViewInit {
  @ViewChildren('otpInput') otpInputs!: QueryList<ElementRef<HTMLInputElement>>;

  digits = signal<string[]>(['', '', '', '', '', '']);
  private readonly credentials = {
    username: (history.state?.username as string) ?? '',
    password: (history.state?.password as string) ?? '',
  };

  maskedEmail = signal<string>((history.state?.maskedEmail as string) ?? '');

  loading = signal(false);
  errorMsg = signal('');
  resendCooldown = signal(0);


  private cooldownTimer?: ReturnType<typeof setInterval>;

  constructor(
    private http: HttpClient,
    private router: Router,
    private constants: Constants,
  ) {}

  ngAfterViewInit() {
    this.focusBox(0);
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

    const token = localStorage.getItem('auth_token') ?? '';
    const url = `${this.constants.API_ENDPOINT}/auth/verify-otp`;

    this.http.post<VerifyOtpRes>(url, { otpCode: this.otpValue }, {
      headers: { Authorization: `Bearer ${token}` },
    }).subscribe({
      next: (res) => {
        localStorage.setItem('auth_token', res.data.accessToken);
        localStorage.setItem('auth_refresh_token', res.data.refreshToken);
        localStorage.setItem('user', JSON.stringify(res.data.user));

        const role = res.data.user.role;
        if (role === 'SuperAdmin') {
          this.router.navigate(['/super-admin/dashboard']);
        } else if (role === 'Admin') {
          this.router.navigate(['/admin/dashboard']);
        } else {
          localStorage.removeItem('auth_token');
          localStorage.removeItem('user');
          this.errorMsg.set('ไม่มีสิทธิ์เข้าถึงระบบนี้');
        }
        this.loading.set(false);
      },
      error: (err) => {
        this.errorMsg.set(err?.error?.message || 'รหัส OTP ไม่ถูกต้องหรือหมดอายุ');
        this.digits.set(['', '', '', '', '', '']);
        this.focusBox(0);
        this.loading.set(false);
      },
    });
  }

  resendOtp() {
    if (this.resendCooldown() > 0) return;

    const url = `${this.constants.API_ENDPOINT}/auth/login`;

    this.http.post<PostLoginRes>(url, this.credentials).subscribe({
      next: (res) => {
        // กันค่า user ของ session เก่าค้างอยู่เหมือนกับตอนกด login ครั้งแรก
        localStorage.removeItem('user');
        localStorage.setItem('auth_token', res.data.otpToken);
        this.errorMsg.set('');
        this.startCooldown(60);
      },
      error: (err) => this.errorMsg.set(err?.error?.message || 'ไม่สามารถส่งรหัสได้ในขณะนี้'),
    });
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
