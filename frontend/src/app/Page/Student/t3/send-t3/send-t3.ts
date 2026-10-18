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
import { englishTitleError, thaiTitleError } from '../../../../title-lang';

interface PreT3Item {
  id:            string;
  submittedDate: string;
  approvedDate:  string;
  title:         string;
  database:      string;
  quartile:      string;
  issn:          string;}


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
  cardStatus:         'approved' | 'rejected' | 'pending';
  statusPillText:     string;
  currentStatusTitle: string;
  currentStatusDesc:  string;
  currentStatusIcon:  string;
  steps:              Step[];
  timeline:           TimelineItem[];
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
      // N2: ใช้ดูว่า Pre-T3 ใบไหนมี T3 ที่รอ/อนุมัติแล้ว — backend ตอบ 409 T3_ALREADY_EXISTS ถ้ายื่นซ้ำ
      // ซ่อนไปตั้งแต่ตอนเลือกดีกว่าให้กรอกฟอร์มครบแล้วค่อยโดนปฏิเสธ (โหลดไม่ได้ก็ไม่กรอง ปล่อยให้ backend กัน)
      myT3:    this.http.get<{ success: boolean; data: { pre_t3_id: number; overall_status: string }[] }>(
                          `${this.constants.API_ENDPOINT}/t3/my`, { headers })
                        .pipe(catchError(() => of(null))),
    }).subscribe(({ profile, preT3, myT3 }) => {
      if (profile?.success) {
        const d = profile.data;
        const name = `${d.prefix ?? ''}${d.firstName} ${d.lastName}`.trim();
        const sid  = d.msuMail.replace('@msu.ac.th', '');
        const deg  = `${d.degreeLevel} ${d.studyPlanCode}`.trim();
        const adv  = d.advisors?.length
          ? (() => { const a = d.advisors.find(x => x.advisorType === 'Major') ?? d.advisors[0]; return `${a.prefix ?? ''}${a.firstName} ${a.lastName}`.trim(); })()
          : '-';

        this.fullName.set(name);
        this.studentId.set(sid);
        this.phone.set(d.phone ?? '');
        this.department.set(d.department ?? '');
        this.degreeLevel.set(deg);
        this.authMail.set(d.msuMail);
        this._profileInfo = { studentName: name, studentId: sid, degree: deg, advisorName: adv };
      }
      const usedPreT3 = new Set(
        (myT3?.success ? myT3.data : [])
          .filter(t => t.overall_status === 'Pending' || t.overall_status === 'Approved')
          .map(t => t.pre_t3_id));
      if (preT3?.success) {
        this.preT3List = preT3.data
          .filter(d => d.overall_status === 'Approved' && !usedPreT3.has(d.pre_t3_id))
          .map(d => this.mapToPreT3Item(d));
        this.selectedPreT3 = this.preT3List[0]?.id ?? '';
      } else {
        // N3: โหลดไม่ได้ ≠ ไม่มี Pre-T3 ที่อนุมัติ
        this.preT3LoadError.set(true);
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
      issn:          d.journal_snapshot.issn,
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
  preT3LoadError = signal(false);
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

  /** พิมพ์หน้าต่างรายละเอียด Pre-T3 (เลือก "บันทึกเป็น PDF" ได้) — ใช้ body.modal-print ใน styles.scss เหมือนหน้าสถานะ Pre-T3 */
  printDetail(): void {
    document.body.classList.add('modal-print');
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('modal-print');
    }, { once: true });
    window.print();
  }

  closePreT3Detail(): void {
    this.selectedDetailId.set(null);
    document.body.style.overflow = '';
  }

  /**
   * หน้าต่างรายละเอียดในหน้านี้เปิดได้เฉพาะ Pre-T3 ที่อนุมัติครบแล้ว (preT3List กรอง overall_status === 'Approved')
   * จึงไม่มีกรณีรอ/ไม่อนุมัติ — ดูสถานะอื่นได้ที่หน้าสถานะ/ประวัติ Pre-T3
   */
  private buildDetail(d: MyPreT3Datum): PreT3Detail {
    const p = this._profileInfo;
    return {
      id:                 `PRE-T3-${d.pre_t3_id}`,
      studentName:        p.studentName,
      studentId:          p.studentId,
      journalName:        d.journal_snapshot.journal_name,
      issn:               d.journal_snapshot.issn,
      quartile:           d.journal_snapshot.quartile_or_tier,
      scopusStatus:       d.journal_snapshot.is_discontinued ? 'Discontinued' : 'Active',
      database:           d.journal_snapshot.indexed_database,
      degree:             p.degree,
      advisor:            p.advisorName,
      submittedDate:      this.formatDateShort(d.created_at),
      cardStatus:         'approved',
      statusPillText:     'อนุมัติสำเร็จ',
      currentStatusTitle: 'อนุมัติสำเร็จ',
      currentStatusDesc:  'คำร้อง Pre-T3 ได้รับการอนุมัติเรียบร้อยแล้ว สามารถยื่น T3 ได้',
      currentStatusIcon:  'ti ti-circle-check',
      steps:              this.buildSteps(d),
      timeline:           this.buildTimeline(d),
    };
  }

  // 3 ขั้น: ยื่น → อาจารย์ที่ปรึกษา → เจ้าหน้าที่ (ผลเดียวกับที่ประชุม) — ทุกขั้นเสร็จแล้ว
  private buildSteps(d: MyPreT3Datum): Step[] {
    return [
      { icon: 'ti ti-check', label: 'ยื่นคำร้องสำเร็จ',        sub: '● เสร็จแล้ว', date: this.formatDateShort(d.created_at),                     status: 'done' },
      { icon: 'ti ti-check', label: 'อาจารย์ที่ปรึกษาพิจารณา', sub: '● เสร็จแล้ว', date: this.formatDateShort(d.advisor_approval.approved_at),     status: 'done' },
      { icon: 'ti ti-check', label: 'เจ้าหน้าที่พิจารณา',      sub: '● เสร็จแล้ว', date: this.formatDateShort(d.faculty_com_approval.approved_at), status: 'done' },
    ];
  }

  private buildTimeline(d: MyPreT3Datum): TimelineItem[] {
    const at = (v: Date | string | null) => v ? this.formatDateFull(v) : undefined;
    return [
      {
        icon: 'ti ti-settings', actor: 'ระบบ Journal Watch', badge: 'ระบบ', badgeType: 'system',
        message: `ยื่นคำร้อง PRE-T3-${d.pre_t3_id} สำเร็จ วารสาร ${d.journal_snapshot.journal_name} ${d.journal_snapshot.quartile_or_tier}`,
        time: this.formatDateFull(d.created_at),
      },
      {
        icon: 'ti ti-chalkboard', actor: this._profileInfo.advisorName, badge: 'อาจารย์', badgeType: 'advisor',
        message: 'อนุมัติคำร้อง Pre-T3 แล้ว', time: at(d.advisor_approval.approved_at),
        detail: (d.advisor_approval.remark as unknown as string | null) || undefined,
      },
      {
        icon: 'ti ti-building-bank', actor: 'ที่ประชุมบัณฑิตวิทยาลัย', badge: 'อนุมัติ', badgeType: 'advisor',
        message: 'อนุมัติคำร้อง Pre-T3 แล้ว', time: at(d.faculty_com_approval.approved_at),
        detail: (d.faculty_com_approval.remark as unknown as string | null) || undefined,
      },
    ];
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
  // กรอกผิดช่องภาษา — กฎอยู่ที่ title-lang.ts (ใช้ร่วมกับฟอร์ม Pre-T3)
  get titleThLangError(): string { return thaiTitleError(this.titleTh); }
  get titleEnLangError(): string { return englishTitleError(this.titleEn); }
  correspondingAuthor = '';
  innovationType      = 'การนำไปใช้ประโยชน์เชิงพาณิชย์ (Commercial)';
  innovationDetail    = '';

  // ── Section 4: publication_details ───────────────
  // ประเภทวารสาร — เลือกให้อัตโนมัติจากฐานข้อมูลของ Pre-T3 ที่เลือก (นิสิตเปลี่ยนเองไม่ได้)
  // กันเลือกผิด เช่น วารสาร TCI แต่เลือก "นานาชาติ" แล้วได้ weight 1.0 เกินจริง
  get journalType(): string {
    const db = this.selectedPreT3Data?.database ?? '';
    if (!db) return '';
    return /tci/i.test(db) ? 'วารสารวิชาการระดับชาติ' : 'วารสารวิชาการระดับนานาชาติ';
  }

  get journalTypeInfo(): { icon: string; hint: string } | null {
    if (!this.journalType) return null;
    return this.isInternational
      ? { icon: 'ti-world', hint: `ฐานข้อมูล ${this.selectedPreT3Data?.database ?? ''}` }
      : { icon: 'ti-flag',  hint: `TCI ${this.selectedPreT3Data?.quartile ?? ''}` };
  }

  private get isInternational(): boolean { return /นานาชาติ/.test(this.journalType); }

  // ค่าน้ำหนักคำนวณที่ backend จาก Pre-T3 (B31) — ตรงนี้แค่แสดงให้ตรงกัน:
  // Scopus = 1.0 · TCI กลุ่ม 1 = 0.8 · TCI กลุ่ม 2 = 0.6 · TCI อ่านกลุ่มไม่ได้ = backend ตอบ 400 INVALID_TIER
  private get tciTier(): string | undefined {
    return (this.selectedPreT3Data?.quartile ?? '').match(/\d+/)?.[0];
  }

  /** A3: Pre-T3 เป็น TCI แต่ไม่ระบุกลุ่ม 1/2 — ยื่น T3 ไม่ได้ (backend ตอบ INVALID_TIER) */
  get tierInvalid(): boolean {
    return !!this.journalType && !this.isInternational && this.tciTier !== '1' && this.tciTier !== '2';
  }

  get weightLabel(): string {
    if (!this.journalType || this.tierInvalid) return '—';
    if (this.isInternational) return '1.0';
    return this.tciTier === '1' ? '0.8' : '0.6';
  }
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

  private readonly FILE_LABELS: Record<string, string> = {
    acceptance_letter: 'หนังสือตอบรับ (acceptance_letter)',
    full_paper:        'บทความฉบับสมบูรณ์ (full_paper)',
    journal_cover:     'หน้าปกวารสาร (journal_cover)',
    table_of_contents: 'สารบัญวารสาร (table_of_contents)',
  };

  /** ไฟล์บังคับตามสถานะ — ต้องตรงกับ backend: accepted → ตอบรับ + ฉบับเต็ม, published → ฉบับเต็ม + ปก + สารบัญ */
  private get requiredFiles(): { key: string; label: string }[] {
    const keys = this.pubStatus === 'published'
      ? ['full_paper', 'journal_cover', 'table_of_contents']
      : ['acceptance_letter', 'full_paper'];
    return keys.map(key => ({ key, label: this.FILE_LABELS[key] }));
  }

  isRequiredFile(key: string): boolean {
    return this.requiredFiles.some(f => f.key === key);
  }

  /**
   * เปลี่ยนสถานะแล้วไฟล์บังคับเปลี่ยน — ล้างกรอบแดงของไฟล์ที่ไม่บังคับแล้ว
   * Accepted = ยังไม่ลงเล่ม ไม่มีเลขเล่ม/ฉบับ/ปี หน้าปก สารบัญ → ช่องพวกนี้ถูกซ่อน
   * ล้างค่าที่อาจกรอก/แนบไว้ตอนเลือก Published ไม่ให้ถูกส่งไปเงียบๆ
   */
  setPubStatus(status: 'accepted' | 'published'): void {
    this.pubStatus = status;
    if (status === 'accepted') {
      this.volume = ''; this.issue = ''; this.publishYear = '';
      this.files['journal_cover'] = null;
      this.files['table_of_contents'] = null;
    }
    const f = this.fieldWithError();
    if (f.startsWith('file-') && !this.isRequiredFile(f.slice(5))) { this.fieldWithError.set(''); this.submitError.set(''); }
  }
  private readonly MAX_FILE_BYTES = 10 * 1024 * 1024;

  /** ปี (ค.ศ. 4 หลัก) / เล่ม / ฉบับ ต้องเป็นตัวเลข — ช่องที่ไม่บังคับ ถ้าว่างก็ผ่าน */
  private numberFieldError(): string {
    const year = (v: string) => /^\d{4}$/.test(v.trim());
    const num  = (v: string) => /^\d+$/.test(v.trim());
    if (!year(this.scoreYear))                          return 'ปีของ Score ต้องเป็นปี ค.ศ. 4 หลัก เช่น 2024';
    if (this.publishYear.trim() && !year(this.publishYear)) return 'ปีที่ตีพิมพ์ต้องเป็นปี ค.ศ. 4 หลัก เช่น 2025';
    if (this.volume.trim() && !num(this.volume))        return 'เล่มที่ (Volume) ต้องเป็นตัวเลข';
    if (this.issue.trim() && !num(this.issue))          return 'ฉบับที่ (Issue) ต้องเป็นตัวเลข';
    return '';
  }

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

    if (this.tierInvalid) {
      this.submitError.set('Pre-T3 ที่เลือกไม่ได้ระบุกลุ่ม TCI (กลุ่ม 1 หรือ 2) จึงคำนวณค่าน้ำหนักไม่ได้ — กรุณายื่น Pre-T3 ใหม่โดยระบุกลุ่มให้ถูกต้อง');
      return;
    }

    // backend ไม่บังคับ impact_factor เมื่อ has_impact_score = true → FE บังคับเอง
    if (this.hasImpactScore && this.toNumberOrNull(this.impactFactor) === null) {
      this.submitError.set('กรุณากรอก Impact Factor เป็นตัวเลข (หรือเอาเครื่องหมาย "วารสารมี Impact Factor" ออก)');
      return;
    }

    const missing = this.REQUIRED_FIELDS.find(f => !f.value().trim());
    if (missing) {
      this.submitError.set('');
      this.fieldWithError.set(missing.fieldId);
      this.scrollToField(missing.fieldId);
      return;
    }

    const wrongLang = this.titleThLangError ? 'field-titleTh' : this.titleEnLangError ? 'field-titleEn' : '';
    if (wrongLang) {
      this.submitError.set('ชื่อเรื่องกรอกผิดภาษา กรุณาแก้ไขก่อนยื่น');
      this.scrollToField(wrongLang);
      return;
    }

    // F3: ไฟล์จำเป็น + ช่องตัวเลข — เดิมยื่นได้โดยไม่แนบหนังสือตอบรับ/บทความฉบับสมบูรณ์
    const missingFile = this.requiredFiles.find(f => !this.files[f.key]);
    if (missingFile) {
      this.submitError.set(`กรุณาแนบไฟล์ ${missingFile.label}`);
      this.fieldWithError.set(`file-${missingFile.key}`);
      this.scrollToField(`file-${missingFile.key}`);
      return;
    }
    const badNumber = this.numberFieldError();
    if (badNumber) {
      this.submitError.set(badNumber);
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
        // 400 MISSING_REQUIRED_FILES มี missing: [...] — แสดงชื่อไฟล์ที่ขาดเป็นภาษาไทย
        const missing: unknown = err?.error?.missing;
        if (Array.isArray(missing) && missing.length) {
          const names = missing.map(k => this.FILE_LABELS[String(k)] ?? String(k)).join(', ');
          this.submitError.set(`ยื่น T3 ล้มเหลว: ยังไม่ได้แนบไฟล์ ${names}`);
          this.isSubmitting.set(false);
          return;
        }
        const raw = err?.error?.message ?? `HTTP ${err?.status}`;
        this.submitError.set(`ยื่น T3 ล้มเหลว: ${this.translateApiError(raw)}`);
        this.isSubmitting.set(false);
      },
    });
  }

  private toNumberOrNull(v: unknown): number | null {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
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
        specified_database: d?.database ?? '',
        status:             this.pubStatus,
        volume:             this.volume,
        issue:              this.issue,
        publish_year:       this.publishYear,
      },
      journal_metrics: {
        has_impact_score: this.hasImpactScore,
        // X20: ไม่มีค่า = ส่ง null (ห้ามส่ง NaN / 0 / "" — 0 ถูกเก็บเป็น 0 จริง, "" ได้ 500)
        impact_factor:    this.hasImpactScore ? this.toNumberOrNull(this.impactFactor) : null,
        citescore:        null,   // Pre-T3 ไม่เก็บ CiteScore แล้ว — staff ตรวจจากหน้าค้นหาเอง
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
      const file = input.files[0];
      if (file.size > this.MAX_FILE_BYTES) {
        this.submitError.set(`ไฟล์ ${file.name} ใหญ่เกิน 10MB`);
        input.value = '';
        this.files[key] = null;   // N10: ไม่เก็บไฟล์เก่าไว้ส่งเงียบๆ ในขณะที่ช่องแสดงว่าว่าง
        return;
      }
      this.files[key] = file;
      if (this.fieldWithError() === `file-${key}`) { this.fieldWithError.set(''); this.submitError.set(''); }
    }
  }

  getFileName(key: string): string {
    return this.files[key]?.name ?? '';
  }
}
