import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

export const adminGuard: CanActivateFn = () => {
  const router = inject(Router);

  const token = localStorage.getItem('auth_token');
  if (!token) {
    // ไม่มี token แปลว่ายังไม่ login (หรือ session หมดไปแล้ว) — ล้าง user ที่อาจ
    // ค้างจาก session ก่อนหน้าทิ้งด้วย ไม่งั้น isAdmin (app.ts) จะยังอ่านเจอค่าเก่า
    // แล้วโชว์ sidebar admin ทั้งที่ redirect ไปหน้า login แล้ว
    localStorage.removeItem('user');
    router.navigate(['/login-admin']);
    return false;
  }

  try {
    const raw = localStorage.getItem('user');
    if (raw) {
      const user = JSON.parse(raw);
      if (user?.role === 'Admin' || user?.role === 'SuperAdmin') {
        return true;
      }
    }
  } catch {}

  localStorage.removeItem('user');
  router.navigate(['/login-admin']);
  return false;
};
