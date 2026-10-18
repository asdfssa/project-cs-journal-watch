import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * F1: เช็คทั้ง "login แล้ว" และ "role ตรงกับหน้า" — เดิม authGuard เช็คแค่ login
 * นิสิตจึงเปิด /staff/user-management เห็น UI ภายในได้ (backend ยังบล็อกข้อมูลอยู่ แต่ไม่ควรเห็นหน้า)
 * role ไม่ตรง → ส่งไป dashboard ของ role ตัวเอง
 * ใช้กับฝั่งนิสิต/อาจารย์/เจ้าหน้าที่ (โปรไฟล์อยู่ใน auth_user) — ฝั่ง admin ใช้ adminGuard / superAdminGuard
 */
export const roleGuard = (...roles: string[]): CanActivateFn => () => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  const role = auth.user?.role?.toLowerCase();
  if (!auth.isLoggedIn || !role) return router.parseUrl('/login');
  // X40: role ที่ไม่มีหน้ารองรับ (เช่น Program_Chair) — เดิม homeUrl = /dashboard แล้ว guard เด้งวนไม่จบ
  if (!AuthService.KNOWN_ROLES.includes(role)) {
    auth.logout();
    return router.parseUrl('/login');
  }
  if (roles.some(r => r.toLowerCase() === role)) return true;
  return router.parseUrl(auth.homeUrl);
};

/** F1: /super-admin/* เฉพาะ SuperAdmin — เดิมใช้ adminGuard ซึ่งปล่อย Admin เข้าด้วย */
export const superAdminGuard: CanActivateFn = () => {
  const router = inject(Router);
  let role: string | undefined;
  try { role = JSON.parse(localStorage.getItem('user') ?? 'null')?.role; } catch { /* ค่าเสีย = ไม่ได้ login */ }

  if (!inject(AuthService).isLoggedIn || !role) return router.parseUrl('/login-admin');   // F33
  if (role === 'SuperAdmin') return true;
  if (role === 'Admin')      return router.parseUrl('/admin/dashboard');
  return router.parseUrl('/login-admin');
};
