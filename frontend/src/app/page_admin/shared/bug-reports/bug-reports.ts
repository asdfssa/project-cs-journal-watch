import { Component, signal, computed, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from '../../../auth.service';
import { Constants } from '../../../comfig/constants';
import { BugReportsRes, Row } from '../../../model_admin/res/Bug_Reports_res';
import { DetilsBugReportsRes, Data as DetailData } from '../../../model_admin/res/detils_Bug_Reports_res';
import { FixBugReportsRes } from '../../../model_admin/req/fix_Bug_Reports_req';

@Component({
  selector: 'app-bug-reports',
  imports: [CommonModule, FormsModule],
  templateUrl: './bug-reports.html',
  styleUrl: './bug-reports.scss',
})
export class BugReports implements OnInit {
  private http      = inject(HttpClient);
  private auth      = inject(AuthService);
  private constants = inject(Constants);

  isLoading   = signal(true);
  reports     = signal<Row[]>([]);
  loadError   = signal<string | null>(null);
  currentPage = signal(1);
  totalPages  = signal(1);
  totalItems  = signal(0);

  searchText   = signal('');
  statusFilter = signal('all');
  statusDropdownOpen = signal(false);

  readonly statusFilterOptions = [
    { value: 'all',         label: 'ทุกสถานะ' },
    { value: 'pending',     label: 'รอดำเนินการ' },
    { value: 'in_progress', label: 'กำลังดำเนินการ' },
    { value: 'resolved',    label: 'แก้ไขแล้ว' },
  ];

  detailLoading = signal(false);
  detailData    = signal<DetailData | null>(null);
  detailError   = signal<string | null>(null);

  editStatus  = signal('');
  editNote    = signal('');
  isSaving    = signal(false);
  saveSuccess = signal<string | null>(null);
  saveError   = signal<string | null>(null);

  readonly LIMIT = 20;

  pendingCount    = computed(() => this.reports().filter(r => r.status === 'pending').length);
  inProgressCount = computed(() => this.reports().filter(r => r.status === 'in_progress').length);
  resolvedCount   = computed(() => this.reports().filter(r => r.status === 'resolved').length);

  filteredReports = computed(() => {
    const s  = this.searchText().toLowerCase();
    const st = this.statusFilter();
    return this.reports().filter(r => {
      const matchSearch = !s ||
        `${r.title} ${r.description} ${r.category} ${r.reporter_first_name} ${r.reporter_last_name}`
          .toLowerCase().includes(s);
      const matchStatus = st === 'all' || r.status === st;
      return matchSearch && matchStatus;
    });
  });

  pageNumbers = computed(() => Array.from({ length: this.totalPages() }, (_, i) => i + 1));

  ngOnInit() { this.loadReports(1); }

  private headers() {
    return new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
  }

  loadReports(page: number) {
    this.isLoading.set(true);
    this.loadError.set(null);
    this.currentPage.set(page);

    const url = `${this.constants.API_ENDPOINT}/bug-reports?page=${page}&limit=${this.LIMIT}`;
    this.http.get<BugReportsRes>(url, { headers: this.headers() }).subscribe({
      next: res => {
        if (res.success) {
          this.reports.set(res.data.rows);
          this.totalPages.set(res.data.totalPages);
          this.totalItems.set(res.data.total);
        } else {
          this.loadError.set('ไม่สามารถโหลดข้อมูลได้');
        }
        this.isLoading.set(false);
      },
      error: () => {
        this.loadError.set('เกิดข้อผิดพลาดในการเชื่อมต่อ');
        this.isLoading.set(false);
      },
    });
  }

  openDetail(reportId: number) {
    this.detailData.set(null);
    this.detailError.set(null);
    this.detailLoading.set(true);
    this.saveSuccess.set(null);
    this.saveError.set(null);

    const url = `${this.constants.API_ENDPOINT}/bug-reports/${reportId}`;
    this.http.get<DetilsBugReportsRes>(url, { headers: this.headers() }).subscribe({
      next: res => {
        this.detailData.set(res.data);
        this.editStatus.set(res.data.status);
        this.editNote.set((res.data.resolved_note as string | null) ?? '');
        this.detailLoading.set(false);
      },
      error: () => {
        this.detailError.set('ไม่สามารถโหลดรายละเอียดได้');
        this.detailLoading.set(false);
      },
    });
  }

  closeDetail() {
    this.detailData.set(null);
    this.detailError.set(null);
    this.saveSuccess.set(null);
    this.saveError.set(null);
  }

  saveStatus() {
    const d = this.detailData();
    if (!d) return;
    this.isSaving.set(true);
    this.saveSuccess.set(null);
    this.saveError.set(null);

    const isResolved = this.editStatus() === 'resolved';
    const body: Record<string, unknown> = {
      status: this.editStatus(),
      ...(isResolved ? { resolved_note: this.editNote() || null } : {}),
    };

    const url = `${this.constants.API_ENDPOINT}/bug-reports/${d.report_id}/status`;
    this.http.patch<{ success: boolean; message: string }>(url, body, { headers: this.headers() }).subscribe({
      next: res => {
        this.saveSuccess.set(res.message ?? 'อัปเดตสถานะเรียบร้อยแล้ว');
        this.isSaving.set(false);
        this.reports.update(rows =>
          rows.map(r => r.report_id === d.report_id
            ? { ...r, status: this.editStatus(), resolved_note: this.editNote() as any }
            : r)
        );
        this.detailData.update(v => v ? { ...v, status: this.editStatus() } : v);
      },
      error: () => {
        this.saveError.set('เกิดข้อผิดพลาดในการบันทึก กรุณาลองใหม่');
        this.isSaving.set(false);
      },
    });
  }

  statusFilterLabel(): string {
    return this.statusFilterOptions.find(o => o.value === this.statusFilter())?.label ?? 'ทุกสถานะ';
  }

  selectStatusFilter(value: string) {
    this.statusFilter.set(value);
    this.statusDropdownOpen.set(false);
  }

  statusLabel(s: string): string {
    const m: Record<string, string> = {
      pending:     'รอดำเนินการ',
      in_progress: 'กำลังดำเนินการ',
      resolved:    'แก้ไขแล้ว',
    };
    return m[s] ?? s;
  }

  categoryLabel(c: string): string {
    const m: Record<string, string> = {
      bug:         '🐛 Bug',
      ui:          '🎨 UI/UX',
      feature:     '✨ Feature Request',
      performance: '⚡ Performance',
      security:    '🔒 Security',
    };
    return m[c] ?? c;
  }

  formatDate(d: Date | string | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleString('th-TH', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  }

  fullName(first: string | null, last: string | null): string {
    return `${first ?? ''} ${last ?? ''}`.trim() || '—';
  }
}
