import { Component, signal, computed, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { AuthService } from '../../../../auth.service';
import { Constants } from '../../../../comfig/constants';
import { GetPreT3RequestRes, Datum } from '../../../../model/res/get_pre-t3_request_res';
import { PreT3DetailsRes, Data as PreT3Detail } from '../../../../model/res/Pre-T3_details_res';
import { PreT3ApprovedReq } from '../../../../model/req/Pre-T3_approved_req';
import { PreT3RejectReq } from '../../../../model/req/Pre-T3_reject_req';

type StatusType = 'pending' | 'approved' | 'rejected';
type FilterType  = 'all' | 'pending' | 'approved' | 'rejected';
type Decision    = 'approved' | 'rejected' | null;

interface ChecklistItem {
  id:     number;
  title:  string;
  status: 'pass' | 'fail';
}

interface PreT3Item {
  id:            string;
  studentName:   string;
  studentId:     string;
  email:         string;
  journalName:   string;
  issn:          string;
  eissn:         string;
  database:      string;
  quartile:      string;
  sjr:           string;
  citeScore:     string;
  journalStatus: string;
  isHijacked:    boolean;
  isDiscontinued: boolean;
  journalUrl:    string;
  submittedDate: string;
  daysAgo:       number;
  requestId:     string;
  status:        StatusType;
  approvedDate?: string;
  advisorRemark: string | null;
  checklist:     ChecklistItem[];
}

const CHECKLIST_TITLES: Record<string, string> = {
  item1: 'มาตรฐานวารสารนานาชาติที่มีคุณภาพตามเกณฑ์',
  item2: 'วารสารมีโปรไฟล์หน้าเว็บที่อ้างอิงในฐานข้อมูล MSU',
  item3: 'กำหนดออกเผยแพร่อย่างสม่ำเสมอ (Continuous Publication)',
  item4: 'กำหนดการกลั่นกรอง (Systematic review) ของวารสาร',
  item5: 'มีคณะกรรมการวิชาการวารสารระดับนานาชาติ (International Editorial Board)',
  item6: 'มีระบบ Peer Review ที่ชัดเจน',
  item7: 'ปฏิบัติตามจรรยาบรรณมาตรฐานสากล',
  item8: 'ไม่ใช่ Hijacked Journal',
  item9: 'อ้างอิงฐานข้อมูลของ Scopus / TCI จะใช้ได้',
};

@Component({
  selector: 'app-pre-t3-request',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './pre-t3-request.html',
  styleUrl: './pre-t3-request.scss',
})
export class PreT3Request implements OnInit {
  private http      = inject(HttpClient);
  private auth      = inject(AuthService);
  private constants = inject(Constants);

  isLoading        = signal(true);
  isDetailLoading  = signal(false);
  isSubmitting     = signal(false);
  activeFilter     = signal<FilterType>('all');
  selectedRequest  = signal<PreT3Item | null>(null);
  detailData       = signal<PreT3Detail | null>(null);
  decision         = signal<Decision>('approved');
  showAbstract     = signal(false);
  showConfirm      = signal(false);
  remark           = '';

  requests = signal<PreT3Item[]>([]);

  ngOnInit(): void {
    window.scrollTo({ top: 0 });
    this.loadRequests();
    // tab-bar เลื่อนแนวนอนได้บนจอแคบ (overflow-x:auto) แต่ scrollLeft เริ่มที่ 0 เสมอ
    // ถ้าแท็บที่ active อยู่ไม่ใช่ตัวแรกจะโดนซ่อนพ้นขอบจอ ต้องเลื่อนให้เข้ามาอยู่ใน
    // มุมมองเองตั้งแต่โหลดหน้า
    setTimeout(() => {
      document.querySelector('.tab-item.tab-active')
        ?.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
    }, 0);
  }

  loadRequests(): void {
    this.isLoading.set(true);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .get<GetPreT3RequestRes>(`${this.constants.API_ENDPOINT}/pre-t3/pending`, { headers })
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        this.isLoading.set(false);
        if (res?.success) {
          this.requests.set(res.data.map(d => this.mapDatum(d)));
        }
      });
  }

  private mapDatum(d: Datum): PreT3Item {
    const createdAt  = new Date(d.created_at);
    const now        = new Date();
    const daysAgo    = Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000);
    const studentId  = d.student_email.replace('@msu.ac.th', '');
    const snap       = d.journal_snapshot;
    const rawStatus  = d.overall_status?.toLowerCase() ?? 'pending';
    let status: StatusType = 'pending';
    if (rawStatus.includes('approv')) status = 'approved';
    else if (rawStatus.includes('reject') || rawStatus.includes('not')) status = 'rejected';

    const advisorApproval = d.advisor_approval;
    const approvedAt = advisorApproval?.approved_at
      ? new Date(advisorApproval.approved_at as any).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
      : undefined;

    const checklist: ChecklistItem[] = Object.entries(CHECKLIST_TITLES).map(([key, title], i) => ({
      id:     i + 1,
      title,
      status: d.checklist_data?.[key] ? 'pass' : 'fail',
    }));

    return {
      id:            String(d.pre_t3_id),
      studentName:   d.student_name,
      studentId,
      email:         d.student_email,
      journalName:   snap.journal_name,
      issn:          snap.issn,
      eissn:         snap.eissn,
      database:      snap.indexed_database,
      quartile:      snap.quartile_or_tier,
      sjr:           snap.sjr_score?.toString() ?? '—',
      citeScore:     snap.cite_score?.toString() ?? '—',
      journalStatus: snap.is_discontinued ? 'Discontinued' : 'Active',
      isHijacked:    snap.is_hijacked,
      isDiscontinued: snap.is_discontinued,
      journalUrl:    snap.journal_url,
      submittedDate: createdAt.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }),
      daysAgo,
      requestId:     `PRE-T3-${d.pre_t3_id}`,
      status,
      approvedDate:  approvedAt,
      advisorRemark: advisorApproval?.remark ?? null,
      checklist,
    };
  }

  filtered = computed(() => {
    const all = this.requests();
    const f   = this.activeFilter();
    if (f === 'all') return all;
    return all.filter(r => r.status === f);
  });

  get countPending():  number { return this.requests().filter(r => r.status === 'pending').length; }
  get countApproved(): number { return this.requests().filter(r => r.status === 'approved').length; }
  get countRejected(): number { return this.requests().filter(r => r.status === 'rejected').length; }
  get countAll():      number { return this.requests().length; }

  setFilter(f: FilterType): void { this.activeFilter.set(f); }

  openDetail(req: PreT3Item): void {
    this.selectedRequest.set(req);
    this.detailData.set(null);
    this.decision.set(req.status === 'rejected' ? 'rejected' : 'approved');
    this.remark = req.advisorRemark ?? '';
    this.showAbstract.set(false);
    document.body.style.overflow = 'hidden';

    this.isDetailLoading.set(true);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .get<PreT3DetailsRes>(`${this.constants.API_ENDPOINT}/pre-t3/${req.id}`, { headers })
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        this.isDetailLoading.set(false);
        if (res?.success) {
          this.detailData.set(res.data);
        }
      });
  }

  closeDetail(): void {
    this.selectedRequest.set(null);
    this.detailData.set(null);
    document.body.style.overflow = '';
  }

  get remarkRequired(): boolean {
    return this.decision() === 'rejected';
  }

  get canSubmit(): boolean {
    if (!this.decision()) return false;
    if (this.decision() === 'rejected' && !this.remark.trim()) return false;
    return true;
  }

  openConfirm(): void {
    if (!this.canSubmit) return;
    this.showConfirm.set(true);
  }

  submitDecision(): void {
    const req = this.selectedRequest();
    if (!req || !this.decision() || this.isSubmitting()) return;
    if (this.decision() === 'rejected' && !this.remark.trim()) return;

    const headers = new HttpHeaders({
      Authorization: `Bearer ${this.auth.token}`,
      'Content-Type': 'application/json',
    });

    const url = `${this.constants.API_ENDPOINT}/pre-t3/${req.id}/advisor-review`;
    const body: PreT3ApprovedReq | PreT3RejectReq = this.decision() === 'approved'
      ? { action: 'approve' }
      : { action: 'reject', remark: this.remark };

    console.log('[submitDecision] URL  :', url);
    console.log('[submitDecision] Body :', body);

    this.isSubmitting.set(true);
    this.http.patch(url, body, { headers })
      .pipe(catchError(err => {
        console.error('[submitDecision] HTTP status :', err?.status);
        console.error('[submitDecision] Error body  :', err?.error);
        console.error('[submitDecision] Full error  :', err);
        return of(null);
      }))
      .subscribe(res => {
        console.log('[submitDecision] Response:', res);
        this.isSubmitting.set(false);
        this.showConfirm.set(false);
        if (res === null) {
          console.warn('[submitDecision] API call failed — ไม่ได้อัปเดต status');
          return;
        }
        const newStatus = this.decision() as 'approved' | 'rejected';
        const approvedDate = newStatus === 'approved'
          ? new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
          : undefined;
        this.requests.update(list =>
          list.map(r => r.id === req.id ? { ...r, status: newStatus, approvedDate } : r)
        );
        this.closeDetail();
      });
  }
}
