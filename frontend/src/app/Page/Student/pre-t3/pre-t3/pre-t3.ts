import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { AuthService } from '../../../../auth.service';
import { Constants } from '../../../../comfig/constants';
import { GetProfileRes, Advisor } from '../../../../model/res/get_profile_res';
import { SendPreT3Req } from '../../../../model/req/Send_Pre-T3_req';
import { apiFailure, failMsg } from '../../../../server-status.service';
import { PRE_T3_CHECKLIST_TITLES } from '../../../../pre-t3-checklist';
import { englishTitleError, thaiTitleError } from '../../../../title-lang';

interface ChecklistItem {
  id: number;
  title: string;
  detail: string;
  status: 'pass' | 'fail' | 'pending';
  canToggle: boolean;
}

@Component({
  selector: 'app-pre-t3',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './pre-t3.html',
  styleUrl: './pre-t3.scss',
})
export class PreT3 implements OnInit {
  private auth      = inject(AuthService);
  private router    = inject(Router);
  private http      = inject(HttpClient);
  private constants = inject(Constants);

  /* ── Section 1: นิสิต ── */
  fullName    = signal('');
  authMail    = signal('');
  degreeLevel = signal('');
  studentId   = signal('');
  phone       = signal('');
  department  = signal('');

  /* ── Section 2: วารสาร ── */
  journalName    = signal('');
  journalNameTh  = signal('');
  issn           = signal('');
  database       = signal('');

  // ── ฐานข้อมูล (X23): DB เป็น ENUM('Scopus','TCI') — ให้เลือกจาก dropdown แทนพิมพ์อิสระ ──
  readonly databaseOptions = [
    { value: 'Scopus', icon: 'ti-world', hint: 'ฐานข้อมูลนานาชาติ' },
    { value: 'TCI',    icon: 'ti-flag',  hint: 'ศูนย์ดัชนีการอ้างอิงวารสารไทย' },
  ];
  databaseOpen = signal(false);

  selectDatabase(value: string): void {
    this.database.set(value);
    this.databaseOpen.set(false);
  }

  /** แปลงค่าจากหน้าค้นหา (อาจเป็น scopus / tci / SCOPUS) ให้ตรง ENUM — ไม่รู้จักให้ว่างไว้เลือกเอง */
  private normalizeDatabase(raw: string | null | undefined): string {
    const v = (raw ?? '').toLowerCase();
    if (v.includes('tci'))    return 'TCI';
    if (v.includes('scopus')) return 'Scopus';
    return '';
  }
  quartile       = signal('');
  journalUrl     = signal('');
  isDiscontinued = signal(false);

  /* ── Section 3: บทความ ── */
  titleEn = signal('');
  titleTh = signal('');

  /* ── Section 4: อาจารย์ ── */
  advisorOverride = signal('');
  coAdvisor1      = signal('');
  coAdvisor2      = signal('');

  /* ── มาจากหน้าค้นหา ── */
  fromSearch = signal(false);

  /* ── ทุกข้อ (1-9): นิสิตต้องกดติกเองทั้งหมด ระบบไม่ auto-check ให้ ── */
  manualChecks = signal<Set<number>>(new Set());

  toggleCheck(id: number): void {
    const item = this.checklist().find(c => c.id === id);
    if (!item?.canToggle) return;

    this.manualChecks.update(set => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  /* ── ติ๊ก/ยกเลิกทั้งหมด — ข้ามข้อที่ระบบตัดสินว่า fail (เช่น Discontinued) ── */
  get allChecked(): boolean {
    const items = this.checklist().filter(c => c.canToggle && c.status !== 'fail');
    return items.length > 0 && items.every(c => c.status === 'pass');
  }

  toggleAll(): void {
    if (this.allChecked) {
      this.manualChecks.set(new Set());
      return;
    }
    const ids = this.checklist().filter(c => c.canToggle && c.status !== 'fail').map(c => c.id);
    this.manualChecks.set(new Set(ids));
  }

  /* ── Checklist computed ── */
  checklist = computed<ChecklistItem[]>(() => {
    const fromS  = this.fromSearch();
    const name   = this.journalName().trim();
    const url    = this.journalUrl().trim();
    const db     = this.database().trim();
    const q      = this.quartile().trim();
    const disc   = this.isDiscontinued();
    const manual = this.manualChecks();

    const ms = (id: number): 'pass' | 'pending' => manual.has(id) ? 'pass' : 'pending';

    return [
      {
        id: 1, canToggle: true,
        title: PRE_T3_CHECKLIST_TITLES['item1'],
        detail: name
          ? `ตรวจสอบว่า "${name}" ตรงกับชื่อในฐานข้อมูลจริง แล้วคลิกยืนยัน`
          : 'กรอกชื่อวารสารก่อน',
        status: ms(1),
      },
      {
        id: 2, canToggle: true,
        title: PRE_T3_CHECKLIST_TITLES['item2'],
        detail: url ? `เปิด URL แล้วตรวจสอบ: ${url}` : 'กรอก URL วารสารก่อน แล้วคลิกเปิดดูเพื่อยืนยัน',
        status: ms(2),
      },
      {
        id: 3, canToggle: true,
        title: PRE_T3_CHECKLIST_TITLES['item3'],
        detail: fromS
          ? 'วารสารที่อยู่ใน Scopus/TCI ต้องผ่านเกณฑ์นี้ก่อน Index'
          : 'ตรวจสอบประวัติการเผยแพร่ที่เว็บไซต์วารสาร',
        status: ms(3),
      },
      {
        id: 4, canToggle: true,
        title: PRE_T3_CHECKLIST_TITLES['item4'],
        detail: fromS
          ? 'วารสารที่อยู่ใน Scopus/TCI ต้องมี Aims & Scope ครบก่อน Index'
          : 'ตรวจสอบ Aims & Scope และสำนักพิมพ์ที่เว็บไซต์วารสาร',
        status: ms(4),
      },
      {
        id: 5, canToggle: true,
        title: PRE_T3_CHECKLIST_TITLES['item5'],
        detail: fromS
          ? 'วารสารที่อยู่ใน Scopus/TCI ต้องผ่านเกณฑ์ Editorial Board นานาชาติก่อน Index'
          : 'ตรวจสอบ Editorial Board ที่เว็บไซต์วารสาร',
        status: ms(5),
      },
      {
        id: 6, canToggle: true,
        title: PRE_T3_CHECKLIST_TITLES['item6'],
        detail: fromS
          ? 'วารสารที่อยู่ใน Scopus/TCI ต้องมีระบบ Peer Review ที่ผ่านเกณฑ์ก่อน Index'
          : 'ตรวจสอบ Author Guidelines ที่เว็บไซต์วารสาร',
        status: ms(6),
      },
      {
        id: 7, canToggle: true,
        title: PRE_T3_CHECKLIST_TITLES['item7'],
        detail: fromS
          ? 'วารสารที่อยู่ใน Scopus/TCI ต้องมีมาตรฐานรูปแบบบทความที่สม่ำเสมอก่อน Index'
          : 'ตรวจสอบตัวอย่างบทความในวารสาร',
        status: ms(7),
      },
      {
        id: 8, canToggle: true,
        title: PRE_T3_CHECKLIST_TITLES['item8'],
        detail: fromS
          ? (disc ? 'วารสารนี้ถูกระงับ (Discontinued)' : 'ไม่พบใน Hijacked / Discontinued list')
          : 'ตรวจสอบกับ Beall\'s List และ Hijacked Journal Database',
        status: fromS && disc ? 'fail' : ms(8),
      },
      {
        id: 9, canToggle: true,
        title: PRE_T3_CHECKLIST_TITLES['item9'],
        detail: (db && q) ? `ฐานข้อมูล: ${db} · Quartile: ${q}` : 'ยังไม่ได้ระบุฐานข้อมูลหรือ Quartile',
        status: ms(9),
      },
    ];
  });

  get passCount(): number  { return this.checklist().filter(c => c.status === 'pass').length; }
  get allPass():   boolean { return this.checklist().every(c => c.status === 'pass'); }

  isSubmitting  = signal(false);
  submitResult  = signal<'success' | 'error' | null>(null);
  submitError   = signal('');

  // ── โหมดยื่นซ้ำ (คำร้องเดิมที่ถูกปฏิเสธ) → PATCH /pre-t3/:id/resubmit ──
  resubmitInfo = signal<{ preT3Id: number; resubmitCount: number; rejectReason: string; rejectedBy: string } | null>(null);
  resubmitAck  = signal(false);   // ต้องติ๊กยืนยันว่าแก้ไขแล้ว ก่อนกดยื่นซ้ำได้   // เหตุผลจาก backend เช่น NO_ADVISOR, โปรไฟล์ไม่ครบ
  showConfirm   = signal(false);

  /** F4: ต้องมีชื่อบทความอย่างน้อย 1 ภาษา */
  hasTitle = computed(() => !!this.titleEn().trim() || !!this.titleTh().trim());

  /** กรอกผิดช่องภาษา — กฎอยู่ที่ title-lang.ts (ใช้ร่วมกับฟอร์ม T3) */
  titleEnError = computed(() => englishTitleError(this.titleEn()));
  titleThError = computed(() => thaiTitleError(this.titleTh()));

  /** เหตุผลที่ยังยื่นไม่ได้ — แสดงใต้ปุ่มยื่น (เดิมขึ้นเรื่อง Checklist ทุกกรณี) */
  submitBlockReason = computed(() => {
    if (this.titleEnError() || this.titleThError()) return 'ชื่อบทความกรอกผิดภาษา กรุณาแก้ไขก่อนยื่น';
    if (!this.hasTitle())                            return 'กรุณากรอกชื่อบทความอย่างน้อย 1 ภาษา';
    return 'กรุณาตรวจสอบ Checklist ทั้ง 9 ข้อให้ครบก่อนยื่น';
  });

  canSubmit = computed(() =>
    this.checklist().every(c => c.status === 'pass') &&
    !!this.journalName().trim() &&   // X47: เดิมชื่อวารสารว่างก็กดยื่นได้ แล้วได้ 400 INVALID_JOURNAL
    !!this.issn() &&
    !!this.database() &&
    this.hasTitle() &&
    !this.titleEnError() && !this.titleThError() &&
    !!this.studentId()
  );

  ngOnInit(): void {
    window.scrollTo(0, 0);
    // tab-bar เลื่อนแนวนอนได้บนจอแคบ (overflow-x:auto) แต่ scrollLeft เริ่มที่ 0 เสมอ
    // ถ้าแท็บที่ active อยู่ไม่ใช่ตัวแรกจะโดนซ่อนพ้นขอบจอ ต้องเลื่อนให้เข้ามาอยู่ใน
    // มุมมองเองตั้งแต่โหลดหน้า โดยไม่ใช้ animation
    setTimeout(() => {
      document.querySelector('.tab-item.tab-active')
        ?.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
    }, 0);
    const state = history.state;
    if (state?.resubmit?.preT3Id) {
      this.resubmitInfo.set(state.resubmit);
      this.titleEn.set(state.titleEn ?? '');
      this.titleTh.set(state.titleTh ?? '');
    }
    if (state?.journalName) {
      this.journalName.set(state.journalName ?? '');
      this.journalNameTh.set(state.journalNameTh ?? '');
      this.issn.set(state.issn ?? '');
      this.database.set(this.normalizeDatabase(state.database));
      this.quartile.set(state.quartile ?? '');
      this.journalUrl.set(state.journalUrl ?? '');
      this.isDiscontinued.set(state.isDiscontinued ?? false);
      this.fromSearch.set(true);
      // ไม่ pre-check ให้อีกต่อไป — นิสิตต้องกดติกทั้ง 9 ข้อด้วยตนเองเสมอ ไม่ว่าจะมาจากหน้าค้นหาหรือกรอกเอง
    }

    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .get<GetProfileRes>(`${this.constants.API_ENDPOINT}/user/profile`, { headers })
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        if (!res?.success) return;
        const d = res.data;

        this.fullName.set(`${d.prefix ?? ''} ${d.firstName} ${d.lastName}`.trim());
        this.authMail.set(d.msuMail ?? '');
        this.studentId.set((d.msuMail ?? '').replace('@msu.ac.th', ''));
        this.degreeLevel.set(d.degreeLevel ?? '');
        this.phone.set(d.phone ?? '');
        this.department.set(d.department ?? '');

        const main = (d.advisors ?? []).find((a: Advisor) => a.advisorType === 'Major');
        const co1  = (d.advisors ?? []).find((a: Advisor) => a.advisorType === 'Co_1');
        const co2  = (d.advisors ?? []).find((a: Advisor) => a.advisorType === 'Co_2');

        if (main) this.advisorOverride.set(`${main.prefix ?? ''} ${main.firstName} ${main.lastName}`.trim());
        if (co1)  this.coAdvisor1.set(`${co1.prefix ?? ''} ${co1.firstName} ${co1.lastName}`.trim());
        if (co2)  this.coAdvisor2.set(`${co2.prefix ?? ''} ${co2.firstName} ${co2.lastName}`.trim());
      });
  }

  openConfirm(): void {
    // N1: หลังยื่นสำเร็จจะรอ 1.5 วิ ก่อนเปลี่ยนหน้า — กันกดยื่นซ้ำในช่วงนั้น (backend ตอบ 409 PRE_T3_DUPLICATE)
    if (!this.canSubmit() || this.isSubmitting() || this.submitResult() === 'success') return;
    this.resubmitAck.set(false);
    this.showConfirm.set(true);
    document.body.style.overflow = 'hidden';
  }

  closeConfirm(): void {
    this.showConfirm.set(false);
    document.body.style.overflow = '';
  }

  submit(): void {
    if (this.resubmitInfo() && !this.resubmitAck()) return;   // ยื่นซ้ำต้องยืนยันก่อน
    this.closeConfirm();
    if (!this.canSubmit() || this.isSubmitting() || this.submitResult() === 'success') return;
    this.isSubmitting.set(true);
    this.submitResult.set(null);

    const checklistData: { [key: string]: boolean } = {};
    this.checklist().forEach(c => { checklistData[`item${c.id}`] = c.status === 'pass'; });

    const body: SendPreT3Req = {
      journal_snapshot: {
        issn:             this.issn(),
        journal_name:     this.journalName(),
        journal_url:      this.journalUrl(),
        indexed_database: this.database(),
        quartile_or_tier: this.quartile(),
        is_discontinued:  this.isDiscontinued(),
        is_hijacked:      this.checklist().find(c => c.id === 8)?.status === 'fail',
      },
      article_info: {
        title_en: this.titleEn(),
        title_th: this.titleTh(),
      },
      checklist_data: checklistData,
      // X33: เอาช่องหมายเหตุออกแล้ว — backend ไม่มีคอลัมน์เก็บ ข้อความที่นิสิตพิมพ์หายไปโดยไม่มีใครเห็น
    };

    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    const rs = this.resubmitInfo();
    const request$ = rs
      ? this.http.patch(`${this.constants.API_ENDPOINT}/pre-t3/${rs.preT3Id}/resubmit`, body, { headers })
      : this.http.post(`${this.constants.API_ENDPOINT}/pre-t3`, body, { headers });
    request$
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.isSubmitting.set(false);
        const ok = (res as { success?: boolean } | null)?.success !== false;
        this.submitResult.set(ok ? 'success' : 'error');
        if (ok) {
          setTimeout(() => this.router.navigateByUrl('/pre-t3-status'), 1500);
        } else {
          // ไม่ซ่อนเองแล้ว — เหตุผลอย่าง "ยังไม่มีที่ปรึกษา" นิสิตต้องอ่านทัน
          this.submitError.set(failMsg(res));
        }
      });
  }

  goBack(): void { this.router.navigateByUrl('/search'); }
}
