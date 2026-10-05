import { Component, signal, computed, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { AuthService } from '../../../../auth.service';
import { Constants } from '../../../../comfig/constants';
import { GetRequestT3Res, Datum } from '../../../../model/res/get_request_T3_res';
import { GetDeteilsT3Res, Data as T3Detail } from '../../../../model/res/get_deteils_T3_res';
import { StaffActionReq } from '../../../../model/req/staff_action_req';
import { StaffActionRejectReq } from '../../../../model/req/staff_action_reject_req';

type StatusType = 'pending' | 'approved' | 'rejected';
type FilterType  = 'all' | 'pending' | 'approved' | 'rejected';
type Decision    = 'approved' | 'rejected' | null;

const AVATAR_COLORS = [
  '#1B3A6B', '#1C3560', '#1A5247', '#7A3A1A',
  '#1E3B6E', '#3A3E4A', '#2D4A1E', '#6B1A3A',
];

const EVIDENCE_FILES: { key: string; label: string; icon: string }[] = [
  { key: 'acceptance_letter',  label: 'หนังสือตอบรับ',     icon: 'ti ti-file-text' },
  { key: 'full_paper',         label: 'บทความฉบับสมบูรณ์', icon: 'ti ti-file-description' },
  { key: 'journal_cover',      label: 'ปกวารสาร',          icon: 'ti ti-news' },
  { key: 'table_of_contents',  label: 'สารบัญ',            icon: 'ti ti-list-details' },
  { key: 'database_evidence',  label: 'หลักฐานฐานข้อมูล',  icon: 'ti ti-search' },
  { key: 'peer_review_result', label: 'ผล Peer Review',     icon: 'ti ti-notes' },
];

interface T3Item {
  id:            string;
  t3Id:          number;
  initials:      string;
  avatarColor:   string;
  studentName:   string;
  studentId:     string;
  email:         string;
  journalName:   string;
  issn:          string;
  database:      string;
  pubType:       string;
  pubStatus:     string;
  titleThai:     string;
  titleEn:       string;
  firstAuthor:   string;
  volume:        string;
  issue:         string;
  publishYear:   string;
  submittedDate: string;
  submittedTime: string;
  dateLabel:     string;
  daysAgo:       number;
  status:        StatusType;
  approvedDate?: string;
  staffRemark:   string | null;
}

@Component({
  selector: 'app-t3-request-staff',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './t3-request.html',
  styleUrl: './t3-request.scss',
})
export class T3Request implements OnInit {
  private http      = inject(HttpClient);
  private auth      = inject(AuthService);
  private constants = inject(Constants);
  private router    = inject(Router);

  readonly evidenceFiles = EVIDENCE_FILES;

  isLoading        = signal(true);
  isDetailLoading  = signal(false);
  isSubmitting     = signal(false);
  submitResult     = signal<'success' | 'error' | ''>('');
  private _resultTimer: ReturnType<typeof setTimeout> | null = null;
  activeFilter     = signal<FilterType>('all');
  selectedRequest  = signal<T3Item | null>(null);
  detailData       = signal<T3Detail | null>(null);
  decision         = signal<Decision>('approved');
  remark           = '';

  // Approve fields (staff only)
  meetingNo   = '';
  meetingDate = '';

  // File states
  fileLoading: Record<string, boolean> = {};
  fileViewing: Record<string, boolean> = {};

  requests = signal<T3Item[]>([]);

  ngOnInit(): void {
    this.loadCards();
    /* .tab-bar มี overflow-x:auto สำหรับจอมือถือ (3 แท็บรวมกันกว้างเกินจอแคบ) —
       พอกดมาแท็บนี้ต้องเลื่อนแท็บที่ active เข้ามาให้เห็นในจอเอง ไม่งั้นผู้ใช้จะไม่เห็น
       ว่าแท็บไหนกำลัง active อยู่เพราะมันตกขอบจอไปแล้ว */
    setTimeout(() => {
      document.querySelector('.tab-item.tab-active')
        ?.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
    }, 0);
  }

  loadCards(): void {
    this.isLoading.set(true);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .get<GetRequestT3Res>(`${this.constants.API_ENDPOINT}/t3/pending`, { headers })
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        this.isLoading.set(false);
        if (res?.success) {
          this.requests.set(res.data.map((d, i) => this.mapDatum(d, i)));
        }
      });
  }

  private mapDatum(d: Datum, index: number): T3Item {
    const createdAt = new Date(d.created_at);
    const daysAgo   = Math.floor((Date.now() - createdAt.getTime()) / 86_400_000);
    const studentId = d.student_email.replace('@msu.ac.th', '');

    const rawStatus = d.overall_status?.toLowerCase() ?? 'pending';
    let status: StatusType = 'pending';
    if (rawStatus.includes('approv')) status = 'approved';
    else if (rawStatus.includes('reject') || rawStatus.includes('cancel')) status = 'rejected';

    const fmt = (v: any) =>
      v ? new Date(v).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '';

    const approvedAt = d.faculty_com_approval?.approved_at
      ? new Date(d.faculty_com_approval.approved_at as any).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
      : undefined;

    let dateLabel = '';
    if (status === 'approved') {
      dateLabel = d.faculty_com_approval?.approved_at ? `อนุมัติ ${fmt(d.faculty_com_approval.approved_at)}` : 'อนุมัติแล้ว';
    } else if (status === 'rejected') {
      dateLabel = d.faculty_com_approval?.approved_at ? `ไม่อนุมัติ ${fmt(d.faculty_com_approval.approved_at)}` : 'ไม่อนุมัติ';
    } else {
      dateLabel = `ยื่น ${fmt(createdAt)}`;
    }

    const stripped = d.student_name.replace(/^(นาย|น\.ส\.|นาง(?:สาว)?|ดร\.|ผศ\.|รศ\.|ศ\.)\s*/u, '').trim();
    const parts    = stripped.split(/\s+/);
    const initials = parts.slice(0, 2).map((p: string) => [...p][0] ?? '').join('') || '??';

    return {
      id:            String(d.t3_id),
      t3Id:          d.t3_id,
      initials,
      avatarColor:   AVATAR_COLORS[index % AVATAR_COLORS.length],
      studentName:   d.student_name,
      studentId,
      email:         d.student_email,
      journalName:   d.journal_snapshot.journal_name,
      issn:          d.journal_snapshot.issn,
      database:      d.publication_details.specified_database,
      pubType:       d.publication_details.type,
      pubStatus:     d.publication_details.status,
      titleThai:     d.paper_and_research_details.title_thai,
      titleEn:       d.paper_and_research_details.title_english,
      firstAuthor:   d.paper_and_research_details.first_author,
      volume:        d.publication_details.volume,
      issue:         d.publication_details.issue,
      publishYear:   d.publication_details.publish_year,
      submittedDate: createdAt.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }),
      submittedTime: createdAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
      dateLabel,
      daysAgo,
      status,
      approvedDate:  approvedAt,
      staffRemark:   d.faculty_com_approval?.remark ?? null,
    };
  }

  filtered = computed(() => {
    const all = this.requests();
    const f   = this.activeFilter();
    return f === 'all' ? all : all.filter(r => r.status === f);
  });

  get countPending():  number { return this.requests().filter(r => r.status === 'pending').length; }
  get countApproved(): number { return this.requests().filter(r => r.status === 'approved').length; }
  get countRejected(): number { return this.requests().filter(r => r.status === 'rejected').length; }
  get countAll():      number { return this.requests().length; }

  setFilter(f: FilterType): void { this.activeFilter.set(f); }

  openDetail(req: T3Item): void {
    this.selectedRequest.set(req);
    this.detailData.set(null);
    this.decision.set(req.status === 'rejected' ? 'rejected' : 'approved');
    this.remark     = req.staffRemark ?? '';
    this.meetingNo  = '';
    this.meetingDate = '';
    this.fileLoading = {};
    this.fileViewing = {};
    document.body.style.overflow = 'hidden';

    this.isDetailLoading.set(true);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .get<GetDeteilsT3Res>(`${this.constants.API_ENDPOINT}/t3/${req.t3Id}`, { headers })
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        this.isDetailLoading.set(false);
        if (res?.success) this.detailData.set(res.data);
      });
  }

  closeDetail(): void {
    this.selectedRequest.set(null);
    this.detailData.set(null);
    this.fileLoading = {};
    this.fileViewing = {};
    document.body.style.overflow = '';
  }

  // ── File handling ─────────────────────────────────────
  private fetchFile(t3Id: number, fileKey: string, stateMap: Record<string, boolean>, onBlob: (blob: Blob) => void): void {
    if (stateMap[fileKey]) return;
    stateMap[fileKey] = true;
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .get(`${this.constants.API_ENDPOINT}/upload/t3/${t3Id}/files/${fileKey}`,
           { headers, responseType: 'blob' })
      .pipe(catchError(() => of(null)))
      .subscribe(blob => {
        stateMap[fileKey] = false;
        if (blob) onBlob(blob);
      });
  }

  downloadFile(t3Id: number, fileKey: string): void {
    this.fetchFile(t3Id, fileKey, this.fileLoading, blob => {
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href = url; a.download = `${fileKey}_T3-${t3Id}`; a.click();
      URL.revokeObjectURL(url);
    });
  }

  viewFile(t3Id: number, fileKey: string): void {
    this.fetchFile(t3Id, fileKey, this.fileViewing, blob => {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
  }

  // ── Decision ──────────────────────────────────────────
  get remarkRequired(): boolean { return this.decision() === 'rejected'; }

  get canSubmit(): boolean {
    if (!this.decision()) return false;
    if (this.decision() === 'approved' && (!this.meetingNo.trim() || !this.meetingDate)) return false;
    if (this.decision() === 'rejected' && !this.remark.trim()) return false;
    return true;
  }

  private _scheduleResultClear(): void {
    if (this._resultTimer) clearTimeout(this._resultTimer);
    this._resultTimer = setTimeout(() => this.submitResult.set(''), 4000);
  }

  submitDecision(): void {
    const req = this.selectedRequest();
    if (!req || !this.decision() || this.isSubmitting() || !this.canSubmit) return;

    const headers = new HttpHeaders({
      Authorization: `Bearer ${this.auth.token}`,
      'Content-Type': 'application/json',
    });

    const url  = `${this.constants.API_ENDPOINT}/t3/${req.t3Id}/faculty-review`;
    const body: StaffActionReq | StaffActionRejectReq = this.decision() === 'approved'
      ? { action: 'approve', meeting_no: this.meetingNo, meeting_date: new Date(this.meetingDate) }
      : { action: 'reject',  remark: this.remark };

    this.isSubmitting.set(true);
    this.http.patch(url, body, { headers })
      .pipe(catchError(err => { console.error('submitDecision error', err); return of(null); }))
      .subscribe(res => {
        this.isSubmitting.set(false);
        if (res === null) {
          this.submitResult.set('error');
          this._scheduleResultClear();
          return;
        }
        const newStatus = this.decision() as 'approved' | 'rejected';
        const approvedDate = newStatus === 'approved'
          ? new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
          : undefined;
        this.requests.update(list =>
          list.map(r => r.id === req.id ? { ...r, status: newStatus, approvedDate } : r)
        );
        this.submitResult.set('success');
        setTimeout(() => {
          this.closeDetail();
          this.router.navigate(['/staff/history'], {
            queryParams: {
              type:   'T3',
              status: newStatus === 'approved' ? 'approved' : 'rejected',
            },
          });
        }, 1200);
      });
  }
}
