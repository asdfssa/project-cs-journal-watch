import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { AuthService } from '../../../../auth.service';
import { Constants } from '../../../../comfig/constants';
import { GetProfileRes } from '../../../../model/res/get_profile_res';
import { GetPreT3RequestRes, Datum as PreT3Datum } from '../../../../model/res/get_pre-t3_request_res';
import { SendT3Req } from '../../../../model/req/send_T3_req';
import { Datum as MyPreT3Datum } from '../../../../model/res/get_my_Pre-T3_res';

interface PreT3Item {
  id:            string;
  submittedDate: string;
  approvedDate:  string;
  title:         string;
  database:      string;
  quartile:      string;
  issn:          string;
  sjr:           string;
  citeScore:     string;
}

type ApprovalStatus = 'Pending' | 'Approved' | 'Rejected';

// ต้องตรงกับ MySQL ENUM ของคอลัมน์ t3_requests.innovation_type
// (Commercial | Social_Economic | Policy_Public | None) — ห้ามส่ง label ภาษาไทยตรงๆ ไม่งั้น insert พัง
const INNOVATION_TYPE_MAP: Record<string, string> = {
  'การนำไปใช้ประโยชน์เชิงพาณิชย์ (Commercial)':                    'Commercial',
  'การนำไปใช้ประโยชน์เชิงสังคมทิศทางเศรษฐกิจ (Social/Economic)': 'Social_Economic',
  'การนำไปใช้ประโยชน์เชิงนโยบายสาธารณะ (Policy/Public)':          'Policy_Public',
};

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

interface PreT3Detail {
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
  cardStatus:         'approved' | 'rejected' | 'pending';
  statusPillText:     string;
  currentStatusTitle: string;
  currentStatusDesc:  string;
  currentStatusIcon:  string;
  steps:              Step[];
  timeline:           TimelineItem[];
  attachments:        Attachment[];
}

@Component({
  selector: 'app-send-t3',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './send-t3.html',
  styleUrl: './send-t3.scss',
})
export class SendT3 implements OnInit {
  // ── Section 1: Student info (from profile) ────────
  fullName    = signal('');
  studentId   = signal('');
  phone       = signal('');
  faculty     = signal('');
  department  = signal('');
  degreeLevel = signal('');
  authMail    = signal('');

  private readonly THAI_MONTHS = [
    'ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
    'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.',
  ];

  private _profileInfo = { studentName: '-', studentId: '-', degree: '-', advisorName: '-' };

  constructor(
    private http:      HttpClient,
    private auth:      AuthService,
    private constants: Constants,
    private router:    Router,
  ) {}

  ngOnInit(): void {
    window.scrollTo(0, 0);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    forkJoin({
      profile: this.http.get<GetProfileRes>(`${this.constants.API_ENDPOINT}/user/profile`, { headers })
                        .pipe(catchError(() => of(null))),
      preT3:   this.http.get<GetPreT3RequestRes>(`${this.constants.API_ENDPOINT}/pre-t3/my`, { headers })
                        .pipe(catchError(() => of(null))),
    }).subscribe(({ profile, preT3 }) => {
      if (profile?.success) {
        const d = profile.data;
        const name = `${d.prefix}${d.firstName} ${d.lastName}`.trim();
        const sid  = d.msuMail.replace('@msu.ac.th', '');
        const deg  = `${d.degreeLevel} ${d.studyPlanCode}`.trim();
        const adv  = d.advisors?.length
          ? (() => { const a = d.advisors.find(x => x.advisorType === 'Major') ?? d.advisors[0]; return `${a.prefix ?? ''}${a.firstName} ${a.lastName}`.trim(); })()
          : '-';

        this.fullName.set(name);
        this.studentId.set(sid);
        this.phone.set(d.phone ?? '');
        this.faculty.set(d.faculty ?? '');
        this.department.set(d.department ?? '');
        this.degreeLevel.set(deg);
        this.authMail.set(d.msuMail);
        this._profileInfo = { studentName: name, studentId: sid, degree: deg, advisorName: adv };
      }
      if (preT3?.success) {
        this.preT3List = preT3.data
          .filter(d => d.overall_status === 'Approved')
          .map(d => this.mapToPreT3Item(d));
        this.selectedPreT3 = this.preT3List[0]?.id ?? '';
      }
      this.isLoading.set(false);
    });
  }

  private mapToPreT3Item(d: PreT3Datum): PreT3Item {
    const approvedAt = d.faculty_com_approval.approved_at ?? d.advisor_approval.approved_at;
    return {
      id:            `PRE-T3-${d.pre_t3_id}`,
      submittedDate: this.formatDateShort(d.created_at),
      approvedDate:  this.formatDateShort(approvedAt),
      title:         d.journal_snapshot.journal_name,
      database:      d.journal_snapshot.indexed_database,
      quartile:      d.journal_snapshot.quartile_or_tier,
      issn:          d.journal_snapshot.issn || d.journal_snapshot.eissn,
      sjr:           d.journal_snapshot.sjr_score != null ? String(d.journal_snapshot.sjr_score) : '-',
      citeScore:     d.journal_snapshot.cite_score != null ? String(d.journal_snapshot.cite_score) : '-',
    };
  }

  private formatDateShort(date: Date | string | null): string {
    if (!date) return '-';
    const d = new Date(date as string);
    if (isNaN(d.getTime())) return '-';
    return `${d.getDate()} ${this.THAI_MONTHS[d.getMonth()]} ${(d.getFullYear() + 543).toString().slice(-2)}`;
  }

  // ── Section 2: Pre-T3 selection ───────────────────
  isLoading      = signal(true);
  selectedPreT3  = '';
  preT3List: PreT3Item[] = [];

  get selectedPreT3Data(): PreT3Item | undefined {
    return this.preT3List.find(p => p.id === this.selectedPreT3);
  }

  // ── Pre-T3 Detail Modal ───────────────────────────
  selectedDetailId = signal<string | null>(null);
  detailLoading    = signal(false);
  details: Record<string, PreT3Detail> = {};

  get selectedDetail(): PreT3Detail | null {
    const id = this.selectedDetailId();
    return id ? (this.details[id] ?? null) : null;
  }

  openPreT3Detail(item: PreT3Item, event: MouseEvent): void {
    event.stopPropagation();
    this.selectedDetailId.set(item.id);
    document.body.style.overflow = 'hidden';

    if (this.details[item.id]) return;

    this.detailLoading.set(true);
    const numericId = item.id.replace('PRE-T3-', '');
    const headers   = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http.get<{ success: boolean; data: MyPreT3Datum }>
      (`${this.constants.API_ENDPOINT}/pre-t3/${numericId}`, { headers })
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        if (res?.success) {
          this.details[item.id] = this.buildDetail(res.data);
        }
        this.detailLoading.set(false);
      });
  }

  closePreT3Detail(): void {
    this.selectedDetailId.set(null);
    document.body.style.overflow = '';
  }

  private buildDetail(d: MyPreT3Datum): PreT3Detail {
    const adv = d.advisor_approval.status as ApprovalStatus;
    const fac = d.faculty_com_approval.status as ApprovalStatus;
    const ov  = d.overall_status;

    let cardStatus: 'approved' | 'rejected' | 'pending';
    if (ov === 'Approved')                                 cardStatus = 'approved';
    else if (adv === 'Rejected' || fac === 'Rejected')    cardStatus = 'rejected';
    else                                                   cardStatus = 'pending';

    const statusPillText    = cardStatus === 'approved' ? '✅ อนุมัติสำเร็จ'
                            : cardStatus === 'rejected' ? '❌ ไม่ผ่านการอนุมัติ' : '⚙ กำลังดำเนินการ';
    const currentStatusIcon = cardStatus === 'approved' ? '✅' : cardStatus === 'rejected' ? '❌' : 'ti ti-hourglass';
    const { title, desc }   = this.buildCurrentStatus(d);
    const p = this._profileInfo;

    return {
      id:                 `PRE-T3-${d.pre_t3_id}`,
      studentName:        p.studentName,
      studentId:          p.studentId,
      journalName:        d.journal_snapshot.journal_name,
      issn:               d.journal_snapshot.issn || d.journal_snapshot.eissn,
      quartile:           d.journal_snapshot.quartile_or_tier,
      sjr:                d.journal_snapshot.sjr_score != null ? String(d.journal_snapshot.sjr_score) : '-',
      scopusStatus:       d.journal_snapshot.is_discontinued ? 'Discontinued' : 'Active',
      database:           d.journal_snapshot.indexed_database,
      degree:             p.degree,
      advisor:            p.advisorName,
      submittedDate:      this.formatDateShort(d.created_at),
      cardStatus,
      statusPillText,
      currentStatusTitle: title,
      currentStatusDesc:  desc,
      currentStatusIcon,
      steps:              this.buildSteps(d),
      timeline:           this.buildTimeline(d),
      attachments: [{
        icon: '📄',
        name: `แบบฟอร์ม Pre-T3 (PRE-T3-${d.pre_t3_id}).pdf`,
        meta: `สร้างเมื่อ: ${this.formatDateShort(d.created_at)}`,
        size: '-',
      }],
    };
  }

  private buildCurrentStatus(d: MyPreT3Datum): { title: string; desc: string } {
    const adv  = d.advisor_approval.status;
    const fac  = d.faculty_com_approval.status;
    const ov   = d.overall_status;
    const adv0 = this._profileInfo.advisorName;

    if (ov === 'Approved')
      return { title: 'อนุมัติสำเร็จ', desc: 'คำร้อง Pre-T3 ได้รับการอนุมัติเรียบร้อยแล้ว สามารถยื่น T3 ได้' };
    if (adv === 'Rejected')
      return { title: 'ไม่ผ่านการอนุมัติจากอาจารย์ที่ปรึกษา', desc: (d.advisor_approval.remark as unknown as string | null) ?? 'กรุณาติดต่ออาจารย์ที่ปรึกษา' };
    if (fac === 'Rejected')
      return { title: 'ไม่ผ่านการอนุมัติจากคณะกรรมการ', desc: (d.faculty_com_approval.remark as unknown as string | null) ?? 'กรุณาติดต่อบัณฑิตวิทยาลัย' };
    if (adv === 'Pending')
      return { title: 'อาจารย์ที่ปรึกษากำลังพิจารณา', desc: `${adv0} รับแจ้งเตือนแล้วและกำลังตรวจสอบคำร้อง` };
    return { title: 'รอเจ้าหน้าที่บัณฑิตวิทยาลัยพิจารณา', desc: 'อาจารย์ที่ปรึกษาเห็นชอบแล้ว · เจ้าหน้าที่กำลังตรวจสอบ' };
  }

  private buildSteps(d: MyPreT3Datum): Step[] {
    const adv  = d.advisor_approval.status;
    const fac  = d.faculty_com_approval.status;
    const ov   = d.overall_status;
    const meet = d.faculty_com_approval.meeting_no !== null;

    const s1: Step = { icon: '✓', label: 'ยื่นคำร้องสำเร็จ', sub: '● เสร็จแล้ว', date: this.formatDateShort(d.created_at), status: 'done' };

    let s2: Step;
    if (adv === 'Approved')       s2 = { icon: '✓',  label: 'อาจารย์ที่ปรึกษาพิจารณา', sub: '● เสร็จแล้ว',       date: this.formatDateShort(d.advisor_approval.approved_at), status: 'done'   };
    else if (adv === 'Rejected')  s2 = { icon: '✗',  label: 'อาจารย์ที่ปรึกษาพิจารณา', sub: '✗ ไม่อนุมัติ',      date: '-',                                                   status: 'active' };
    else                          s2 = { icon: 'ti ti-hourglass', label: 'อาจารย์ที่ปรึกษาพิจารณา', sub: '⚙ กำลังดำเนินการ', date: this.formatDateShort(d.created_at),                    status: 'active' };

    let s3: Step;
    if (fac === 'Approved')       s3 = { icon: '✓',  label: 'รอผลจากที่ประชุม', sub: '● เสร็จแล้ว',       date: '-', status: 'done'    };
    else if (meet)                s3 = { icon: 'ti ti-hourglass', label: 'รอผลจากที่ประชุม', sub: '⚙ กำลังดำเนินการ', date: '-', status: 'active'  };
    else                          s3 = { icon: '🏛', label: 'รอผลจากที่ประชุม', sub: '○ รอขั้นก่อนหน้า',  date: '-', status: 'pending' };

    const s4: Step = ov === 'Approved'
      ? { icon: '🎓', label: 'อนุมัติสำเร็จพร้อมยื่น T3', sub: '● เสร็จแล้ว',      date: '-', status: 'done'    }
      : { icon: '🎓', label: 'อนุมัติสำเร็จพร้อมยื่น T3', sub: '○ รอขั้นก่อนหน้า', date: '-', status: 'pending' };

    return [s1, s2, s3, s4];
  }

  private buildTimeline(d: MyPreT3Datum): TimelineItem[] {
    const items: TimelineItem[] = [];
    const adv  = d.advisor_approval.status;
    const fac  = d.faculty_com_approval.status;
    const meet = d.faculty_com_approval.meeting_no !== null;
    const adv0 = this._profileInfo.advisorName;

    items.push({
      icon: '⚙️', actor: 'ระบบ Journal Watch', badge: 'ระบบ', badgeType: 'system',
      message: `ยื่นคำร้อง PRE-T3-${d.pre_t3_id} สำเร็จ วารสาร ${d.journal_snapshot.journal_name} ${d.journal_snapshot.quartile_or_tier}`,
      time: this.formatDateFull(d.created_at),
    });

    if (adv === 'Approved') {
      items.push({ icon: '👨‍🏫', actor: adv0, badge: 'อาจารย์', badgeType: 'advisor', message: 'อนุมัติคำร้อง Pre-T3 แล้ว', time: d.advisor_approval.approved_at ? this.formatDateFull(d.advisor_approval.approved_at) : undefined });
    } else if (adv === 'Rejected') {
      items.push({ icon: '👨‍🏫', actor: adv0, badge: 'อาจารย์', badgeType: 'advisor', message: 'ไม่อนุมัติคำร้อง Pre-T3', detail: (d.advisor_approval.remark as unknown as string | null) ?? undefined });
    } else {
      items.push({ icon: '👨‍🏫', actor: adv0, badge: 'อาจารย์', badgeType: 'advisor', message: 'กำลังพิจารณาคำร้อง Pre-T3 · รับแจ้งเตือนทาง MSU Mail แล้ว' });
    }

    if (meet) {
      items.push({ icon: '🏛', actor: 'ที่ประชุมบัณฑิตวิทยาลัย', badge: fac === 'Approved' ? 'อนุมัติ' : 'กำลังพิจารณา', badgeType: fac === 'Approved' ? 'advisor' : 'waiting', message: fac === 'Approved' ? 'อนุมัติคำร้อง Pre-T3 แล้ว' : 'กำลังพิจารณาในที่ประชุม' });
    } else {
      items.push({ icon: '🏛', actor: 'ที่ประชุมบัณฑิตวิทยาลัย', badge: 'รออยู่', badgeType: 'waiting', message: 'รอขั้นก่อนหน้า' });
    }

    return items;
  }

  private formatDateFull(date: Date | string | null): string {
    if (!date) return '-';
    const d = new Date(date as string);
    if (isNaN(d.getTime())) return '-';
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${d.getDate()} ${this.THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543} - ${h}:${m}`;
  }

  // ── Section 3: paper_and_research_details ────────
  titleTh             = '';
  titleEn             = '';
  correspondingAuthor = '';
  innovationType      = 'การนำไปใช้ประโยชน์เชิงพาณิชย์ (Commercial)';
  innovationDetail    = '';

  // ── Section 4: publication_details ───────────────
  journalType  = 'วารสารวิชาการระดับนานาชาติ';
  pubStatus    = 'accepted';
  volume       = '';
  issue        = '';
  publishYear  = '';

  // ── Section 5: journal_metrics ───────────────────
  hasImpactScore = false;
  impactFactor   = '';
  scoreYear      = '';

  isSubmitting   = signal(false);
  submitError    = signal('');
  submitSuccess  = signal(false);
  showConfirm    = signal(false);
  fieldWithError = signal<string>('');

  private readonly REQUIRED_FIELDS = [
    { value: () => this.titleTh,             label: 'ชื่อเรื่องภาษาไทย',   fieldId: 'field-titleTh' },
    { value: () => this.titleEn,             label: 'ชื่อเรื่องภาษาอังกฤษ', fieldId: 'field-titleEn' },
    { value: () => this.correspondingAuthor, label: 'Corresponding Author', fieldId: 'field-correspondingAuthor' },
  ];

  private readonly API_FIELD_LABELS: Record<string, string> = {
    'paper_and_research_details.title_thai':           'ชื่อเรื่องภาษาไทย',
    'paper_and_research_details.title_english':        'ชื่อเรื่องภาษาอังกฤษ',
    'paper_and_research_details.corresponding_author': 'Corresponding Author',
    'paper_and_research_details.innovation_detail':    'รายละเอียดการนำไปใช้ประโยชน์',
    'paper_and_research_details.innovation_type':      'ประเภทการนำไปใช้ประโยชน์',
    'paper_and_research_details.first_author':         'ชื่อผู้แต่ง (First Author)',
    'publication_details.type':                        'ประเภทวารสาร',
    'publication_details.status':                      'สถานะการตีพิมพ์',
    'publication_details.volume':                      'เล่มที่ (Volume)',
    'publication_details.issue':                       'ฉบับที่ (Issue)',
    'publication_details.publish_year':                'ปีที่ตีพิมพ์',
    'publication_details.specified_database':          'ฐานข้อมูล',
    'journal_metrics.score_year':                      'ปีที่คำนวณ Score',
    'journal_metrics.impact_factor':                   'Impact Factor',
    'pre_t3_id':                                       'Pre-T3 อ้างอิง',
  };

  private translateApiError(msg: string): string {
    let result = msg;
    for (const [path, label] of Object.entries(this.API_FIELD_LABELS)) {
      result = result.replace(path, label);
    }
    return result;
  }

  private scrollToField(fieldId: string): void {
    setTimeout(() => {
      const el = document.getElementById(fieldId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        (el as HTMLInputElement).focus();
      }
    }, 50);
  }

  openConfirm(): void {
    if (!this.selectedPreT3 || this.isSubmitting() || this.submitSuccess()) return;

    const missing = this.REQUIRED_FIELDS.find(f => !f.value().trim());
    if (missing) {
      this.submitError.set('');
      this.fieldWithError.set(missing.fieldId);
      this.scrollToField(missing.fieldId);
      return;
    }

    this.fieldWithError.set('');
    this.submitError.set('');
    this.showConfirm.set(true);
    document.body.style.overflow = 'hidden';
  }

  closeConfirm(): void {
    this.showConfirm.set(false);
    document.body.style.overflow = '';
  }

  submit(): void {
    this.closeConfirm();
    if (!this.selectedPreT3) return;
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    const payload = this.buildPayload();

    this.isSubmitting.set(true);
    this.submitError.set('');

    // ส่งทุกอย่างใน FormData เดียว — JSON fields เป็น string, files เป็น File
    const fd = new FormData();
    fd.append('pre_t3_id',                  String(payload.pre_t3_id));
    fd.append('journal_snapshot',           JSON.stringify(payload.journal_snapshot));
    fd.append('paper_and_research_details', JSON.stringify(payload.paper_and_research_details));
    fd.append('publication_details',        JSON.stringify(payload.publication_details));
    fd.append('journal_metrics',            JSON.stringify(payload.journal_metrics));

    for (const [key, file] of Object.entries(this.files)) {
      if (file) fd.append(key, file);
    }

    this.http.post<{ success: boolean }>(
      `${this.constants.API_ENDPOINT}/t3/with-files`, fd, { headers }
    ).subscribe({
      next: (res) => {
        if (!res.success) {
          this.submitError.set('ไม่สามารถยื่น T3 ได้ กรุณาลองใหม่');
          this.isSubmitting.set(false);
          return;
        }
        this.isSubmitting.set(false);
        this.submitSuccess.set(true);
        setTimeout(() => this.router.navigateByUrl('/status-t3'), 1500);
      },
      error: (err) => {
        const raw = err?.error?.message ?? `HTTP ${err?.status}`;
        this.submitError.set(`ยื่น T3 ล้มเหลว: ${this.translateApiError(raw)}`);
        this.isSubmitting.set(false);
      },
    });
  }

  private buildPayload(): SendT3Req {
    const preT3NumericId = this.selectedPreT3.replace('PRE-T3-', '');
    const d = this.selectedPreT3Data;
    return {
      pre_t3_id: Number(preT3NumericId),
      journal_snapshot: {
        issn:         d?.issn ?? '',
        journal_name: d?.title ?? '',
      },
      paper_and_research_details: {
        title_thai:           this.titleTh,
        title_english:        this.titleEn,
        first_author:         this.fullName(),
        corresponding_author: this.correspondingAuthor,
        innovation_type:      INNOVATION_TYPE_MAP[this.innovationType] ?? 'None',
        innovation_detail:    this.innovationDetail,
      },
      publication_details: {
        type:               this.journalType,
        weight_score:       this.journalType === 'วารสารวิชาการระดับนานาชาติ' ? 1.0 : 0.5,
        specified_database: d?.database ?? '',
        status:             this.pubStatus,
        volume:             this.volume,
        issue:              this.issue,
        publish_year:       this.publishYear,
      },
      journal_metrics: {
        has_impact_score: this.hasImpactScore,
        impact_factor:    this.hasImpactScore ? Number(this.impactFactor) : 0,
        citescore:        d ? Number(d.citeScore) : 0,
        score_year:       this.scoreYear,
      },
    };
  }

  // ── Section 7: Documents ──────────────────────────
  files: Record<string, File | null> = {
    acceptance_letter:  null,
    full_paper:         null,
    journal_cover:      null,
    table_of_contents:  null,
    database_evidence:  null,
    peer_review_result: null,
  };

  onFileChange(key: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      this.files[key] = input.files[0];
    }
  }

  getFileName(key: string): string {
    return this.files[key]?.name ?? '';
  }
}
