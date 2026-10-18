import { Component, HostListener, Input, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Constants } from '../../comfig/constants';
import { GetAdminRes } from '../../model_admin/res/get_admin_res';
import { AuthService, readStoredAdmin, ADMIN_PROFILE_UPDATED } from '../../auth.service';

interface NavChild {
  label: string;
  route: string;
}

interface NavItem {
  label: string;
  icon: string;
  route?: string;
  roles?: string[];
  children?: NavChild[];
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

@Component({
  selector: 'app-sidebar-admin',
  imports: [CommonModule, RouterLink],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
})
export class Sidebar implements OnInit {
  @Input() isOpen = true;

  // ข้อมูล user — แสดงจาก localStorage ทันที, API call อัปเดต background
  // F31: ค่าใน localStorage เสีย (แก้มือ/เขียนไม่ครบ) → JSON.parse throw ทั้ง component พัง = หน้าขาว
  private cached = readStoredAdmin() ?? {};

  // F29: แอปเป็น zoneless — field ธรรมดาที่แก้ใน subscribe ไม่ทำให้หน้าจอ render ใหม่ ต้องเป็น signal
  userRole  = signal<string>(this.cached?.role ?? '');
  userName  = signal<string>((`${this.cached?.firstName ?? ''} ${this.cached?.lastName ?? ''}`).trim()
                             || (this.cached?.username ?? ''));
  userEmail = signal<string>(this.cached?.msuMail ?? this.cached?.username ?? '');


  private expandedItems = signal<Set<string>>(new Set());

  constructor(
    private readonly router: Router,
    private readonly http: HttpClient,
    private readonly constants: Constants,
    private readonly authService: AuthService,
  ) {}

  ngOnInit() {
    this.fetchMe();
  }

  // N14: เดิมโหลดชื่อครั้งเดียวตอนเปิดแอป — แก้ชื่อในหน้าโปรไฟล์แล้ว sidebar ยังโชว์ชื่อเก่าจนกว่าจะ reload
  @HostListener(`window:${ADMIN_PROFILE_UPDATED}`)
  onProfileUpdated() {
    this.fetchMe();
  }

  private fetchMe() {
    const token = this.authService.token ?? '';
    this.http.get<GetAdminRes>(`${this.constants.API_ENDPOINT}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    }).subscribe({
      next: (res) => {
        const d = res.data;
        this.userRole.set(d.role);
        this.userName.set((`${d.firstName ?? ''} ${d.lastName ?? ''}`).trim() || d.username);
        this.userEmail.set(d.msuMail || d.username);

        // อัปเดต localStorage ให้ sync
        localStorage.setItem('user', JSON.stringify(d));
      },
      error: () => { /* ใช้ข้อมูลจาก localStorage แทน (แสดงอยู่แล้ว) */ },
    });
  }

  get allNavGroups(): NavGroup[] {
    const prefix = this.userRole() === 'SuperAdmin' ? '/super-admin' : '/admin';
    return [
      {
        group: 'หลัก',
        items: [
          { label: 'แดชบอร์ด',       icon: 'ti ti-chart-bar',       route: this.getDashboardRoute() },
          { label: 'ค้นหาวารสาร',    icon: 'ti ti-search',          route: `${prefix}/search` },
          { label: 'วารสารต้องห้าม', icon: 'ti ti-ban',             route: `${prefix}/msu-unwanted` },
        ],
      },
      {
        group: 'จัดการ',
        items: [
          { label: 'จัดการผู้ใช้', icon: 'ti ti-users', route: `${prefix}/manage-users` },
        ],
      },
    ];
  }

  get navGroups(): NavGroup[] {
    return this.allNavGroups
      .map(g => ({
        ...g,
        items: g.items.filter(item => !item.roles || item.roles.includes(this.userRole())),
      }))
      .filter(g => g.items.length > 0);
  }

  private getDashboardRoute(): string {
    return this.userRole() === 'SuperAdmin' ? '/super-admin/dashboard' : '/admin/dashboard';
  }

  getProfileRoute(): string {
    return this.userRole() === 'SuperAdmin' ? '/super-admin/profile' : '/admin/profile';
  }

  isActive(route: string): boolean {
    return this.router.url === route || this.router.url.startsWith(route + '/');
  }

  hasActiveChild(item: NavItem): boolean {
    return item.children?.some(c => this.isActive(c.route)) ?? false;
  }

  toggleExpand(label: string) {
    this.expandedItems.update(set => {
      const next = new Set(set);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  }

  isExpanded(label: string): boolean {
    return this.expandedItems().has(label);
  }

  // X29: ผ่าน AuthService.logout() — ล้างทุก key + รีเซ็ต isLoggedIn + บอก backend ให้ revoke
  // (เดิมลบเองแค่ auth_token/user → isLoggedIn ค้าง true หน้า public เลยโชว์ sidebar นิสิตให้คนที่ logout แล้ว)
  logout() {
    this.authService.logout();
    this.router.navigate(['/login-admin']);
  }
}
