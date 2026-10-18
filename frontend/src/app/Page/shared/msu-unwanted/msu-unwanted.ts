import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { AuthService } from '../../../auth.service';
import { Constants } from '../../../comfig/constants';
import { MSUUnwantedRes, Journal } from '../../../model/res/MSU_Unwanted_res';
import { ImportMsuUnwantedRes } from '../../../model/res/import_msu_Unwanted_res';
import { apiFailure, failMsg } from '../../../server-status.service';
import { downloadBlob } from '../../../file-download';

interface ActionResult { ok: boolean; msg: string; errors?: string[]; }

@Component({
  selector: 'app-msu-unwanted',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './msu-unwanted.html',
  styleUrl: './msu-unwanted.scss',
})
export class MsuUnwanted implements OnInit {
  private http      = inject(HttpClient);
  private auth      = inject(AuthService);
  private constants = inject(Constants);

  get isStaff(): boolean { return this.auth.user?.role?.toLowerCase() === 'staff'; }

  isLoading       = signal(true);
  errorMessage    = signal('');
  journals        = signal<Journal[]>([]);
  totalItems      = signal(0);
  totalPagesCount = signal(1);

  searchQuery = signal('');
  currentPage = signal(1);
  readonly itemsPerPage = 10;

  selectedJournal = signal<Journal | null>(null);

  pageNumbers = computed(() =>
    Array.from({ length: this.totalPagesCount() }, (_, i) => i + 1)
  );

  // ── Add Single ────────────────────────────────────────────────────
  addModal    = signal(false);
  addForm     = { journal_name: '', issn: '', publisher: '', note: '', recorded_date: '' };
  addFile: File | null = null;
  isAdding    = signal(false);
  addResult   = signal<ActionResult | null>(null);

  // ── Import CSV ────────────────────────────────────────────────────
  csvModal    = signal(false);
  csvFile: File | null = null;
  isImporting = signal(false);
  importResult = signal<ActionResult | null>(null);

  // ── Edit ──────────────────────────────────────────────────────────
  editModal   = signal<Journal | null>(null);
  editForm    = { journal_name: '', issn: '', publisher: '', note: '', recorded_date: '' };
  editFile: File | null = null;
  editClearEvidence = false;
  isEditing   = signal(false);
  editResult  = signal<ActionResult | null>(null);

  // ── Delete ────────────────────────────────────────────────────────
  deleteModal = signal<Journal | null>(null);
  isDeleting  = signal(false);

  ngOnInit(): void {
    window.scrollTo({ top: 0 });
    this.loadData();
  }

  /** N20: คำที่กดค้นหาล่าสุด — เปลี่ยนหน้าใช้คำนี้ ไม่ใช่ข้อความที่พิมพ์ค้างในช่องแต่ยังไม่ได้กดค้นหา */
  private appliedSearch = '';

  loadData(): void {
    this.isLoading.set(true);
    this.errorMessage.set('');

    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    let params = new HttpParams()
      .set('page',  String(this.currentPage()))
      .set('limit', String(this.itemsPerPage));

    const q = this.normalizeSearch(this.appliedSearch);
    if (q) params = params.set('search', q);

    this.http
      .get<MSUUnwantedRes>(`${this.constants.API_ENDPOINT}/unwanted-journals`, { headers, params })
      .subscribe({
        next: (res) => {
          if (res.success) {
            // N19: ลบรายการสุดท้ายของหน้าสุดท้ายแล้วหน้านั้นว่าง → ถอยไปหน้าก่อนหน้าแทนการโชว์ "ไม่พบข้อมูล"
            if (!res.data.journals.length && this.currentPage() > 1) {
              this.currentPage.set(Math.max(1, Math.min(this.currentPage() - 1, res.data.pagination.totalPages || 1)));
              this.loadData();
              return;
            }
            this.journals.set(res.data.journals);
            this.totalItems.set(res.data.pagination.total);
            this.totalPagesCount.set(Math.max(1, res.data.pagination.totalPages));
          } else {
            this.errorMessage.set('ไม่สามารถโหลดข้อมูลได้');
          }
          this.isLoading.set(false);
        },
        error: () => {
          this.errorMessage.set('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
          this.isLoading.set(false);
        },
      });
  }

  search(): void {
    this.appliedSearch = this.searchQuery().trim();
    this.currentPage.set(1);
    this.loadData();
  }

  refresh(): void {
    this.searchQuery.set('');
    this.appliedSearch = '';
    this.currentPage.set(1);
    this.loadData();
  }

  setPage(p: number): void {
    if (p < 1 || p > this.totalPagesCount()) return;
    this.currentPage.set(p);
    this.loadData();
    // เปลี่ยนหน้าแล้วเลื่อนจอขึ้นไปบนสุดของตารางให้เอง กัน (โดยเฉพาะบนมือถือ)
    // ไม่ให้ผู้ใช้ค้างอยู่ตรงปุ่มเพจจิเนชันล่างสุดแล้วมองไม่เห็นข้อมูลหน้าใหม่
    document.querySelector('.table-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  openDetail(j: Journal): void { this.selectedJournal.set(j); }
  closeDetail(): void          { this.selectedJournal.set(null); this.evidenceError.set(''); }

  // ── ดูไฟล์หลักฐาน: GET /unwanted-journals/:id/evidence ต้องแนบ token จึงเปิดลิงก์ตรงไม่ได้
  //    → โหลดเป็น blob แล้วเปิดในแท็บใหม่ ──
  isLoadingEvidence = signal(false);
  evidenceError     = signal('');

  openEvidence(j: Journal): void {
    if (this.isLoadingEvidence()) return;
    // เปิดแท็บก่อนรอโหลด — ถ้าเปิดหลัง await เบราว์เซอร์จะบล็อกเป็น popup
    const tab = window.open('', '_blank');
    this.isLoadingEvidence.set(true);
    this.evidenceError.set('');
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http.get(`${this.constants.API_ENDPOINT}/unwanted-journals/${j.unwanted_id}/evidence`, { headers, responseType: 'blob' })
      .subscribe({
        next: blob => {
          this.isLoadingEvidence.set(false);
          const url = URL.createObjectURL(blob);
          if (tab) tab.location.href = url; else window.open(url, '_blank');
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        },
        error: err => {
          this.isLoadingEvidence.set(false);
          tab?.close();
          this.evidenceError.set(err?.status === 404 ? 'ไม่พบไฟล์หลักฐานของวารสารนี้' : 'เปิดไฟล์หลักฐานไม่สำเร็จ กรุณาลองใหม่');
        },
      });
  }

  // ── Add Single ────────────────────────────────────────────────────
  openAddModal(): void {
    // X36: backend บังคับ recorded_date — เติมวันนี้ให้เป็นค่าเริ่มต้น (แก้เป็นวันอื่นได้)
    this.addForm = { journal_name: '', issn: '', publisher: '', note: '', recorded_date: this.todayInput() };
    this.addFile = null;
    this.addResult.set(null);
    this.addModal.set(true);
    document.body.style.overflow = 'hidden';
  }

  closeAddModal(): void {
    this.addModal.set(false);
    document.body.style.overflow = '';
  }

  onAddFileChange(e: Event): void {
    this.addFile = (e.target as HTMLInputElement).files?.[0] ?? null;
  }

  submitAdd(): void {
    if (!this.addForm.journal_name.trim() || !this.addForm.recorded_date) return;
    this.isAdding.set(true);
    this.addResult.set(null);

    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    const fd = new FormData();
    fd.append('journal_name', this.addForm.journal_name.trim());
    if (this.addForm.issn)          fd.append('issn',          this.addForm.issn.trim());
    if (this.addForm.publisher)     fd.append('publisher',     this.addForm.publisher.trim());
    if (this.addForm.note)          fd.append('note',          this.addForm.note.trim());
    if (this.addForm.recorded_date) fd.append('recorded_date', this.addForm.recorded_date);
    if (this.addFile)               fd.append('evidence_file', this.addFile);

    this.http
      .post<ImportMsuUnwantedRes>(`${this.constants.API_ENDPOINT}/unwanted-journals/single`, fd, { headers })
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.isAdding.set(false);
        if (res?.success) {
          this.addResult.set({ ok: true, msg: res.message });
          this.loadData();
          setTimeout(() => this.closeAddModal(), 1600);
        } else {
          this.addResult.set({ ok: false, msg: failMsg(res) });
        }
      });
  }

  // ── Import CSV ────────────────────────────────────────────────────
  openCsvModal(): void {
    this.csvFile = null;
    this.importResult.set(null);
    this.csvModal.set(true);
    document.body.style.overflow = 'hidden';
  }

  /**
   * ดาวน์โหลดไฟล์ CSV ตัวอย่าง (feedback backend ข้อ 4) — สร้างในเบราว์เซอร์ ไม่ต้องมีไฟล์/endpoint ฝั่ง backend
   * ใส่ BOM ให้ Excel เปิดภาษาไทยได้ (backend อ่านไฟล์ที่มี BOM ได้) · recorded_date เป็น ค.ศ. YYYY-MM-DD
   */
  downloadCsvTemplate(): void {
    const rows = [
      ['journal_name', 'issn', 'publisher', 'note', 'recorded_date'],
      ['ตัวอย่างวารสาร A (ลบแถวตัวอย่างออกก่อนนำเข้า)', '1234-5678', 'ตัวอย่างสำนักพิมพ์', 'หมายเหตุ (ไม่บังคับ)', '2026-01-31'],
      ['ตัวอย่างวารสาร B ที่ไม่มี ISSN', '', '', '', '2026-01-31'],
    ];
    const csv = rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\r\n');
    downloadBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }), 'msu-unwanted-journals-template.csv');
  }

  closeCsvModal(): void {
    this.csvModal.set(false);
    document.body.style.overflow = '';
  }

  onCsvFileChange(e: Event): void {
    this.csvFile = (e.target as HTMLInputElement).files?.[0] ?? null;
  }

  submitCsv(): void {
    if (!this.csvFile) return;
    this.isImporting.set(true);
    this.importResult.set(null);

    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    const fd = new FormData();
    fd.append('file', this.csvFile);

    this.http
      .post<ImportMsuUnwantedRes>(`${this.constants.API_ENDPOINT}/unwanted-journals/import`, fd, { headers })
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.isImporting.set(false);
        if (res?.success) {
          this.importResult.set({ ok: true, msg: res.message });
          this.loadData();
          setTimeout(() => this.closeCsvModal(), 1600);
        } else {
          // X35: แสดงทุกแถวที่ผิด (import เป็น all-or-nothing — แก้ไฟล์แล้วอัปโหลดใหม่ทั้งไฟล์)
          this.importResult.set({ ok: false, msg: failMsg(res), errors: (res as { errors?: string[] }).errors });
        }
      });
  }

  // ── Edit ──────────────────────────────────────────────────────────
  private editOriginalDate = '';

  /** DATE จาก backend → 'YYYY-MM-DD' สำหรับ <input type="date">
   *  ห้ามใช้ toISOString(): ได้วันที่แบบ UTC — "2026-10-04T17:00Z" (= 5 ต.ค. เวลาไทย) จะกลายเป็น 4 ต.ค.
   *  และวันที่ถอยไป 1 วันทุกครั้งที่บันทึก (X26) */
  /** วันนี้ตามเวลาท้องถิ่นในรูป 'YYYY-MM-DD' (ไม่ใช้ toISOString — ได้วันแบบ UTC ช่วงเช้ามืดจะได้เมื่อวาน) */
  private todayInput(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  private toDateInput(v: unknown): string {
    if (!v) return '';
    const str = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;          // backend ส่งเป็นข้อความอยู่แล้ว (dateStrings)
    const d = new Date(str);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;   // วันที่ตามเวลาท้องถิ่น
  }

  openEditModal(j: Journal, e: Event): void {
    e.stopPropagation();
    const rd = this.toDateInput(j.recorded_date);
    this.editOriginalDate = rd;
    this.editForm = {
      journal_name: j.journal_name ?? '',
      issn:         j.issn ?? '',
      publisher:    j.publisher ?? '',
      note:         j.note ?? '',
      recorded_date: rd,
    };
    this.editFile = null;
    this.editClearEvidence = false;
    this.editResult.set(null);
    this.editModal.set(j);
    document.body.style.overflow = 'hidden';
  }

  closeEditModal(): void {
    this.editModal.set(null);
    document.body.style.overflow = '';
  }

  onEditFileChange(e: Event): void {
    this.editFile = (e.target as HTMLInputElement).files?.[0] ?? null;
  }

  submitEdit(): void {
    const j = this.editModal();
    if (!j || !this.editForm.journal_name.trim() || !this.editForm.recorded_date) return;
    this.isEditing.set(true);
    this.editResult.set(null);

    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    const fd = new FormData();
    fd.append('journal_name', this.editForm.journal_name.trim());
    // ส่ง issn/publisher/note ทุกครั้ง (ว่างก็ส่ง '') — backend ถือว่า field ที่ไม่ส่ง = ไม่เปลี่ยน
    // ถ้าข้ามตอนว่างจะล้างค่าเดิมไม่ได้ ส่วน '' backend แปลงเป็น null ให้
    fd.append('issn',      (this.editForm.issn      ?? '').trim());
    fd.append('publisher', (this.editForm.publisher ?? '').trim());
    fd.append('note',      (this.editForm.note      ?? '').trim());
    // ส่งเฉพาะเมื่อผู้ใช้เปลี่ยนวันที่จริง — กันวันที่เพี้ยนจากการแปลง timezone (X26)
    if (this.editForm.recorded_date && this.editForm.recorded_date !== this.editOriginalDate) {
      fd.append('recorded_date', this.editForm.recorded_date);
    }
    if (this.editFile)               fd.append('evidence_file', this.editFile);
    if (this.editClearEvidence)      fd.append('clear_evidence','true');

    let errorMsg = '';
    this.http
      .patch<ImportMsuUnwantedRes>(`${this.constants.API_ENDPOINT}/unwanted-journals/${j.unwanted_id}`, fd, { headers })
      .pipe(catchError(err => { errorMsg = err?.error?.message ?? ''; return of(null); }))
      .subscribe(res => {
        this.isEditing.set(false);
        if (res?.success) {
          this.editResult.set({ ok: true, msg: res.message || 'แก้ไขเรียบร้อยแล้ว' });
          this.loadData();
          setTimeout(() => this.closeEditModal(), 1600);
        } else {
          this.editResult.set({ ok: false, msg: errorMsg || 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
        }
      });
  }

  // ── Delete ────────────────────────────────────────────────────────
  openDeleteModal(j: Journal, e: Event): void {
    e.stopPropagation();
    this.deleteModal.set(j);
    document.body.style.overflow = 'hidden';
  }

  deleteError = signal('');

  closeDeleteModal(): void {
    this.deleteModal.set(null);
    this.deleteError.set('');
    document.body.style.overflow = '';
  }

  submitDelete(): void {
    const j = this.deleteModal();
    if (!j) return;
    this.isDeleting.set(true);
    this.deleteError.set('');

    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .delete<ImportMsuUnwantedRes>(`${this.constants.API_ENDPOINT}/unwanted-journals/${j.unwanted_id}`, { headers })
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.isDeleting.set(false);
        // เดิมปิด modal ทุกกรณี → ลบไม่สำเร็จก็ดูเหมือนลบแล้ว
        if (res?.success) {
          this.closeDeleteModal();
          this.loadData();
        } else {
          this.deleteError.set(failMsg(res, 'ลบไม่สำเร็จ กรุณาลองใหม่'));
        }
      });
  }

  // ── Helpers ───────────────────────────────────────────────────────
  formatDate(date: Date | string | null | undefined): string {
    if (!date) return '—';
    return new Date(date as string).toLocaleDateString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  private normalizeSearch(q: string): string {
    const digits = q.replace(/-/g, '');
    if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    return q;
  }
}
