import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService, readStoredAdmin } from './auth.service';

// ใช้กับหน้า /login, /login-admin, /req-otp — ถ้า login อยู่แล้วไม่ต้องเห็นหน้า login อีก ส่งไป dashboard ตาม role แทน
// ('' และ '**' redirect มาที่ /login อยู่แล้ว เลยครอบคลุม http://localhost:4200/ ด้วย)
export const guestGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // ฝั่ง admin เก็บโปรไฟล์ไว้ใน key 'user' แยกจากฝั่งนิสิต/อาจารย์/เจ้าหน้าที่ (auth_user)
  try {
    const admin = readStoredAdmin();
    if (authService.isLoggedIn && admin?.role === 'SuperAdmin') return router.parseUrl('/super-admin/dashboard');
    if (authService.isLoggedIn && admin?.role === 'Admin')      return router.parseUrl('/admin/dashboard');
  } catch {}

  // ต้องมีทั้ง token และ user — ระหว่างขั้น OTP ของ admin จะมีแค่ otpToken ใน auth_token
  // โดยยังไม่มี user ถ้าเช็คแค่ token จะเด้งไป dashboard ทั้งที่ยัง login ไม่เสร็จ
  if (authService.isLoggedIn && authService.user) {
    return router.parseUrl(authService.homeUrl);
  }

  return true;
};
