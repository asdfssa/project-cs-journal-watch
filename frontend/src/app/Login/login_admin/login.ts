import { Component, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { PostLoginReq, PostLoginRes } from '../../model_admin/req/post_login_res';
import { Constants } from '../../comfig/constants';

@Component({
  selector: 'app-login',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  form: FormGroup;
  loading = signal(false);
  errorMsg = signal('');
  showPassword = signal(false);

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private router: Router,
    private constants: Constants,
  ) {
    this.form = this.fb.group({
      username: ['', Validators.required],
      password: ['', Validators.required],
    });

    // ล็อกอิน admin ค้างอยู่แล้ว (key 'user' ถูกตั้งหลังผ่าน OTP เท่านั้น) → ข้ามไป dashboard เลย
    try {
      const role = JSON.parse(localStorage.getItem('user') ?? 'null')?.role;
      if (localStorage.getItem('auth_token') && role === 'SuperAdmin') this.router.navigate(['/super-admin/dashboard']);
      else if (localStorage.getItem('auth_token') && role === 'Admin') this.router.navigate(['/admin/dashboard']);
    } catch {}
  }

  togglePassword() {
    this.showPassword.update(v => !v);
  }

  onSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.errorMsg.set('');

    const body: PostLoginReq = this.form.value;
    const url = `${this.constants.API_ENDPOINT}/auth/login`;

    this.http.post<PostLoginRes>(url, body).subscribe({
      next: (res) => {
        // ล้างโปรไฟล์ admin ของ session เก่าทิ้งก่อนเสมอ เพราะ isAdmin (app.ts) อ่านจาก
        // key นี้ตรงๆ โดยไม่เช็คว่า token ยังใช้ได้ไหม — ถ้าไม่ล้าง พอมาเริ่ม login
        // รอบใหม่ (เช่น token เก่าหมดอายุ/ถูกเคลียร์แล้วต้อง login ใหม่) ค่าเก่าที่ค้างอยู่
        // จะทำให้ sidebar admin โผล่มาที่หน้ากรอก OTP ทั้งที่ยังไม่ login เสร็จจริง
        localStorage.removeItem('user');
        localStorage.setItem('auth_token', res.data.otpToken);
        this.router.navigate(['/req-otp'], {
          state: {
            username: body.username,
            password: body.password,
            maskedEmail: res.data.maskedEmail,
          },
        });
        this.loading.set(false);
      },
      error: (err) => {
        this.errorMsg.set(err?.error?.message || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
        this.loading.set(false);
      },
    });
  }
}
