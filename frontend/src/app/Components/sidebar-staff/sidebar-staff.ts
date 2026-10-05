import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { AuthService } from '../../auth.service';
import { filter } from 'rxjs/operators';

interface NavItem {
  label: string;
  icon: string;
  route?: string;
  children?: NavItem[];
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

@Component({
  standalone: true,
  selector: 'app-sidebar-staff',
  imports: [CommonModule, RouterModule],
  templateUrl: './sidebar-staff.html',
  styleUrls: ['./sidebar-staff.scss'],
})
export class SidebarStaff implements OnInit {
  @Input() isOpen = true;

  activeRoute   = '';
  expandedItems = new Set<string>();
  imgError      = false;

  ngOnInit(): void {}

  onImgError(): void { this.imgError = true; }

  get userName()    { return `${this.authService.user?.firstName ?? ''} ${this.authService.user?.lastName ?? ''}`.trim(); }
  get userEmail()   { return this.authService.user?.msuMail ?? ''; }
  get userRole()    { return this.authService.user?.role ?? 'เจ้าหน้าที่บัณฑิตวิทยาลัย'; }
  get userPicture() { return this.authService.userPicture; }
  get userInitials() {
    const f = this.authService.user?.firstName?.[0] ?? '';
    const l = this.authService.user?.lastName?.[0] ?? '';
    return (f + l).toUpperCase();
  }

  navGroups: NavGroup[] = [
    {
      group: 'เมนูหลัก',
      items: [
        { label: 'Dashboard',            icon: 'ti ti-home',          route: '/staff/dashboard' },
        { label: 'ค้นหาวารสาร',         icon: 'ti ti-search',        route: '/search'          },
        { label: 'จัดการ MSU Unwanted', icon: 'ti ti-ban',           route: '/msu-unwanted'    },
        { label: 'รายงานปัญหา',         icon: 'ti ti-bug',           route: '/bug-reports'     },
      ],
    },
    {
      group: 'คำร้องและจัดการ',
      items: [
        {
          label: 'คำร้อง Pre-T3 / T3',
          icon: 'ti ti-clipboard-text',
          children: [
            { label: 'คำร้อง Pre-T3', icon: 'ti ti-clipboard-text', route: '/staff/pre-t3-request' },
            { label: 'คำร้อง T3',     icon: 'ti ti-chart-bar',      route: '/staff/t3-request'     },
            { label: 'ประวัติ',        icon: 'ti ti-folder',         route: '/staff/history'        },
          ],
        },
        { label: 'จัดการผู้ใช้งาน', icon: 'ti ti-users', route: '/staff/user-management' },
      ],
    },
  ];

  constructor(private authService: AuthService, private router: Router) {
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe((e: any) => {
        this.activeRoute = e.url;
        this.autoExpand();
      });
    this.activeRoute = this.router.url;
    this.autoExpand();
  }

  private autoExpand(): void {
    for (const group of this.navGroups) {
      for (const item of group.items) {
        if (item.children?.some(c => c.route && this.activeRoute.startsWith(c.route))) {
          this.expandedItems.add(item.label);
        }
      }
    }
  }

  toggleExpand(label: string): void {
    this.expandedItems.has(label)
      ? this.expandedItems.delete(label)
      : this.expandedItems.add(label);
  }

  isExpanded(label: string): boolean {
    return this.expandedItems.has(label);
  }

  hasActiveChild(item: NavItem): boolean {
    return item.children?.some(c => c.route && this.isActive(c.route)) ?? false;
  }

  isActive(route: string): boolean {
    return this.activeRoute === route || this.activeRoute.startsWith(route + '/');
  }

  logout(): void {
    this.authService.logout();
    this.router.navigateByUrl('/login');
  }
}
