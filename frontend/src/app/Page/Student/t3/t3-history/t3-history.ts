import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { catchError, finalize } from 'rxjs/operators';
import { of } from 'rxjs';

import { AuthService } from '../../../../auth.service';
import { Constants } from '../../../../comfig/constants';
import { GetT3Res, Datum } from '../../../../model/res/get_T3_res';
import { GetMyT3Res, Data as T3Detail } from '../../../../model/res/get_my_T3_res';
import { normalizePubStatus, pubTypeLabel } from '../../../../t3-labels';
import { apiFailure, failMsg } from '../../../../server-status.service';

type ApprovalStatus = 'Pending' | 'Approved' | 'Rejected';

interface T3Card {
  id:            string;
  t3Id:          number;
  titleThai:     string;
  titleEn:       string;
  issn:          string;
  database:      string;
  pubType:       string;
  pubStatus:     string;
  status:        'approved' | 'rejected' | 'cancelled';
  submittedDate:     string;
  submittedDateTime: string;
  advisorDateTime:   string;
  facultyDateTime:   string;
  advisorStatus:  ApprovalStatus;
  facultyStatus:  ApprovalStatus;
  overallStatus:  string;
}

interface Step {
  icon:   string;
  label:  string;
  sub:    string;
  date:   string;
  status: 'done' | 'active' | 'pending';
}

interface TimelineItem {
  icon:      string;
  actor:     string;
  badge:     string;
  badgeType: 'system' | 'advisor' | 'waiting';
  message:   string;
  detail?:   string;
  time?:     string;
}

interface T3DetailView {
  id:           string;
  t3Id:         number;
  titleThai:    string;
  titleEn:      string;
  journalName:  string;
  issn:         string;
  database:     string;
  pubType:      string;
  pubStatus:    string;
  volume:       string;
  issue:        string;
  publishYear:  string;
  firstAuthor:  string;
  degree:       string;
  submittedDate:      string;
  cardStatus:         'approved' | 'rejected' | 'cancelled';
  statusPillText:     string;
  currentStatusTitle: string;
  currentStatusDesc:  string;
  currentStatusIcon:  string;
  steps:    Step[];
  timeline: TimelineItem[];
}

@Component({
  selector: 'app-t3-history',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './t3-history.html',
  styleUrl: './t3-history.scss',
})
export class T3History implements OnInit {
  isLoading    = signal(true);
  isRefreshing = signal(false);
  cards: T3Card[] = [];

  selectedId    = signal<string | null>(null);
  detailLoading = signal(false);
  details: Record<string, T3DetailView> = {};

  private readonly THAI_MONTHS = [
    'ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
    'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.',
  ];

  constructor(
    private http:      HttpClient,
    private auth:      AuthService,
    private constants: Constants,
  ) {}

  ngOnInit(): void {
    this.loadData();
  }

  refresh(): void {
    if (this.isRefreshing()) return;
    this.isRefreshing.set(true);
    // F22: ล้าง cache รายละเอียด ไม่งั้นเปิด modal ซ้ำจะเห็นสถานะเก่า (เช่นอาจารย์อนุมัติไปแล้วแต่ยังขึ้นรอ)
    this.details = {};
    this.loadData(true);
  }

  // N3: โหลดไม่สำเร็จ ≠ ไม่มีรายการ — เดิม error ทุกแบบแสดงเป็นรายการว่าง
  loadError = signal('');

  private loadData(isRefresh = false): void {
    let failure: unknown = null;
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http.get<GetT3Res>(`${this.constants.API_ENDPOINT}/t3/my`, { headers })
      .pipe(
        catchError(err => { failure = err; return of(null); }),
        // finalize ทำงานเสมอ แม้ map ข้อมูลแล้ว throw — กัน spinner ค้าง
        finalize(() => {
          this.isLoading.set(false);
          if (isRefresh) this.isRefreshing.set(false);
        }),
      )
      .subscribe(res => {
        this.loadError.set(res?.success ? '' : failMsg(failure ? apiFailure(failure) : res, 'โหลดรายการไม่สำเร็จ กรุณาลองใหม่'));
        if (res?.success) {
          this.cards = res.data
            .map(d => this.mapToCard(d))
            .filter(c =>
              c.overallStatus === 'Approved'  ||
              c.overallStatus === 'Cancelled' ||
              c.overallStatus === 'Rejected'
            );
        }
      });
  }

  private mapToCard(d: Datum): T3Card {
    const adv  = d.advisor_approval.status as ApprovalStatus;
    const fac  = d.faculty_com_approval.status as ApprovalStatus;
    const ov   = d.overall_status;

    let status: 'approved' | 'rejected' | 'cancelled';
    if (ov === 'Approved')                                                      status = 'approved';
    else if (ov === 'Cancelled')                                                status = 'cancelled';
    else                                                                        status = 'rejected';

    return {
      id:            `T3-${d.t3_id}`,
      t3Id:          d.t3_id,
      titleThai:     d.paper_and_research_details.title_thai,
      titleEn:       d.paper_and_research_details.title_english,
      issn:          d.issn || d.journal_snapshot.issn,
      database:      d.publication_details.specified_database,
      pubType:       pubTypeLabel(d.publication_details.type),
      pubStatus:     normalizePubStatus(d.publication_details.status),
      status,
      submittedDate:     this.formatDateShort(d.created_at),
      submittedDateTime: this.formatDateCompact(d.created_at),
      advisorDateTime:   this.formatDateCompact(d.advisor_approval.approved_at),
      facultyDateTime:   this.formatDateCompact(d.faculty_com_approval.approved_at),
      advisorStatus: adv,
      facultyStatus: fac,
      overallStatus: ov,
    };
  }

  cardClass(card: T3Card): string {
    if (card.status === 'approved')   return 'req-card req-card--approved';
    if (card.status === 'cancelled')  return 'req-card req-card--cancelled';
    return 'req-card req-card--rejected';
  }

  statusLabel(card: T3Card): string {
    if (card.status === 'approved')   return 'อนุมัติแล้ว';
    if (card.status === 'cancelled')  return 'ยกเลิกแล้ว';
    return 'ไม่ผ่านการอนุมัติ';
  }

  statusChipClass(card: T3Card): string {
    if (card.status === 'approved')   return 'cs-chip cs-approved';
    if (card.status === 'cancelled')  return 'cs-chip cs-cancelled';
    return 'cs-chip cs-rejected';
  }

  actionDateLabel(card: T3Card): string {
    // v3: ที่ประชุมคณะคือขั้นสุดท้าย — วันที่อนุมัติ = วันที่ที่ประชุมมีมติ
    if (card.status === 'approved' && card.facultyDateTime) return `อนุมัติ ${card.facultyDateTime}`;
    if (card.status === 'rejected') {
      if (card.advisorStatus === 'Rejected' && card.advisorDateTime) return `ปฏิเสธ ${card.advisorDateTime}`;
      if (card.facultyStatus === 'Rejected' && card.facultyDateTime) return `ปฏิเสธ ${card.facultyDateTime}`;
    }
    return '';
  }

  // ── Detail Modal ─────────────────────────────────────
  get selectedDetail(): T3DetailView | null {
    const id = this.selectedId();
    return id ? (this.details[id] ?? null) : null;
  }

  openDetail(card: T3Card): void {
    this.selectedId.set(card.id);
    document.body.style.overflow = 'hidden';
    if (this.details[card.id]) return;

    this.detailLoading.set(true);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http.get<GetMyT3Res>(`${this.constants.API_ENDPOINT}/t3/${card.t3Id}`, { headers })
      .pipe(
        catchError(() => of(null)),
        finalize(() => this.detailLoading.set(false)),
      )
      .subscribe(res => {
        if (res?.success) {
          this.details[card.id] = this.buildDetail(res.data);
        }
      });
  }

  closeDetail(): void {
    this.selectedId.set(null);
    document.body.style.overflow = '';
  }

  printDetail(): void {
    document.body.classList.add('modal-print');
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('modal-print');
    }, { once: true });
    window.print();
  }

  private buildDetail(d: T3Detail): T3DetailView {
    const ov   = d.overall_status;

    let cardStatus: 'approved' | 'rejected' | 'cancelled';
    if (ov === 'Approved')   cardStatus = 'approved';
    else if (ov === 'Cancelled') cardStatus = 'cancelled';
    else                     cardStatus = 'rejected';

    const statusPillText    = cardStatus === 'approved'  ? 'อนุมัติสำเร็จ'
                            : cardStatus === 'cancelled' ? 'ยกเลิกแล้ว'
                            :                             'ไม่ผ่านการอนุมัติ';
    const currentStatusIcon = cardStatus === 'approved'  ? 'ti ti-circle-check'
                            : cardStatus === 'cancelled' ? 'ti ti-ban' : 'ti ti-circle-x';
    const { title, desc }   = this.buildCurrentStatusText(d);

    return {
      id:            `T3-${d.t3_id}`,
      t3Id:          d.t3_id,
      titleThai:     d.paper_and_research_details.title_thai,
      titleEn:       d.paper_and_research_details.title_english,
      journalName:   d.journal_snapshot.journal_name,
      issn:          d.issn || d.journal_snapshot.issn,
      database:      d.publication_details.specified_database,
      pubType:       pubTypeLabel(d.publication_details.type),
      pubStatus:     normalizePubStatus(d.publication_details.status),
      volume:        d.publication_details.volume,
      issue:         d.publication_details.issue,
      publishYear:   d.publication_details.publish_year,
      firstAuthor:   d.paper_and_research_details.first_author,
      degree:        `${d.student_snapshot.degree_level} ${d.student_snapshot.study_plan_code}`.trim(),
      submittedDate: this.formatDateShort(d.created_at),
      cardStatus,
      statusPillText,
      currentStatusTitle: title,
      currentStatusDesc:  desc,
      currentStatusIcon,
      steps:    this.buildSteps(d),
      timeline: this.buildTimeline(d),
    };
  }

  private buildCurrentStatusText(d: T3Detail): { title: string; desc: string } {
    const adv  = d.advisor_approval.status;
    const fac  = d.faculty_com_approval.status;
    const ov   = d.overall_status;

    if (ov === 'Approved')   return { title: 'อนุมัติสำเร็จ', desc: 'คำร้อง T3 ได้รับการอนุมัติเรียบร้อยแล้ว' };
    if (ov === 'Cancelled')  return { title: 'ยกเลิกคำร้องแล้ว', desc: 'นิสิตได้ยกเลิกคำร้อง T3 นี้ด้วยตนเอง' };
    if (adv === 'Rejected')  return { title: 'ไม่ผ่านการอนุมัติจากอาจารย์ที่ปรึกษา', desc: (d.advisor_approval.remark as unknown as string | null) ?? 'กรุณาติดต่ออาจารย์ที่ปรึกษา' };
    if (fac === 'Rejected')  return { title: 'ไม่ผ่านการอนุมัติจากที่ประชุม', desc: (d.faculty_com_approval.remark as unknown as string | null) ?? 'กรุณาติดต่อบัณฑิตวิทยาลัย' };
    return { title: 'ดำเนินการเสร็จสิ้น', desc: 'คำร้องได้รับการดำเนินการแล้ว' };
  }

  private buildSteps(d: T3Detail): Step[] {
    const adv  = d.advisor_approval.status;
    const fac  = d.faculty_com_approval.status;
    const date = this.formatDateShort(d.created_at);
    const advisorDate = d.advisor_approval.approved_at
      ? this.formatDateShort(d.advisor_approval.approved_at) : '-';
    const facultyDate = d.faculty_com_approval.approved_at
      ? this.formatDateShort(d.faculty_com_approval.approved_at) : '-';

    // 3 ขั้น: ยื่น → อาจารย์ที่ปรึกษา → เจ้าหน้าที่ — ผลของเจ้าหน้าที่คือผลที่ประชุม และคำร้องอนุมัติสำเร็จทันที
    // เดิมมีขั้นที่ 4 "อนุมัติสำเร็จ" แยก ซึ่งซ้ำกับขั้นเจ้าหน้าที่ (วันเดียวกัน สถานะเดียวกัน) จึงเอาออก
    const s1: Step = { icon: 'ti ti-check', label: 'ยื่น T3 สำเร็จ', sub: '● เสร็จแล้ว', date, status: 'done' };

    const s2: Step = adv === 'Approved' ? { icon: 'ti ti-check', label: 'อาจารย์ที่ปรึกษาพิจารณา', sub: '● เสร็จแล้ว',  date: advisorDate, status: 'done'   }
                   : adv === 'Rejected' ? { icon: 'ti ti-x', label: 'อาจารย์ที่ปรึกษาพิจารณา', sub: '● ไม่อนุมัติ', date: advisorDate, status: 'active' }
                   :                     { icon: 'ti ti-hourglass', label: 'อาจารย์ที่ปรึกษาพิจารณา', sub: '● ดำเนินการ',  date: '-',         status: 'active' };

    // รอผลจากที่ประชุม — ต้องเช็คว่าอาจารย์อนุมัติแล้วหรือยังด้วย ไม่งั้นแม้อาจารย์
    // อนุมัติแล้วก็จะยังค้างแสดงเป็น pending/รอขั้นก่อนหน้า ทั้งที่คำร้องเดินมาถึง
    // ขั้นนี้แล้ว (บั๊กแพทเทิร์นเดียวกับที่แก้ไปใน status-t3.ts/pre-t3-status.ts)
    const s3: Step = fac === 'Approved' ? { icon: 'ti ti-check', label: 'เจ้าหน้าที่พิจารณา', sub: '● เสร็จแล้ว',      date: facultyDate, status: 'done'    }
                   : fac === 'Rejected' ? { icon: 'ti ti-x', label: 'เจ้าหน้าที่พิจารณา', sub: '● ไม่อนุมัติ',     date: facultyDate, status: 'active'  }
                   : adv === 'Approved' ? { icon: 'ti ti-hourglass', label: 'เจ้าหน้าที่พิจารณา', sub: '● กำลังดำเนินการ', date: '-', status: 'active' }
                   :                     { icon: 'ti ti-building-bank', label: 'เจ้าหน้าที่พิจารณา', sub: '○ รอขั้นก่อนหน้า', date: '-',         status: 'pending' };

    return [s1, s2, s3];
  }

  private buildTimeline(d: T3Detail): TimelineItem[] {
    const items: TimelineItem[] = [];
    const adv  = d.advisor_approval.status;
    const fac  = d.faculty_com_approval.status;
    const ov   = d.overall_status;

    items.push({
      icon: 'ti ti-settings', actor: 'ระบบ Journal Watch', badge: 'ระบบ', badgeType: 'system',
      message: `ยื่นคำร้อง T3-${d.t3_id} สำเร็จ บทความ: ${d.paper_and_research_details.title_thai}`,
      time: this.formatDateFull(d.created_at),
    });

    if (adv === 'Approved') {
      items.push({ icon: 'ti ti-chalkboard', actor: 'อาจารย์ที่ปรึกษา', badge: 'อาจารย์', badgeType: 'advisor', message: 'อนุมัติคำร้อง T3 แล้ว', detail: (d.advisor_approval.remark as unknown as string | null) || undefined, time: d.advisor_approval.approved_at ? this.formatDateFull(d.advisor_approval.approved_at) : undefined });
    } else if (adv === 'Rejected') {
      items.push({ icon: 'ti ti-chalkboard', actor: 'อาจารย์ที่ปรึกษา', badge: 'อาจารย์', badgeType: 'advisor', message: 'ไม่อนุมัติคำร้อง T3', detail: (d.advisor_approval.remark as unknown as string | null) ?? undefined, time: d.advisor_approval.approved_at ? this.formatDateFull(d.advisor_approval.approved_at) : undefined });
    }

    if (adv === 'Approved') {
      if (fac === 'Approved') {
        items.push({ icon: 'ti ti-building-bank', actor: 'ที่ประชุมบัณฑิตวิทยาลัย', badge: 'อนุมัติ', badgeType: 'advisor', message: 'อนุมัติคำร้อง T3 แล้ว', detail: (d.faculty_com_approval.remark as unknown as string | null) || undefined, time: d.faculty_com_approval.approved_at ? this.formatDateFull(d.faculty_com_approval.approved_at) : undefined });
      } else if (fac === 'Rejected') {
        items.push({ icon: 'ti ti-building-bank', actor: 'ที่ประชุมบัณฑิตวิทยาลัย', badge: 'ไม่อนุมัติ', badgeType: 'advisor', message: 'ไม่อนุมัติคำร้อง T3', detail: (d.faculty_com_approval.remark as unknown as string | null) ?? undefined, time: d.faculty_com_approval.approved_at ? this.formatDateFull(d.faculty_com_approval.approved_at) : undefined });
      }
    }

    if (ov === 'Cancelled') {
      items.push({ icon: 'ti ti-ban', actor: 'นิสิต', badge: 'ยกเลิก', badgeType: 'waiting', message: 'ยกเลิกคำร้อง T3 ด้วยตนเอง',
                   // API ไม่มี cancelled_at — คำร้องที่ยกเลิกแล้วไม่ถูกแก้อีก updated_at จึงเป็นเวลาที่ยกเลิก
                   time: d.updated_at ? this.formatDateFull(d.updated_at) : undefined });
    }

    return items;
  }

  private formatDateCompact(date: Date | string | null | undefined): string {
    if (!date) return '';
    const d = new Date(date as string);
    if (isNaN(d.getTime())) return '';
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${d.getDate()} ${this.THAI_MONTHS[d.getMonth()]} ${h}:${m}`;
  }

  private formatDateShort(date: Date | string | null): string {
    if (!date) return '-';
    const d = new Date(date as string);
    if (isNaN(d.getTime())) return '-';
    return `${d.getDate()} ${this.THAI_MONTHS[d.getMonth()]} ${(d.getFullYear() + 543).toString().slice(-2)}`;
  }

  private formatDateFull(date: Date | string | null): string {
    if (!date) return '-';
    const d = new Date(date as string);
    if (isNaN(d.getTime())) return '-';
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${d.getDate()} ${this.THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543} - ${h}:${m}`;
  }
}
