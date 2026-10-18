import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { AuthService } from '../../../../auth.service';
import { Constants } from '../../../../comfig/constants';
import { GetMyPreT3Res, Datum } from '../../../../model/res/get_my_Pre-T3_res';
import { GetProfileRes, Data as ProfileData } from '../../../../model/res/get_profile_res';
import { apiFailure, failMsg } from '../../../../server-status.service';

type ApprovalStatus = 'Pending' | 'Approved' | 'Rejected';

interface PreT3Card {
  id:               string;
  journalName:      string;
  issn:             string;
  database:         string;
  quartile:         string;
  journalStatus:    string;
  overallStatus:    string;
  advisorStatus:    ApprovalStatus;
  facultyStatus:    ApprovalStatus;
  meetingScheduled: boolean;
  status:           'pending' | 'approved' | 'rejected';
  submittedDate:    string;
  daysAgo:          number;
  submittedDateTime:  string;
  advisorDateTime:    string | null;
  facultyDateTime:    string | null;
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

interface PreT3Detail {
  id:                 string;
  studentName:        string;
  studentId:          string;
  journalName:        string;
  issn:               string;
  quartile:           string;
  scopusStatus:       string;
  database:           string;
  degree:             string;
  advisor:            string;
  submittedDate:      string;
  overallStatus:      string;
  advisorStatus:      ApprovalStatus;
  cardStatus:         'approved' | 'rejected' | 'pending';
  statusPillText:     string;
  currentStatusTitle: string;
  currentStatusDesc:  string;
  currentStatusIcon:  string;
  steps:    Step[];
  timeline: TimelineItem[];
}

@Component({
  selector: 'app-pre-t3-status',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './pre-t3-status.html',
  styleUrl: './pre-t3-status.scss',
})
export class PreT3Status implements OnInit {
  selectedId   = signal<string | null>(null);
  isLoading    = signal(true);
  isRefreshing = signal(false);

  cards = signal<PreT3Card[]>([]);
  details: Record<string, PreT3Detail> = {};

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
    window.scrollTo(0, 0);
    this.loadData();
    // tab-bar เลื่อนแนวนอนได้บนจอแคบ (overflow-x:auto) แต่ scrollLeft เริ่มที่ 0 เสมอ
    // ถ้าแท็บที่ active อยู่ไม่ใช่ตัวแรกจะโดนซ่อนพ้นขอบจอ ต้องเลื่อนให้เข้ามาอยู่ใน
    // มุมมองเองตั้งแต่โหลดหน้า โดยไม่ใช้ animation
    setTimeout(() => {
      document.querySelector('.tab-item.tab-active')
        ?.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
    }, 0);
  }

  refresh(): void {
    this.loadData(true);
  }

  // F24: โหลดรายการล้มเหลว ≠ ไม่มีรายการ — เดิม error ทุกแบบแสดงเป็น "ยังไม่มีคำร้อง"
  loadError = signal('');

  private loadData(isRefresh = false): void {
    if (isRefresh) {
      this.isRefreshing.set(true);
    } else {
      this.isLoading.set(true);
    }

    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });

    let failure: unknown = null;
    forkJoin({
      myList:  this.http.get<GetMyPreT3Res>(`${this.constants.API_ENDPOINT}/pre-t3/my`, { headers })
                        .pipe(catchError(err => { failure = err; return of(null); })),
      profile: this.http.get<GetProfileRes>(`${this.constants.API_ENDPOINT}/user/profile`, { headers })
                        .pipe(catchError(() => of(null))),
    }).subscribe(({ myList, profile }) => {
      const prof = profile?.success ? profile.data : null;
      if (myList?.success) {
        this.buildData(myList.data, prof);
        this.loadError.set('');
      } else {
        this.loadError.set(failMsg(failure ? apiFailure(failure) : myList, 'โหลดรายการคำร้องไม่สำเร็จ กรุณาลองใหม่'));
      }
      this.isLoading.set(false);
      this.isRefreshing.set(false);
    });
  }

  // ─────────────────────────────────────────────────────────────
  private buildData(data: Datum[], prof: ProfileData | null): void {
    const advisorName = this.getAdvisorName(prof);
    const studentName = prof ? `${prof.prefix ?? ''}${prof.firstName} ${prof.lastName}`.trim() : '-';
    const studentId   = prof ? prof.msuMail.replace('@msu.ac.th', '') : '-';
    const degree      = prof ? `${prof.degreeLevel} ${prof.studyPlanCode}`.trim() : '-';

    this.cards.set(data.map(d => this.mapToCard(d)).filter(c => c.status === 'pending'));

    const rec: Record<string, PreT3Detail> = {};
    data.forEach(d => {
      rec[`PRE-T3-${d.pre_t3_id}`] = this.mapToDetail(d, { studentName, studentId, degree, advisorName });
    });
    this.details = rec;
  }

  private getAdvisorName(prof: ProfileData | null): string {
    if (!prof?.advisors?.length) return '-';
    const a = prof.advisors.find(x => x.advisorType === 'Major') ?? prof.advisors[0];
    return `${a.prefix ?? ''}${a.firstName} ${a.lastName}`.trim();
  }

  cardClass(card: PreT3Card): string {
    const base = 'req-card';
    if (card.advisorStatus === 'Rejected' || card.facultyStatus === 'Rejected') return `${base} req-card--rejected`;
    if (card.overallStatus === 'Approved') return `${base} req-card--approved`;
    const db = card.database?.toLowerCase() ?? '';
    if (db.includes('tci'))    return `${base} req-card--tci`;
    if (db.includes('scopus')) return `${base} req-card--scopus`;
    return base;
  }

  // ── Card mapping ──────────────────────────────────────────────
  private mapToCard(d: Datum): PreT3Card {
    const advisorStatus    = d.advisor_approval.status as ApprovalStatus;
    const facultyStatus    = d.faculty_com_approval.status as ApprovalStatus;
    const overallStatus    = d.overall_status;
    const meetingScheduled = d.faculty_com_approval.meeting_no !== null;

    let status: 'pending' | 'approved' | 'rejected';
    if (overallStatus === 'Approved')                                                              status = 'approved';
    else if (overallStatus === 'Cancelled' || advisorStatus === 'Rejected' || facultyStatus === 'Rejected') status = 'rejected';
    else                                                                                           status = 'pending';

    const created = new Date(d.created_at as unknown as string);
    const daysAgo = Math.floor((Date.now() - created.getTime()) / 86_400_000);

    return {
      id:               `PRE-T3-${d.pre_t3_id}`,
      journalName:      d.journal_snapshot.journal_name,
      issn:             d.journal_snapshot.issn,
      database:         d.journal_snapshot.indexed_database,
      quartile:         d.journal_snapshot.quartile_or_tier,
      journalStatus:    d.journal_snapshot.is_discontinued ? 'Discontinued' : 'Active',
      overallStatus,
      advisorStatus,
      facultyStatus,
      meetingScheduled,
      status,
      submittedDate:    this.formatDateShort(d.created_at),
      daysAgo,
      submittedDateTime:  this.formatDateCompact(d.created_at),
      advisorDateTime:    advisorStatus === 'Approved' && d.advisor_approval.approved_at
                            ? this.formatDateCompact(d.advisor_approval.approved_at) : null,
      facultyDateTime:    facultyStatus === 'Approved' && d.faculty_com_approval.approved_at
                            ? this.formatDateCompact(d.faculty_com_approval.approved_at) : null,
    };
  }

  // ── Detail mapping ────────────────────────────────────────────
  private mapToDetail(
    d: Datum,
    info: { studentName: string; studentId: string; degree: string; advisorName: string },
  ): PreT3Detail {
    const advisorStatus = d.advisor_approval.status as ApprovalStatus;
    const facultyStatus = d.faculty_com_approval.status as ApprovalStatus;
    const overallStatus = d.overall_status;

    let cardStatus: 'approved' | 'rejected' | 'pending';
    if (overallStatus === 'Approved')                                        cardStatus = 'approved';
    else if (advisorStatus === 'Rejected' || facultyStatus === 'Rejected')   cardStatus = 'rejected';
    else                                                                     cardStatus = 'pending';

    let statusPillText: string;
    if (cardStatus === 'approved') statusPillText = 'อนุมัติสำเร็จ';
    else if (cardStatus === 'rejected') statusPillText = 'ไม่ผ่านการอนุมัติ';
    else statusPillText = 'กำลังดำเนินการ';

    const currentStatusIcon = cardStatus === 'approved' ? 'ti ti-circle-check' : cardStatus === 'rejected' ? 'ti ti-circle-x' : 'ti ti-hourglass';

    const { title, desc } = this.buildCurrentStatus(d, info.advisorName);

    return {
      id:                 `PRE-T3-${d.pre_t3_id}`,
      studentName:        info.studentName,
      studentId:          info.studentId,
      journalName:        d.journal_snapshot.journal_name,
      issn:               d.journal_snapshot.issn,
      quartile:           d.journal_snapshot.quartile_or_tier,
      scopusStatus:       d.journal_snapshot.is_discontinued ? 'Discontinued' : 'Active',
      database:           d.journal_snapshot.indexed_database,
      degree:             info.degree,
      advisor:            info.advisorName,
      submittedDate:      this.formatDateShort(d.created_at),
      overallStatus,
      advisorStatus,
      cardStatus,
      statusPillText,
      currentStatusTitle:  title,
      currentStatusDesc:   desc,
      currentStatusIcon,
      steps:    this.buildSteps(d),
      timeline: this.buildTimeline(d, info.advisorName),
    };
  }

  // ── Current status text ───────────────────────────────────────
  private buildCurrentStatus(d: Datum, advisorName: string): { title: string; desc: string } {
    const adv  = d.advisor_approval.status;
    const fac  = d.faculty_com_approval.status;
    const over = d.overall_status;
    const meet = d.faculty_com_approval.meeting_no !== null;

    if (over === 'Approved') {
      return { title: 'อนุมัติสำเร็จ', desc: 'คำร้อง Pre-T3 ได้รับการอนุมัติเรียบร้อยแล้ว สามารถยื่น T3 ได้' };
    }
    if (adv === 'Rejected') {
      return {
        title: 'ไม่ผ่านการอนุมัติจากอาจารย์ที่ปรึกษา',
        desc:  (d.advisor_approval.remark as unknown as string | null) ?? 'กรุณาติดต่ออาจารย์ที่ปรึกษา',
      };
    }
    if (fac === 'Rejected') {
      return {
        title: 'ไม่ผ่านการอนุมัติจากคณะกรรมการ',
        desc:  (d.faculty_com_approval.remark as unknown as string | null) ?? 'กรุณาติดต่อบัณฑิตวิทยาลัย',
      };
    }
    if (adv === 'Pending') {
      return {
        title: 'อาจารย์ที่ปรึกษากำลังพิจารณา',
        desc:  `${advisorName} รับแจ้งเตือนแล้วและกำลังตรวจสอบคำร้อง · คาดว่าจะมีผลภายใน 1-2 วันทำการ`,
      };
    }
    // advisor approved
    if (fac === 'Pending') {
      if (meet) {
        return { title: 'รอผลจากที่ประชุมบัณฑิตวิทยาลัย', desc: 'คำร้องถูกบรรจุในวาระการประชุมแล้ว รอผลการพิจารณาจากที่ประชุม' };
      }
      return {
        title: 'รอเจ้าหน้าที่บัณฑิตวิทยาลัยพิจารณา',
        desc:  'อาจารย์ที่ปรึกษาเห็นชอบแล้ว · เจ้าหน้าที่บัณฑิตวิทยาลัยได้รับแจ้งเตือนและกำลังตรวจสอบ',
      };
    }
    return { title: 'กำลังดำเนินการ', desc: 'คำร้องอยู่ระหว่างการพิจารณา' };
  }

  // ── Stepper ───────────────────────────────────────────────────
  private buildSteps(d: Datum): Step[] {
    const adv  = d.advisor_approval.status;
    const fac  = d.faculty_com_approval.status;

    const createdDate  = this.formatDateShort(d.created_at);
    const advisorDate  = d.advisor_approval.approved_at
      ? this.formatDateShort(d.advisor_approval.approved_at) : '-';
    // วันที่เจ้าหน้าที่บันทึกผล (ผลเดียวกับที่ประชุม)
    const facultyDate = d.faculty_com_approval.approved_at
      ? this.formatDateShort(d.faculty_com_approval.approved_at) : '-';

    // 3 ขั้น: ยื่น → อาจารย์ที่ปรึกษา → เจ้าหน้าที่ — ผลของเจ้าหน้าที่คือผลที่ประชุม และคำร้องอนุมัติสำเร็จทันที
    // เดิมมีขั้นที่ 4 "อนุมัติสำเร็จ" แยก ซึ่งซ้ำกับขั้นเจ้าหน้าที่ (วันเดียวกัน สถานะเดียวกัน) จึงเอาออก
    const s1: Step = { icon: 'ti ti-check', label: 'ยื่นคำร้องสำเร็จ', sub: '● เสร็จแล้ว', date: createdDate, status: 'done' };

    // Step 2 — advisor
    let s2: Step;
    if (adv === 'Approved')       s2 = { icon: 'ti ti-check',  label: 'อาจารย์ที่ปรึกษาพิจารณา', sub: '● เสร็จแล้ว',       date: advisorDate, status: 'done'   };
    else if (adv === 'Rejected')  s2 = { icon: 'ti ti-x',  label: 'อาจารย์ที่ปรึกษาพิจารณา', sub: '● ไม่อนุมัติ',      date: advisorDate, status: 'active' };
    else                          s2 = { icon: 'ti ti-hourglass', label: 'อาจารย์ที่ปรึกษาพิจารณา', sub: '● กำลังดำเนินการ', date: '-',          status: 'active' };

    // Step 3 — เจ้าหน้าที่ (ผลที่ประชุม)
    let s4: Step;
    if (fac === 'Approved')
      s4 = { icon: 'ti ti-check',  label: 'เจ้าหน้าที่พิจารณา', sub: '● เสร็จแล้ว',       date: facultyDate, status: 'done'   };
    else if (fac === 'Rejected')
      s4 = { icon: 'ti ti-x', label: 'เจ้าหน้าที่พิจารณา', sub: '● ไม่อนุมัติ', date: facultyDate, status: 'active' };
    else if (adv === 'Approved')
      s4 = { icon: 'ti ti-hourglass', label: 'เจ้าหน้าที่พิจารณา', sub: '● กำลังดำเนินการ', date: '-', status: 'active' };
    else
      s4 = { icon: 'ti ti-building-bank', label: 'เจ้าหน้าที่พิจารณา', sub: '○ รอขั้นก่อนหน้า',  date: '-', status: 'pending' };

    return [s1, s2, s4];
  }

  // ── Timeline ──────────────────────────────────────────────────
  private buildTimeline(d: Datum, advisorName: string): TimelineItem[] {
    const items: TimelineItem[] = [];
    const adv  = d.advisor_approval.status;
    const fac  = d.faculty_com_approval.status;
    const meet = d.faculty_com_approval.meeting_no !== null;

    // 1. System
    items.push({
      icon: 'ti ti-settings', actor: 'ระบบ Journal Watch', badge: 'ระบบ', badgeType: 'system',
      message: `ยื่นคำร้อง PRE-T3-${d.pre_t3_id} สำเร็จ วารสาร ${d.journal_snapshot.journal_name} ${d.journal_snapshot.quartile_or_tier} ผ่านเกณฑ์ทุกข้อ ส่งแจ้งเตือนอาจารย์ที่ปรึกษาแล้ว`,
      time: this.formatDateFull(d.created_at),
    });

    // 2. Advisor
    if (adv === 'Approved') {
      items.push({
        icon: 'ti ti-chalkboard', actor: advisorName, badge: 'อาจารย์', badgeType: 'advisor',
        message: 'อนุมัติคำร้อง Pre-T3 แล้ว',
        detail: (d.advisor_approval.remark as unknown as string | null) || undefined,
        time: d.advisor_approval.approved_at ? this.formatDateFull(d.advisor_approval.approved_at) : undefined,
      });
    } else if (adv === 'Rejected') {
      items.push({
        icon: 'ti ti-chalkboard', actor: advisorName, badge: 'อาจารย์', badgeType: 'advisor',
        message: 'ไม่อนุมัติคำร้อง Pre-T3',
        detail: (d.advisor_approval.remark as unknown as string | null) ?? undefined,
        time: d.advisor_approval.approved_at ? this.formatDateFull(d.advisor_approval.approved_at) : undefined,
      });
    } else {
      items.push({
        icon: 'ti ti-chalkboard', actor: advisorName, badge: 'อาจารย์', badgeType: 'advisor',
        message: 'กำลังพิจารณาคำร้อง Pre-T3 · รับแจ้งเตือนทาง MSU Mail แล้ว',
      });
    }

    // 3. Meeting
    // ผลตัดสินแล้ว (อนุมัติ/ไม่อนุมัติ) — แสดงเวลาที่บันทึกผล · เดิมไม่มี time และกรณีไม่อนุมัติขึ้น "กำลังพิจารณา" ผิด
    // เช็คจาก status ก่อน meeting_no — ผลออกแล้วแต่ไม่มีเลขที่ประชุม เดิมตกไป "รอขั้นก่อนหน้า"
    if (fac === 'Approved' || fac === 'Rejected') {
      items.push({
        icon: 'ti ti-building-bank', actor: 'ที่ประชุมบัณฑิตวิทยาลัย',
        badge: fac === 'Approved' ? 'อนุมัติ' : 'ไม่อนุมัติ', badgeType: 'advisor',
        message: fac === 'Approved' ? 'อนุมัติคำร้อง Pre-T3 แล้ว' : 'ไม่อนุมัติคำร้อง Pre-T3',
        detail: (d.faculty_com_approval.remark as unknown as string | null) || undefined,
        time: d.faculty_com_approval.approved_at ? this.formatDateFull(d.faculty_com_approval.approved_at) : undefined,
      });
    } else if (meet) {
      items.push({
        icon: 'ti ti-building-bank', actor: 'ที่ประชุมบัณฑิตวิทยาลัย', badge: 'กำลังพิจารณา', badgeType: 'waiting',
        message: 'กำลังพิจารณาในที่ประชุม',
      });
    } else {
      items.push({
        icon: 'ti ti-building-bank', actor: 'ที่ประชุมบัณฑิตวิทยาลัย', badge: 'รออยู่', badgeType: 'waiting',
        message: 'รอขั้นก่อนหน้า',
        detail: 'รอดำเนินการ\nขั้นตอนนี้ยังไม่ดำเนินการ — รอขั้นก่อนหน้าก่อน',
      });
    }

    return items;
  }

  // ── Date helpers ──────────────────────────────────────────────
  private formatDateShort(date: Date | string | null): string {
    if (!date) return '-';
    const d = new Date(date as string);
    if (isNaN(d.getTime())) return '-';
    return `${d.getDate()} ${this.THAI_MONTHS[d.getMonth()]} ${(d.getFullYear() + 543).toString().slice(-2)}`;
  }

  private formatDateCompact(date: Date | string | null): string {
    if (!date) return '-';
    const d = new Date(date as string);
    if (isNaN(d.getTime())) return '-';
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${d.getDate()} ${this.THAI_MONTHS[d.getMonth()]} ${h}:${m}`;
  }

  private formatDateFull(date: Date | string | null): string {
    if (!date) return '-';
    const d = new Date(date as string);
    if (isNaN(d.getTime())) return '-';
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${d.getDate()} ${this.THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543} - ${h}:${m}`;
  }

  // ── Modal helpers ─────────────────────────────────────────────
  get selectedDetail(): PreT3Detail | null {
    const id = this.selectedId();
    return id ? (this.details[id] ?? null) : null;
  }

  cancelledLabel = signal('');

  cancelFailed   = signal(false);
  private _toastTimer: ReturnType<typeof setTimeout> | null = null;

  cancelTarget = signal<{ id: string } | null>(null);

  /** F5: เดิมกดครั้งเดียวยกเลิกทันที — ตอนนี้ถามยืนยันก่อน */
  cancelRequest(id: string, event: MouseEvent): void {
    event.stopPropagation();
    this.cancelTarget.set({ id });
  }

  confirmCancel(): void {
    const t = this.cancelTarget();
    if (!t) return;
    this.cancelTarget.set(null);
    this.doCancel(t.id);
  }

  private doCancel(id: string): void {

    // optimistic: ลบออกทันที
    const removed = this.cards().find(c => c.id === id);
    this.cards.set(this.cards().filter(c => c.id !== id));

    const numericId = id.replace('PRE-T3-', '');
    const headers   = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http.patch(`${this.constants.API_ENDPOINT}/pre-t3/${numericId}/cancel`, {}, { headers })
      .subscribe({
        next: () => {
          // แสดง toast
          if (this._toastTimer) clearTimeout(this._toastTimer);
          this.cancelFailed.set(false);
          this.cancelledLabel.set(`ยกเลิก ${id} เรียบร้อยแล้ว`);
          this._toastTimer = setTimeout(() => this.cancelledLabel.set(''), 4000);
        },
        error: (err) => {
          // restore card กลับ + บอกเหตุผล (เช่น T3_ACTIVE: ต้องยกเลิก T3 ก่อน) แทนการเงียบ
          if (removed) this.cards.set([removed, ...this.cards()]);
          if (this._toastTimer) clearTimeout(this._toastTimer);
          this.cancelFailed.set(true);
          this.cancelledLabel.set(`ยกเลิก ${id} ไม่สำเร็จ: ${failMsg(apiFailure(err))}`);
          this._toastTimer = setTimeout(() => this.cancelledLabel.set(''), 6000);
        },
      });
  }

  openDetail(id: string): void {
    this.selectedId.set(id);
    document.body.style.overflow = 'hidden';
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
}
