import { Component, Input, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Constants } from '../../comfig/constants';
import { GetAdminRes } from '../../model_admin/res/get_admin_res';

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
  private cached = JSON.parse(localStorage.getItem('user') ?? '{}');

  userRole     = this.cached?.role     ?? '';
  userName     = (`${this.cached?.firstName ?? ''} ${this.cached?.lastName ?? ''}`).trim()
                 || (this.cached?.username ?? '');
  userEmail    = this.cached?.msuMail  ?? this.cached?.username ?? '';
  userInitials = this.userName.charAt(0).toUpperCase() || 'A';
  userPicture  = '';

  private expandedItems = signal<Set<string>>(new Set());

  constructor(
    private readonly router: Router,
    private readonly http: HttpClient,
    private readonly constants: Constants,
  ) {}

  ngOnInit() {
    this.fetchMe();
  }

  private fetchMe() {
    const token = localStorage.getItem('auth_token') ?? '';
    this.http.get<GetAdminRes>(`${this.constants.API_ENDPOINT}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    }).subscribe({
      next: (res) => {
        const d = res.data;
        this.userRole     = d.role;
        this.userName     = (`${d.firstName} ${d.lastName}`).trim() || d.username;
        this.userEmail    = d.msuMail || d.username;
        this.userInitials = (d.firstName.charAt(0) + d.lastName.charAt(0)).toUpperCase() || 'A';

        this.userPicture  = d.picture ?? '';

        // อัปเดต localStorage ให้ sync
        localStorage.setItem('user', JSON.stringify(d));
      },
      error: () => { /* ใช้ข้อมูลจาก localStorage แทน (แสดงอยู่แล้ว) */ },
    });
  }

  get allNavGroups(): NavGroup[] {
    const prefix = this.userRole === 'SuperAdmin' ? '/super-admin' : '/admin';
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
      {
        group: 'ระบบ',
        items: [
          { label: 'Backup & Restore',  icon: 'ti ti-device-floppy',   route: `${prefix}/backup-restore` },
          { label: 'Bug Reports',       icon: 'ti ti-bug',             route: `${prefix}/bug-reports` },
        ],
      },
    ];
  }

  get navGroups(): NavGroup[] {
    return this.allNavGroups
      .map(g => ({
        ...g,
        items: g.items.filter(item => !item.roles || item.roles.includes(this.userRole)),
      }))
      .filter(g => g.items.length > 0);
  }

  private getDashboardRoute(): string {
    return this.userRole === 'SuperAdmin' ? '/super-admin/dashboard' : '/admin/dashboard';
  }

  getProfileRoute(): string {
    return this.userRole === 'SuperAdmin' ? '/super-admin/profile' : '/admin/profile';
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

  logout() {
    const token = localStorage.getItem('auth_token') ?? '';
    this.http.post(
      `${this.constants.API_ENDPOINT}/auth/logout`,
      {},
      { headers: { Authorization: `Bearer ${token}` } },
    ).subscribe({
      complete: () => this.clearAndRedirect(),
      error:    () => this.clearAndRedirect(), // logout ฝั่ง client เสมอ แม้ API error
    });
  }

  private clearAndRedirect() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    this.router.navigate(['/login-admin']);
  }
}
