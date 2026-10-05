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

type TabType = 'student' | 'advisor';

@Component({
  selector: 'app-manage-users',
  standalone: true,
  imports: [CommonModule, FormsModule],
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
    study_plan_code: '', advisor_major_mail: '', advisor_co1_mail: '',
  };

  openAddStudentModal(): void {
    this.addStudentForm = {
      role: 'Student', prefix: '', first_name: '', last_name: '',
      msu_mail: '', phone: '', degree_level: '', curriculum_year: '',
      study_plan_code: '', advisor_major_mail: '', advisor_co1_mail: '',
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
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        this.isAddSaving.set(false);
        if (res?.success) {
          this.addSaveResult.set({ ok: true, msg: 'เพิ่มนิสิตเรียบร้อยแล้ว' });
          setTimeout(() => { this.closeAddStudentModal(); this.loadData(); }, 1500);
        } else {
          this.addSaveResult.set({ ok: false, msg: res?.message ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
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
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        this.isAdvisorSaving.set(false);
        if (res?.success) {
          this.advisorSaveResult.set({ ok: true, msg: 'เพิ่มอาจารย์เรียบร้อยแล้ว' });
          setTimeout(() => { this.closeAddAdvisorModal(); this.loadData(); }, 1500);
        } else {
          this.advisorSaveResult.set({ ok: false, msg: res?.message ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
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
    this.assignAdvisorForm = {
      advisor_major_mail: u.advisors?.Major?.mail ?? '',
      advisor_co1_mail:   u.advisors?.Co_1?.mail  ?? '',
      advisor_co2_mail:   '',
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
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        this.isAssignSaving.set(false);
        if (res?.success) {
          this.assignAdvisorResult.set({ ok: true, msg: 'กำหนดอาจารย์ที่ปรึกษาเรียบร้อยแล้ว' });
          setTimeout(() => { this.closeAssignAdvisorModal(); this.loadData(); }, 1500);
        } else {
          this.assignAdvisorResult.set({ ok: false, msg: res?.message ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
        }
      });
  }

  // ── Import CSV Modal ─────────────────────────────────────────────
  importModal   = signal(false);
  isImporting   = signal(false);
  importResult  = signal<{ ok: boolean; msg: string } | null>(null);
  selectedFile: File | null = null;

  openImportModal(): void {
    this.selectedFile = null;
    this.importResult.set(null);
    this.importModal.set(true);
    document.body.style.overflow = 'hidden';
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
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        this.isImporting.set(false);
        if (res?.success) {
          const imported = res.data?.imported ?? 0;
          this.importResult.set({ ok: true, msg: `นำเข้าสำเร็จ ${imported} รายการ` });
          setTimeout(() => { this.closeImportModal(); this.loadData(); }, 2000);
        } else {
          this.importResult.set({ ok: false, msg: res?.message ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
        }
      });
  }

  // ── Suspend / Activate ───────────────────────────────────────────
  suspendingId  = signal<number | null>(null);
  suspendResult = signal<{ ok: boolean; msg: string } | null>(null);

  suspendUser(u: User): void {
    if (this.suspendingId() !== null) return;
    this.suspendingId.set(u.user_id);
    this.suspendResult.set(null);

    const isSuspended = u.account_status === AccountStatus.Suspended;
    const endpoint    = isSuspended ? 'activate' : 'suspend';
    const headers     = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });

    this.http
      .patch<{ success: boolean; message?: string }>(
        `${this.constants.API_ENDPOINT}/manage/users/${u.user_id}/${endpoint}`,
        {},
        { headers }
      )
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        this.suspendingId.set(null);
        if (res?.success) {
          const newStatus = isSuspended ? AccountStatus.Active : AccountStatus.Suspended;
          this.allUsers.update(users =>
            users.map(x => x.user_id === u.user_id ? { ...x, account_status: newStatus } : x)
          );
          this.suspendResult.set({
            ok:  true,
            msg: isSuspended ? `✅ เปิดใช้งานบัญชีเรียบร้อยแล้ว` : `🚫 ระงับบัญชีเรียบร้อยแล้ว`,
          });
        } else {
          this.suspendResult.set({ ok: false, msg: '⚠️ เกิดข้อผิดพลาด กรุณาลองใหม่' });
        }
        setTimeout(() => this.suspendResult.set(null), 3000);
      });
  }

  // ── Edit Modal ────────────────────────────────────────────────────
  editModal      = signal<User | null>(null);
  editForm: PatchManageUsersReq = {
    prefix: '', first_name: '', last_name: '', msu_mail: '',
    phone: '', degree_level: '', curriculum_year: '', study_plan_code: '',
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

  readonly studyPlanOptions = [
    { group: 'Master',   values: ['Master_A1','Master_A2','Master_B','Master_P1A1','Master_P1A2','Master_P2B'] },
    { group: 'Doctoral', values: ['Doc_1_1','Doc_1_2','Doc_2_1','Doc_2_2','Doc_P1_1_1','Doc_P1_1_2','Doc_P2_2_1','Doc_P2_2_2'] },
  ];

  openEditModal(u: User): void {
    this.editForm = {
      prefix:          u.prefix          ?? '',
      first_name:      u.first_name      ?? '',
      last_name:       u.last_name       ?? '',
      msu_mail:        u.msu_mail        ?? '',
      phone:           u.phone           ?? '',
      degree_level:    u.degree_level    ?? '',
      curriculum_year: u.curriculum_year ?? '',
      study_plan_code: u.study_plan_code ?? '',
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

    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .patch<{ success: boolean; message?: string }>(
        `${this.constants.API_ENDPOINT}/manage/users/${u.user_id}`,
        this.editForm,
        { headers }
      )
      .pipe(catchError(() => of(null)))
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
                }
              : x
          ));
          setTimeout(() => this.closeEditModal(), 1500);
        } else {
          this.editSaveResult.set({ ok: false, msg: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
        }
      });
  }

  // ── Helpers ───────────────────────────────────────────────────────
  fullName(u: User): string {
    return `${u.prefix ? u.prefix + ' ' : ''}${u.first_name} ${u.last_name}`.trim();
  }

  initials(u: User): string {
    return ((u.first_name?.[0] ?? '') + (u.last_name?.[0] ?? '')).toUpperCase();
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

  advisorStudentCount(u: User): number {
    const mail = u.msu_mail;
    return this.allStudents().filter(s =>
      s.advisors?.Major?.mail === mail || s.advisors?.Co_1?.mail === mail
    ).length;
  }

  formatDate(d: Date | string | null): string {
    if (!d) return '—';
    return new Date(d as string).toLocaleDateString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }
}
