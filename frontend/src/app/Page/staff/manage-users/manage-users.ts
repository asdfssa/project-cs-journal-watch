import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { AuthService } from '../../../auth.service';
import { Constants } from '../../../comfig/constants';
import { GetManageUsersRes, User, Role, DegreeLevel, AccountStatus } from '../../../model/res/get_manage_users_res';
import type { PatchManageUsersReq } from '../../../model/req/patch_manage_users_req';
import type { PostAddStudentReq }   from '../../../model/req/post_add_student_req';
import type { PostAddAdvisorReq }          from '../../../model/req/post_add_advisor_req';
import type { PatchStudentAddAdvisorReq } from '../../../model/req/patch_student-add_advisor_req';
import { apiFailure, failMsg } from '../../../server-status.service';
import { AppSelect } from '../../../Components/app-select/app-select';
import { downloadBlob } from '../../../file-download';
import { departmentOptions, departmentFits } from '../../../departments';

type TabType = 'student' | 'advisor';

@Component({
  selector: 'app-manage-users',
  standalone: true,
  imports: [CommonModule, FormsModule, AppSelect],
  templateUrl: './manage-users.html',
  styleUrl: './manage-users.scss',
})
export class ManageUsers implements OnInit {
  private http      = inject(HttpClient);
  private auth      = inject(AuthService);
  private constants = inject(Constants);

  isLoading  = signal(true);
  allUsers   = signal<User[]>([]);
  activeTab          = signal<TabType>('student');
  searchText         = signal('');
  statusFilter       = signal<string>('all');
  statusDropdownOpen = signal(false);

  statusLabel = computed(() => {
    const sf = this.statusFilter();
    if (sf === 'Active')    return 'Active';
    if (sf === 'Suspended') return 'ถูกล็อค';
    return 'สถานะทั้งหมด';
  });

  toggleStatusDropdown(): void { this.statusDropdownOpen.update(v => !v); }

  selectStatus(val: string): void {
    this.statusFilter.set(val);
    this.statusDropdownOpen.set(false);
    this.studentPage.set(1);
    this.advisorPage.set(1);
  }

  readonly limit     = 1000;
  readonly PAGE_SIZE = 12;
  studentPage = signal(1);
  advisorPage = signal(1);

  allStudents  = computed(() => this.allUsers().filter(u => u.role === Role.Student));
  allAdvisors  = computed(() => this.allUsers().filter(u => u.role === Role.Supervisor));

  filteredStudents = computed(() => {
    const q  = this.searchText().toLowerCase().trim();
    const sf = this.statusFilter();
    return this.allStudents().filter(u => {
      const matchSearch = !q ||
        this.fullName(u).toLowerCase().includes(q) ||
        this.studentId(u).includes(q) ||
        u.msu_mail.toLowerCase().includes(q);
      const matchStatus = sf === 'all' || u.account_status === sf;
      return matchSearch && matchStatus;
    });
  });

  filteredAdvisors = computed(() => {
    const q  = this.searchText().toLowerCase().trim();
    const sf = this.statusFilter();
    return this.allAdvisors().filter(u => {
      const matchSearch = !q ||
        this.fullName(u).toLowerCase().includes(q) ||
        u.msu_mail.toLowerCase().includes(q);
      const matchStatus = sf === 'all' || u.account_status === sf;
      return matchSearch && matchStatus;
    });
  });

  // แถบสรุปเหนือตาราง: จำนวนทั้งหมดของแท็บที่เปิดอยู่ (+ จำนวนที่พบเมื่อมีตัวกรอง)
  get resultSummary(): { icon: string; label: string; unit: string; total: number; found: number; filtered: boolean } | null {
    if (this.isLoading()) return null;
    const isStudent = this.activeTab() === 'student';
    return {
      icon:     isStudent ? 'ti-school' : 'ti-user-check',
      label:    isStudent ? 'นิสิต' : 'อาจารย์',
      unit:     'คน',
      total:    isStudent ? this.allStudents().length      : this.allAdvisors().length,
      found:    isStudent ? this.filteredStudents().length : this.filteredAdvisors().length,
      filtered: this.statusFilter() !== 'all' || !!this.searchText().trim(),
    };
  }

  studentTotalPages = computed(() => Math.ceil(this.filteredStudents().length / this.PAGE_SIZE));
  advisorTotalPages = computed(() => Math.ceil(this.filteredAdvisors().length / this.PAGE_SIZE));

  pagedStudents = computed(() => {
    const start = (this.studentPage() - 1) * this.PAGE_SIZE;
    return this.filteredStudents().slice(start, start + this.PAGE_SIZE);
  });

  pagedAdvisors = computed(() => {
    const start = (this.advisorPage() - 1) * this.PAGE_SIZE;
    return this.filteredAdvisors().slice(start, start + this.PAGE_SIZE);
  });

  studentPageNumbers = computed(() =>
    Array.from({ length: this.studentTotalPages() }, (_, i) => i + 1)
  );
  advisorPageNumbers = computed(() =>
    Array.from({ length: this.advisorTotalPages() }, (_, i) => i + 1)
  );

  // N5: หลังบันทึกสำเร็จ modal ปิดเองใน 1.5–2 วิ — เก็บ timer ตัวเดียวไว้ยกเลิกได้
  // เดิมใช้ setTimeout ตรงๆ ถ้าผู้ใช้ปิดเองแล้วเปิด modal ใหม่ภายในช่วงนั้น timer เก่าจะปิด modal ที่เพิ่งเปิด
  // ถ้าเปิด modal ใหม่ก่อนถึงเวลา → ทำงานที่ค้างทันที (ปิด modal เก่า + โหลดรายการใหม่) แล้วค่อยเปิดตัวใหม่
  private modalCloseTimer?: ReturnType<typeof setTimeout>;
  private pendingModalClose?: () => void;

  private closeModalLater(fn: () => void, ms: number): void {
    this.flushModalClose();
    this.pendingModalClose = fn;
    this.modalCloseTimer = setTimeout(() => this.flushModalClose(), ms);
  }

  private flushModalClose(): void {
    if (this.modalCloseTimer) clearTimeout(this.modalCloseTimer);
    const fn = this.pendingModalClose;
    this.modalCloseTimer = undefined;
    this.pendingModalClose = undefined;
    fn?.();
  }

  /**
   * feedback backend ข้อ 6: เช็ครูปแบบอีเมลก่อนส่ง — เดิมใส่แค่รหัสนิสิต (ไม่มี @โดเมน) ก็บันทึกได้
   * แล้วล็อกอินด้วย Google ไม่ได้ (backend ตรวจแล้วตอบ 400 INVALID_EMAIL แต่ให้ผู้ใช้เห็นทันทีที่หน้าเว็บ)
   */
  mailError(v: string | null | undefined): string {
    const m = (v ?? '').trim();
    if (!m) return '';
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m) ? '' : 'ต้องเป็นอีเมลเต็ม เช่น name@msu.ac.th (ใส่แค่รหัสนิสิตไม่ได้)';
  }

  ngOnInit(): void { this.loadData(); }

  loadData(): void {
    this.isLoading.set(true);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    const params  = new HttpParams()
      .set('page',  '1')
      .set('limit', String(this.limit));

    this.http
      .get<GetManageUsersRes>(`${this.constants.API_ENDPOINT}/manage/users`, { headers, params })
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        if (res?.success) {
          this.allUsers.set(res.data.users);
        }
        this.isLoading.set(false);
      });
  }

  setTab(t: TabType): void {
    this.activeTab.set(t);
    this.searchText.set('');
    this.statusFilter.set('all');
    this.statusDropdownOpen.set(false);
    this.studentPage.set(1);
    this.advisorPage.set(1);
  }

  setStudentPage(p: number): void {
    if (p < 1 || p > this.studentTotalPages()) return;
    this.studentPage.set(p);
  }

  setAdvisorPage(p: number): void {
    if (p < 1 || p > this.advisorTotalPages()) return;
    this.advisorPage.set(p);
  }

  onSearchChange(val: string): void {
    this.searchText.set(val);
    this.studentPage.set(1);
    this.advisorPage.set(1);
  }

  // ── Add Student Modal ────────────────────────────────────────────
  addStudentModal  = signal(false);
  isAddSaving      = signal(false);
  addSaveResult    = signal<{ ok: boolean; msg: string } | null>(null);
  addStudentForm: PostAddStudentReq = {
    role: 'Student', prefix: '', first_name: '', last_name: '',
    msu_mail: '', phone: '', degree_level: '', curriculum_year: '',
    study_plan_code: '', department: '', advisor_major_mail: '', advisor_co1_mail: '',
  };

  openAddStudentModal(): void {
    this.flushModalClose();
    this.addStudentForm = {
      role: 'Student', prefix: '', first_name: '', last_name: '',
      msu_mail: '', phone: '', degree_level: '', curriculum_year: '',
      study_plan_code: '', department: '', advisor_major_mail: '', advisor_co1_mail: '',
    };
    this.addSaveResult.set(null);
    this.addStudentModal.set(true);
    document.body.style.overflow = 'hidden';
  }

  closeAddStudentModal(): void {
    this.addStudentModal.set(false);
    document.body.style.overflow = '';
  }

  submitAddStudent(): void {
    this.isAddSaving.set(true);
    this.addSaveResult.set(null);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    const payload = { ...this.addStudentForm, advisor_major_mail: null, advisor_co1_mail: null };
    this.http
      .post<{ success: boolean; message?: string }>(
        `${this.constants.API_ENDPOINT}/manage/users/single`,
        payload,
        { headers }
      )
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.isAddSaving.set(false);
        if (res?.success) {
          this.addSaveResult.set({ ok: true, msg: 'เพิ่มนิสิตเรียบร้อยแล้ว' });
          this.closeModalLater(() => { this.closeAddStudentModal(); this.loadData(); }, 1500);
        } else {
          this.addSaveResult.set({ ok: false, msg: failMsg(res) });
        }
      });
  }

  // ── Add Advisor Modal ────────────────────────────────────────────
  addAdvisorModal  = signal(false);
  isAdvisorSaving  = signal(false);
  advisorSaveResult = signal<{ ok: boolean; msg: string } | null>(null);
  addAdvisorForm: PostAddAdvisorReq = {
    role: 'Supervisor', prefix: '', first_name: '', last_name: '', msu_mail: '', phone: '',
  };

  openAddAdvisorModal(): void {
    this.flushModalClose();
    this.addAdvisorForm = {
      role: 'Supervisor', prefix: '', first_name: '', last_name: '', msu_mail: '', phone: '',
    };
    this.advisorSaveResult.set(null);
    this.addAdvisorModal.set(true);
    document.body.style.overflow = 'hidden';
  }

  closeAddAdvisorModal(): void {
    this.addAdvisorModal.set(false);
    document.body.style.overflow = '';
  }

  submitAddAdvisor(): void {
    this.isAdvisorSaving.set(true);
    this.advisorSaveResult.set(null);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    const payload = {
      ...this.addAdvisorForm,
      degree_level: null, curriculum_year: null, study_plan_code: null,
      advisor_major_mail: null, advisor_co1_mail: null,
    };
    this.http
      .post<{ success: boolean; message?: string }>(
        `${this.constants.API_ENDPOINT}/manage/users/single`,
        payload,
        { headers }
      )
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.isAdvisorSaving.set(false);
        if (res?.success) {
          this.advisorSaveResult.set({ ok: true, msg: 'เพิ่มอาจารย์เรียบร้อยแล้ว' });
          this.closeModalLater(() => { this.closeAddAdvisorModal(); this.loadData(); }, 1500);
        } else {
          this.advisorSaveResult.set({ ok: false, msg: failMsg(res) });
        }
      });
  }

  // ── Assign Advisor Modal ─────────────────────────────────────────
  assignAdvisorModal   = signal<User | null>(null);
  isAssignSaving       = signal(false);
  assignAdvisorResult  = signal<{ ok: boolean; msg: string } | null>(null);
  assignAdvisorForm: PatchStudentAddAdvisorReq = {
    advisor_major_mail: '', advisor_co1_mail: '', advisor_co2_mail: '',
  };

  openAssignAdvisorModal(u: User): void {
    this.flushModalClose();
    this.assignAdvisorForm = {
      advisor_major_mail: u.advisors?.Major?.mail ?? '',
      advisor_co1_mail:   u.advisors?.Co_1?.mail  ?? '',
      advisor_co2_mail:   u.advisors?.Co_2?.mail  ?? '',
    };
    this.assignAdvisorResult.set(null);
    this.assignAdvisorModal.set(u);
    document.body.style.overflow = 'hidden';
  }

  closeAssignAdvisorModal(): void {
    this.assignAdvisorModal.set(null);
    document.body.style.overflow = '';
  }

  submitAssignAdvisor(): void {
    const u = this.assignAdvisorModal();
    if (!u) return;
    this.isAssignSaving.set(true);
    this.assignAdvisorResult.set(null);

    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .patch<{ success: boolean; message?: string }>(
        `${this.constants.API_ENDPOINT}/manage/users/${u.user_id}/advisors`,
        this.assignAdvisorForm,
        { headers }
      )
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.isAssignSaving.set(false);
        if (res?.success) {
          this.assignAdvisorResult.set({ ok: true, msg: 'กำหนดอาจารย์ที่ปรึกษาเรียบร้อยแล้ว' });
          this.closeModalLater(() => { this.closeAssignAdvisorModal(); this.loadData(); }, 1500);
        } else {
          this.assignAdvisorResult.set({ ok: false, msg: failMsg(res) });
        }
      });
  }

  // ── Import CSV Modal ─────────────────────────────────────────────
  importModal   = signal(false);
  isImporting   = signal(false);
  importResult  = signal<{ ok: boolean; msg: string; errors?: string[] } | null>(null);
  selectedFile: File | null = null;

  openImportModal(): void {
    this.flushModalClose();
    this.selectedFile = null;
    this.importResult.set(null);
    this.importModal.set(true);
    document.body.style.overflow = 'hidden';
  }

  /**
   * ดาวน์โหลดไฟล์ CSV ตัวอย่างสำหรับนำเข้าผู้ใช้ (feedback backend ข้อ 5) — สร้างในเบราว์เซอร์
   * ใส่ BOM ให้ Excel เปิดภาษาไทยได้ · แถวตัวอย่างเป็นข้อมูลสมมุติ ต้องแก้หรือลบก่อนนำเข้า
   */
  downloadCsvTemplate(): void {
    const rows = [
      ['role', 'first_name', 'last_name', 'msu_mail', 'prefix', 'phone', 'degree_level', 'curriculum_year', 'study_plan_code', 'advisor_major_mail', 'advisor_co1_mail', 'department'],
      ['Supervisor', 'ตัวอย่าง', 'อาจารย์', 'example.supervisor@msu.ac.th', 'ผศ.ดร.', '0800000000', '', '', '', '', '', ''],
      ['Student', 'ตัวอย่าง', 'นิสิต', 'example.student@msu.ac.th', 'นาย', '0900000000', 'Master', '2566', 'Master_A1', '', '', 'เทคโนโลยีสารสนเทศ'],
    ];
    const csv = rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\r\n');
    downloadBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }), 'users-import-template.csv');
  }

  closeImportModal(): void {
    this.importModal.set(false);
    document.body.style.overflow = '';
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
    this.importResult.set(null);
  }

  submitImport(): void {
    if (!this.selectedFile) return;
    this.isImporting.set(true);
    this.importResult.set(null);

    const headers  = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    const formData = new FormData();
    formData.append('file', this.selectedFile);

    this.http
      .post<{ success: boolean; message?: string; data?: { imported?: number; failed?: number } }>(
        `${this.constants.API_ENDPOINT}/manage/users/import`,
        formData,
        { headers }
      )
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.isImporting.set(false);
        if (res?.success) {
          const imported = res.data?.imported ?? 0;
          this.importResult.set({ ok: true, msg: `นำเข้าสำเร็จ ${imported} รายการ` });
          this.closeModalLater(() => { this.closeImportModal(); this.loadData(); }, 2000);
        } else {
          // X35: แสดงทุกแถวที่ผิด (import เป็น all-or-nothing — แก้ไฟล์แล้วอัปโหลดใหม่ทั้งไฟล์)
          this.importResult.set({ ok: false, msg: failMsg(res), errors: (res as { errors?: string[] }).errors });
        }
      });
  }

  // ── Suspend / Activate ───────────────────────────────────────────
  suspendingId  = signal<number | null>(null);
  suspendResult = signal<{ ok: boolean; msg: string } | null>(null);

  // F27: ระงับบัญชีมีผลทันที (ผู้ใช้ login ไม่ได้) — ถามยืนยันก่อน ส่วนเปิดใช้งาน/อนุมัติทำได้เลย
  suspendConfirm = signal<{ name: string; run: () => void } | null>(null);

  askSuspendUser(u: User): void {
    if (u.account_status !== 'Active') { this.suspendUser(u); return; }
    this.suspendConfirm.set({ name: this.fullName(u), run: () => this.suspendUser(u) });
  }

  confirmSuspend(): void {
    const c = this.suspendConfirm();
    this.suspendConfirm.set(null);
    c?.run();
  }

  suspendUser(u: User): void {
    // X24: Pending ยังไม่ใช่ Active — suspend ไม่ได้ และ staff อนุมัติไม่ได้ (/approve เฉพาะ Admin)
    if (this.suspendingId() !== null || u.account_status === AccountStatus.Pending) return;
    this.suspendingId.set(u.user_id);
    this.suspendResult.set(null);

    const isSuspended = u.account_status === AccountStatus.Suspended;
    const endpoint    = isSuspended ? 'activate' : 'suspend';
    const headers     = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });

    this.http
      .patch<{ success: boolean; message?: string; data?: { pending_approvals?: number } }>(
        `${this.constants.API_ENDPOINT}/manage/users/${u.user_id}/${endpoint}`,
        {},
        { headers }
      )
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.suspendingId.set(null);
        if (res?.success) {
          const newStatus = isSuspended ? AccountStatus.Active : AccountStatus.Suspended;
          this.allUsers.update(users =>
            users.map(x => x.user_id === u.user_id ? { ...x, account_status: newStatus } : x)
          );
          let msg = isSuspended ? `เปิดใช้งานบัญชีเรียบร้อยแล้ว` : `ระงับบัญชีเรียบร้อยแล้ว`;
          // B32: ระงับอาจารย์ที่ยังมีคำร้องรออนุมัติ — คำร้องจะค้าง ต้องเปลี่ยนอาจารย์ที่ปรึกษาของนิสิตเอง
          const pending = ('data' in res ? res.data?.pending_approvals : 0) ?? 0;
          if (!isSuspended && pending > 0) {
            msg = `ระงับบัญชีแล้ว — อาจารย์ท่านนี้ยังมีคำร้องรออนุมัติ ${pending} รายการ กรุณาเปลี่ยนอาจารย์ที่ปรึกษาของนิสิตที่เกี่ยวข้อง`;
          }
          this.suspendResult.set({ ok: true, msg });
        } else {
          this.suspendResult.set({ ok: false, msg: `${failMsg(res)}` });
        }
        setTimeout(() => this.suspendResult.set(null), this.suspendResult()?.msg.includes('รออนุมัติ') ? 10000 : 3000);
      });
  }

  // ── Edit Modal ────────────────────────────────────────────────────
  editModal      = signal<User | null>(null);
  editForm: PatchManageUsersReq = {
    prefix: '', first_name: '', last_name: '', msu_mail: '',
    phone: '', degree_level: '', curriculum_year: '', study_plan_code: '', department: '',
  };
  isEditSaving   = signal(false);
  editSaveResult = signal<{ ok: boolean; msg: string } | null>(null);

  readonly prefixOptions          = ['นาย', 'นางสาว', 'นาง'];
  readonly advisorPrefixOptions   = ['ผศ.', 'ผศ.ดร.', 'รศ.', 'รศ.ดร.', 'ศ.', 'ศ.ดร.', 'ดร.', 'อ.'];
  readonly curriculumYearOptions  = ['2560', '2566'];

  readonly degreeLevelOptions = [
    { value: 'Master',   label: 'ป.โท (Master)' },
    { value: 'Doctoral', label: 'ป.เอก (Doctoral)' },
  ];

  // สาขาวิชา — ปริญญาเอกมีแค่ 3 สาขาแรก · เปลี่ยนระดับแล้วสาขาเดิมใช้ไม่ได้ → เคลียร์ (backend ตอบ 400 ถ้าส่งคู่ที่ไม่ถูก)
  readonly departmentOptions = departmentOptions;

  onDegreeChange(form: { degree_level: string; department?: string }, degree: string): void {
    form.degree_level = degree;
    if (!departmentFits(form.department, degree)) form.department = '';
  }

  readonly studyPlanOptions = [
    { group: 'Master',   values: ['Master_A1','Master_A2','Master_B','Master_P1A1','Master_P1A2','Master_P2B'] },
    { group: 'Doctoral', values: ['Doc_1_1','Doc_1_2','Doc_2_1','Doc_2_2','Doc_P1_1_1','Doc_P1_1_2','Doc_P2_2_1','Doc_P2_2_2'] },
  ];

  openEditModal(u: User): void {
    this.flushModalClose();
    this.editForm = {
      prefix:          u.prefix          ?? '',
      first_name:      u.first_name      ?? '',
      last_name:       u.last_name       ?? '',
      msu_mail:        u.msu_mail        ?? '',
      phone:           u.phone           ?? '',
      degree_level:    u.degree_level    ?? '',
      curriculum_year: u.curriculum_year ?? '',
      study_plan_code: u.study_plan_code ?? '',
      department:      u.department      ?? '',
    };
    this.editSaveResult.set(null);
    this.editModal.set(u);
    document.body.style.overflow = 'hidden';
  }

  closeEditModal(): void {
    this.editModal.set(null);
    document.body.style.overflow = '';
  }

  submitEdit(): void {
    const u = this.editModal();
    if (!u) return;
    this.isEditSaving.set(true);
    this.editSaveResult.set(null);

    // Staff เปลี่ยน msu_mail ไม่ได้ (backend ตอบ 403) — ไม่ส่ง field นี้ไป ให้ backend คงค่าเดิม
    const { msu_mail: _mail, ...rest } = this.editForm;
    // ระดับการศึกษา/ปีหลักสูตร/รหัสหลักสูตร/สาขา เป็นของนิสิตเท่านั้น — แก้อาจารย์ไม่ส่ง
    const { degree_level: _d, curriculum_year: _c, study_plan_code: _s, department: _dep, ...common } = rest;
    const body = u.role === Role.Student ? rest : common;
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .patch<{ success: boolean; message?: string }>(
        `${this.constants.API_ENDPOINT}/manage/users/${u.user_id}`,
        body,
        { headers }
      )
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.isEditSaving.set(false);
        if (res?.success) {
          this.editSaveResult.set({ ok: true, msg: 'บันทึกข้อมูลเรียบร้อยแล้ว' });
          // อัปเดต local list ทันที
          this.allUsers.update(users => users.map(x =>
            x.user_id === u.user_id
              ? { ...x,
                  prefix:          this.editForm.prefix          || null,
                  first_name:      this.editForm.first_name,
                  last_name:       this.editForm.last_name,
                  msu_mail:        this.editForm.msu_mail,
                  phone:           this.editForm.phone           || null,
                  degree_level:    (this.editForm.degree_level   || null) as DegreeLevel | null,
                  curriculum_year: this.editForm.curriculum_year || null,
                  study_plan_code: this.editForm.study_plan_code || null,
                  department:      u.role === Role.Student ? (this.editForm.department || null) : x.department,
                }
              : x
          ));
          this.closeModalLater(() => this.closeEditModal(), 1500);
        } else {
          this.editSaveResult.set({ ok: false, msg: failMsg(res) });
        }
      });
  }

  // ── Helpers ───────────────────────────────────────────────────────
  fullName(u: User): string {
    return `${u.prefix ? u.prefix + ' ' : ''}${u.first_name} ${u.last_name}`.trim();
  }

  studentId(u: User): string {
    return u.msu_mail.replace('@msu.ac.th', '');
  }

  degreeLabel(d: DegreeLevel | null): string {
    if (d === DegreeLevel.Doctoral) return 'ป.เอก';
    if (d === DegreeLevel.Master)   return 'ป.โท';
    return '—';
  }

  majorAdvisorName(u: User): string {
    return u.advisors?.Major?.name ?? '—';
  }

  /** X44: นับที่ backend (Major + Co_1 + Co_2 จาก DB ทั้งหมด) — เดิมนับเองจากนิสิตที่โหลดมาและไม่นับ Co_2 */
  advisorStudentCount(u: User): number {
    return u.student_count ?? 0;
  }

  formatDate(d: Date | string | null): string {
    if (!d) return '—';
    return new Date(d as string).toLocaleDateString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }
}
