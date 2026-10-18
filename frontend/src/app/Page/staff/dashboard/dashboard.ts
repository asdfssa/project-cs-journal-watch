import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { catchError, forkJoin, of } from 'rxjs';
import { AuthService } from '../../../auth.service';
import { Constants } from '../../../comfig/constants';
import { GetPreT3RequestStaffRes } from '../../../model/res/get_Pre-T3_request_staff_res';
import { GetRequestT3Res } from '../../../model/res/get_request_T3_res';
import { PreT3HistorySatffRes } from '../../../model/res/pre-t3_history_satff_res';
import { T3HistorySatffRes } from '../../../model/res/t3_history_satff_res';
import { fetchAllPages } from '../../../paged-fetch';

interface RecentItem {
  type: 'PreT3' | 'T3';
  studentName: string;
  studentId: string;
  journalName: string;
  status: 'pending';
  dateLabel: string;
  updatedAt: Date;
  routerLink: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard implements OnInit {
  private auth      = inject(AuthService);
  private http      = inject(HttpClient);
  private constants = inject(Constants);

  staffName  = '';
  staffEmail = '';

  get userPicture() { return this.auth.userPicture; }
  today      = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  greeting   = this.getGreeting();

  isLoading     = signal(true);
  // N3: API ล่ม → ตัวเลขทั้งหมดเป็น 0 เงียบๆ ดูเหมือนไม่มีคำร้อง — แจ้งให้รู้
  loadError     = signal(false);
  pendingPreT3  = signal(0);
  pendingT3     = signal(0);
  approvedTotal = signal(0);
  rejectedTotal = signal(0);
  recentItems   = signal<RecentItem[]>([]);

  totalPending = computed(() => this.pendingPreT3() + this.pendingT3());

  private getGreeting(): string {
    const h = new Date().getHours();
    if (h < 12) return 'สวัสดีตอนเช้า';
    if (h < 17) return 'สวัสดีตอนบ่าย';
    return 'สวัสดีตอนเย็น';
  }

  ngOnInit(): void {
    window.scrollTo({ top: 0 });
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    const api     = this.constants.API_ENDPOINT;

    const profile$      = this.http.get<any>(`${api}/user/profile`, { headers }).pipe(catchError(() => of(null)));
    const preT3Pending$ = this.http.get<GetPreT3RequestStaffRes>(`${api}/pre-t3/pending`, { headers }).pipe(catchError(() => of(null)));
    const t3Pending$    = this.http.get<GetRequestT3Res>(`${api}/t3/pending`, { headers }).pipe(catchError(() => of(null)));
    const preT3Hist$    = fetchAllPages<PreT3HistorySatffRes>(this.http, `${api}/pre-t3/history`, headers).pipe(catchError(() => of(null)));
    const t3Hist$       = fetchAllPages<T3HistorySatffRes>(this.http, `${api}/t3/history`, headers).pipe(catchError(() => of(null)));

    forkJoin([profile$, preT3Pending$, t3Pending$, preT3Hist$, t3Hist$]).subscribe(
      ([profileRes, preT3PendRes, t3PendRes, preT3HistRes, t3HistRes]) => {
        this.loadError.set(!preT3PendRes?.success || !t3PendRes?.success || !preT3HistRes?.success || !t3HistRes?.success);
        if (profileRes?.success) {
          const d       = profileRes.data;
          this.staffName  = `${d.prefix ?? ''} ${d.firstName} ${d.lastName}`.trim();
          this.staffEmail = d.msuMail ?? '';
        }

        this.pendingPreT3.set(preT3PendRes?.success ? preT3PendRes.data.length : 0);
        this.pendingT3.set(t3PendRes?.success ? t3PendRes.data.length : 0);

        let approved = 0;
        let rejected = 0;
        (preT3HistRes?.success ? preT3HistRes.data.items : []).forEach(d => {
          const s = d.overall_status?.toLowerCase() ?? '';
          if (s.includes('approv')) approved++;
          else if (s.includes('reject')) rejected++;   // N7: ยกเลิกโดยนิสิต ≠ ไม่อนุมัติ
        });
        (t3HistRes?.success ? t3HistRes.data.items : []).forEach(d => {
          const s = d.overall_status?.toLowerCase() ?? '';
          if (s.includes('approv')) approved++;
          else if (s.includes('reject')) rejected++;   // N7: ยกเลิกโดยนิสิต ≠ ไม่อนุมัติ
        });
        this.approvedTotal.set(approved);
        this.rejectedTotal.set(rejected);

        const recentPreT3: RecentItem[] = (preT3PendRes?.success ? preT3PendRes.data : [])
          .slice(0, 6)
          .map(d => ({
            type: 'PreT3' as const,
            studentName: d.student_name,
            studentId:   d.student_email.replace('@msu.ac.th', ''),
            journalName: (d.journal_snapshot as any)?.journal_name ?? '-',
            status:      'pending' as const,
            dateLabel:   new Date(d.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }),
            updatedAt:   new Date(d.created_at),
            routerLink:  '/staff/pre-t3-request',
          }));

        const recentT3: RecentItem[] = (t3PendRes?.success ? t3PendRes.data : [])
          .slice(0, 6)
          .map(d => ({
            type: 'T3' as const,
            studentName: d.student_name,
            studentId:   d.student_email.replace('@msu.ac.th', ''),
            journalName: (d.journal_snapshot as any)?.journal_name ?? '-',
            status:      'pending' as const,
            dateLabel:   new Date(d.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }),
            updatedAt:   new Date(d.created_at),
            routerLink:  '/staff/t3-request',
          }));

        const merged = [...recentPreT3, ...recentT3]
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          .slice(0, 8);

        this.recentItems.set(merged);
        this.isLoading.set(false);
      }
    );
  }
}
