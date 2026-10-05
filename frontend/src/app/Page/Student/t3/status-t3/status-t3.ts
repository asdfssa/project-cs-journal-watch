import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';

import { AuthService } from '../../../../auth.service';
import { Constants } from '../../../../comfig/constants';
import { GetT3Res, Datum } from '../../../../model/res/get_T3_res';
import { GetMyT3Res, Data as T3Detail } from '../../../../model/res/get_my_T3_res';

type ApprovalStatus = 'Pending' | 'Approved' | 'Rejected';

interface T3Card {
  id:         string;
  t3Id:       number;
  titleThai:  string;
  titleEn:    string;
  issn:       string;
  database:   string;
  pubType:    string;
  pubStatus:  string;
  status:     'pending' | 'approved' | 'rejected';
  submittedDate:     string;
  submittedDateTime: string;
  advisorDateTime:   string;
  facultyDateTime:   string;
  gradDateTime:      string;
  daysAgo:    number;
  advisorStatus:    ApprovalStatus;
  facultyStatus:    ApprovalStatus;
  gradStatus:       ApprovalStatus;
  overallStatus:    string;
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
  submittedDate: string;
  advisorStatus: ApprovalStatus;
  cardStatus:   'approved' | 'rejected' | 'pending';
  statusPillText:     string;
  currentStatusTitle: string;
  currentStatusDesc:  string;
  currentStatusIcon:  string;
  steps:     Step[];
  timeline:  TimelineItem[];
}

@Component({
  selector: 'app-status-t3',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './status-t3.html',
  styleUrl: './status-t3.scss',
})
export class StatusT3 implements OnInit {
  isLoading    = signal(true);
  isRefreshing = signal(false);
  cards: T3Card[] = [];

  selectedId    = signal<string | null>(null);
  detailLoading = signal(false);
  details: Record<string, T3DetailView> = {};

  cancelledLabel = signal('');
  private _toastTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.loadCards();
  }

  refresh(): void {
    if (this.isRefreshing()) return;
    this.isRefreshing.set(true);
    this.loadCards(true);
  }

  private loadCards(isRefresh = false): void {
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http.get<GetT3Res>(`${this.constants.API_ENDPOINT}/t3/my`, { headers })
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        if (res?.success) {
          this.cards = res.data
            .map(d => this.mapToCard(d))
            .filter(c => c.status === 'pending');
        }
        this.isLoading.set(false);
        if (isRefresh) this.isRefreshing.set(false);
      });
  }

  private mapToCard(d: Datum): T3Card {
    const adv  = d.advisor_approval.status as ApprovalStatus;
    const fac  = d.faculty_com_approval.status as ApprovalStatus;
    const grad = d.grad_school_approval.status as ApprovalStatus;
    const ov   = d.overall_status;

    let status: 'pending' | 'approved' | 'rejected';
    if (ov === 'Approved')                                              status = 'approved';
    else if (ov === 'Cancelled' || adv === 'Rejected' || fac === 'Rejected' || grad === 'Rejected') status = 'rejected';
    else                                                                status = 'pending';

    const created = new Date(d.created_at as unknown as string);
    const daysAgo = Math.floor((Date.now() - created.getTime()) / 86_400_000);

    return {
      id:            `T3-${d.t3_id}`,
      t3Id:          d.t3_id,
      titleThai:     d.paper_and_research_details.title_thai,
      titleEn:       d.paper_and_research_details.title_english,
      issn:          d.issn || d.journal_snapshot.issn,
      database:      d.publication_details.specified_database,
      pubType:       d.publication_details.type,
      pubStatus:     d.publication_details.status,
      status,
      submittedDate:     this.formatDateShort(d.created_at),
      submittedDateTime: this.formatDateCompact(d.created_at),
      advisorDateTime:   this.formatDateCompact(d.advisor_approval.approved_at),
      facultyDateTime:   this.formatDateCompact(d.faculty_com_approval.approved_at),
      gradDateTime:      this.formatDateCompact(d.grad_school_approval.approved_at),
      daysAgo,
      advisorStatus: adv,
      facultyStatus: fac,
      gradStatus:    grad,
      overallStatus: ov,
    };
  }

  cardClass(card: T3Card): string {
    const base = 'req-card';
    if (card.overallStatus === 'Approved') return `${base} req-card--approved`;
    if (card.advisorStatus === 'Rejected' || card.facultyStatus === 'Rejected' || card.gradStatus === 'Rejected')
      return `${base} req-card--rejected`;
    return `${base} req-card--pending`;
  }

  currentStatusLabel(card: T3Card): string {
    if (card.overallStatus === 'Approved')    return '✅ อนุมัติแล้ว';
    if (card.advisorStatus === 'Rejected' || card.facultyStatus === 'Rejected' || card.gradStatus === 'Rejected')
                                              return '❌ ไม่ผ่านการอนุมัติ';
    if (card.advisorStatus === 'Pending')     return '○ รออาจารย์ที่ปรึกษา';
    if (card.facultyStatus === 'Pending')     return '○ รอที่ประชุมบัณฑิต';
    if (card.gradStatus   === 'Pending')      return '○ รอบัณฑิตวิทยาลัย';
    return '○ กำลังดำเนินการ';
  }

  // ── Cancel ─────────────────────────────────────────
  cancelRequest(id: string, t3Id: number, event: MouseEvent): void {
    event.stopPropagation();
    const removed = this.cards.find(c => c.id === id);
    this.cards = this.cards.filter(c => c.id !== id);

    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http.patch(`${this.constants.API_ENDPOINT}/t3/${t3Id}/cancel`, {}, { headers })
      .subscribe({
        next: () => {
          if (this._toastTimer) clearTimeout(this._toastTimer);
          this.cancelledLabel.set(`✓ ยกเลิก ${id} เรียบร้อยแล้ว`);
          this._toastTimer = setTimeout(() => this.cancelledLabel.set(''), 4000);
        },
        error: () => {
          if (removed) this.cards = [removed, ...this.cards];
        },
      });
  }

  // ── Detail Modal ────────────────────────────────────
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
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        if (res?.success) {
          this.details[card.id] = this.buildDetail(res.data);
        }
        this.detailLoading.set(false);
      });
  }

  closeDetail(): void {
    this.selectedId.set(null);
    document.body.style.overflow = '';
  }

  private buildDetail(d: T3Detail): T3DetailView {
    const adv  = d.advisor_approval.status as ApprovalStatus;
    const fac  = d.faculty_com_approval.status as ApprovalStatus;
    const grad = d.grad_school_approval.status as ApprovalStatus;
    const ov   = d.overall_status;

    let cardStatus: 'approved' | 'rejected' | 'pending';
    if (ov === 'Approved')                                           cardStatus = 'approved';
    else if (adv === 'Rejected' || fac === 'Rejected' || grad === 'Rejected') cardStatus = 'rejected';
    else                                                             cardStatus = 'pending';

    const statusPillText    = cardStatus === 'approved'  ? '✅ อนุมัติสำเร็จ'
                            : cardStatus === 'rejected'  ? '❌ ไม่ผ่านการอนุมัติ'
                            :                             '⚙ กำลังดำเนินการ';
    const currentStatusIcon = cardStatus === 'approved' ? '✅' : cardStatus === 'rejected' ? '❌' : 'ti ti-hourglass';
    const { title, desc }   = this.buildCurrentStatusText(d);

    return {
      id:           `T3-${d.t3_id}`,
      t3Id:         d.t3_id,
      titleThai:    d.paper_and_research_details.title_thai,
      titleEn:      d.paper_and_research_details.title_english,
      journalName:  d.journal_snapshot.journal_name,
      issn:         d.issn || d.journal_snapshot.issn,
      database:     d.publication_details.specified_database,
      pubType:      d.publication_details.type,
      pubStatus:    d.publication_details.status,
      volume:       d.publication_details.volume,
      issue:        d.publication_details.issue,
      publishYear:  d.publication_details.publish_year,
      firstAuthor:  d.paper_and_research_details.first_author,
      degree:       `${d.student_snapshot.degree_level} ${d.student_snapshot.study_plan_code}`.trim(),
      submittedDate: this.formatDateShort(d.created_at),
      advisorStatus: adv,
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
    const grad = d.grad_school_approval.status;
    const ov   = d.overall_status;

    if (ov === 'Approved')   return { title: 'อนุมัติสำเร็จ', desc: 'คำร้อง T3 ได้รับการอนุมัติเรียบร้อยแล้ว' };
    if (adv === 'Rejected')  return { title: 'ไม่ผ่านการอนุมัติจากอาจารย์ที่ปรึกษา', desc: (d.advisor_approval.remark as unknown as string | null) ?? 'กรุณาติดต่ออาจารย์ที่ปรึกษา' };
    if (fac === 'Rejected')  return { title: 'ไม่ผ่านการอนุมัติจากที่ประชุม', desc: (d.faculty_com_approval.remark as unknown as string | null) ?? 'กรุณาติดต่อบัณฑิตวิทยาลัย' };
    if (grad === 'Rejected') return { title: 'ไม่ผ่านการอนุมัติจากบัณฑิตวิทยาลัย', desc: (d.grad_school_approval.remark as unknown as string | null) ?? 'กรุณาติดต่อบัณฑิตวิทยาลัย' };
    if (adv === 'Pending')   return { title: 'อาจารย์ที่ปรึกษากำลังพิจารณา', desc: 'รับแจ้งเตือนแล้วและกำลังตรวจสอบคำร้อง' };
    if (fac === 'Pending')   return { title: 'รอที่ประชุมบัณฑิตวิทยาลัยพิจารณา', desc: 'อาจารย์ที่ปรึกษาเห็นชอบแล้ว รอที่ประชุม' };
    if (grad === 'Pending')  return { title: 'รอบัณฑิตวิทยาลัยอนุมัติสุดท้าย', desc: 'ผ่านที่ประชุมแล้ว รอการอนุมัติขั้นสุดท้าย' };
    return { title: 'กำลังดำเนินการ', desc: 'คำร้องอยู่ระหว่างการพิจารณา' };
  }

  private buildSteps(d: T3Detail): Step[] {
    const adv  = d.advisor_approval.status;
    const fac  = d.faculty_com_approval.status;
    const ov   = d.overall_status;
    const date = this.formatDateShort(d.created_at);
    const advisorDate = d.advisor_approval.approved_at
      ? this.formatDateShort(d.advisor_approval.approved_at) : '-';
    const facultyDate = d.faculty_com_approval.approved_at
      ? this.formatDateShort(d.faculty_com_approval.approved_at) : '-';

    const s1: Step = { icon: '✓', label: 'ยื่น T3 สำเร็จ', sub: '● เสร็จแล้ว', date, status: 'done' };

    const s2: Step = adv === 'Approved' ? { icon: '✓',  label: 'อาจารย์ที่ปรึกษาพิจารณา', sub: '● เสร็จแล้ว',       date: advisorDate, status: 'done'    }
                   : adv === 'Rejected' ? { icon: '✗',  label: 'อาจารย์ที่ปรึกษาพิจารณา', sub: '✗ ไม่อนุมัติ',      date: '-',         status: 'active'  }
                   :                     { icon: 'ti ti-hourglass',  label: 'อาจารย์ที่ปรึกษาพิจารณา', sub: '⚙ กำลังดำเนินการ', date: '-',         status: 'active'  };

    // รอผลจากที่ประชุม — ต้องเช็คว่าขั้นก่อนหน้า (อาจารย์) อนุมัติแล้วหรือยัง ไม่ใช่แค่
    // เช็คสถานะของขั้นนี้เอง ไม่งั้นแม้อาจารย์จะอนุมัติแล้วก็ยังค้างแสดงเป็น "pending/
    // รอขั้นก่อนหน้า" (วงกลมเทา) ทั้งที่จริงๆ คำร้องเดินมาถึงขั้นนี้แล้ว ควรเป็น
    // "active/กำลังดำเนินการ" (วงกลมเหลือง) แทน
    const s3: Step = fac === 'Approved' ? { icon: '✓',  label: 'รอผลจากที่ประชุม', sub: '● เสร็จแล้ว',       date: facultyDate, status: 'done'    }
                   : fac === 'Rejected' ? { icon: '✗',  label: 'รอผลจากที่ประชุม', sub: '✗ ไม่อนุมัติ',      date: '-',         status: 'active'  }
                   : adv === 'Approved' ? { icon: 'ti ti-hourglass', label: 'รอผลจากที่ประชุม', sub: '⚙ กำลังดำเนินการ', date: '-', status: 'active'  }
                   :                     { icon: '🏛',  label: 'รอผลจากที่ประชุม', sub: '○ รอขั้นก่อนหน้า',  date: '-',         status: 'pending' };

    const s4: Step = ov === 'Approved'
      ? { icon: '🎓', label: 'อนุมัติสำเร็จ', sub: '● เสร็จแล้ว',       date: '-', status: 'done'    }
      : { icon: '🎓', label: 'อนุมัติสำเร็จ', sub: '○ รอขั้นก่อนหน้า',  date: '-', status: 'pending' };

    return [s1, s2, s3, s4];
  }

  private buildTimeline(d: T3Detail): TimelineItem[] {
    const items: TimelineItem[] = [];
    const adv  = d.advisor_approval.status;
    const fac  = d.faculty_com_approval.status;
    const grad = d.grad_school_approval.status;

    items.push({
      icon: '⚙️', actor: 'ระบบ Journal Watch', badge: 'ระบบ', badgeType: 'system',
      message: `ยื่นคำร้อง T3-${d.t3_id} สำเร็จ บทความ: ${d.paper_and_research_details.title_thai}`,
      time: this.formatDateFull(d.created_at),
    });

    // อาจารย์ที่ปรึกษา — ถึงคิวนี้เสมอตั้งแต่ยื่นคำร้องเสร็จ
    if (adv === 'Approved') {
      items.push({ icon: '👨‍🏫', actor: 'อาจารย์ที่ปรึกษา', badge: 'อาจารย์', badgeType: 'advisor', message: 'อนุมัติคำร้อง T3 แล้ว', time: this.formatDateFull(d.advisor_approval.approved_at) });
    } else if (adv === 'Rejected') {
      items.push({ icon: '👨‍🏫', actor: 'อาจารย์ที่ปรึกษา', badge: 'อาจารย์', badgeType: 'advisor', message: 'ไม่อนุมัติคำร้อง T3', detail: (d.advisor_approval.remark as unknown as string | null) ?? undefined, time: this.formatDateFull(d.advisor_approval.approved_at) });
    } else {
      items.push({ icon: '👨‍🏫', actor: 'อาจารย์ที่ปรึกษา', badge: 'อาจารย์', badgeType: 'advisor', message: 'กำลังพิจารณาคำร้อง T3' });
    }

    // ที่ประชุมบัณฑิตวิทยาลัย — โชว์เสมอ ไม่ว่าจะถึงคิวหรือยัง (ต่างจากเดิมที่ซ่อน
    // รายการนี้ไปเลยถ้าอาจารย์ยังไม่อนุมัติ) ให้ตรงกับ stepper ด้านบนที่โชว์ครบ 4 ขั้น
    if (adv !== 'Approved') {
      items.push({ icon: '🏛', actor: 'ที่ประชุมบัณฑิตวิทยาลัย', badge: 'รออยู่', badgeType: 'waiting', message: 'รอขั้นก่อนหน้า' });
    } else if (fac === 'Approved') {
      items.push({ icon: '🏛', actor: 'ที่ประชุมบัณฑิตวิทยาลัย', badge: 'อนุมัติ', badgeType: 'advisor', message: 'อนุมัติคำร้อง T3 แล้ว', time: this.formatDateFull(d.faculty_com_approval.approved_at) });
    } else if (fac === 'Rejected') {
      items.push({ icon: '🏛', actor: 'ที่ประชุมบัณฑิตวิทยาลัย', badge: 'ไม่อนุมัติ', badgeType: 'advisor', message: 'ไม่อนุมัติคำร้อง T3', time: this.formatDateFull(d.faculty_com_approval.approved_at) });
    } else {
      items.push({ icon: '🏛', actor: 'ที่ประชุมบัณฑิตวิทยาลัย', badge: 'กำลังพิจารณา', badgeType: 'advisor', message: 'กำลังรอที่ประชุมพิจารณา' });
    }

    // บัณฑิตวิทยาลัย — โชว์เสมอเช่นกัน
    if (fac !== 'Approved') {
      items.push({ icon: '🎓', actor: 'บัณฑิตวิทยาลัย', badge: 'รออยู่', badgeType: 'waiting', message: 'รอขั้นก่อนหน้า' });
    } else if (grad === 'Approved') {
      items.push({ icon: '🎓', actor: 'บัณฑิตวิทยาลัย', badge: 'อนุมัติ', badgeType: 'advisor', message: 'อนุมัติคำร้อง T3 สำเร็จ', time: this.formatDateFull(d.grad_school_approval.approved_at) });
    } else if (grad === 'Rejected') {
      items.push({ icon: '🎓', actor: 'บัณฑิตวิทยาลัย', badge: 'ไม่อนุมัติ', badgeType: 'advisor', message: 'ไม่อนุมัติคำร้อง T3', time: this.formatDateFull(d.grad_school_approval.approved_at) });
    } else {
      items.push({ icon: '🎓', actor: 'บัณฑิตวิทยาลัย', badge: 'กำลังพิจารณา', badgeType: 'advisor', message: 'กำลังรอบัณฑิตวิทยาลัยอนุมัติขั้นสุดท้าย' });
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
