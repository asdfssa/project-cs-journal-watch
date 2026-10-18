import { Component, signal, computed, OnInit, inject, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { AuthService } from '../../../../auth.service';
import { Constants } from '../../../../comfig/constants';
import { GetRequestT3Res, Datum } from '../../../../model/res/get_request_T3_res';
import { GetDeteilsT3Res, Data as T3Detail } from '../../../../model/res/get_deteils_T3_res';
import { T3ApprovedReq } from '../../../../model/req/T3_approved_req';
import { T3RejectReq } from '../../../../model/req/T3_reject_req';
import { apiFailure, failMsg } from '../../../../server-status.service';
import { downloadBlob } from '../../../../file-download';
import { normalizePubStatus, pubTypeLabel, innovationTypeLabel } from '../../../../t3-labels';

type StatusType = 'pending' | 'approved' | 'rejected';
type FilterType  = 'all' | 'pending' | 'approved' | 'rejected';
type Decision    = 'approved' | 'rejected' | null;

const EVIDENCE_FILES: { key: string; label: string; icon: string }[] = [
  { key: 'acceptance_letter',  label: 'หนังสือตอบรับ',     icon: 'ti ti-file-check' },
  { key: 'full_paper',         label: 'บทความฉบับสมบูรณ์', icon: 'ti ti-files' },
  { key: 'journal_cover',      label: 'ปกวารสาร',          icon: 'ti ti-news' },
  { key: 'table_of_contents',  label: 'สารบัญ',            icon: 'ti ti-list-details' },
  { key: 'database_evidence',  label: 'หลักฐานฐานข้อมูล',  icon: 'ti ti-database-search' },
  { key: 'peer_review_result', label: 'ผล Peer Review',     icon: 'ti ti-notes' },
];

interface T3Item {
  id:            string;
  t3Id:          number;
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
  daysAgo:       number;
  status:        StatusType;
  canReview:     boolean;   // X16: เฉพาะอาจารย์หลักที่ยังไม่ได้ตัดสิน
  isCoAdvisor:   boolean;   // อาจารย์ร่วม (Co_1/Co_2) — เห็นในคิวแต่ดูอย่างเดียว
  approvedDate?: string;
  advisorRemark: string | null;
}

@Component({
  selector: 'app-t3-request',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './t3-request.html',
  styleUrl: './t3-request.scss',
})
export class T3Request implements OnInit {
  readonly innovationLabel = innovationTypeLabel;
  private http      = inject(HttpClient);
  private auth      = inject(AuthService);
  private constants = inject(Constants);

  readonly evidenceFiles = EVIDENCE_FILES;

  isLoading        = signal(true);
  isDetailLoading  = signal(false);
  isSubmitting     = signal(false);
  activeFilter     = signal<FilterType>('all');
  selectedRequest  = signal<T3Item | null>(null);
  detailData       = signal<T3Detail | null>(null);
  decision         = signal<Decision>('approved');
  showConfirm      = signal(false);
  remark           = '';

  fileLoading = signal<Record<string, boolean>>({});
  fileViewing = signal<Record<string, boolean>>({});

  requests = signal<T3Item[]>([]);

  ngOnInit(): void {
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
      .get<GetRequestT3Res>(`${this.constants.API_ENDPOINT}/t3/pending`, { headers })
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

  private mapDatum(d: Datum): T3Item {
    const createdAt = new Date(d.created_at);
    const now       = new Date();
    const daysAgo   = Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000);
    const studentId = d.student_email.replace('@msu.ac.th', '');

    const rawStatus = d.overall_status?.toLowerCase() ?? 'pending';
    let status: StatusType = 'pending';
    if (rawStatus.includes('approv')) status = 'approved';
    else if (rawStatus.includes('reject') || rawStatus.includes('cancel')) status = 'rejected';

    const approvedAt = d.advisor_approval?.approved_at
      ? new Date(d.advisor_approval.approved_at as any).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
      : undefined;

    return {
      id:            String(d.t3_id),
      t3Id:          d.t3_id,
      studentName:   d.student_name,
      studentId,
      email:         d.student_email,
      journalName:   d.journal_snapshot.journal_name,
      issn:          d.journal_snapshot.issn,
      database:      d.publication_details.specified_database,
      pubType:       pubTypeLabel(d.publication_details.type),
      pubStatus:     normalizePubStatus(d.publication_details.status),
      titleThai:     d.paper_and_research_details.title_thai,
      titleEn:       d.paper_and_research_details.title_english,
      firstAuthor:   d.paper_and_research_details.first_author,
      volume:        d.publication_details.volume,
      issue:         d.publication_details.issue,
      publishYear:   d.publication_details.publish_year,
      submittedDate: createdAt.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }),
      daysAgo,
      status,
      canReview:     d.can_review === true,
      isCoAdvisor:   d.my_role === 'Co_1' || d.my_role === 'Co_2',
      approvedDate:  approvedAt,
      advisorRemark: d.advisor_approval?.remark ?? null,
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

  openDetail(req: T3Item): void {
    this.selectedRequest.set(req);
    this.detailData.set(null);
    this.decision.set(req.status === 'rejected' ? 'rejected' : 'approved');
    this.remark = req.advisorRemark ?? '';
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
    this.fileLoading.set({});
    this.fileViewing.set({});
    document.body.style.overflow = '';
  }

  // X32: T3 เก่าบางใบสร้างไว้โดยไม่มีไฟล์ (ก่อน backend บังคับแนบ) — ปิดปุ่มของไฟล์ที่ไม่มี
  fileError = signal('');

  hasFile(key: string): boolean {
    const files = this.detailData()?.journal_evidence_files as Record<string, string | null> | null | undefined;
    return !files || !!files[`${key}_path`];   // ยังโหลดรายละเอียดไม่เสร็จ = ยังไม่รู้ ให้กดได้
  }

  private fetchFile(t3Id: number, fileKey: string, state: WritableSignal<Record<string, boolean>>, onBlob: (blob: Blob) => void, onFail?: () => void): void {
    if (state()[fileKey]) return;
    this.fileError.set('');
    state.update(m => ({ ...m, [fileKey]: true }));
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .get(`${this.constants.API_ENDPOINT}/upload/t3/${t3Id}/files/${fileKey}`,
           { headers, responseType: 'blob' })
      .pipe(catchError(err => {
        // X32: เดิมล้มแล้วเงียบ (กดแล้วไม่มีอะไรเกิดขึ้น)
        this.fileError.set(err?.status === 404
          ? 'ไม่พบไฟล์นี้ในระบบ — ผู้ยื่นอาจไม่ได้แนบไฟล์นี้ไว้'
          : 'เปิดไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
        return of(null);
      }))
      .subscribe(blob => {
        state.update(m => ({ ...m, [fileKey]: false }));
        if (blob) onBlob(blob);
        else onFail?.();
      });
  }

  downloadFile(t3Id: number, fileKey: string): void {
    this.fetchFile(t3Id, fileKey, this.fileLoading, blob => {
      downloadBlob(blob, `${fileKey}_T3-${t3Id}`);   // F13: ใส่นามสกุลไฟล์ + revoke URL หลังเริ่มดาวน์โหลด
    });
  }

  viewFile(t3Id: number, fileKey: string): void {
    if (this.fileViewing()[fileKey]) return;
    // F23: เปิดแท็บเปล่าก่อนแบบ sync (ยังอยู่ใน click event) — ถ้าเปิดหลังโหลดไฟล์เสร็จ เบราว์เซอร์จะบล็อกเป็น popup
    const tab = window.open('', '_blank');
    this.fetchFile(t3Id, fileKey, this.fileViewing, blob => {
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url; else window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }, () => tab?.close());
  }

  get remarkRequired(): boolean { return this.decision() === 'rejected'; }

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

    const url  = `${this.constants.API_ENDPOINT}/t3/${req.t3Id}/advisor-review`;
    const body: T3ApprovedReq | T3RejectReq = this.decision() === 'approved'
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
