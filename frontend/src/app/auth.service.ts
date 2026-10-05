import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { LoginRes, User } from './model/res/login_res';
import { Constants } from './comfig/constants';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http      = inject(HttpClient);
  private constants = inject(Constants);

  private _isLoggedIn = signal(!!localStorage.getItem('auth_token'));
  private _user = signal<User | null>(this.loadUser());

  get isLoggedIn(): boolean     { return this._isLoggedIn(); }
  get user(): User | null       { return this._user(); }
  get token(): string | null    { return localStorage.getItem('auth_token'); }
  get refreshToken(): string | null { return localStorage.getItem('auth_refresh_token'); }
  get userPicture(): string     { return localStorage.getItem('auth_picture') ?? ''; }

  setLoggedIn(res: LoginRes, picture: string = ''): void {
    localStorage.setItem('auth_token',         res.data.accessToken);
    localStorage.setItem('auth_refresh_token', res.data.refreshToken);
    localStorage.setItem('auth_user',          JSON.stringify(res.data.user));
    localStorage.setItem('auth_picture',       picture);
    this._isLoggedIn.set(true);
    this._user.set(res.data.user);
  }

  logout(): void {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_refresh_token');
    localStorage.removeItem('auth_user');
    localStorage.removeItem('auth_picture');
    // ฝั่ง admin เก็บโปรไฟล์ไว้ใน key ชื่อ 'user' แยกต่างหาก (คนละชุดกับ auth_user)
    // แต่ app.ts (isAdmin) อ่านจาก key นี้ตรงๆ — ถ้าไม่ล้างด้วย พอ logout ฝั่งนี้แล้ว
    // เคยมีข้อมูล admin ค้างอยู่ก่อนหน้า sidebar admin จะยังโผล่มาอยู่ดี
    localStorage.removeItem('user');
    this._isLoggedIn.set(false);
    this._user.set(null);
  }

  refreshAccessToken(): Observable<string | null> {
    const rt = this.refreshToken;
    if (!rt) return of(null);

    return this.http
      .post<{ success: boolean; data: { accessToken: string } }>(
        `${this.constants.API_ENDPOINT}/auth/refresh`,
        { refreshToken: rt }
      )
      .pipe(
        map(res => {
          const token = res.data.accessToken;
          localStorage.setItem('auth_token', token);
          return token;
        }),
        catchError(() => of(null))
      );
  }

  private loadUser(): User | null {
    const raw = localStorage.getItem('auth_user');
    return raw ? JSON.parse(raw) : null;
  }
}
