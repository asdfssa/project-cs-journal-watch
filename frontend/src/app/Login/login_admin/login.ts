import { Component, OnInit, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { PostLoginReq, PostLoginRes } from '../../model_admin/req/post_login_res';
import { Constants } from '../../comfig/constants';
import { ServerStatusService, SERVER_DOWN_MESSAGE } from '../../server-status.service';

@Component({
  selector: 'app-login',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login implements OnInit {
  private serverStatus = inject(ServerStatusService);
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
  }

  // เปิดหน้ามาแล้วเซิร์ฟเวอร์ล่มอยู่ → บอกเลย ไม่ต้องรอให้ผู้ใช้กรอกแล้วเจอ error
  ngOnInit() {
    this.serverStatus.check().subscribe(ok => {
      if (!ok) this.errorMsg.set(SERVER_DOWN_MESSAGE);
    });
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
        // F8: otpToken ยังไม่ผ่าน 2FA — เก็บแยก key ไม่ให้นับว่า login แล้ว (auth_token = ผ่าน OTP แล้วเท่านั้น)
        localStorage.setItem('otp_token', res.data.otpToken);
        // ไม่ส่ง username/password ไปใน history.state แล้ว (F7: กด Back บนเครื่องใช้ร่วมกันแล้วอ่านรหัสได้)
        // หน้า OTP ส่งรหัสใหม่ผ่าน /auth/resend-otp ด้วย otpToken แทนการ login ซ้ำ
        this.router.navigate(['/req-otp'], {
          state: { maskedEmail: res.data.maskedEmail },
        });
        this.loading.set(false);
      },
      error: (err) => {
        // ไม่มี message จาก backend + ไม่ใช่ 4xx = ต่อเซิร์ฟเวอร์ไม่ได้/ขัดข้อง (เช็คผ่าน /health)
        // ไม่ใช่ "รหัสผิด" เสมอไปเหมือนเดิม
        this.serverStatus.explain(err, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง').subscribe(msg => {
          this.errorMsg.set(msg);
          this.loading.set(false);
        });
      },
    });
  }
}
