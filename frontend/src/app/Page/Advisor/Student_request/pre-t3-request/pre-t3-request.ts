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
import { apiFailure, failMsg } from '../../../../server-status.service';
import { PRE_T3_CHECKLIST_TITLES as CHECKLIST_TITLES } from '../../../../pre-t3-checklist';
import { isHttpUrl } from '../../../../safe-url';

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
  articleTitle:  string;
  issn:          string;
  database:      string;
  quartile:      string;
  journalStatus: string;
  isHijacked:    boolean;
  isDiscontinued: boolean;
  journalUrl:    string;
  submittedDate: string;
  daysAgo:       number;
  requestId:     string;
  status:        StatusType;
  canReview:     boolean;   // X16: เฉพาะอาจารย์หลักที่ยังไม่ได้ตัดสิน
  isCoAdvisor:   boolean;   // อาจารย์ร่วม (Co_1/Co_2) — เห็นในคิวแต่ดูอย่างเดียว
  approvedDate?: string;
  advisorRemark: string | null;
  checklist:     ChecklistItem[];
}


@Component({
  selector: 'app-pre-t3-request',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './pre-t3-request.html',
  styleUrl: './pre-t3-request.scss',
})
export class PreT3Request implements OnInit {
  readonly isHttpUrl = isHttpUrl;
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

  // F24: โหลดรายการล้มเหลว ≠ ไม่มีรายการ — เดิม error ทุกแบบแสดงเป็น "ยังไม่มีคำร้อง"
  loadError = signal('');

  loadRequests(): void {
    this.isLoading.set(true);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .get<GetPreT3RequestRes>(`${this.constants.API_ENDPOINT}/pre-t3/pending`, { headers })
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.isLoading.set(false);
        if (res.success && 'data' in res) {
          this.requests.set(res.data.map(d => this.mapDatum(d)));
          this.loadError.set('');
        } else {
          this.loadError.set(failMsg(res, 'โหลดรายการคำร้องไม่สำเร็จ กรุณาลองใหม่'));
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
      // X43: เดิมการ์ดเอาชื่อวารสารมาแสดงเป็น "ชื่อบทความ"
      articleTitle:  (d as { article_info?: { title_th?: string | null; title_en?: string | null } }).article_info?.title_th
                  || (d as { article_info?: { title_en?: string | null } }).article_info?.title_en || '',
      issn:          snap.issn,
      database:      snap.indexed_database,
      quartile:      snap.quartile_or_tier,
      journalStatus: snap.is_discontinued ? 'Discontinued' : 'Active',
      isHijacked:    snap.is_hijacked,
      isDiscontinued: snap.is_discontinued,
      journalUrl:    snap.journal_url,
      submittedDate: createdAt.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }),
      daysAgo,
      requestId:     `PRE-T3-${d.pre_t3_id}`,
      status,
      canReview:     d.can_review === true,
      isCoAdvisor:   d.my_role === 'Co_1' || d.my_role === 'Co_2',
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

  // ลงนามไม่ผ่าน (เช่น นิสิตยกเลิกคำร้องไปแล้ว) → แสดงเหตุผลใน dialog แทนการปิดเงียบ
  decisionError = signal('');

  openConfirm(): void {
    this.decisionError.set('');
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
      // X42: เดิมตอนอนุมัติไม่ส่งหมายเหตุ ข้อความที่อาจารย์พิมพ์หายไป (backend รับและบันทึกได้)
      ? { action: 'approve', ...(this.remark.trim() ? { remark: this.remark.trim() } : {}) }
      : { action: 'reject', remark: this.remark.trim() };


    this.isSubmitting.set(true);
    this.http.patch(url, body, { headers })
      .pipe(catchError(err => {
        console.error('[submitDecision]', err?.status, err?.error);
        return of(apiFailure(err));
      }))
      .subscribe(res => {
        this.isSubmitting.set(false);
        if ((res as { success?: boolean } | null)?.success === false) {
          // ไม่ปิด dialog — อาจารย์ต้องรู้ว่าลงนามไม่สำเร็จและเพราะอะไร
          this.decisionError.set(failMsg(res, 'ลงนามไม่สำเร็จ กรุณาลองใหม่'));
          return;
        }
        this.showConfirm.set(false);
        const newStatus = this.decision() as 'approved' | 'rejected';
        const approvedDate = newStatus === 'approved'
          ? new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
          : undefined;
        this.requests.update(list =>
          list.map(r => r.id === req.id ? { ...r, status: newStatus, approvedDate, canReview: false } : r)
        );
        this.closeDetail();
      });
  }
}
