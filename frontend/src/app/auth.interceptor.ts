import { Injectable } from '@angular/core';
import {
  HttpInterceptor, HttpRequest, HttpHandler,
  HttpEvent, HttpErrorResponse,
} from '@angular/common/http';
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { catchError, filter, switchMap, take } from 'rxjs/operators';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { ErrorNotificationService, SERVER_ERROR_MESSAGE } from './error-notification.service';

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
  ) {}

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(req).pipe(
      catchError((err: HttpErrorResponse) => {
        // ไม่ refresh ถ้า error มาจาก endpoint /auth/refresh เอง (ป้องกัน loop)
        // และไม่ redirect ถ้า user ยังไม่ได้ login อยู่ (ปล่อยให้ component จัดการ error เอง)
        if (err.status === 401 && !req.url.includes('/auth/refresh') && this.auth.isLoggedIn) {
          return this.handle401(req, next);
        }
        if (err.status === 500) {
          this.errorNotification.show(SERVER_ERROR_MESSAGE);
        }
        return throwError(() => err);
      }),
    );
  }

  private handle401(
    req: HttpRequest<unknown>,
    next: HttpHandler,
  ): Observable<HttpEvent<unknown>> {

    if (!this.isRefreshing) {
      // เป็น request แรกที่เจอ token หมดอายุ → รับหน้าที่ไป refresh เอง
      // (request อื่นที่ 401 พร้อมกันจะไม่เข้ามาในบล็อกนี้ซ้ำ เพราะ isRefreshing = true แล้ว)
      this.isRefreshing = true;
      this.refreshSubject.next(null); // เคลียร์กระดานประกาศ บอกทุกคนว่า "ยังไม่มี token ใหม่ รอก่อน"

      return this.auth.refreshAccessToken().pipe(
        switchMap(token => {
          this.isRefreshing = false;
          if (token) {
            this.refreshSubject.next(token);              // ประกาศ token ใหม่ให้คนที่รออยู่รู้
            return next.handle(this.attachToken(req, token)); // ยิง request เดิมซ้ำด้วย token ใหม่
          }
          // refresh ล้มเหลว (refresh token ก็หมดอายุด้วย) → logout แล้ว redirect ไปหน้า login จริงๆ
          this.auth.logout();
          this.router.navigateByUrl('/login');
          return throwError(() => new Error('Session expired'));
        }),
      );
    }

    // มีคนอื่นกำลัง refresh อยู่แล้ว (isRefreshing = true) ไม่ต้อง refresh ซ้ำ
    // แค่ รอฟัง จนกว่า refreshSubject จะประกาศ token ใหม่ออกมา (ไม่ใช่ null ที่ตั้งไว้ตอนแรก)
    return this.refreshSubject.pipe(
      filter(token => token !== null), // ข้ามค่า null ที่เคลียร์ไว้ตอนเริ่ม refresh
      take(1),                          // รับ token ใหม่แค่ค่าแรกพอ แล้วเลิกฟัง
      switchMap(token => next.handle(this.attachToken(req, token!))), // ยิง request เดิมซ้ำเหมือนกัน
    );
  }

  // HttpRequest แก้ไขตรงๆ ไม่ได้ (immutable) ต้อง clone แล้วแนบ header ใหม่เข้าไปแทน
  private attachToken(req: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
    return req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
}
