import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { AuthService } from '../../../auth.service';
import { Constants } from '../../../comfig/constants';
import { GetManageUsersRes, User, Role, DegreeLevel, AccountStatus } from '../../../model_admin/res/get_manage_users_res';
import type { PatchManageUsersReq } from '../../../model/req/patch_manage_users_req';
import type { PostAddStudentReq }   from '../../../model/req/post_add_student_req';
import type { PostAddAdvisorReq }          from '../../../model/req/post_add_advisor_req';
import type { PatchStudentAddAdvisorReq } from '../../../model/req/patch_student-add_advisor_req';
import type { PostAddAdminReq } from '../../../model_admin/req/post_add_admin_req';
import type { PatchAdminReq }   from '../../../model_admin/req/patch_admin_req';
import { GetAdminListRes, Admin } from '../../../model_admin/res/get_admin_list_res';

type TabType = 'student' | 'advisor' | 'staff' | 'admin';

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

  get isSuperAdmin(): boolean {
    return this.auth.user?.role === 'SuperAdmin'
      || (JSON.parse(localStorage.getItem('user') ?? 'null') as any)?.role === 'SuperAdmin';
  }
  get canSeeAdminTab(): boolean { return this.isSuperAdmin; }

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
  }

  currentPage = signal(1);
  totalPages  = signal(1);
  totalItems  = signal(0);
  readonly limit = 20;

  allStudents  = computed(() => this.allUsers().filter(u => u.role === Role.Student));
  allAdvisors  = computed(() => this.allUsers().filter(u => u.role === Role.Supervisor));
  allStaff     = computed(() => this.allUsers().filter(u => u.role === Role.Staff));

  // ── Admin tab ─────────────────────────────────────────────────────
  allAdmins        = signal<Admin[]>([]);
  isLoadingAdmins  = signal(false);

  filteredAdmins = computed(() => {
    const q  = this.searchText().toLowerCase().trim();
    const sf = this.statusFilter();
    return this.allAdmins().filter(a => {
      const name = `${a.first_name} ${a.last_name}`.toLowerCase();
      const matchSearch = !q || name.includes(q)
        || a.username.toLowerCase().includes(q)
        || a.msu_mail.toLowerCase().includes(q);
      const matchStatus = sf === 'all' || a.account_status === sf;
      return matchSearch && matchStatus;
    });
  });

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

  filteredStaff = computed(() => {
    const q  = this.searchText().toLowerCase().trim();
    const sf = this.statusFilter();
    return this.allStaff().filter(u => {
      const matchSearch = !q ||
        this.fullName(u).toLowerCase().includes(q) ||
        u.msu_mail.toLowerCase().includes(q);
      const matchStatus = sf === 'all' || u.account_status === sf;
      return matchSearch && matchStatus;
    });
  });

  ngOnInit(): void {
    window.scrollTo({ top: 0 });
    this.loadData();
  }

  loadData(): void {
    this.isLoading.set(true);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    const params  = new HttpParams()
      .set('page',  String(this.currentPage()))
      .set('limit', String(this.limit));

    this.http
      .get<GetManageUsersRes>(`${this.constants.API_ENDPOINT}/manage/users`, { headers, params })
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        if (res?.success) {
          this.allUsers.set(res.data.users);
          this.totalPages.set(res.data.pagination.totalPages);
          this.totalItems.set(res.data.pagination.total);
        }
        this.isLoading.set(false);
      });
  }

  setTab(t: TabType): void {
    this.activeTab.set(t);
    this.searchText.set('');
    this.statusFilter.set('all');
    this.statusDropdownOpen.set(false);
    if (t === 'admin') this.loadAdmins();
  }

  loadAdmins(): void {
    this.isLoadingAdmins.set(true);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .get<GetAdminListRes>(`${this.constants.API_ENDPOINT}/admin/admins`, { headers })
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        if (res?.success) this.allAdmins.set(res.data.admins);
        this.isLoadingAdmins.set(false);
      });
  }

  setPage(p: number): void {
    if (p < 1 || p > this.totalPages()) return;
    this.currentPage.set(p);
    this.loadData();
  }

  pageNumbers = computed(() =>
    Array.from({ length: this.totalPages() }, (_, i) => i + 1)
  );

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

  // ── Add Staff Modal ──────────────────────────────────────────────
  addStaffModal   = signal(false);
  isStaffSaving   = signal(false);
  staffSaveResult = signal<{ ok: boolean; msg: string } | null>(null);
  addStaffForm: PostAddAdvisorReq = {
    role: 'Staff', prefix: '', first_name: '', last_name: '', msu_mail: '', phone: '',
  };

  openAddStaffModal(): void {
    this.addStaffForm = { role: 'Staff', prefix: '', first_name: '', last_name: '', msu_mail: '', phone: '' };
    this.staffSaveResult.set(null);
    this.addStaffModal.set(true);
    document.body.style.overflow = 'hidden';
  }

  closeAddStaffModal(): void {
    this.addStaffModal.set(false);
    document.body.style.overflow = '';
  }

  submitAddStaff(): void {
    this.isStaffSaving.set(true);
    this.staffSaveResult.set(null);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    const payload = {
      ...this.addStaffForm,
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
        this.isStaffSaving.set(false);
        if (res?.success) {
          this.staffSaveResult.set({ ok: true, msg: 'เพิ่ม Staff เรียบร้อยแล้ว' });
          setTimeout(() => { this.closeAddStaffModal(); this.loadData(); }, 1500);
        } else {
          this.staffSaveResult.set({ ok: false, msg: res?.message ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
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

    const isPending   = u.account_status === AccountStatus.Pending;
    const isSuspended = u.account_status === AccountStatus.Suspended;
    const endpoint    = isPending ? 'approve' : isSuspended ? 'activate' : 'suspend';
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
          const msg = isPending ? `✅ อนุมัติบัญชีเรียบร้อยแล้ว`
                    : isSuspended ? `✅ เปิดใช้งานบัญชีเรียบร้อยแล้ว`
                    : `🚫 ระงับบัญชีเรียบร้อยแล้ว`;
          this.suspendResult.set({ ok: true, msg });
          this.loadData();
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

  // ── Add Admin Modal (SuperAdmin only) ────────────────────────────
  addAdminModal    = signal(false);
  isAddAdminSaving = signal(false);
  addAdminResult   = signal<{ ok: boolean; msg: string } | null>(null);
  addAdminForm: PostAddAdminReq = { username: '', password: '', first_name: '', last_name: '', msu_mail: '' };

  openAddAdminModal(): void {
    this.addAdminForm = { username: '', password: '', first_name: '', last_name: '', msu_mail: '' };
    this.addAdminResult.set(null);
    this.addAdminModal.set(true);
    document.body.style.overflow = 'hidden';
  }

  closeAddAdminModal(): void {
    this.addAdminModal.set(false);
    document.body.style.overflow = '';
  }

  submitAddAdmin(): void {
    this.isAddAdminSaving.set(true);
    this.addAdminResult.set(null);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .post<{ success: boolean; message?: string }>(
        `${this.constants.API_ENDPOINT}/admin/admins`,
        this.addAdminForm,
        { headers }
      )
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        this.isAddAdminSaving.set(false);
        if (res?.success) {
          this.addAdminResult.set({ ok: true, msg: 'เพิ่ม Admin เรียบร้อยแล้ว' });
          setTimeout(() => { this.closeAddAdminModal(); this.loadAdmins(); }, 1500);
        } else {
          this.addAdminResult.set({ ok: false, msg: res?.message ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
        }
      });
  }

  // ── Edit Admin Modal (SuperAdmin only) ───────────────────────────
  editAdminModal    = signal<Admin | null>(null);
  isEditAdminSaving = signal(false);
  editAdminResult   = signal<{ ok: boolean; msg: string } | null>(null);
  editAdminForm: PatchAdminReq = { first_name: '', last_name: '', msu_mail: '' };

  openEditAdminModal(a: Admin): void {
    this.editAdminForm = { first_name: a.first_name, last_name: a.last_name, msu_mail: a.msu_mail };
    this.editAdminResult.set(null);
    this.editAdminModal.set(a);
    document.body.style.overflow = 'hidden';
  }

  closeEditAdminModal(): void {
    this.editAdminModal.set(null);
    document.body.style.overflow = '';
  }

  submitEditAdmin(): void {
    const a = this.editAdminModal();
    if (!a) return;
    this.isEditAdminSaving.set(true);
    this.editAdminResult.set(null);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .patch<{ success: boolean; message?: string }>(
        `${this.constants.API_ENDPOINT}/admin/admins/${a.user_id}`,
        this.editAdminForm,
        { headers }
      )
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        this.isEditAdminSaving.set(false);
        if (res?.success) {
          this.editAdminResult.set({ ok: true, msg: 'แก้ไขข้อมูลเรียบร้อยแล้ว' });
          this.allAdmins.update(list => list.map(x =>
            x.user_id === a.user_id
              ? { ...x, first_name: this.editAdminForm.first_name, last_name: this.editAdminForm.last_name, msu_mail: this.editAdminForm.msu_mail }
              : x
          ));
          setTimeout(() => this.closeEditAdminModal(), 1500);
        } else {
          this.editAdminResult.set({ ok: false, msg: res?.message ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
        }
      });
  }

  // ── Suspend / Activate Admin (SuperAdmin only) ───────────────────
  suspendingAdminId = signal<number | null>(null);

  suspendAdmin(a: Admin): void {
    if (this.suspendingAdminId() !== null) return;
    this.suspendingAdminId.set(a.user_id);
    const isSuspended = a.account_status === 'Suspended';
    const endpoint    = isSuspended ? 'activate' : 'suspend';
    const headers     = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .patch<{ success: boolean; message?: string }>(
        `${this.constants.API_ENDPOINT}/admin/admins/${a.user_id}/${endpoint}`,
        {},
        { headers }
      )
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        this.suspendingAdminId.set(null);
        if (res?.success) {
          const newStatus = isSuspended ? 'Active' : 'Suspended';
          this.allAdmins.update(list =>
            list.map(x => x.user_id === a.user_id ? { ...x, account_status: newStatus } : x)
          );
          this.suspendResult.set({
            ok: true,
            msg: isSuspended ? '✅ เปิดใช้งานบัญชีเรียบร้อยแล้ว' : '🚫 ระงับบัญชีเรียบร้อยแล้ว',
          });
        } else {
          this.suspendResult.set({ ok: false, msg: '⚠️ เกิดข้อผิดพลาด กรุณาลองใหม่' });
        }
        setTimeout(() => this.suspendResult.set(null), 3000);
      });
  }

  // ── Helpers ───────────────────────────────────────────────────────
  adminFullName(a: Admin): string {
    return `${a.first_name} ${a.last_name}`.trim();
  }

  adminInitials(a: Admin): string {
    return ((a.first_name?.[0] ?? '') + (a.last_name?.[0] ?? '')).toUpperCase();
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
