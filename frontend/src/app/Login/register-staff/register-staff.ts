import { Component, inject, signal, OnInit, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Constants } from '../../comfig/constants';
import { GOOGLE_CLIENT_ID } from '../../auth-config';
import { loadGoogleIdentity } from '../../google-gsi';
import { AuthService } from '../../auth.service';

declare const google: any;

@Component({
  selector: 'app-register-staff',
  standalone: true,
  imports: [CommonModule, RouterModule, MatSnackBarModule],
  templateUrl: './register-staff.html',
  styleUrl: './register-staff.scss',
})
export class RegisterStaff implements OnInit {
  private readonly http      = inject(HttpClient);
  private readonly constants = inject(Constants);
  private readonly snackBar  = inject(MatSnackBar);
  private readonly router    = inject(Router);
  private readonly ngZone    = inject(NgZone);

  readonly CLIENT_ID = GOOGLE_CLIENT_ID;

  loading        = signal(false);
  errorCode      = signal<string | null>(null);
  errorMessage   = signal<string | null>(null);
  /** สมัครสำเร็จ → แสดงหน้าสรุปค้างไว้ (เดิมเป็น snackbar 4 วิ แล้วเด้งไปหน้า login ผู้ใช้อ่านไม่ทัน) */
  registered     = signal<{ name: string; email: string } | null>(null);

  ngOnInit() {
    this.loadGoogleScript().then(() => {
      google.accounts.id.initialize({
        client_id: this.CLIENT_ID,
        callback: (response: any) =>
          this.ngZone.run(() => this.handleGoogleCallback(response)),
      });

      // width: 320 ตายตัวเดิม ล้นออกนอกจอบนมือถือจอแคบ (เช่น 360px/320px) ที่ตัว
      // .card-body มี padding 24px สองฝั่งเหลือพื้นที่จริงน้อยกว่า 320px — วัดความกว้าง
      // ของ container จริงแล้วใช้ค่านั้นแทน (เพดานสูงสุด 320 ตามเดิมสำหรับจอกว้าง)
      const btnContainer = document.getElementById('google-btn-register');
      const btnWidth = Math.min(320, btnContainer?.clientWidth || 320);

      google.accounts.id.renderButton(
        btnContainer,
        {
          type: 'standard',
          shape: 'rectangular',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          locale: 'th',
          width: btnWidth,
        }
      );
    }).catch(() => this.showSnack('โหลดปุ่มลงทะเบียนด้วย Google ไม่สำเร็จ กรุณารีเฟรชหน้า', 'error'));
  }

  private handleGoogleCallback(response: any) {
    this.loading.set(true);
    this.errorCode.set(null);
    this.errorMessage.set(null);

    this.http
      .post<any>(`${this.constants.API_ENDPOINT}/auth/register-staff`, {
        idToken: response.credential,
      })
      .subscribe({
        next: () => {
          this.loading.set(false);
          // ชื่อ/อีเมลจาก token ของ Google (แค่ใช้แสดงผล) — ให้ผู้สมัครเห็นว่าสมัครด้วยบัญชีไหน
          const c = AuthService.decodeJwt(response.credential) ?? {};
          this.registered.set({ name: String(c['name'] ?? ''), email: String(c['email'] ?? '') });
        },
        error: (err) => {
          this.loading.set(false);
          const code: string = err.error?.code ?? '';
          const msg: string  = err.error?.message ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่';
          this.errorCode.set(code);
          this.errorMessage.set(msg);
        },
      });
  }

  // F16: ใช้ loader กลางที่รอจน google.accounts พร้อมจริง (กัน race ตอนสคริปต์ยังโหลดไม่เสร็จ)
  private loadGoogleScript(): Promise<void> {
    return loadGoogleIdentity();
  }

  private showSnack(message: string, type: 'success' | 'error' | 'info') {
    this.snackBar.open(message, 'ปิด', {
      duration: 4000,
      panelClass: [`snack-${type}`],
      horizontalPosition: 'center',
      verticalPosition: 'top',
    });
  }
}
