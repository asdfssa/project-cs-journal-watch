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
  private readonly ngZone = inject(NgZone); //service หลักของ Angular ที่ทำหน้าที่ "เฝ้าดู" ว่าเมื่อไหร่ควรสั่งอัปเดตหน้าจอใหม่ (เรียกกระบวนการนี้ว่า Change Detection) — เป็นกลไกเบื้องหลังที่ทำให้ Angular รู้ได้เองว่า "มีอะไรเปลี่ยนแปลง ต้อง render ใหม่แล้วนะ" โดยที่นักพัฒนาไม่ต้องสั่ง refresh หน้าจอเอง

  loading = signal(false);

  readonly CLIENT_ID = GOOGLE_CLIENT_ID;

  ngOnInit() {
    // ล็อกอินค้างอยู่แล้ว (token อยู่ใน localStorage ใช้ร่วมกันทุก tab) → ข้ามหน้า login ไป dashboard เลย
    const user = this.authService.user;
    if (this.authService.isLoggedIn && user) {
      this.router.navigate([this.dashboardFor(user.role)]);
      return;
    }

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
    });
  }

  private dashboardFor(role?: string): string {
    const r = role?.toLowerCase();
    return r === 'supervisor' ? '/advisor/dashboard'
         : r === 'staff'      ? '/staff/dashboard'
         : '/dashboard';
  }

  private decodeJwt(token: string): any { // ฟังก์ชันนี้คือการ แกะ JWT Token ของ Google ออกมาอ่านข้อมูลข้างใน โดยไม่ต้องพึ่งไลบรารีภายนอกเลย 
    try {
      const payload = token.split('.')[1];
      const base64  = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded  = base64 + '='.repeat((4 - base64.length % 4) % 4); //แปลงข้อความนั้น (ที่จริงๆ เป็น JSON string) ให้กลายเป็น JavaScript object ที่เอาไปใช้งานต่อได้ 
      return JSON.parse(atob(padded));
    } catch { return {}; }
  }

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
        this.router.navigate([this.dashboardFor(res.data.user.role)]);
      },
      error: (err) => {
        this.loading.set(false);
        this.showSnack(err.error?.message || 'เข้าสู่ระบบไม่สำเร็จ', 'error');
      
      },
    });
  }

  triggerGoogleSignIn(): void {
    const gsiBtn = document.querySelector('#google-btn div[role="button"]') as HTMLElement;
    gsiBtn?.click();
  }

  private loadGoogleScript(): Promise<void> { // คือฟังก์ชันที่ทำหน้าที่ โหลดสคริปต์ของ Google Identity Services เข้ามาในหน้าเว็บแบบ dynamic (ไม่ได้ใส่ <script> ไว้ตายตัวใน index.html ตั้งแต่แรก) พร้อมป้องกันการโหลดซ้ำซ้อน 
    return new Promise((resolve) => {
      if (document.getElementById('google-gsi-script')) {
        resolve(); //ถ้าผู้ใช้ย้อนกลับมาหน้า Login ซ้ำ) ถ้ามีอยู่แล้ว ไม่ต้องโหลดซ้ำ เรียก resolve() ทันทีถือว่าเสร็จเลย 
        return;
      }
      const script = document.createElement('script');
      script.id = 'google-gsi-script';
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      document.head.appendChild(script);
    });
  }

  private showSnack(message: string, type: 'success' | 'error' | 'info') {
    this.snackBar.open(message, '✕', {
      duration: 4000,
      panelClass: [`snack-${type}`],
      horizontalPosition: 'center',
      verticalPosition: 'top',
    });
  }
}
