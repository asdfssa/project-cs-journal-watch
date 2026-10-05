import { Component, Input } from '@angular/core';
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
  selector: 'app-sidebar',
  imports: [CommonModule, RouterModule],
  templateUrl: './sidebar.html',
  styleUrls: ['./sidebar.scss'],
})
export class Sidebar {
  activeRoute = '';

  get userName()    { return `${this.authService.user?.firstName ?? ''} ${this.authService.user?.lastName ?? ''}`.trim(); }
  get userEmail()   { return this.authService.user?.msuMail ?? ''; }
  get userRole()    { return this.authService.user?.role ?? ''; }
  get userPicture()  { return this.authService.userPicture; }
  get userInitials() {
    const f = this.authService.user?.firstName?.[0] ?? '';
    const l = this.authService.user?.lastName?.[0] ?? '';
    return (f + l).toUpperCase();
  }

  expandedItems = new Set<string>();

  navGroups: NavGroup[] = [
    {
      group: 'เมนูหลัก',
      items: [
        { label: 'Dashboard',            icon: 'ri-dashboard-line',    route: '/dashboard'    },
        { label: 'ค้นหาวารสาร',           icon: 'ri-search-line',       route: '/search'       },
        { label: 'ตรวจสอบ MSU Unwanted', icon: 'ri-shield-cross-line', route: '/msu-unwanted' },
        { label: 'รายงานปัญหา',           icon: 'ri-bug-line',          route: '/bug-reports'  },
      ],
    },
    {
      group: 'การยื่นเรื่อง',
      items: [
        {
          label: 'ยื่น Pre-T3',
          icon: 'ri-file-list-3-line',
          children: [
            { label: 'ยื่น Pre-T3',    icon: 'ri-file-add-line',        route: '/pre-t3'         },
            { label: 'สถานะ Pre-T3',   icon: 'ri-task-line',            route: '/pre-t3-status'  },
            { label: 'ประวัติทั้งหมด', icon: 'ri-history-line',         route: '/pre-t3-history' },
          ],
        },
        {
          label: 'ยื่น T3',
          icon: 'ri-graduation-cap-line',
          children: [
            { label: 'ยื่น T3',    icon: 'ri-file-add-line',  route: '/send-t3'    },
            { label: 'สถานะ T3',   icon: 'ri-task-line',      route: '/status-t3'  },
            { label: 'ประวัติ T3', icon: 'ri-history-line',   route: '/t3-history' },
          ],
        },
      ],
    },
  ];

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

  @Input() isOpen = true;

  isActive(route: string): boolean {
    return this.activeRoute === route || this.activeRoute.startsWith(route + '/');
  }

  logout(): void {
    this.authService.logout();
    this.router.navigateByUrl('/login');
  }
}
