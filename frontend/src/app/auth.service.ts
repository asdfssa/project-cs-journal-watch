import { Injectable, signal, inject, isDevMode } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, firstValueFrom, map, of, throwError, timeout } from 'rxjs';
import { LoginRes, User } from './model/res/login_res';
import { Constants } from './comfig/constants';

/**
 * F31: อ่านโปรไฟล์ admin ที่เก็บไว้ใน localStorage key 'user' แบบปลอดภัย
 * ค่าเสีย/ถูกแก้มือ → คืน null แทนที่จะ throw (เดิมหลายไฟล์ JSON.parse ตรงๆ พังทั้งหน้า)
 */
/** N14: หน้าโปรไฟล์ admin แก้ชื่อสำเร็จ → แจ้ง sidebar admin ให้โหลดชื่อใหม่ (คนละ component กัน) */
export const ADMIN_PROFILE_UPDATED = 'jw:admin-profile-updated';

export function readStoredAdmin(): any | null {
  try { return JSON.parse(localStorage.getItem('user') ?? 'null'); }
  catch { return null; }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http      = inject(HttpClient);
  private constants = inject(Constants);

  /**
   * feedback backend ข้อ 3 (F33): access token ไม่เขียนลง localStorage — สคริปต์ใดๆ ในหน้าอ่าน localStorage ได้
   * ถ้ามี XSS ครั้งเดียว token (รวมของ Admin) ถูกขโมยไปใช้แทนเจ้าของบัญชีได้ → เก็บในหน่วยความจำของแอปเท่านั้น
   * รีโหลด/เปิดแท็บใหม่ token หาย → restoreSession() ขอใหม่จาก refresh cookie (httpOnly, JS อ่านไม่ได้)
   *
   * ยกเว้นตอน dev (ng serve): บน localhost cookie ไม่ถูกส่งข้ามเว็บ refresh ไม่ได้ ถ้าไม่เก็บไว้
   * จะหลุดทุกครั้งที่รีโหลด/แก้โค้ด → dev เก็บใน localStorage เหมือนเดิม ส่วน production build ไม่เก็บ
   */
  private static readonly PERSIST_TOKEN = isDevMode();
  private static readonly TOKEN_KEY = 'auth_token';
  private memToken = AuthService.PERSIST_TOKEN ? localStorage.getItem(AuthService.TOKEN_KEY) : null;

  // login อยู่ = มีโปรไฟล์ที่เก็บไว้ (ไม่ลับ) — production ตอนเปิดแอปยังไม่มี token ในหน่วยความจำ
  // restoreSession() จะขอ token จาก cookie ให้ ถ้าขอไม่ได้ค่อย logout
  private _isLoggedIn = signal(!!(localStorage.getItem('auth_user') || readStoredAdmin()));
  private _user = signal<User | null>(this.loadUser());

  /** แจ้งแท็บอื่นเมื่อ login/logout — token ไม่อยู่ใน localStorage แล้ว จึงใช้ event 'storage' ของ token ไม่ได้ */
  private channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('jw-auth') : null;

  constructor() {
    // production: token ที่อาจค้างจากเวอร์ชันก่อน (เคยเก็บใน localStorage) ลบทิ้ง
    if (!AuthService.PERSIST_TOKEN) localStorage.removeItem(AuthService.TOKEN_KEY);

    // X40: logout / เปลี่ยนบัญชีในอีกแท็บ → แท็บนี้โหลดหน้าใหม่ ให้ guard/sidebar ตัดสินจากค่าปัจจุบัน
    this.channel?.addEventListener('message', e => {
      if (e.data?.type === 'logout' || e.data?.type === 'login') location.reload();
    });
    // โปรไฟล์ใน localStorage ยังใช้ร่วมกันทุกแท็บ — กันกรณีเบราว์เซอร์ไม่มี BroadcastChannel / แก้ค่าเอง
    window.addEventListener('storage', e => {
      if (e.key === null) { location.reload(); return; }                       // localStorage.clear()
      if ((e.key === 'auth_user' || e.key === 'user') && AuthService.identity(e.oldValue) !== AuthService.identity(e.newValue)) {
        location.reload();                                                       // คนละบัญชี / role เปลี่ยน
      }
    });
  }

  /** เก็บ/ล้าง access token — production อยู่ในหน่วยความจำเท่านั้น */
  private setToken(token: string | null): void {
    this.memToken = token;
    if (!AuthService.PERSIST_TOKEN) return;
    if (token) localStorage.setItem(AuthService.TOKEN_KEY, token);
    else localStorage.removeItem(AuthService.TOKEN_KEY);
  }

  private broadcast(type: 'login' | 'logout'): void {
    try { this.channel?.postMessage({ type }); } catch { /* ignore */ }
  }

  /** userId + role จาก JSON ของโปรไฟล์ที่เก็บไว้ ใช้เทียบว่าเป็นคนเดิม role เดิมไหม */
  private static identity(raw: string | null): string {
    try {
      const u = raw ? JSON.parse(raw) : null;
      return u ? `${u.userId ?? ''}|${u.role ?? ''}` : '';
    } catch { return ''; }
  }

  /** อ่าน payload ของ JWT (รองรับ UTF-8 เช่นชื่อภาษาไทย) — อ่านไม่ได้คืน null */
  static decodeJwt(token: string | null): Record<string, unknown> | null {
    try {
      const payload = token?.split('.')[1];
      if (!payload) return null;
      const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch { return null; }
  }

  /**
   * X40: role ใน token ใหม่ต่างจากที่เก็บไว้ (admin เปลี่ยน role ระหว่างล็อกอิน → backend ตอบ 401 ROLE_CHANGED
   * → refresh ได้ token ที่มี role ปัจจุบัน) — อัปเดตโปรไฟล์ที่เก็บไว้ให้ guard/sidebar ใช้ role ใหม่
   */
  private syncRoleFromToken(token: string): void {
    const role = AuthService.decodeJwt(token)?.['role'];
    if (typeof role !== 'string') return;
    const u = this._user();
    if (u && u.role !== role) {
      const next = { ...u, role };
      localStorage.setItem('auth_user', JSON.stringify(next));
      this._user.set(next);
    }
    const admin = readStoredAdmin();
    if (admin && admin.role !== role) {
      localStorage.setItem('user', JSON.stringify({ ...admin, role }));
    }
  }

  get isLoggedIn(): boolean     { return this._isLoggedIn(); }
  get user(): User | null       { return this._user(); }
  get token(): string | null    { return this.memToken; }
  get userPicture(): string     { return localStorage.getItem('auth_picture') ?? ''; }

  /** role ที่หน้าเว็บฝั่งนิสิต/อาจารย์/เจ้าหน้าที่รองรับ — role อื่น (เช่น Program_Chair) ไม่มีหน้าให้ใช้ */
  static readonly KNOWN_ROLES = ['student', 'supervisor', 'staff'];

  /** หน้า dashboard ตาม role ของผู้ใช้ที่ login อยู่ */
  get homeUrl(): string {
    const role = this._user()?.role?.toLowerCase();
    return role === 'supervisor' ? '/advisor/dashboard'
         : role === 'staff'      ? '/staff/dashboard'
         : '/dashboard';
  }

  /**
   * X29: Admin/SuperAdmin เก็บโปรไฟล์ไว้ใน key 'user' (ไม่ใช่ auth_user) — guard/หน้า admin หลายไฟล์อ่าน key นี้ตรงๆ
   * จึงคง key เดิมไว้ แต่ให้ login/logout ผ่าน service นี้เพื่อให้สถานะ isLoggedIn ตรงกับความจริง
   */
  get isAdmin(): boolean {
    const role = readStoredAdmin()?.role;
    return role === 'Admin' || role === 'SuperAdmin';
  }

  /** หน้า login ที่ถูกต้องของผู้ใช้คนนี้ — admin ใช้ username + OTP คนละหน้ากับนิสิต/อาจารย์/staff */
  get loginUrl(): string {
    return this.isAdmin ? '/login-admin' : '/login';
  }

  /** X29: เรียกจากหน้า OTP ของ admin หลัง verify สำเร็จ (เดิมหน้า OTP เขียน localStorage เอง ทำให้ isLoggedIn ยังเป็น false) */
  setAdminSession(accessToken: string, user: unknown): void {
    localStorage.removeItem('auth_refresh_token');
    localStorage.removeItem('otp_token');
    this.setToken(accessToken);
    localStorage.setItem('user', JSON.stringify(user));
    this._isLoggedIn.set(true);
    this.broadcast('login');
  }

  setLoggedIn(res: LoginRes, picture: string = ''): void {
    // X28: refresh token อยู่ใน httpOnly cookie ที่ backend ตั้งให้ (JS อ่านไม่ได้ และ body ไม่มีค่านี้)
    // ลบ key เก่าที่เคยเก็บ "undefined" ไว้ทิ้งด้วย
    localStorage.removeItem('auth_refresh_token');
    this.setToken(res.data.accessToken);
    localStorage.setItem('auth_user',    JSON.stringify(res.data.user));
    localStorage.setItem('auth_picture', picture);
    this._isLoggedIn.set(true);
    this._user.set(res.data.user);
    this.broadcast('login');
  }

  /**
   * เรียกครั้งเดียวตอนเปิดแอป (app.config → provideAppInitializer) — router รอจนเสร็จ
   * X28: access token ที่ค้างจากครั้งก่อนหมดอายุแล้ว → ลอง refresh ด้วย cookie ก่อน
   * เดิม logout ทันที ทำให้ปิดเว็บไปเกิน 60 นาทีแล้วเปิดใหม่ต้อง login ใหม่ทุกครั้ง ทั้งที่ refresh token ยังอยู่ 7 วัน
   * - refresh สำเร็จ → ใช้งานต่อ
   * - session หมดจริง (401) → logout ให้ guard ส่งไปหน้า login
   * - เน็ต/เซิร์ฟเวอร์มีปัญหา หรือรอเกิน 8 วินาที → ยังไม่ logout ให้ interceptor ลองใหม่ตอนเรียก API
   */
  async restoreSession(): Promise<void> {
    if (AuthService.isJwtExpired(localStorage.getItem('otp_token'))) localStorage.removeItem('otp_token');
    if (!this._isLoggedIn()) return;                                   // ไม่เคย login — ไม่มีอะไรให้กู้
    if (this.token && !AuthService.isJwtExpired(this.token)) return;   // dev: token ที่เก็บไว้ยังใช้ได้
    // production เปิดแอป/รีโหลด = ไม่มี token ในหน่วยความจำเสมอ → ขอใหม่จาก refresh cookie
    try {
      const token = await firstValueFrom(this.refreshAccessToken().pipe(timeout(8000)));
      if (!token) this.logout();
    } catch { /* ขัดข้องชั่วคราว — คง session ไว้ */ }
  }

  /** อ่าน exp จาก payload ของ JWT — ไม่ใช่ JWT / ไม่มี exp ถือว่ายังไม่หมดอายุ (ปล่อยให้ backend ตัดสิน) */
  static isJwtExpired(token: string | null): boolean {
    if (!token) return false;
    try {
      const payload = token.split('.')[1];
      if (!payload) return false;
      const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
      return typeof json.exp === 'number' && json.exp * 1000 <= Date.now();
    } catch {
      return false;
    }
  }

  /**
   * ล้าง session ฝั่ง client ทุก role (รวม admin) — ทุก sidebar/interceptor ต้องเรียกตัวนี้ ไม่ลบ localStorage เอง
   * X30: บอก backend ให้ revoke refresh token + ลบ cookie ด้วย (fire-and-forget — ล้มก็ logout ฝั่ง client อยู่ดี)
   * ไม่งั้น cookie ยังใช้ refresh ได้อีก 7 วัน คนที่ใช้เครื่องต่อจากเรา (เครื่องสาธารณะ) เข้าบัญชีเราได้
   */
  logout(): void {
    const token = this.token;
    if (token) {
      this.http.post(`${this.constants.API_ENDPOINT}/auth/logout`, {},
        { headers: { Authorization: `Bearer ${token}` } },
      ).subscribe({ error: () => {} });
    }
    this.setToken(null);
    localStorage.removeItem(AuthService.TOKEN_KEY);   // ล้างของเก่าที่อาจค้างจากเวอร์ชันก่อน
    localStorage.removeItem('auth_refresh_token');
    localStorage.removeItem('auth_user');
    localStorage.removeItem('auth_picture');
    localStorage.removeItem('otp_token');
    // ฝั่ง admin เก็บโปรไฟล์ไว้ใน key ชื่อ 'user' แยกต่างหาก (คนละชุดกับ auth_user)
    // แต่ app.ts (isAdmin) อ่านจาก key นี้ตรงๆ — ถ้าไม่ล้างด้วย พอ logout ฝั่งนี้แล้ว
    // เคยมีข้อมูล admin ค้างอยู่ก่อนหน้า sidebar admin จะยังโผล่มาอยู่ดี
    localStorage.removeItem('user');
    this._isLoggedIn.set(false);
    this._user.set(null);
    this.broadcast('logout');
  }

  /**
   * X28: ขอ access token ใหม่ — backend อ่าน refresh token จาก httpOnly cookie (jw_refresh_token) อย่างเดียว
   * เลยส่ง body ว่าง ส่วน cookie ถูกแนบโดย withCredentials ใน interceptor (X27)
   * - สำเร็จ → token ใหม่
   * - 400/401/403 → null = session หมดจริง (ไม่มี cookie / หมดอายุ / ถูก revoke) ผู้เรียกควร logout
   * - อย่างอื่น (เน็ตหลุด, 429, 5xx) → throw ต่อ — ไม่ใช่เหตุผลที่จะเตะผู้ใช้ออก
   */
  refreshAccessToken(): Observable<string | null> {
    return this.http
      .post<{ success: boolean; data: { accessToken: string } }>(
        `${this.constants.API_ENDPOINT}/auth/refresh`,
        {}
      )
      .pipe(
        map(res => {
          const token = res.data.accessToken;
          this.setToken(token);
          this.syncRoleFromToken(token);
          return token;
        }),
        catchError((err: HttpErrorResponse) =>
          [400, 401, 403].includes(err.status) ? of(null) : throwError(() => err)),
      );
  }

  private loadUser(): User | null {
    // F31: ค่าเสีย → JSON.parse throw ตอนสร้าง service = ทั้งแอปพัง (หน้าขาว) — ถือว่าไม่มี user แทน
    const raw = localStorage.getItem('auth_user');
    try { return raw ? JSON.parse(raw) : null; }
    catch { return null; }
  }
}
