import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { catchError, forkJoin, of } from 'rxjs';
import { AuthService, readStoredAdmin } from '../../../auth.service';
import { Constants } from '../../../comfig/constants';
import { GetManageUsersRes, User, Role, DegreeLevel, AccountStatus } from '../../../model_admin/res/get_manage_users_res';
import type { PatchManageUsersReq } from '../../../model/req/patch_manage_users_req';
import type { PostAddStudentReq }   from '../../../model/req/post_add_student_req';
import type { PostAddAdvisorReq }          from '../../../model/req/post_add_advisor_req';
import type { PatchStudentAddAdvisorReq } from '../../../model/req/patch_student-add_advisor_req';
import type { PostAddAdminReq } from '../../../model_admin/req/post_add_admin_req';
import type { PatchAdminReq }   from '../../../model_admin/req/patch_admin_req';
import { GetAdminListRes, Admin } from '../../../model_admin/res/get_admin_list_res';
import { apiFailure, failMsg } from '../../../server-status.service';
import { AppSelect } from '../../../Components/app-select/app-select';
import { passwordProblem } from '../../../password-policy';
import { downloadBlob } from '../../../file-download';
import { departmentOptions, departmentFits } from '../../../departments';

type TabType = 'student' | 'advisor' | 'staff' | 'admin';
type UserTab = Exclude<TabType, 'admin'>;

// role ที่ backend ใช้กรองของแต่ละแท็บ
const TAB_ROLE: Record<UserTab, Role> = {
  student: Role.Student,
  advisor: Role.Supervisor,
  staff:   Role.Staff,
};

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
  private router    = inject(Router);

  get isSuperAdmin(): boolean {
    return this.auth.user?.role === 'SuperAdmin'
      || (readStoredAdmin() as any)?.role === 'SuperAdmin';
  }
  /** Admin และ SuperAdmin จัดการบัญชี Admin ได้ทั้งคู่ (แต่ Admin แตะแถว SuperAdmin ไม่ได้ — ดู canManageAdminRow) */
  get canManageAdmins(): boolean {
    const role = this.auth.user?.role ?? (readStoredAdmin() as any)?.role;
    return role === 'Admin' || role === 'SuperAdmin';
  }
  get canSeeAdminTab(): boolean { return this.canManageAdmins; }

  /** Admin ห้ามแก้/ระงับ/ลบบัญชี SuperAdmin (backend ตอบ 403) — SuperAdmin จัดการได้ทุกแถว */
  canManageAdminRow(a: Admin): boolean {
    if (!this.canManageAdmins) return false;
    return this.isSuperAdmin || a.role !== 'SuperAdmin';
  }

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
    if (sf === 'Pending')   return 'รออนุมัติ';
    return 'สถานะทั้งหมด';
  });

  toggleStatusDropdown(): void { this.statusDropdownOpen.update(v => !v); }

  selectStatus(val: string): void {
    this.statusFilter.set(val);
    this.statusDropdownOpen.set(false);
    this.reloadFromFirstPage();
  }

  // ค้นหา: แท็บ admin กรองฝั่ง client (โหลดมาครบแล้ว) ส่วนแท็บอื่นให้ backend ค้น
  // รอหยุดพิมพ์ 400ms ก่อนยิง กันยิง API ทุกตัวอักษร
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  onSearchChange(val: string): void {
    this.searchText.set(val);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.reloadFromFirstPage(), 400);
  }

  private reloadFromFirstPage(): void {
    if (this.activeTab() === 'admin') return;
    this.currentPage.set(1);
    this.loadData();
  }

  currentPage = signal(1);
  totalPages  = signal(1);
  totalItems  = signal(0);
  readonly limit = 20;

  // จำนวนทั้งหมดของแต่ละ role (ตัวเลขบนแท็บ) — ไม่ขึ้นกับตัวกรองสถานะ/คำค้น
  roleCounts = signal<Record<UserTab, number>>({ student: 0, advisor: 0, staff: 0 });
  /** feedback backend ข้อ 1.2: staff ที่สมัครเข้ามารออนุมัติ — แสดงบนแท็บ ไม่งั้นคำขอค้างถ้า admin ไม่เปิดดูเอง */
  pendingStaffCount = signal(0);

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

  // backend กรอง role/status/search + แบ่งหน้าให้แล้ว — ตรงนี้กรอง role ซ้ำอีกชั้น
  // กันรายชื่อของแท็บเก่าโผล่ชั่วขณะระหว่างรอโหลดแท็บใหม่
  filteredStudents = computed(() => this.allUsers().filter(u => u.role === Role.Student));
  filteredAdvisors = computed(() => this.allUsers().filter(u => u.role === Role.Supervisor));
  filteredStaff    = computed(() => this.allUsers().filter(u => u.role === Role.Staff));

  // แถบสรุปเหนือตาราง: จำนวนทั้งหมดของแท็บที่เปิดอยู่ (+ จำนวนที่พบเมื่อมีตัวกรอง)
  get resultSummary(): { icon: string; label: string; unit: string; total: number; found: number; filtered: boolean } | null {
    const tab = this.activeTab();
    if (tab === 'admin' ? this.isLoadingAdmins() : this.isLoading()) return null;
    const meta = {
      student: { icon: 'ti-school',      label: 'นิสิต',   unit: 'คน' },
      advisor: { icon: 'ti-user-check',  label: 'อาจารย์', unit: 'คน' },
      staff:   { icon: 'ti-user',        label: 'Staff',   unit: 'คน' },
      admin:   { icon: 'ti-shield-lock', label: 'Admin',   unit: 'คน' },
    }[tab];
    return {
      ...meta,
      total:    tab === 'admin' ? this.allAdmins().length      : this.roleCounts()[tab],
      found:    tab === 'admin' ? this.filteredAdmins().length : this.totalItems(),
      filtered: this.statusFilter() !== 'all' || !!this.searchText().trim(),
    };
  }

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

  ngOnInit(): void {
    window.scrollTo({ top: 0 });
    this.loadData();
    this.loadRoleCounts();
  }

  private loadSeq = 0;

  loadData(): void {
    const tab = this.activeTab();
    if (tab === 'admin') return;

    const seq = ++this.loadSeq;
    this.isLoading.set(true);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    let params = new HttpParams()
      .set('page',  String(this.currentPage()))
      .set('limit', String(this.limit))
      .set('role',  TAB_ROLE[tab]);
    const status = this.statusFilter();
    const search = this.searchText().trim();
    if (status !== 'all') params = params.set('status', status);
    if (search)           params = params.set('search', search);

    this.http
      .get<GetManageUsersRes>(`${this.constants.API_ENDPOINT}/manage/users`, { headers, params })
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        // ผลของ request เก่า (เช่น พิมพ์ค้นหาต่อ/สลับแท็บไปแล้ว) มาช้ากว่า → ทิ้ง
        if (seq !== this.loadSeq) return;
        if (res?.success) {
          this.allUsers.set(res.data.users);
          this.totalPages.set(Math.max(1, res.data.pagination.totalPages));
          this.totalItems.set(res.data.pagination.total);
        }
        this.isLoading.set(false);
      });
  }

  // ยิง limit=1 ต่อ role พร้อมกัน เอาแค่ pagination.total มาเป็นตัวเลขบนแท็บ
  loadRoleCounts(): void {
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    const count = (role: Role, status?: string) => this.http
      .get<GetManageUsersRes>(`${this.constants.API_ENDPOINT}/manage/users`, {
        headers,
        params: status
          ? new HttpParams().set('role', role).set('status', status).set('page', '1').set('limit', '1')
          : new HttpParams().set('role', role).set('page', '1').set('limit', '1'),
      })
      .pipe(catchError(() => of(null)));

    forkJoin({
      student: count(TAB_ROLE.student),
      advisor: count(TAB_ROLE.advisor),
      staff:   count(TAB_ROLE.staff),
      pending: count(TAB_ROLE.staff, 'Pending'),
    }).subscribe(r => {
      this.roleCounts.set({
        student: r.student?.data.pagination.total ?? 0,
        advisor: r.advisor?.data.pagination.total ?? 0,
        staff:   r.staff?.data.pagination.total   ?? 0,
      });
      this.pendingStaffCount.set(r.pending?.data.pagination.total ?? 0);
    });
  }

  // ── รายชื่ออาจารย์เต็ม (ไม่แบ่งหน้า) — ใช้กับ datalist ใน modal กำหนดอาจารย์ (backend ให้ limit ได้ถึง 1000)
  // ("ดูแลนิสิต N คน" ไม่ต้องโหลดนิสิตทั้งหมดมานับแล้ว ใช้ student_count จาก backend — X44)
  allAdvisors      = signal<User[]>([]);

  private fetchAllByRole(role: Role, target: { set(v: User[]): void }): void {
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .get<GetManageUsersRes>(`${this.constants.API_ENDPOINT}/manage/users`, {
        headers,
        params: new HttpParams().set('role', role).set('page', '1').set('limit', '1000'),
      })
      .pipe(catchError(() => of(null)))
      .subscribe(res => { if (res?.success) target.set(res.data.users); });
  }

  /** หลังเพิ่ม/import ผู้ใช้ — จำนวนต่อ role เปลี่ยน ต้องโหลดตัวเลขบนแท็บใหม่ด้วย */
  private refreshAll(): void {
    this.loadData();
    this.loadRoleCounts();
    if (this.allAdvisors().length)      this.fetchAllByRole(Role.Supervisor, this.allAdvisors);
  }

  setTab(t: TabType): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.activeTab.set(t);
    this.searchText.set('');
    this.statusFilter.set('all');
    this.statusDropdownOpen.set(false);
    this.currentPage.set(1);
    if (t === 'admin') this.loadAdmins();
    else this.loadData();
  }

  loadAdmins(): void {
    this.isLoadingAdmins.set(true);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      // X45: ค่าเริ่มต้นของ backend คือ 20 คนแรก — admin มีไม่กี่คน ขอทีเดียวให้ครบ (backend รับ limit สูงสุด 1000)
      .get<GetAdminListRes>(`${this.constants.API_ENDPOINT}/admin/admins`, {
        headers, params: new HttpParams().set('page', '1').set('limit', '1000'),
      })
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
          this.closeModalLater(() => { this.closeAddStudentModal(); this.refreshAll(); }, 1500);
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
          this.closeModalLater(() => { this.closeAddAdvisorModal(); this.refreshAll(); }, 1500);
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
    if (!this.allAdvisors().length) this.fetchAllByRole(Role.Supervisor, this.allAdvisors);
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
          this.closeModalLater(() => { this.closeImportModal(); this.refreshAll(); }, 2000);
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
  suspendConfirm = signal<{ name: string; run: () => void; reject?: boolean } | null>(null);

  askSuspendUser(u: User): void {
    if (u.account_status !== 'Active') { this.suspendUser(u); return; }
    this.suspendConfirm.set({ name: this.fullName(u), run: () => this.suspendUser(u) });
  }

  /**
   * X39: ปฏิเสธ staff ที่สมัครเข้ามา (Pending) — ตกลงกับ backend ใช้ /suspend (ทาง ข.)
   * บัญชีกลายเป็น Suspended และสมัครซ้ำด้วยอีเมลเดิมไม่ได้ (กันสแปมวนกลับมา)
   */
  askRejectUser(u: User): void {
    if (u.account_status !== 'Pending') return;
    this.suspendConfirm.set({ name: this.fullName(u), run: () => this.suspendUser(u, true), reject: true });
  }

  /**
   * ห้ามระงับบัญชีตัวเอง (ระงับแล้วถูกตัด session เข้ากลับมาไม่ได้)
   * และห้ามระงับ SuperAdmin (ถ้าเหลือคนเดียวจะไม่มีใครปลดล็อคให้ได้) — กฎเดียวกับปุ่มลบ
   */
  canSuspendAdmin(a: Admin): boolean {
    return this.canDeleteAdmin(a);
  }

  askSuspendAdmin(a: Admin): void {
    if (!this.canSuspendAdmin(a)) return;
    if (a.account_status !== 'Active') { this.suspendAdmin(a); return; }
    this.suspendConfirm.set({ name: this.adminFullName(a), run: () => this.suspendAdmin(a) });
  }

  confirmSuspend(): void {
    const c = this.suspendConfirm();
    this.suspendConfirm.set(null);
    c?.run();
  }

  suspendUser(u: User, reject = false): void {
    if (this.suspendingId() !== null) return;
    this.suspendingId.set(u.user_id);
    this.suspendResult.set(null);

    const isPending   = u.account_status === AccountStatus.Pending;
    const isSuspended = u.account_status === AccountStatus.Suspended;
    const endpoint    = reject ? 'suspend' : isPending ? 'approve' : isSuspended ? 'activate' : 'suspend';
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
          let msg = reject ? `ปฏิเสธการสมัครเรียบร้อยแล้ว`
                  : isPending ? `อนุมัติบัญชีเรียบร้อยแล้ว`
                  : isSuspended ? `เปิดใช้งานบัญชีเรียบร้อยแล้ว`
                  : `ระงับบัญชีเรียบร้อยแล้ว`;
          // B32: ระงับอาจารย์ที่ยังมีคำร้องรออนุมัติ — คำร้องจะค้าง ต้องเปลี่ยนอาจารย์ที่ปรึกษาของนิสิตเอง
          const pending = ('data' in res ? res.data?.pending_approvals : 0) ?? 0;
          if (!isSuspended && pending > 0) {
            msg = `ระงับบัญชีแล้ว — อาจารย์ท่านนี้ยังมีคำร้องรออนุมัติ ${pending} รายการ กรุณาเปลี่ยนอาจารย์ที่ปรึกษาของนิสิตที่เกี่ยวข้อง`;
          }
          this.suspendResult.set({ ok: true, msg });
          this.loadData();
          if (isPending) this.loadRoleCounts();
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

    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .patch<{ success: boolean; message?: string }>(
        `${this.constants.API_ENDPOINT}/manage/users/${u.user_id}`,
        // ระดับการศึกษา/ปีหลักสูตร/รหัสหลักสูตร/สาขา เป็นของนิสิตเท่านั้น — แก้อาจารย์ไม่ส่ง
        u.role === Role.Student ? this.editForm : (({ degree_level, curriculum_year, study_plan_code, department, ...common }) => common)(this.editForm),
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

  // ── Add Admin Modal (Admin / SuperAdmin) ─────────────────────────
  addAdminModal    = signal(false);
  isAddAdminSaving = signal(false);
  addAdminResult   = signal<{ ok: boolean; msg: string } | null>(null);
  addAdminForm: PostAddAdminReq = { username: '', password: '', first_name: '', last_name: '', msu_mail: '' };

  // ติ๊ก "แสดงรหัสผ่าน" ในฟอร์มเพิ่ม Admin / ยืนยันรหัสตอนเปลี่ยนอีเมล — เปิด modal ใหม่ซ่อนกลับเสมอ
  showAddAdminPassword  = signal(false);
  showEditAdminPassword = signal(false);

  openAddAdminModal(): void {
    this.flushModalClose();
    this.addAdminForm = { username: '', password: '', first_name: '', last_name: '', msu_mail: '' };
    this.showAddAdminPassword.set(false);
    this.addAdminResult.set(null);
    this.addAdminModal.set(true);
    document.body.style.overflow = 'hidden';
  }

  closeAddAdminModal(): void {
    this.addAdminModal.set(false);
    document.body.style.overflow = '';
  }

  /** N11 / B35: backend ใช้กฎเดียวกับหน้า login — 4–50 ตัว a-z A-Z 0-9 _ . - */
  readonly USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{4,50}$/;
  get addAdminUsernameInvalid(): boolean {
    const u = this.addAdminForm.username.trim();
    return !!u && !this.USERNAME_PATTERN.test(u);
  }

  /** X48: กฎรหัสผ่านเดียวกับ backend (ผิดกฎ = 400 WEAK_PASSWORD) */
  get addAdminPasswordError(): string { return passwordProblem(this.addAdminForm.password); }

  submitAddAdmin(): void {
    if (this.addAdminUsernameInvalid || this.addAdminPasswordError) return;
    this.isAddAdminSaving.set(true);
    this.addAdminResult.set(null);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .post<{ success: boolean; message?: string }>(
        `${this.constants.API_ENDPOINT}/admin/admins`,
        this.addAdminForm,
        { headers }
      )
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.isAddAdminSaving.set(false);
        if (res?.success) {
          this.addAdminResult.set({ ok: true, msg: 'เพิ่ม Admin เรียบร้อยแล้ว' });
          this.closeModalLater(() => { this.closeAddAdminModal(); this.loadAdmins(); }, 1500);
        } else {
          this.addAdminResult.set({ ok: false, msg: failMsg(res) });
        }
      });
  }

  // ── Edit Admin Modal (Admin / SuperAdmin — Admin แก้แถว SuperAdmin ไม่ได้) ──
  editAdminModal    = signal<Admin | null>(null);
  isEditAdminSaving = signal(false);
  editAdminResult   = signal<{ ok: boolean; msg: string } | null>(null);
  // ฟอร์มนี้แก้ชื่อ/นามสกุล/อีเมลเสมอ (ยังไม่ส่ง prefix เพราะ GET /admin/admins ไม่คืน prefix มา prefill — ส่งไปจะล้างค่าเดิม)
  editAdminForm: Required<Pick<PatchAdminReq, 'first_name' | 'last_name' | 'msu_mail'>> = { first_name: '', last_name: '', msu_mail: '' };

  openEditAdminModal(a: Admin): void {
    if (!this.canManageAdminRow(a)) return;
    this.flushModalClose();
    this.editAdminForm = { first_name: a.first_name, last_name: a.last_name, msu_mail: a.msu_mail };
    this.editAdminPassword = '';
    this.showEditAdminPassword.set(false);
    this.editAdminResult.set(null);
    this.editAdminModal.set(a);
    document.body.style.overflow = 'hidden';
  }

  closeEditAdminModal(): void {
    this.editAdminModal.set(null);
    document.body.style.overflow = '';
  }

  // A5 / B34: เปลี่ยนอีเมล Admin (= ช่องทางรับ OTP) ต้องยืนยันด้วยรหัสผ่านของผู้ทำรายการ
  editAdminPassword = '';

  get editAdminEmailChanged(): boolean {
    const a = this.editAdminModal();
    return !!a && this.editAdminForm.msu_mail.trim().toLowerCase() !== (a.msu_mail ?? '').trim().toLowerCase();
  }

  submitEditAdmin(): void {
    const a = this.editAdminModal();
    if (!a) return;
    if (this.editAdminEmailChanged && !this.editAdminPassword) return;
    this.isEditAdminSaving.set(true);
    this.editAdminResult.set(null);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .patch<{ success: boolean; message?: string; data?: { relogin_required?: boolean } }>(
        `${this.constants.API_ENDPOINT}/admin/admins/${a.user_id}`,
        this.editAdminEmailChanged
          ? { ...this.editAdminForm, current_password: this.editAdminPassword }
          : this.editAdminForm,
        { headers }
      )
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.isEditAdminSaving.set(false);
        this.editAdminPassword = '';
        if (res?.success) {
          // B34: เปลี่ยนอีเมลแล้ว backend ตัดทุกเซสชันของบัญชีนั้น — ถ้าเป็นบัญชีตัวเองต้องล็อกอินใหม่
          const me = readStoredAdmin() as { userId?: number } | null;
          if ('data' in res && res.data?.relogin_required && me?.userId === a.user_id) {
            this.editAdminResult.set({ ok: true, msg: 'เปลี่ยนอีเมลแล้ว — กรุณาเข้าสู่ระบบใหม่ด้วยอีเมลใหม่' });
            setTimeout(() => {
              this.closeEditAdminModal();
              this.auth.logout();
              this.router.navigateByUrl('/login-admin');
            }, 2000);
            return;
          }
          this.editAdminResult.set({ ok: true, msg: 'แก้ไขข้อมูลเรียบร้อยแล้ว' });
          this.allAdmins.update(list => list.map(x =>
            x.user_id === a.user_id
              ? { ...x, first_name: this.editAdminForm.first_name, last_name: this.editAdminForm.last_name, msu_mail: this.editAdminForm.msu_mail }
              : x
          ));
          this.closeModalLater(() => this.closeEditAdminModal(), 1500);
        } else {
          this.editAdminResult.set({ ok: false, msg: failMsg(res) });
        }
      });
  }

  // ── Suspend / Activate Admin (Admin / SuperAdmin) ────────────────
  suspendingAdminId = signal<number | null>(null);

  // ── Delete Admin (Admin / SuperAdmin — ลบ SuperAdmin ไม่ได้ทุกกรณี) ──
  deleteAdminTarget = signal<Admin | null>(null);
  isDeletingAdmin   = signal(false);
  deleteAdminError  = signal('');

  /** ห้ามลบ SuperAdmin และห้ามลบบัญชีตัวเอง */
  canDeleteAdmin(a: Admin): boolean {
    if (!this.canManageAdmins || a.role === 'SuperAdmin') return false;
    const me = readStoredAdmin() as { userId?: number } | null;
    return me?.userId !== a.user_id;
  }

  openDeleteAdmin(a: Admin): void {
    this.deleteAdminError.set('');
    this.deleteAdminTarget.set(a);
    document.body.style.overflow = 'hidden';
  }

  closeDeleteAdmin(): void {
    if (this.isDeletingAdmin()) return;
    this.deleteAdminTarget.set(null);
    document.body.style.overflow = '';
  }

  confirmDeleteAdmin(): void {
    const a = this.deleteAdminTarget();
    if (!a || this.isDeletingAdmin()) return;
    this.isDeletingAdmin.set(true);
    this.deleteAdminError.set('');
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .delete<{ success: boolean; message?: string }>(`${this.constants.API_ENDPOINT}/admin/admins/${a.user_id}`, { headers })
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.isDeletingAdmin.set(false);
        if (res?.success) {
          this.allAdmins.update(list => list.filter(x => x.user_id !== a.user_id));
          this.deleteAdminTarget.set(null);
          document.body.style.overflow = '';
          this.suspendResult.set({ ok: true, msg: `ลบบัญชี ${this.adminFullName(a)} เรียบร้อยแล้ว` });
          setTimeout(() => this.suspendResult.set(null), 3000);
        } else {
          this.deleteAdminError.set(failMsg(res, 'ลบบัญชีไม่สำเร็จ กรุณาลองใหม่'));
        }
      });
  }

  // ── Delete User (นิสิต / อาจารย์ / Staff — Admin, SuperAdmin เท่านั้น) ──
  // DELETE /manage/users/:id · มีข้อมูลผูกอยู่ (Pre-T3/T3, เป็นที่ปรึกษา, เคยอนุมัติ ฯลฯ) → 409 USER_HAS_DATA พร้อมเหตุผล
  deleteUserTarget = signal<User | null>(null);
  isDeletingUser   = signal(false);
  deleteUserError  = signal('');

  get canDeleteUser(): boolean { return this.canManageAdmins; }

  openDeleteUser(u: User): void {
    if (!this.canDeleteUser) return;
    this.deleteUserError.set('');
    this.deleteUserTarget.set(u);
    document.body.style.overflow = 'hidden';
  }

  closeDeleteUser(): void {
    if (this.isDeletingUser()) return;
    this.deleteUserTarget.set(null);
    document.body.style.overflow = '';
  }

  confirmDeleteUser(): void {
    const u = this.deleteUserTarget();
    if (!u || this.isDeletingUser()) return;
    this.isDeletingUser.set(true);
    this.deleteUserError.set('');
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .delete<{ success: boolean; message?: string }>(`${this.constants.API_ENDPOINT}/manage/users/${u.user_id}`, { headers })
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.isDeletingUser.set(false);
        if (res?.success) {
          this.deleteUserTarget.set(null);
          document.body.style.overflow = '';
          // ลบแถวสุดท้ายของหน้า → ถอยกลับหน้าก่อน · โหลดใหม่เพื่อให้จำนวน/หน้าตรงกับ backend
          if (this.allUsers().length <= 1 && this.currentPage() > 1) this.currentPage.update(p => p - 1);
          this.loadData();
          this.loadRoleCounts();
          this.suspendResult.set({ ok: true, msg: `ลบบัญชี ${this.fullName(u)} เรียบร้อยแล้ว` });
          setTimeout(() => this.suspendResult.set(null), 3000);
        } else {
          this.deleteUserError.set(failMsg(res, 'ลบบัญชีไม่สำเร็จ กรุณาลองใหม่'));
        }
      });
  }

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
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.suspendingAdminId.set(null);
        if (res?.success) {
          const newStatus = isSuspended ? 'Active' : 'Suspended';
          this.allAdmins.update(list =>
            list.map(x => x.user_id === a.user_id ? { ...x, account_status: newStatus } : x)
          );
          this.suspendResult.set({
            ok: true,
            msg: isSuspended ? 'เปิดใช้งานบัญชีเรียบร้อยแล้ว' : 'ระงับบัญชีเรียบร้อยแล้ว',
          });
        } else {
          this.suspendResult.set({ ok: false, msg: `${failMsg(res)}` });
        }
        setTimeout(() => this.suspendResult.set(null), 3000);
      });
  }

  // ── Helpers ───────────────────────────────────────────────────────
  adminFullName(a: Admin): string {
    return `${a.first_name} ${a.last_name}`.trim();
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

  /** X44: นับที่ backend (Major + Co_1 + Co_2 จาก DB ทั้งหมด) — เดิมโหลดนิสิตทั้งหมดมานับเอง */
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
