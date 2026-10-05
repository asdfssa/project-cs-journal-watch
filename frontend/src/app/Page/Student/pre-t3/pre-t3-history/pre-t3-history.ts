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

type ApprovalStatus = 'Pending' | 'Approved' | 'Rejected';

interface HistoryCard {
  id:                string;
  journalName:       string;
  issn:              string;
  database:          string;
  quartile:          string;
  journalStatus:     string;
  advisorStatus:     ApprovalStatus;
  facultyStatus:     ApprovalStatus;
  status:            'approved' | 'rejected' | 'cancelled';
  submittedDate:     string;
  submittedDateTime: string;
  advisorDateTime:   string | null;
  facultyDateTime:   string | null;
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

interface Attachment {
  icon: string;
  name: string;
  meta: string;
  size: string;
}

interface HistoryDetail {
  id:                 string;
  studentName:        string;
  studentId:          string;
  journalName:        string;
  issn:               string;
  quartile:           string;
  sjr:                string;
  scopusStatus:       string;
  database:           string;
  degree:             string;
  advisor:            string;
  submittedDate:      string;
  cardStatus:         'approved' | 'rejected' | 'cancelled';
  statusPillText:     string;
  currentStatusTitle: string;
  currentStatusDesc:  string;
  currentStatusIcon:  string;
  steps:              Step[];
  timeline:           TimelineItem[];
  attachments:        Attachment[];
}

@Component({
  selector: 'app-pre-t3-history',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './pre-t3-history.html',
  styleUrl: './pre-t3-history.scss',
})
export class PreT3History implements OnInit {
  selectedId   = signal<string | null>(null);
  isLoading    = signal(true);
  isRefreshing = signal(false);

  cards:   HistoryCard[]                = [];
  details: Record<string, HistoryDetail> = {};

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
    // tab-bar เลื่อนแนวนอนได้บนจอแคบ (overflow-x:auto) แต่ scrollLeft เริ่มที่ 0 เสมอ
    // ถ้าแท็บที่ active อยู่ขวาสุด (เช่น "ประวัติทั้งหมด") จะโดนซ่อนพ้นขอบจอ ต้อง
    // เลื่อนให้เข้ามาอยู่ในมุมมองเองตั้งแต่โหลดหน้า โดยไม่ใช้ animation (ไม่งั้นจะ
    // เห็นแท็บเด้งเลื่อนทุกครั้งที่เข้าหน้า)
    setTimeout(() => {
      document.querySelector('.tab-item.tab-active')
        ?.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
    }, 0);
  }

  refresh(): void {
    this.loadData(true);
  }

  private loadData(isRefresh = false): void {
    if (isRefresh) {
      this.isRefreshing.set(true);
    } else {
      this.isLoading.set(true);
    }

    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    forkJoin({
      myList:  this.http.get<GetMyPreT3Res>(`${this.constants.API_ENDPOINT}/pre-t3/my`, { headers })
                        .pipe(catchError(() => of(null))),
      profile: this.http.get<GetProfileRes>(`${this.constants.API_ENDPOINT}/user/profile`, { headers })
                        .pipe(catchError(() => of(null))),
    }).subscribe(({ myList, profile }) => {
      const prof = profile?.success ? profile.data : null;
      if (myList?.success) {
        this.buildData(myList.data, prof);
      }
      this.isLoading.set(false);
      this.isRefreshing.set(false);
    });
  }

  private buildData(data: Datum[], prof: ProfileData | null): void {
    const advisorName = this.getAdvisorName(prof);
    const studentName = prof ? `${prof.prefix}${prof.firstName} ${prof.lastName}`.trim() : '-';
    const studentId   = prof ? prof.msuMail.replace('@msu.ac.th', '') : '-';
    const degree      = prof ? `${prof.degreeLevel} ${prof.studyPlanCode}`.trim() : '-';

    const completed = data.filter(d => {
      const adv = d.advisor_approval.status;
      const fac = d.faculty_com_approval.status;
      return d.overall_status === 'Approved' || d.overall_status === 'Cancelled' || adv === 'Rejected' || fac === 'Rejected';
    });

    this.cards = completed.map(d => this.mapToCard(d));

    const rec: Record<string, HistoryDetail> = {};
    completed.forEach(d => {
      rec[`PRE-T3-${d.pre_t3_id}`] = this.mapToDetail(d, { studentName, studentId, degree, advisorName });
    });
    this.details = rec;
  }

  private getAdvisorName(prof: ProfileData | null): string {
    if (!prof?.advisors?.length) return '-';
    const a = prof.advisors.find(x => x.advisorType === 'Major') ?? prof.advisors[0];
    return `${a.prefix ?? ''}${a.firstName} ${a.lastName}`.trim();
  }

  private mapToCard(d: Datum): HistoryCard {
    const advisorStatus = d.advisor_approval.status as ApprovalStatus;
    const facultyStatus = d.faculty_com_approval.status as ApprovalStatus;
    const status: 'approved' | 'rejected' | 'cancelled' =
      d.overall_status === 'Approved'   ? 'approved'  :
      d.overall_status === 'Cancelled'  ? 'cancelled' : 'rejected';

    return {
      id:            `PRE-T3-${d.pre_t3_id}`,
      journalName:   d.journal_snapshot.journal_name,
      issn:          d.journal_snapshot.issn || d.journal_snapshot.eissn,
      database:      d.journal_snapshot.indexed_database,
      quartile:      d.journal_snapshot.quartile_or_tier,
      journalStatus: d.journal_snapshot.is_discontinued ? 'Discontinued' : 'Active',
      advisorStatus,
      facultyStatus,
      status,
      submittedDate:     this.formatDateShort(d.created_at),
      submittedDateTime: this.formatDateCompact(d.created_at),
      advisorDateTime:   advisorStatus === 'Approved' && d.advisor_approval.approved_at
                           ? this.formatDateCompact(d.advisor_approval.approved_at) : null,
      facultyDateTime:   facultyStatus === 'Approved' && d.faculty_com_approval.approved_at
                           ? this.formatDateCompact(d.faculty_com_approval.approved_at) : null,
    };
  }

  private mapToDetail(
    d: Datum,
    info: { studentName: string; studentId: string; degree: string; advisorName: string },
  ): HistoryDetail {
    const advisorStatus = d.advisor_approval.status as ApprovalStatus;
    const facultyStatus = d.faculty_com_approval.status as ApprovalStatus;
    const cardStatus: 'approved' | 'rejected' | 'cancelled' =
      d.overall_status === 'Approved'  ? 'approved'  :
      d.overall_status === 'Cancelled' ? 'cancelled' : 'rejected';

    const statusPillText    = cardStatus === 'approved'  ? 'อนุมัติสำเร็จ'
                            : cardStatus === 'cancelled' ? '🚫 ยกเลิกแล้ว'
                            :                             '❌ ไม่ผ่านการอนุมัติ';
    const currentStatusIcon = cardStatus === 'approved'  ? 'ti ti-circle-check'
                            : cardStatus === 'cancelled' ? '🚫' : '❌';
    const { title, desc }     = this.buildCurrentStatus(d, info.advisorName);

    return {
      id:                 `PRE-T3-${d.pre_t3_id}`,
      studentName:        info.studentName,
      studentId:          info.studentId,
      journalName:        d.journal_snapshot.journal_name,
      issn:               d.journal_snapshot.issn || d.journal_snapshot.eissn,
      quartile:           d.journal_snapshot.quartile_or_tier,
      sjr:                d.journal_snapshot.sjr_score != null ? String(d.journal_snapshot.sjr_score) : '-',
      scopusStatus:       d.journal_snapshot.is_discontinued ? 'Discontinued' : 'Active',
      database:           d.journal_snapshot.indexed_database,
      degree:             info.degree,
      advisor:            info.advisorName,
      submittedDate:      this.formatDateShort(d.created_at),
      cardStatus,
      statusPillText,
      currentStatusTitle: title,
      currentStatusDesc:  desc,
      currentStatusIcon,
      steps:              this.buildSteps(d),
      timeline:           this.buildTimeline(d, info.advisorName),
      attachments: [{
        icon: '📄',
        name: `แบบฟอร์ม Pre-T3 (PRE-T3-${d.pre_t3_id}).pdf`,
        meta: `สร้างเมื่อ: ${this.formatDateShort(d.created_at)}`,
        size: '-',
      }],
    };
  }

  private buildCurrentStatus(d: Datum, advisorName: string): { title: string; desc: string } {
    const adv  = d.advisor_approval.status;
    const fac  = d.faculty_com_approval.status;
    const over = d.overall_status;

    if (over === 'Approved') {
      return { title: 'อนุมัติสำเร็จ', desc: 'คำร้อง Pre-T3 ได้รับการอนุมัติเรียบร้อยแล้ว สามารถยื่น T3 ได้' };
    }
    if (over === 'Cancelled') {
      return { title: 'ยกเลิกคำร้องแล้ว', desc: 'นิสิตได้ยกเลิกคำร้อง Pre-T3 นี้ด้วยตนเอง' };
    }
    if (adv === 'Rejected') {
      return {
        title: 'ไม่ผ่านการอนุมัติจากอาจารย์ที่ปรึกษา',
        desc:  (d.advisor_approval.remark as any) ?? 'กรุณาติดต่ออาจารย์ที่ปรึกษา',
      };
    }
    return {
      title: 'ไม่ผ่านการอนุมัติจากคณะกรรมการ',
      desc:  (d.faculty_com_approval.remark as any) ?? 'กรุณาติดต่อบัณฑิตวิทยาลัย',
    };
  }

  private buildSteps(d: Datum): Step[] {
    const adv  = d.advisor_approval.status;
    const fac  = d.faculty_com_approval.status;
    const over = d.overall_status;

    const createdDate = this.formatDateShort(d.created_at);
    const advisorDate = d.advisor_approval.approved_at
      ? this.formatDateShort(d.advisor_approval.approved_at) : '-';

    const s1: Step = { icon: '✓', label: 'ยื่นคำร้องสำเร็จ', sub: '● เสร็จแล้ว', date: createdDate, status: 'done' };

    let s2: Step;
    if (adv === 'Rejected') s2 = { icon: '✗', label: 'อาจารย์ที่ปรึกษาพิจารณา', sub: '✗ ไม่อนุมัติ', date: advisorDate, status: 'active' };
    else                    s2 = { icon: '✓', label: 'อาจารย์ที่ปรึกษาพิจารณา', sub: '● เสร็จแล้ว', date: advisorDate, status: 'done' };

    let s3: Step;
    if (adv === 'Rejected') s3 = { icon: '3', label: 'รอผลจากที่ประชุม', sub: '○ ไม่ถึงขั้นตอนนี้', date: '-', status: 'pending' };
    else if (fac === 'Rejected') s3 = { icon: '✗', label: 'รอผลจากที่ประชุม', sub: '✗ ไม่อนุมัติ', date: '-', status: 'active' };
    else s3 = { icon: '✓', label: 'รอผลจากที่ประชุม', sub: '● เสร็จแล้ว', date: '-', status: 'done' };

    const s4: Step = over === 'Approved'    ? { icon: '🎓', label: 'อนุมัติสำเร็จพร้อมยื่น T3', sub: '● เสร็จแล้ว',        date: '-', status: 'done'    }
                   : over === 'Cancelled'  ? { icon: '🚫', label: 'อนุมัติสำเร็จพร้อมยื่น T3', sub: '○ ยกเลิกคำร้องแล้ว', date: '-', status: 'pending' }
                   :                        { icon: '🎓', label: 'อนุมัติสำเร็จพร้อมยื่น T3', sub: '○ ไม่ผ่านการอนุมัติ', date: '-', status: 'pending' };

    return [s1, s2, s3, s4];
  }

  private buildTimeline(d: Datum, advisorName: string): TimelineItem[] {
    const items: TimelineItem[] = [];
    const adv  = d.advisor_approval.status;
    const fac  = d.faculty_com_approval.status;

    items.push({
      icon: '⚙️', actor: 'ระบบ Journal Watch', badge: 'ระบบ', badgeType: 'system',
      message: `ยื่นคำร้อง PRE-T3-${d.pre_t3_id} สำเร็จ วารสาร ${d.journal_snapshot.journal_name} ${d.journal_snapshot.quartile_or_tier}`,
      time: this.formatDateFull(d.created_at),
    });

    if (adv === 'Approved') {
      items.push({
        icon: '👨‍🏫', actor: advisorName, badge: 'อาจารย์', badgeType: 'advisor',
        message: 'อนุมัติคำร้อง Pre-T3 แล้ว',
        time: d.advisor_approval.approved_at ? this.formatDateFull(d.advisor_approval.approved_at) : undefined,
      });
    } else if (adv === 'Rejected') {
      items.push({
        icon: '👨‍🏫', actor: advisorName, badge: 'อาจารย์', badgeType: 'advisor',
        message: 'ไม่อนุมัติคำร้อง Pre-T3',
        detail: (d.advisor_approval.remark as any) ?? undefined,
      });
    }

    if (adv === 'Approved') {
      if (fac === 'Approved') {
        items.push({
          icon: '🏛', actor: 'ที่ประชุมบัณฑิตวิทยาลัย', badge: 'อนุมัติ', badgeType: 'advisor',
          message: 'อนุมัติคำร้อง Pre-T3 แล้ว',
        });
      } else if (fac === 'Rejected') {
        items.push({
          icon: '🏛', actor: 'ที่ประชุมบัณฑิตวิทยาลัย', badge: 'ไม่อนุมัติ', badgeType: 'advisor',
          message: 'ไม่อนุมัติคำร้อง',
          detail: (d.faculty_com_approval.remark as any) ?? undefined,
        });
      }
    }

    if (d.overall_status === 'Cancelled') {
      items.push({
        icon: '🚫', actor: 'นิสิต', badge: 'ยกเลิก', badgeType: 'waiting',
        message: 'ยกเลิกคำร้อง Pre-T3 ด้วยตนเอง',
      });
    }

    return items;
  }

  cardClass(card: HistoryCard): string {
    if (card.status === 'approved')   return 'req-card req-card--approved';
    if (card.status === 'cancelled')  return 'req-card req-card--cancelled';
    return 'req-card req-card--rejected';
  }

  get selectedDetail(): HistoryDetail | null {
    const id = this.selectedId();
    return id ? (this.details[id] ?? null) : null;
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
}
