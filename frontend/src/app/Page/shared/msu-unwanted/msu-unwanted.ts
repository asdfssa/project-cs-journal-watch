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

interface ActionResult { ok: boolean; msg: string; }

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

  loadData(): void {
    this.isLoading.set(true);
    this.errorMessage.set('');

    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    let params = new HttpParams()
      .set('page',  String(this.currentPage()))
      .set('limit', String(this.itemsPerPage));

    const q = this.normalizeSearch(this.searchQuery().trim());
    if (q) params = params.set('search', q);

    this.http
      .get<MSUUnwantedRes>(`${this.constants.API_ENDPOINT}/unwanted-journals`, { headers, params })
      .subscribe({
        next: (res) => {
          if (res.success) {
            this.journals.set(res.data.journals);
            this.totalItems.set(res.data.pagination.total);
            this.totalPagesCount.set(res.data.pagination.totalPages);
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

  search(): void { this.currentPage.set(1); this.loadData(); }

  refresh(): void {
    this.searchQuery.set('');
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
  closeDetail(): void          { this.selectedJournal.set(null); }

  // ── Add Single ────────────────────────────────────────────────────
  openAddModal(): void {
    this.addForm = { journal_name: '', issn: '', publisher: '', note: '', recorded_date: '' };
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
    if (!this.addForm.journal_name.trim()) return;
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
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        this.isAdding.set(false);
        if (res?.success) {
          this.addResult.set({ ok: true, msg: res.message });
          this.loadData();
          setTimeout(() => this.closeAddModal(), 1600);
        } else {
          this.addResult.set({ ok: false, msg: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
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
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        this.isImporting.set(false);
        if (res?.success) {
          this.importResult.set({ ok: true, msg: res.message });
          this.loadData();
          setTimeout(() => this.closeCsvModal(), 1600);
        } else {
          this.importResult.set({ ok: false, msg: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
        }
      });
  }

  // ── Edit ──────────────────────────────────────────────────────────
  openEditModal(j: Journal, e: Event): void {
    e.stopPropagation();
    const rd = j.recorded_date
      ? new Date(j.recorded_date as any).toISOString().split('T')[0]
      : '';
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
    if (!j || !this.editForm.journal_name.trim()) return;
    this.isEditing.set(true);
    this.editResult.set(null);

    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    const fd = new FormData();
    fd.append('journal_name', this.editForm.journal_name.trim());
    if (this.editForm.issn)          fd.append('issn',          this.editForm.issn.trim());
    if (this.editForm.publisher)     fd.append('publisher',     this.editForm.publisher.trim());
    if (this.editForm.note)          fd.append('note',          this.editForm.note.trim());
    if (this.editForm.recorded_date) fd.append('recorded_date', this.editForm.recorded_date);
    if (this.editFile)               fd.append('evidence_file', this.editFile);
    if (this.editClearEvidence)      fd.append('clear_evidence','true');

    this.http
      .patch<ImportMsuUnwantedRes>(`${this.constants.API_ENDPOINT}/unwanted-journals/${j.unwanted_id}`, fd, { headers })
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        this.isEditing.set(false);
        if (res?.success) {
          this.editResult.set({ ok: true, msg: res.message || 'แก้ไขเรียบร้อยแล้ว' });
          this.loadData();
          setTimeout(() => this.closeEditModal(), 1600);
        } else {
          this.editResult.set({ ok: false, msg: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
        }
      });
  }

  // ── Delete ────────────────────────────────────────────────────────
  openDeleteModal(j: Journal, e: Event): void {
    e.stopPropagation();
    this.deleteModal.set(j);
    document.body.style.overflow = 'hidden';
  }

  closeDeleteModal(): void {
    this.deleteModal.set(null);
    document.body.style.overflow = '';
  }

  submitDelete(): void {
    const j = this.deleteModal();
    if (!j) return;
    this.isDeleting.set(true);

    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .delete<ImportMsuUnwantedRes>(`${this.constants.API_ENDPOINT}/unwanted-journals/${j.unwanted_id}`, { headers })
      .pipe(catchError(() => of(null)))
      .subscribe(() => {
        this.isDeleting.set(false);
        this.closeDeleteModal();
        this.loadData();
      });
  }

  // ── Helpers ───────────────────────────────────────────────────────
  formatDate(date: Date | string | null | undefined): string {
    if (!date) return '—';
    return new Date(date as string).toLocaleDateString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  addedBy(j: Journal): string {
    const name = `${j.first_name ?? ''} ${j.last_name ?? ''}`.trim();
    return name || j.msu_mail || '—';
  }

  private normalizeSearch(q: string): string {
    const digits = q.replace(/-/g, '');
    if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    return q;
  }
}
