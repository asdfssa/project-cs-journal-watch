import { Component, inject, signal, OnInit, NgZone } from '@angular/core';
import { GOOGLE_CLIENT_ID } from '../../auth-config';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Constants } from '../../comfig/constants';
import { Welcome } from '../../model/req/login_req';
import { LoginRes } from '../../model/res/login_res';
import { AuthService } from '../../auth.service';
import { ServerStatusService } from '../../server-status.service';
import { loadGoogleIdentity } from '../../google-gsi';

declare const google: any;

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    MatProgressSpinnerModule,
    MatSnackBarModule,
    RouterModule,
  ],
  templateUrl: './login.html',
  styleUrls: ['./login.scss'],
})
export class Login implements OnInit {
  private readonly http = inject(HttpClient); 
  private readonly constants = inject(Constants); // เก็บ URL ของ backend API ไว้ที่จุดเดียว ให้ทุกไฟล์เรียกใช้ร่วมกัน
  private readonly authService = inject(AuthService); //  service ที่เขียนเองในโปรเจกต์นี้ ทำหน้าที่เป็น "ศูนย์กลางจัดการสถานะการล็อกอิน" ของทั้งแอป — เก็บว่าใครล็อกอินอยู่ ข้อมูลผู้ใช้คนนั้นคือใคร และ token สำหรับยืนยันตัวตนตอนเรียก API
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly serverStatus = inject(ServerStatusService);
  private readonly ngZone = inject(NgZone); //service หลักของ Angular ที่ทำหน้าที่ "เฝ้าดู" ว่าเมื่อไหร่ควรสั่งอัปเดตหน้าจอใหม่ (เรียกกระบวนการนี้ว่า Change Detection) — เป็นกลไกเบื้องหลังที่ทำให้ Angular รู้ได้เองว่า "มีอะไรเปลี่ยนแปลง ต้อง render ใหม่แล้วนะ" โดยที่นักพัฒนาไม่ต้องสั่ง refresh หน้าจอเอง

  loading = signal(false);

  readonly CLIENT_ID = GOOGLE_CLIENT_ID;

  ngOnInit() {
    this.loadGoogleScript().then(() => { //โค้ดทั้งก้อนนี้คือ "ไปรับ Chef Google มา → คุยตกลงกฎกัน → จ้างล่ามไว้แปลตอน Chef ตะโกนบอกผล" แค่นั้นเองครับ ฟังดูซับซ้อนแต่จริงๆ แค่จัดการเรื่อง "รอของมาก่อนค่อยใช้" กับ "แปลภาษาให้ Angular เข้าใจ" 
      google.accounts.id.initialize({
        client_id: this.CLIENT_ID,
        callback: (response: any) =>
          this.ngZone.run(() => this.handleGoogleCallback(response)),
      });

      google.accounts.id.renderButton(
        document.getElementById('google-btn'),
        {
          type: 'standard',
          shape: 'rectangular',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          locale: 'th',
          width: 400,
        }
      );
    }).catch(() => this.showSnack('โหลดปุ่มเข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณารีเฟรชหน้า', 'error'));
  }

  private decodeJwt(token: string): any { // ฟังก์ชันนี้คือการ แกะ JWT Token ของ Google ออกมาอ่านข้อมูลข้างใน โดยไม่ต้องพึ่งไลบรารีภายนอกเลย 
    try {
      const payload = token.split('.')[1];
      const base64  = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded  = base64 + '='.repeat((4 - base64.length % 4) % 4); //แปลงข้อความนั้น (ที่จริงๆ เป็น JSON string) ให้กลายเป็น JavaScript object ที่เอาไปใช้งานต่อได้ 
      return JSON.parse(atob(padded));
    } catch { return {}; }
  }

  /** บัญชียังรออนุมัติ / ถูกระงับ — แสดงเป็นกล่องสถานะค้างไว้ (เดิมเป็น snackbar error สีแดง 4 วิ) */
  accountNotice = signal<'pending' | 'suspended' | null>(null);

  private handleGoogleCallback(response: any) { // ฟังก์ชันนี้ทำให้ระบบ รับผลการยืนยันตัวตนจาก Google แล้วพานิสิตเข้าสู่ระบบได้ครบวงจร 
    this.loading.set(true);
    const claims = this.decodeJwt(response.credential);
    const picture: string = claims['picture'] ?? '';
    const body: Welcome = { idToken: response.credential };

    this.http.post<LoginRes>(`${this.constants.API_ENDPOINT}/auth/google`, body).subscribe({
      next: (res: LoginRes) => {
        this.loading.set(false);
        this.authService.setLoggedIn(res, picture);
        this.showSnack(`ยินดีต้อนรับ ${res.data.user.firstName} ${res.data.user.lastName}`, 'success');
        this.router.navigateByUrl(this.authService.homeUrl);
      },
      error: (err) => {
        const code = err?.error?.code;
        if (code === 'ACCOUNT_PENDING' || code === 'ACCOUNT_SUSPENDED') {
          this.loading.set(false);
          this.accountNotice.set(code === 'ACCOUNT_PENDING' ? 'pending' : 'suspended');
          return;
        }
        this.accountNotice.set(null);
        this.serverStatus.explain(err, 'เข้าสู่ระบบไม่สำเร็จ').subscribe(msg => {
          this.loading.set(false);
          this.showSnack(msg, 'error');
        });
      },
    });
  }

  triggerGoogleSignIn(): void {
    const gsiBtn = document.querySelector('#google-btn div[role="button"]') as HTMLElement;
    gsiBtn?.click();
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
