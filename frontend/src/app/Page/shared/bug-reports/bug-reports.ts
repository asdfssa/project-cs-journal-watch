import { Component, signal, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { AuthService } from '../../../auth.service';
import { Constants } from '../../../comfig/constants';
import { BugReportsReq } from '../../../model/req/bug-reports_req';
import { BugReportsListRes } from '../../../model/res/bug-reports_list_res';

interface BugRow {
  id:          number;
  category:    string;
  title:       string;
  description: string;
  page_url:    string;
  status:      string;
  created_at:  string;
}

const CATEGORIES = [
  { value: 'scraper',      label: 'ปัญหาการดึงข้อมูล'  },
  { value: 'form',         label: 'ปัญหาฟอร์ม'         },
  { value: 'auth',         label: 'ปัญหาเข้าสู่ระบบ'   },
  { value: 'notification', label: 'ปัญหาการแจ้งเตือน'  },
  { value: 'other',        label: 'อื่นๆ'              },
];

@Component({
  selector: 'app-bug-reports',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './bug-reports.html',
  styleUrl: './bug-reports.scss',
})
export class BugReports implements OnInit {
  private http      = inject(HttpClient);
  private auth      = inject(AuthService);
  private constants = inject(Constants);

  readonly categories = CATEGORIES;
  readonly LIMIT = 10;

  form = {
    category:    '',
    title:       '',
    description: '',
    page_url:    typeof window !== 'undefined' ? window.location.href : '',
  };

  isSubmitting = signal(false);
  submitResult = signal<'success' | 'error' | ''>('');
  private _timer: ReturnType<typeof setTimeout> | null = null;

  isLoading   = signal(true);
  rows        = signal<BugRow[]>([]);
  currentPage = signal(1);
  totalPages  = signal(1);
  total       = signal(0);

  ngOnInit(): void { this.loadList(); }

  loadList(page = 1): void {
    this.isLoading.set(true);
    this.currentPage.set(page);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .get<BugReportsListRes>(
        `${this.constants.API_ENDPOINT}/bug-reports/my?page=${page}&limit=${this.LIMIT}`,
        { headers }
      )
      .pipe(catchError((err: HttpErrorResponse) => {
        console.error('[bug-reports] GET error', err.status, err.error);
        return of(null);
      }))
      .subscribe(res => {
        this.isLoading.set(false);
        if (res?.success) {
          this.rows.set(res.data.rows as BugRow[]);
          this.totalPages.set(res.data.totalPages);
          this.total.set(res.data.total);
        }
      });
  }

  get canSubmit(): boolean {
    return !!this.form.category
      && !!this.form.title.trim()
      && this.form.description.trim().length >= 10;
  }

  submit(): void {
    if (!this.canSubmit || this.isSubmitting()) return;
    const headers = new HttpHeaders({
      Authorization:  `Bearer ${this.auth.token}`,
      'Content-Type': 'application/json',
    });
    const body: BugReportsReq = {
      category:    this.form.category,
      title:       this.form.title.trim(),
      description: this.form.description.trim(),
      page_url:    this.form.page_url,
    };
    this.isSubmitting.set(true);
    this.http
      .post(`${this.constants.API_ENDPOINT}/bug-reports`, body, { headers })
      .pipe(catchError((err: HttpErrorResponse) => {
        console.error('[bug-reports] POST error', err.status, JSON.stringify(err.error));
        return of(null);
      }))
      .subscribe(res => {
        this.isSubmitting.set(false);
        if (res === null) {
          this.submitResult.set('error');
        } else {
          this.submitResult.set('success');
          this.resetForm();
          this.loadList(1);
        }
        if (this._timer) clearTimeout(this._timer);
        this._timer = setTimeout(() => this.submitResult.set(''), 4000);
      });
  }

  private resetForm(): void {
    this.form = {
      category:    '',
      title:       '',
      description: '',
      page_url:    typeof window !== 'undefined' ? window.location.href : '',
    };
  }

  pageNumbers(): number[] {
    const tp  = this.totalPages();
    const cur = this.currentPage();
    if (tp <= 7) return Array.from({ length: tp }, (_, i) => i + 1);
    const pages = new Set([1, tp, cur - 1, cur, cur + 1].filter(p => p >= 1 && p <= tp));
    return [...pages].sort((a, b) => a - b);
  }

  statusLabel(status: string): string {
    const map: Record<string, string> = {
      open:        'รอดำเนินการ',
      pending:     'รอดำเนินการ',
      in_progress: 'กำลังดำเนินการ',
      resolved:    'แก้ไขแล้ว',
      closed:      'ปิดแล้ว',
      rejected:    'ไม่ดำเนินการ',
    };
    return map[status?.toLowerCase()] ?? 'รอดำเนินการ';
  }

  statusClass(status: string): string {
    const s = status?.toLowerCase();
    if (s === 'resolved' || s === 'closed')  return 'status--resolved';
    if (s === 'in_progress')                  return 'status--progress';
    if (s === 'rejected')                     return 'status--rejected';
    return 'status--open';
  }

  categoryLabel(cat: string): string {
    return this.categories.find(c => c.value === cat)?.label ?? cat;
  }

  formatDate(iso: string): string {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }
}
