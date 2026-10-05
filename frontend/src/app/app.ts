import { Component, HostListener } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { CommonModule } from '@angular/common';
import { Header } from './Components/header/header';
import { Header as HeaderAdmin } from './Components/header_admin/header';
import { Footer } from './Components/footer/footer';
import { Sidebar } from './Components/sidebar_user/sidebar';
import { Sidebar as SidebarAdmin } from './Components/sidebar_admin/sidebar';
import { SidebarAdvisor } from './Components/sidebar-advisor/sidebar-advisor';
import { SidebarStaff } from './Components/sidebar-staff/sidebar-staff';
import { GlobalErrorToast } from './Components/global-error-toast/global-error-toast';
import { AuthService } from './auth.service';

@Component({
  standalone: true,
  selector: 'app-root',
  imports: [RouterOutlet, Header, HeaderAdmin, Footer, Sidebar, SidebarAdmin, SidebarAdvisor, SidebarStaff, GlobalErrorToast, CommonModule],
  templateUrl: './app.html',
  styleUrls: ['./app.scss'],
})
export class App {
  sidebarOpen = true;

  get isLoginPage(): boolean {
    const url = this.router.url;
    return url === '/' || url === ''
      || url.startsWith('/login')
      || url.startsWith('/register')
      // หน้ากรอก OTP เป็นส่วนหนึ่งของขั้นตอน login ที่ยังไม่เสร็จ ไม่ควรนับเป็น
      // หน้า "login แล้ว" ที่โชว์ sidebar/header ของระบบ
      || url.startsWith('/req-otp');
  }

  get isAdmin(): boolean {
    try {
      // ต้องมี token อยู่ด้วยเสมอ ไม่ใช่เช็คแค่ค่า user ที่อาจเป็นข้อมูลค้างจาก
      // session ก่อนหน้าที่ logout/token หมดอายุไปแล้วแต่ลืมล้าง user ทิ้ง
      if (!localStorage.getItem('auth_token')) return false;
      const role = JSON.parse(localStorage.getItem('user') ?? '{}')?.role;
      return role === 'Admin' || role === 'SuperAdmin';
    } catch { return false; }
  }

  get isAdvisor(): boolean {
    return this.authService.user?.role?.toLowerCase() === 'supervisor';
  }

  get isStaff(): boolean {
    return this.authService.user?.role?.toLowerCase() === 'staff';
  }

  toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen;
  }

  constructor(public authService: AuthService, private router: Router) {
    // โหมดมือถือ/แท็บเล็ต (≤1024px ตรงกับ breakpoint ที่ sidebar เปลี่ยนเป็น overlay)
    // พอเปลี่ยนหน้าสำเร็จ ให้ปิด sidebar ลงอัตโนมัติ กันไม่ให้ค้างบังหน้าใหม่ที่เพิ่งเปิด
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(() => {
        if (window.innerWidth <= 1024) {
          this.sidebarOpen = false;
        }
      });
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    if (event.altKey && event.shiftKey && event.code === 'KeyL') {
      event.preventDefault();
      this.router.navigate(['/login-admin']);
    }
  }
}
