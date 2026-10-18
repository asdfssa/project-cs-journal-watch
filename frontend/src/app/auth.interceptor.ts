import { Injectable } from '@angular/core';
import {
  HttpInterceptor, HttpRequest, HttpHandler,
  HttpEvent, HttpErrorResponse,
} from '@angular/common/http';
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { catchError, filter, switchMap, take, timeout } from 'rxjs/operators';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { ErrorNotificationService, SERVER_ERROR_MESSAGE } from './error-notification.service';
import { Constants } from './comfig/constants';
import { SERVER_DOWN_MESSAGE } from './server-status.service';

const AUTH_FLOW_URL = /\/auth\/(login|verify-otp|resend-otp|google|refresh|logout|register-staff|forgot-password|reset-password)\b/;

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  // ธงกันไม่ให้ refresh token ซ้ำ ถ้ามีหลาย request เจอ 401 พร้อมกัน
  private isRefreshing   = false;
  // กระดานประกาศ token ใหม่ request ที่มาทีหลังจะรอฟังตรงนี้แทนที่จะ refresh เอง
  private refreshSubject = new BehaviorSubject<string | null>(null);

  constructor(
    private auth: AuthService,
    private router: Router,
    private errorNotification: ErrorNotificationService,
    private constants: Constants,
  ) {}

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    // X27: API อยู่คนละ origin กับหน้าเว็บ (api.farmlnwza007.online vs journal.farmlnwza007.online)
    // cookie refresh token (httpOnly, path=/api/v3/auth) จะถูกเก็บ/ส่งข้าม origin ก็ต่อเมื่อเปิด withCredentials
    // จำกัดเฉพาะ /auth/* — request อื่นใช้ Bearer token อยู่แล้ว ไม่ต้องพก cookie
    if (req.url.startsWith(`${this.constants.API_ENDPOINT}/auth/`)) {
      req = req.clone({ withCredentials: true });
    }
    return next.handle(req).pipe(
      catchError((err: HttpErrorResponse) => {
        // ไม่ refresh ถ้า error มาจาก endpoint /auth/refresh เอง (ป้องกัน loop)
        // และไม่ redirect ถ้า user ยังไม่ได้ login อยู่ (ปล่อยให้ component จัดการ error เอง)
        // 401 จาก endpoint ที่ใช้เข้าสู่ระบบ (login, verify-otp, google, refresh ฯลฯ) = ข้อมูลที่กรอกไม่ผ่าน
        // ไม่ใช่ token หมดอายุ — เดิมถ้ามี token เก่าค้าง จะไป refresh แล้ว throw Error ที่ไม่มี message
        // หน้า login เลยขึ้น "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" ทั้งที่ข้อความจริงจาก backend หายไป
        // (/auth/me ยังต้อง refresh ตามปกติ จึงไม่ข้ามทั้ง /auth/)
        if (err.status === 401 && !AUTH_FLOW_URL.test(req.url)) {
          if (this.auth.isLoggedIn) return this.handle401(req, next);
          // session ถูกล้างไปแล้ว (เช่นตอนเปิดแอป refresh ไม่ผ่าน) แต่ผู้ใช้ยังค้างอยู่หน้าเดิม
          // แล้วกดอะไรที่เรียก API ด้วย token เก่า → พาไปหน้า login แทนการ error เงียบๆ
          if (req.headers.has('Authorization')) this.redirectToLogin();
        }
        const globalMsg = this.globalErrorMessage(err);
        if (globalMsg) this.errorNotification.show(globalMsg);
        return throwError(() => err);
      }),
    );
  }

  private handle401(
    req: HttpRequest<unknown>,
    next: HttpHandler,
  ): Observable<HttpEvent<unknown>> {

    // X28: อีกแท็บ refresh ไปแล้ว (token ใน localStorage ไม่ใช่ตัวที่ request นี้แนบไป และยังไม่หมดอายุ)
    // → ยิงซ้ำด้วยตัวนั้นเลย ไม่ต้อง refresh ซ้ำ (refresh token rotate ทุกครั้ง ยิงซ้อนกันเสี่ยงหลุดทั้งคู่)
    const sent    = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    const current = this.auth.token;
    if (!this.isRefreshing && current && current !== sent && !AuthService.isJwtExpired(current)) {
      return next.handle(this.attachToken(req, current));
    }

    // เริ่ม refresh ถ้ายังไม่มีใครทำอยู่ — ทุก request (รวมตัวที่เริ่ม) รอ token ใหม่ผ่าน refreshSubject เหมือนกันหมด
    if (!this.isRefreshing) this.startRefresh();

    return this.refreshSubject.pipe(
      filter(token => token !== null), // ข้ามค่า null ที่เคลียร์ไว้ตอนเริ่ม refresh
      take(1),                          // รับ token ใหม่แค่ค่าแรกพอ แล้วเลิกฟัง
      // ตาข่ายกันค้าง: ถ้ารอ token ใหม่เกิน 20 วิ (ไม่ว่าเพราะอะไร) ให้ request นี้ error ไป หน้าจะได้หยุดหมุน
      timeout({ first: 20_000 }),
      switchMap(token => next.handle(this.attachToken(req, token!))), // ยิง request เดิมซ้ำด้วย token ใหม่
    );
  }

  /**
   * ขอ token ใหม่ด้วย subscription ของตัวเอง ไม่ผูกกับ request ใด request หนึ่ง
   * เดิม refresh วิ่งอยู่ใน pipe ของ request แรกที่เจอ 401 — ถ้า request นั้นถูกยกเลิกกลางทาง
   * (เปลี่ยนหน้า / component ถูกทำลาย / switchMap ของผู้เรียก) refresh ถูกยกเลิกไปด้วย
   * แต่ request อื่นที่รอ token อยู่ไม่เคยได้รับแจ้ง → ค้างตลอด (หน้าหมุน "กำลังโหลด..." ไม่จบ)
   */
  private startRefresh(): void {
    this.isRefreshing = true;
    this.refreshSubject.next(null); // เคลียร์กระดานประกาศ บอกทุกคนว่า "ยังไม่มี token ใหม่ รอก่อน"

    this.auth.refreshAccessToken().subscribe({
      next: token => {
        this.isRefreshing = false;
        if (token) {
          this.refreshSubject.next(token);   // ประกาศ token ใหม่ — ทุก request ที่รออยู่ยิงซ้ำ
          return;
        }
        // refresh token ใช้ไม่ได้จริง (backend ตอบ 401) → แจ้งทุก request ที่รอให้ error แล้ว logout ไปหน้า login
        this.failWaiters(new Error('Session expired'));
        this.redirectToLogin();
      },
      // X28: ล้มชั่วคราว (เน็ตหลุด / 429 / 5xx) — ไม่ logout ปล่อย error ให้หน้าจอแสดง 401 ครั้งหน้าลองใหม่ได้
      error: err => {
        this.isRefreshing = false;
        this.failWaiters(err);
      },
    });
  }

  /**
   * logout แล้วพาไปหน้า login ที่ถูกต้อง — admin ไป /login-admin (X29)
   * เช็คจาก URL ปัจจุบันด้วย เพราะถ้า session ถูกล้างไปก่อนแล้ว ข้อมูล role ที่ใช้ดูว่าเป็น admin หายไปแล้ว
   */
  private redirectToLogin(): void {
    const onAdminPage = /^\/(admin|super-admin)(\/|$)/.test(this.router.url);
    const loginUrl = this.auth.isAdmin || onAdminPage ? '/login-admin' : '/login';
    if (this.auth.isLoggedIn || this.auth.token) this.auth.logout();
    if (!this.router.url.startsWith(loginUrl)) this.router.navigateByUrl(loginUrl);
  }

  /** F2: แจ้ง request ที่รอ token ให้ error (subject ที่ error แล้วใช้ต่อไม่ได้ → สร้างใหม่ไว้รอบหน้า) */
  private failWaiters(err: unknown): void {
    this.refreshSubject.error(err);
    this.refreshSubject = new BehaviorSubject<string | null>(null);
  }

  /**
   * F32: error ที่ควรแจ้งทั้งแอป (เดิมแจ้งแค่ 500 — เน็ตหลุด/gateway ล่ม/โดน rate limit เงียบหมด)
   * 503/429 ที่ backend ใส่ code มา (เช่น SCOPUS_QUOTA_EXCEEDED, CAPTCHA_UNAVAILABLE, RATE_LIMIT)
   * หน้านั้นจัดการเองอยู่แล้ว (สลับไป scraping / เปิด CAPTCHA / บอกเวลารอ) — ไม่แจ้งซ้ำ
   */
  private globalErrorMessage(err: HttpErrorResponse): string | null {
    const hasCode = typeof err.error?.code === 'string';
    if (err.status === 0)                       return SERVER_DOWN_MESSAGE;
    if (err.status === 500)                     return SERVER_ERROR_MESSAGE;
    if (err.status === 502 || err.status === 504) return 'เซิร์ฟเวอร์ไม่ตอบสนองชั่วคราว กรุณาลองใหม่อีกครั้ง';
    if (err.status === 503 && !hasCode)         return 'ระบบปิดปรับปรุงหรือไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่ภายหลัง';
    if (err.status === 429 && !hasCode)         return 'มีการใช้งานบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่';
    return null;
  }

  // HttpRequest แก้ไขตรงๆ ไม่ได้ (immutable) ต้อง clone แล้วแนบ header ใหม่เข้าไปแทน
  private attachToken(req: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
    return req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
}
