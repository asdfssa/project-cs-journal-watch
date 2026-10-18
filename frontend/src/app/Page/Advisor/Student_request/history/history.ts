import { Component, signal, computed, OnInit, inject, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { catchError, forkJoin, of } from 'rxjs';
import { AuthService } from '../../../../auth.service';
import { Constants } from '../../../../comfig/constants';
import { T3HistoryAdvisor, Item as T3Item } from '../../../../model/res/t3_history_advisor';
import { PreT3HistoryAdvisor, Item as PreT3Item } from '../../../../model/res/pre-t3_history_advisor';
import { GetDeteilsT3Res, Data as T3Detail } from '../../../../model/res/get_deteils_T3_res';
import { PreT3DetailsRes, Data as PreT3Detail } from '../../../../model/res/Pre-T3_details_res';
import { downloadBlob } from '../../../../file-download';
import { fetchAllPages } from '../../../../paged-fetch';
import { apiFailure, failMsg } from '../../../../server-status.service';
import { PRE_T3_CHECKLIST_TITLES as CHECKLIST_TITLES } from '../../../../pre-t3-checklist';
import { normalizePubStatus, pubTypeLabel, innovationTypeLabel } from '../../../../t3-labels';

type TypeFilter    = 'all' | 'pre-t3' | 't3';
type StatusFilter  = 'all' | 'approved' | 'rejected';
type AdvisorStatus = 'Approved' | 'Rejected' | 'Pending';

interface HistoryCard {
  id:             string;
  rawId:          number;
  itemType:       'T3' | 'PreT3';
  studentName:    string;
  studentId:      string;
  email:          string;
  articleTitle:   string;
  journalName:    string;
  issn:           string;
  database:       string;
  quartile:       string;
  pubType:        string;
  pubStatus:      string;
  isDiscontinued: boolean;
  submittedDate:  string;
  advisorStatus:  AdvisorStatus;   // ผลของอาจารย์หลักเสมอ (X16: อาจารย์หลักตัดสินคนเดียว)
  advisorRemark:  string | null;
  isCoAdvisor:    boolean;         // คนที่ login เป็นอาจารย์ร่วมของคำร้องนี้ → แสดงป้ายผลจากอาจารย์ที่ปรึกษาหลัก
  actionDate:     string | null;
  updatedAt:      Date;
}

interface ChecklistItem { id: number; title: string; status: 'pass' | 'fail'; }


const EVIDENCE_FILES: { key: string; label: string; icon: string }[] = [
  { key: 'acceptance_letter',  label: 'หนังสือตอบรับ',     icon: 'ti ti-file-check' },
  { key: 'full_paper',         label: 'บทความฉบับสมบูรณ์', icon: 'ti ti-files' },
  { key: 'journal_cover',      label: 'ปกวารสาร',          icon: 'ti ti-news' },
  { key: 'table_of_contents',  label: 'สารบัญ',            icon: 'ti ti-list-details' },
  { key: 'database_evidence',  label: 'หลักฐานฐานข้อมูล',  icon: 'ti ti-database-search' },
  { key: 'peer_review_result', label: 'ผล Peer Review',     icon: 'ti ti-notes' },
];

@Component({
  selector: 'app-history',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './history.html',
  styleUrl: './history.scss',
})
export class History implements OnInit {
  readonly innovationLabel = innovationTypeLabel;
  private http      = inject(HttpClient);
  private auth      = inject(AuthService);
  private constants = inject(Constants);

  readonly evidenceFiles = EVIDENCE_FILES;

  private readonly THAI_MONTHS = [
    'ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
    'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.',
  ];

  isLoading       = signal(true);
  isDetailLoading = signal(false);
  typeFilter      = signal<TypeFilter>('all');
  statusFilter    = signal<StatusFilter>('all');
  allCards        = signal<HistoryCard[]>([]);
  selectedCard    = signal<HistoryCard | null>(null);
  detailDataT3    = signal<T3Detail | null>(null);
  detailDataPreT3 = signal<PreT3Detail | null>(null);

  fileLoading = signal<Record<string, boolean>>({});
  fileViewing = signal<Record<string, boolean>>({});

  filtered = computed(() => {
    const type   = this.typeFilter();
    const status = this.statusFilter();
    return this.allCards().filter(c => {
      if (type === 'pre-t3' && c.itemType !== 'PreT3') return false;
      if (type === 't3'     && c.itemType !== 'T3')    return false;
      if (status === 'approved' && c.advisorStatus !== 'Approved') return false;
      if (status === 'rejected' && c.advisorStatus !== 'Rejected') return false;
      return true;
    });
  });

  get countAll():      number { return this.allCards().length; }
  get countApproved(): number { return this.allCards().filter(c => c.advisorStatus === 'Approved').length; }
  get countRejected(): number { return this.allCards().filter(c => c.advisorStatus === 'Rejected').length; }
  get countPreT3():    number { return this.allCards().filter(c => c.itemType === 'PreT3').length; }
  get countT3():       number { return this.allCards().filter(c => c.itemType === 'T3').length; }

  resetFilters(): void {
    this.typeFilter.set('all');
    this.statusFilter.set('all');
  }

  setTypeFilter(f: Exclude<TypeFilter, 'all'>): void {
    this.typeFilter.set(this.typeFilter() === f ? 'all' : f);
  }

  setStatusFilter(f: Exclude<StatusFilter, 'all'>): void {
    this.statusFilter.set(this.statusFilter() === f ? 'all' : f);
  }

  checklistItems(): ChecklistItem[] {
    const data = this.detailDataPreT3();
    if (!data?.checklist_data) return [];
    return Object.entries(CHECKLIST_TITLES).map(([key, title], i) => ({
      id:     i + 1,
      title,
      status: data.checklist_data[key] ? 'pass' : 'fail',
    }));
  }

  ngOnInit(): void {
    this.loadHistory();
    // tab-bar เลื่อนแนวนอนได้บนจอแคบ (overflow-x:auto) แต่ scrollLeft เริ่มที่ 0 เสมอ
    // ถ้าแท็บที่ active อยู่ไม่ใช่ตัวแรก (เช่น "ประวัติทั้งหมด" ซึ่งเป็นตัวสุดท้าย)
    // จะโดนซ่อนพ้นขอบจอ ต้องเลื่อนให้เข้ามาอยู่ในมุมมองเองตั้งแต่โหลดหน้า
    setTimeout(() => {
      document.querySelector('.tab-item.tab-active')
        ?.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
    }, 0);
  }

  // F24: โหลดรายการล้มเหลว ≠ ไม่มีรายการ — เดิม error ทุกแบบแสดงเป็น "ยังไม่มีคำร้อง"
  loadError = signal('');

  loadHistory(): void {
    this.isLoading.set(true);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    let failure: unknown = null;
    const t3$    = fetchAllPages<T3HistoryAdvisor>(this.http, `${this.constants.API_ENDPOINT}/t3/history`, headers)
                       .pipe(catchError(err => { failure = err; return of(null); }));
    const preT3$ = fetchAllPages<PreT3HistoryAdvisor>(this.http, `${this.constants.API_ENDPOINT}/pre-t3/history`, headers)
                       .pipe(catchError(err => { failure = err; return of(null); }));

    forkJoin([t3$, preT3$]).subscribe(([t3Res, preT3Res]) => {
      const t3Cards    = (t3Res?.success    ? t3Res.data.items    : []).map(d => this.mapT3(d));
      const preT3Cards = (preT3Res?.success ? preT3Res.data.items : []).map(d => this.mapPreT3(d));

      const merged = [...t3Cards, ...preT3Cards]
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

      this.allCards.set(merged);
      this.isLoading.set(false);
      // ฝั่งไหนโหลดไม่ได้ก็แจ้ง (ยังแสดงรายการของอีกฝั่งที่โหลดได้)
      this.loadError.set(t3Res?.success && preT3Res?.success ? '' :
        failMsg(failure ? apiFailure(failure) : null, 'โหลดประวัติบางส่วนไม่สำเร็จ กรุณาลองใหม่'));
    });
  }

  private mapT3(d: T3Item): HistoryCard {
    const advStatus = d.advisor_approval.status as string;
    const advisorStatus: AdvisorStatus =
      advStatus === 'Approved' ? 'Approved' :
      advStatus === 'Rejected' ? 'Rejected' : 'Pending';

    return {
      id:            `T3-${d.t3_id}`,
      rawId:         d.t3_id,
      itemType:      'T3',
      studentName:   d.student_name,
      studentId:     d.student_email.replace('@msu.ac.th', ''),
      email:         d.student_email,
      articleTitle:  d.paper_and_research_details.title_thai || d.paper_and_research_details.title_english,
      journalName:   d.journal_snapshot.journal_name,
      issn:          d.issn || d.journal_snapshot.issn,
      database:      d.publication_details.specified_database,
      quartile:      '',
      pubType:       pubTypeLabel(d.publication_details.type),
      pubStatus:     normalizePubStatus(d.publication_details.status),
      isDiscontinued: false,
      submittedDate: this.formatDate(d.created_at),
      advisorStatus,
      advisorRemark: d.advisor_approval.remark,
      isCoAdvisor:   d.my_role === 'Co_1' || d.my_role === 'Co_2',
      actionDate:    d.advisor_approval.approved_at ? this.formatDate(d.advisor_approval.approved_at) : null,
      updatedAt:     new Date(d.updated_at as unknown as string),
    };
  }

  private mapPreT3(d: PreT3Item): HistoryCard {
    const advStatus = d.advisor_approval.status as unknown as string;
    const advisorStatus: AdvisorStatus =
      advStatus === 'Approved' ? 'Approved' :
      advStatus === 'Rejected' ? 'Rejected' : 'Pending';

    const titleEn = (d.article_info?.title_en as unknown as string | null);
    const titleTh = (d.article_info?.title_th as unknown as string | null);
    const articleTitle = titleEn || titleTh || d.journal_snapshot.journal_name;

    return {
      id:            `PRE-T3-${d.pre_t3_id}`,
      rawId:         d.pre_t3_id,
      itemType:      'PreT3',
      studentName:   d.student_name,
      studentId:     d.student_email.replace('@msu.ac.th', ''),
      email:         d.student_email,
      articleTitle,
      journalName:   d.journal_snapshot.journal_name,
      issn:          d.journal_snapshot.issn,
      database:      d.journal_snapshot.indexed_database,
      quartile:      d.journal_snapshot.quartile_or_tier ?? '',
      pubType:       '',
      pubStatus:     '',
      isDiscontinued: d.journal_snapshot.is_discontinued,
      submittedDate: this.formatDate(d.created_at),
      advisorStatus,
      advisorRemark: d.advisor_approval.remark,
      isCoAdvisor:   d.my_role === 'Co_1' || d.my_role === 'Co_2',
      actionDate:    d.advisor_approval.approved_at ? this.formatDate(d.advisor_approval.approved_at) : null,
      updatedAt:     new Date(d.updated_at as unknown as string),
    };
  }

  openDetail(card: HistoryCard): void {
    this.selectedCard.set(card);
    this.detailDataT3.set(null);
    this.detailDataPreT3.set(null);
    this.fileLoading.set({});
    this.fileViewing.set({});
    document.body.style.overflow = 'hidden';

    this.isDetailLoading.set(true);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });

    if (card.itemType === 'T3') {
      this.http
        .get<GetDeteilsT3Res>(`${this.constants.API_ENDPOINT}/t3/${card.rawId}`, { headers })
        .pipe(catchError(() => of(null)))
        .subscribe(res => {
          this.isDetailLoading.set(false);
          if (res?.success) this.detailDataT3.set(res.data);
        });
    } else {
      this.http
        .get<PreT3DetailsRes>(`${this.constants.API_ENDPOINT}/pre-t3/${card.rawId}`, { headers })
        .pipe(catchError(() => of(null)))
        .subscribe(res => {
          this.isDetailLoading.set(false);
          if (res?.success) this.detailDataPreT3.set(res.data);
        });
    }
  }

  closeDetail(): void {
    this.selectedCard.set(null);
    this.detailDataT3.set(null);
    this.detailDataPreT3.set(null);
    this.fileLoading.set({});
    this.fileViewing.set({});
    document.body.style.overflow = '';
  }

  printDetail(): void {
    document.body.classList.add('modal-print');
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('modal-print');
    }, { once: true });
    window.print();
  }

  // X32: T3 เก่าบางใบสร้างไว้โดยไม่มีไฟล์ (ก่อน backend บังคับแนบ) — ปิดปุ่มของไฟล์ที่ไม่มี
  fileError = signal('');

  hasFile(key: string): boolean {
    const files = this.detailDataT3()?.journal_evidence_files as Record<string, string | null> | null | undefined;
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

  private formatDate(date: Date | string | null): string {
    if (!date) return '-';
    const d = new Date(date as string);
    if (isNaN(d.getTime())) return '-';
    const year = (d.getFullYear() + 543).toString().slice(-2);
    return `${d.getDate()} ${this.THAI_MONTHS[d.getMonth()]} ${year}`;
  }

  statusBadgeClass(card: HistoryCard): string {
    if (card.advisorStatus === 'Approved') return 'status-badge status-approved';
    if (card.advisorStatus === 'Rejected') return 'status-badge status-rejected';
    return 'status-badge status-pending';
  }

  statusLabel(card: HistoryCard): string {
    if (card.advisorStatus === 'Approved') return 'อนุมัติแล้ว';
    if (card.advisorStatus === 'Rejected') return 'ไม่อนุมัติ';
    return '○ รอดำเนินการ';
  }

  actionDateLabel(card: HistoryCard): string {
    if (!card.actionDate) return '';
    if (card.advisorStatus === 'Approved') return `อนุมัติ ${card.actionDate}`;
    if (card.advisorStatus === 'Rejected') return `ปฏิเสธ ${card.actionDate}`;
    return '';
  }
}
