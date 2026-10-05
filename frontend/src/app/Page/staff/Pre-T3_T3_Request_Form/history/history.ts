import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { catchError, forkJoin, of } from 'rxjs';
import { AuthService } from '../../../../auth.service';
import { Constants } from '../../../../comfig/constants';
import { PreT3HistorySatffRes, Item as PreT3Item } from '../../../../model/res/pre-t3_history_satff_res';
import { T3HistorySatffRes, Item as T3Item } from '../../../../model/res/t3_history_satff_res';
import { GetPreT3DeteilsStaffRes, Data as PreT3DetailData } from '../../../../model/res/get_pre-t3_deteils_staff_res';
import { GetDeteilsT3StaffRes, Data as T3DetailData } from '../../../../model/res/get_deteils_T3_staff_res';

type FilterType = 'all' | 'approved' | 'rejected';
type TypeFilter  = 'all' | 'PreT3' | 'T3';
type CardStatus = 'approved' | 'rejected' | 'cancelled';

const CHECKLIST_LABELS: Record<string, string> = {
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

const AVATAR_COLORS = [
  '#1B3A6B', '#1C3560', '#1A5247', '#7A3A1A',
  '#1E3B6E', '#3A3E4A', '#2D4A1E', '#6B1A3A',
];

interface HistoryCard {
  id:             string;
  preT3Id:        number | null;
  t3Id:           number | null;
  itemType:       'T3' | 'PreT3';
  studentName:    string;
  studentId:      string;
  initials:       string;
  avatarColor:    string;
  articleTitle:   string;
  journalName:    string;
  issn:           string;
  database:       string;
  quartile:       string;
  isDiscontinued: boolean;
  status:         CardStatus;
  overallStatus:  string;
  actionDate:     string;
  updatedAt:      Date;
}

interface ApprovalRow {
  label:  string;
  status: string;
  date:   string;
  remark: string;
}

interface DetailView {
  requestId:       string;
  studentName:     string;
  studentId:       string;
  degreeLevel:     string;
  email:           string;
  journalName:     string;
  issn:            string;
  database:        string;
  quartile:        string;
  isDiscontinued:  boolean;
  isHijacked:      boolean;
  journalUrl:      string;
  checklistPassed: boolean;
  checklistItems:  { key: string; passed: boolean }[];
  approvals:       ApprovalRow[];
  cardStatus:      CardStatus;
  submittedDate:   string;
}

interface T3DetailView {
  requestId:        string;
  studentName:      string;
  studentId:        string;
  email:            string;
  degreeLevel:      string;
  journalName:      string;
  issn:             string;
  database:         string;
  citescore:        number;
  impactFactor:     number | null;
  scoreYear:        string;
  titleThai:        string;
  titleEn:          string;
  firstAuthor:      string;
  correspondingAuthor: string;
  innovationType:   string;
  pubStatus:        string;
  volume:           string;
  issue:            string;
  publishYear:      string;
  t3Id:             number;
  approvals:        ApprovalRow[];
  cardStatus:       CardStatus;
  submittedDate:    string;
}

@Component({
  selector: 'app-history',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './history.html',
  styleUrl: './history.scss',
})
export class History implements OnInit {
  private http      = inject(HttpClient);
  private auth      = inject(AuthService);
  private constants = inject(Constants);
  private route     = inject(ActivatedRoute);

  private readonly THAI_MONTHS = [
    'ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
    'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.',
  ];

  readonly evidenceFiles = [
    { key: 'acceptance_letter',  label: 'หนังสือตอบรับ',        icon: 'ti ti-file-text' },
    { key: 'full_paper',         label: 'บทความฉบับสมบูรณ์',    icon: 'ti ti-file-description' },
    { key: 'journal_cover',      label: 'ปกวารสาร',              icon: 'ti ti-news' },
    { key: 'table_of_contents',  label: 'สารบัญ',                icon: 'ti ti-list-details' },
    { key: 'database_evidence',  label: 'หลักฐานฐานข้อมูล',     icon: 'ti ti-search' },
    { key: 'peer_review_result', label: 'ผล Peer Review',        icon: 'ti ti-notes' },
  ];

  isLoading     = signal(true);
  activeFilter  = signal<FilterType>('all');
  typeFilter    = signal<TypeFilter>('all');
  allCards      = signal<HistoryCard[]>([]);

  // Pre-T3 modal
  selectedCard   = signal<HistoryCard | null>(null);
  detailLoading  = signal(false);
  selectedDetail = signal<DetailView | null>(null);
  cachedDetails: Record<string, DetailView> = {};

  // T3 modal
  selectedT3Card   = signal<HistoryCard | null>(null);
  t3DetailLoading  = signal(false);
  selectedT3Detail = signal<T3DetailView | null>(null);
  cachedT3Details: Record<string, T3DetailView> = {};
  fileLoading: Record<string, boolean> = {};
  fileViewing: Record<string, boolean> = {};

  filtered = computed(() => {
    const f    = this.activeFilter();
    const type = this.typeFilter();
    let all    = this.allCards();
    if (type !== 'all') all = all.filter(c => c.itemType === type);
    if (f === 'approved') return all.filter(c => c.status === 'approved');
    if (f === 'rejected')  return all.filter(c => c.status === 'rejected' || c.status === 'cancelled');
    return all;
  });

  get countAll():      number { return this.allCards().length; }
  get countApproved(): number { return this.allCards().filter(c => c.status === 'approved').length; }
  get countRejected(): number { return this.allCards().filter(c => c.status !== 'approved').length; }

  setFilter(f: FilterType):     void { this.activeFilter.set(f); }
  setTypeFilter(t: TypeFilter): void { this.typeFilter.set(t); }

  ngOnInit(): void {
    /* .tab-bar มี overflow-x:auto สำหรับจอมือถือ (3 แท็บรวมกันกว้างเกินจอแคบ) —
       พอกดมาแท็บนี้ (ขวาสุด) ต้องเลื่อนแท็บที่ active เข้ามาให้เห็นในจอเอง ไม่งั้น
       ผู้ใช้จะไม่เห็นว่าแท็บไหนกำลัง active อยู่เพราะมันตกขอบขวาไปแล้ว */
    setTimeout(() => {
      document.querySelector('.tab-item.tab-active')
        ?.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
    }, 0);

    const qp = this.route.snapshot.queryParamMap;
    const qpType   = qp.get('type')   as TypeFilter | null;
    const qpStatus = qp.get('status') as FilterType | null;
    if (qpType   && ['PreT3','T3'].includes(qpType))                           this.typeFilter.set(qpType);
    if (qpStatus && ['all','approved','rejected'].includes(qpStatus))           this.activeFilter.set(qpStatus);

    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    const preT3$  = this.http.get<PreT3HistorySatffRes>(`${this.constants.API_ENDPOINT}/pre-t3/history?page=1&limit=20`, { headers })
                        .pipe(catchError(() => of(null)));
    const t3$     = this.http.get<T3HistorySatffRes>(`${this.constants.API_ENDPOINT}/t3/history?page=1&limit=20`, { headers })
                        .pipe(catchError(() => of(null)));

    forkJoin([preT3$, t3$]).subscribe(([preT3Res, t3Res]) => {
      const preT3Cards = (preT3Res?.success ? preT3Res.data.items : []).map((d, i) => this.mapPreT3(d, i));
      const t3Cards    = (t3Res?.success    ? t3Res.data.items    : []).map((d, i) => this.mapT3(d, i));

      const merged = [...preT3Cards, ...t3Cards]
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

      this.allCards.set(merged);
      this.isLoading.set(false);
    });
  }

  openDetail(card: HistoryCard): void {
    if (card.itemType === 'PreT3') {
      this.openPreT3Detail(card);
    } else {
      this.openT3Detail(card);
    }
  }

  private openPreT3Detail(card: HistoryCard): void {
    if (!card.preT3Id) return;
    this.selectedCard.set(card);
    this.selectedDetail.set(null);
    document.body.style.overflow = 'hidden';

    const cacheKey = card.id;
    if (this.cachedDetails[cacheKey]) {
      this.selectedDetail.set(this.cachedDetails[cacheKey]);
      return;
    }

    this.detailLoading.set(true);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http.get<GetPreT3DeteilsStaffRes>(`${this.constants.API_ENDPOINT}/pre-t3/${card.preT3Id}`, { headers })
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        if (res?.success) {
          const detail = this.buildPreT3Detail(res.data, card);
          this.cachedDetails[cacheKey] = detail;
          this.selectedDetail.set(detail);
        }
        this.detailLoading.set(false);
      });
  }

  private openT3Detail(card: HistoryCard): void {
    if (!card.t3Id) return;
    this.selectedT3Card.set(card);
    this.selectedT3Detail.set(null);
    this.fileLoading = {};
    this.fileViewing = {};
    document.body.style.overflow = 'hidden';

    const cacheKey = card.id;
    if (this.cachedT3Details[cacheKey]) {
      this.selectedT3Detail.set(this.cachedT3Details[cacheKey]);
      return;
    }

    this.t3DetailLoading.set(true);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http.get<GetDeteilsT3StaffRes>(`${this.constants.API_ENDPOINT}/t3/${card.t3Id}`, { headers })
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        if (res?.success) {
          const detail = this.buildT3Detail(res.data, card);
          this.cachedT3Details[cacheKey] = detail;
          this.selectedT3Detail.set(detail);
        }
        this.t3DetailLoading.set(false);
      });
  }

  closeDetail(): void {
    this.selectedCard.set(null);
    this.selectedDetail.set(null);
    document.body.style.overflow = '';
  }

  closeT3Detail(): void {
    this.selectedT3Card.set(null);
    this.selectedT3Detail.set(null);
    this.fileLoading = {};
    this.fileViewing = {};
    document.body.style.overflow = '';
  }

  viewFile(t3Id: number, fileKey: string): void {
    this.fetchFile(t3Id, fileKey, this.fileViewing, blob => {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
  }

  downloadFile(t3Id: number, fileKey: string): void {
    this.fetchFile(t3Id, fileKey, this.fileLoading, blob => {
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = `${fileKey}_T3-${t3Id}`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

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

  private buildPreT3Detail(d: PreT3DetailData, card: HistoryCard): DetailView {
    const snap  = d.journal_snapshot;
    const snap2 = d.student_snapshot;

    const checklistItems = Object.entries(CHECKLIST_LABELS).map(([key, label]) => ({
      key:    label,
      passed: !!(d.checklist_data?.[key]),
    }));
    const checklistPassed = checklistItems.every(c => c.passed);

    const mapStatus = (s: string): string => {
      const l = s?.toLowerCase() ?? '';
      if (l.includes('approv')) return 'อนุมัติ';
      if (l.includes('reject')) return 'ไม่อนุมัติ';
      if (l === 'n/a')          return 'ไม่เกี่ยวข้อง';
      return 'รอดำเนินการ';
    };

    const approvals: ApprovalRow[] = [
      { label: 'อาจารย์ที่ปรึกษา',           status: mapStatus(d.advisor_approval?.status ?? ''),       date: this.fmt(d.advisor_approval?.approved_at),       remark: (d.advisor_approval?.remark as any) ?? '-' },
      { label: 'ประธานหลักสูตร',              status: mapStatus(d.program_chair_approval?.status ?? ''), date: this.fmt(d.program_chair_approval?.approved_at), remark: '-' },
      { label: 'ที่ประชุมบัณฑิตวิทยาลัย',    status: mapStatus(d.faculty_com_approval?.status ?? ''),   date: this.fmt(d.faculty_com_approval?.approved_at),   remark: (d.faculty_com_approval?.remark as any) ?? '-' },
    ].filter(a => a.status !== 'รอดำเนินการ' && a.status !== 'ไม่เกี่ยวข้อง');

    return {
      requestId: card.id, studentName: d.student_name,
      studentId: d.student_email.replace('@msu.ac.th', ''),
      degreeLevel: snap2?.degree_level ?? '-', email: d.student_email,
      journalName: snap.journal_name, issn: snap.issn, database: snap.indexed_database,
      quartile: snap.quartile_or_tier, isDiscontinued: snap.is_discontinued,
      isHijacked: snap.is_hijacked, journalUrl: snap.journal_url,
      checklistPassed, checklistItems, approvals,
      cardStatus: card.status, submittedDate: this.formatDate(d.created_at),
    };
  }

  private buildT3Detail(d: T3DetailData, card: HistoryCard): T3DetailView {
    const mapStatus = (s: string): string => {
      const l = s?.toLowerCase() ?? '';
      if (l.includes('approv')) return 'อนุมัติ';
      if (l.includes('reject')) return 'ไม่อนุมัติ';
      if (l === 'n/a')          return 'ไม่เกี่ยวข้อง';
      return 'รอดำเนินการ';
    };

    const approvals: ApprovalRow[] = [
      { label: 'อาจารย์ที่ปรึกษา', status: mapStatus(d.advisor_approval?.status ?? ''),     date: this.fmt(d.advisor_approval?.approved_at),     remark: (d.advisor_approval?.remark as any) ?? '-' },
      { label: 'ที่ประชุมคณะ',      status: mapStatus(d.faculty_com_approval?.status ?? ''), date: this.fmt(d.faculty_com_approval?.approved_at), remark: (d.faculty_com_approval?.remark as any) ?? '-' },
    ].filter(a => a.status !== 'รอดำเนินการ' && a.status !== 'ไม่เกี่ยวข้อง');

    const pub = d.publication_details;
    const paper = d.paper_and_research_details;
    const metrics = d.journal_metrics;

    return {
      requestId:   card.id,
      studentName: d.student_name,
      studentId:   d.student_email.replace('@msu.ac.th', ''),
      email:       d.student_email,
      degreeLevel: d.student_snapshot?.degree_level ?? '-',
      journalName: d.journal_snapshot.journal_name,
      issn:        d.issn || d.journal_snapshot.issn,
      database:    pub.specified_database,
      citescore:   metrics.citescore,
      impactFactor: metrics.has_impact_score ? metrics.impact_factor : null,
      scoreYear:   metrics.score_year,
      titleThai:   paper.title_thai,
      titleEn:     paper.title_english,
      firstAuthor: paper.first_author,
      correspondingAuthor: paper.corresponding_author,
      innovationType: paper.innovation_type,
      pubStatus:   pub.status,
      volume:      pub.volume,
      issue:       pub.issue,
      publishYear: pub.publish_year,
      t3Id:        d.t3_id,
      approvals,
      cardStatus:  card.status,
      submittedDate: this.formatDate(d.created_at),
    };
  }

  chipClass(card: HistoryCard): string {
    if (card.status === 'approved')  return 'status-chip chip-approved';
    if (card.status === 'cancelled') return 'status-chip chip-cancelled';
    return 'status-chip chip-rejected';
  }

  chipLabel(card: HistoryCard): string {
    if (card.status === 'approved')  return '✅ อนุมัติแล้ว';
    if (card.status === 'cancelled') return '🚫 ยกเลิกแล้ว';
    return '❌ ไม่อนุมัติ';
  }

  approvalChipClass(status: string): string {
    if (status === 'อนุมัติ')     return 'apv-chip apv-approved';
    if (status === 'ไม่อนุมัติ') return 'apv-chip apv-rejected';
    return 'apv-chip apv-pending';
  }

  private fmt(v: any): string {
    if (!v) return '-';
    const dt = new Date(v as string);
    return isNaN(dt.getTime()) ? '-' : `${dt.getDate()} ${this.THAI_MONTHS[dt.getMonth()]} ${(dt.getFullYear() + 543).toString().slice(-2)}`;
  }

  private mapPreT3(d: PreT3Item, index: number): HistoryCard {
    const parts    = d.student_name.trim().split(/\s+/);
    const initials = parts.slice(0, 2).map(p => [...p][0] ?? '').join('') || '??';
    const titleEn  = (d.article_info?.title_en as unknown as string | null);
    const titleTh  = (d.article_info?.title_th as unknown as string | null);

    return {
      id:            `PRE-T3-${d.pre_t3_id}`,
      preT3Id:       d.pre_t3_id,
      t3Id:          null,
      itemType:      'PreT3',
      studentName:   d.student_name,
      studentId:     d.student_email.replace('@msu.ac.th', ''),
      initials,
      avatarColor:   AVATAR_COLORS[index % AVATAR_COLORS.length],
      articleTitle:  titleEn || titleTh || '',
      journalName:   d.journal_snapshot.journal_name,
      issn:          d.journal_snapshot.issn,
      database:      d.journal_snapshot.indexed_database,
      quartile:      d.journal_snapshot.quartile_or_tier ?? '',
      isDiscontinued: d.journal_snapshot.is_discontinued,
      status:        this.mapStatus(d.overall_status),
      overallStatus: d.overall_status,
      actionDate:    this.resolvePreT3Date(d),
      updatedAt:     new Date(d.updated_at as unknown as string),
    };
  }

  private mapT3(d: T3Item, index: number): HistoryCard {
    const parts    = d.student_name.trim().split(/\s+/);
    const initials = parts.slice(0, 2).map(p => [...p][0] ?? '').join('') || '??';

    return {
      id:            `T3-${d.t3_id}`,
      preT3Id:       null,
      t3Id:          d.t3_id,
      itemType:      'T3',
      studentName:   d.student_name,
      studentId:     d.student_email.replace('@msu.ac.th', ''),
      initials,
      avatarColor:   AVATAR_COLORS[(index + 3) % AVATAR_COLORS.length],
      articleTitle:  d.paper_and_research_details.title_thai || d.paper_and_research_details.title_english,
      journalName:   d.journal_snapshot.journal_name,
      issn:          d.issn || d.journal_snapshot.issn,
      database:      d.publication_details.specified_database,
      quartile:      '',
      isDiscontinued: false,
      status:        this.mapStatus(d.overall_status),
      overallStatus: d.overall_status,
      actionDate:    this.formatDate(d.updated_at),
      updatedAt:     new Date(d.updated_at as unknown as string),
    };
  }

  private mapStatus(ov: string): CardStatus {
    if (ov === 'Approved')  return 'approved';
    if (ov === 'Cancelled') return 'cancelled';
    return 'rejected';
  }

  private resolvePreT3Date(d: PreT3Item): string {
    if (d.faculty_com_approval?.approved_at) return this.formatDate(d.faculty_com_approval.approved_at);
    if (d.advisor_approval?.approved_at)     return this.formatDate(d.advisor_approval.approved_at);
    return this.formatDate(d.updated_at);
  }

  private formatDate(date: Date | string | null): string {
    if (!date) return '-';
    const d = new Date(date as string);
    if (isNaN(d.getTime())) return '-';
    return `${d.getDate()} ${this.THAI_MONTHS[d.getMonth()]} ${(d.getFullYear() + 543).toString().slice(-2)}`;
  }
}
