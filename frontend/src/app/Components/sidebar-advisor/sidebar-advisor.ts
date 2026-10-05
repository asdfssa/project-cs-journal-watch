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
  selector: 'app-sidebar-advisor',
  imports: [CommonModule, RouterModule],
  templateUrl: './sidebar-advisor.html',
  styleUrls: ['./sidebar-advisor.scss'],
})
export class SidebarAdvisor {
  @Input() isOpen = true;

  activeRoute   = '';
  expandedItems = new Set<string>();

  get userName()    { return `${this.authService.user?.firstName ?? ''} ${this.authService.user?.lastName ?? ''}`.trim(); }
  get userEmail()   { return this.authService.user?.msuMail ?? ''; }
  get userRole()    { return this.authService.user?.role ?? 'อาจารย์ที่ปรึกษา'; }
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
        { label: 'Dashboard',             icon: 'ti ti-home',          route: '/advisor/dashboard' },
        { label: 'ค้นหาวารสาร',          icon: 'ti ti-search',        route: '/search'            },
        { label: 'ตรวจสอบ MSU Unwanted', icon: 'ti ti-ban',           route: '/msu-unwanted'      },
        { label: 'รายงานปัญหา',          icon: 'ti ti-bug',           route: '/bug-reports'       },
      ],
    },
    {
      group: 'คำร้องนิสิต',
      items: [
        {
          label: 'คำร้องขอของนิสิต',
          icon: 'ti ti-clipboard-text',
          children: [
            { label: 'Pre-T3 ที่รอลงนาม', icon: 'ti ti-clipboard-text', route: '/advisor/pre-t3-request' },
            { label: 'T3 ที่รอลงนาม',     icon: 'ti ti-chart-bar',      route: '/advisor/t3-request'     },
            { label: 'ประวัติทั้งหมด',    icon: 'ti ti-folder',         route: '/advisor/history'         },
          ],
        },
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
