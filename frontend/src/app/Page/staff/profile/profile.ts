import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { AuthService } from '../../../auth.service';
import { Constants } from '../../../comfig/constants';
import { GetProfileStaffRes, Data as ProfileData } from '../../../model/res/get_profile_staff_res';
import { PatchProfileStaffReq } from '../../../model/req/patch_profile_staff_res';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile implements OnInit {
  private http      = inject(HttpClient);
  private auth      = inject(AuthService);
  private constants = inject(Constants);

  get profilePicture(): string { return this.auth.userPicture; }

  isLoading   = signal(true);
  isSaving    = signal(false);
  saveResult  = signal<{ ok: boolean; msg: string } | null>(null);
  imgError    = false;

  profile     = signal<ProfileData | null>(null);
  isEditing   = signal(false);

  editForm: PatchProfileStaffReq = { phone: '', facebook_id: '', line_id: '' };

  ngOnInit(): void {
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .get<GetProfileStaffRes>(`${this.constants.API_ENDPOINT}/user/profile`, { headers })
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        if (res?.success) this.profile.set(res.data);
        this.isLoading.set(false);
      });
  }

  openEdit(): void {
    const p = this.profile();
    this.editForm = {
      phone:       p?.phone      ?? '',
      facebook_id: p?.facebookId ?? '',
      line_id:     p?.lineId     ?? '',
    };
    this.saveResult.set(null);
    this.isEditing.set(true);
  }

  cancelEdit(): void { this.isEditing.set(false); }

  saveEdit(): void {
    this.isSaving.set(true);
    this.saveResult.set(null);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .patch<{ success: boolean; message?: string }>(
        `${this.constants.API_ENDPOINT}/user/profile`,
        this.editForm,
        { headers }
      )
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        this.isSaving.set(false);
        if (res?.success) {
          this.saveResult.set({ ok: true, msg: 'บันทึกข้อมูลเรียบร้อยแล้ว' });
          const p = this.profile();
          if (p) {
            this.profile.set({
              ...p,
              phone:      this.editForm.phone      || null,
              facebookId: this.editForm.facebook_id || null,
              lineId:     this.editForm.line_id     || null,
            } as any);
          }
          setTimeout(() => { this.isEditing.set(false); this.saveResult.set(null); }, 1500);
        } else {
          this.saveResult.set({ ok: false, msg: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
        }
      });
  }

  onImgError(): void { this.imgError = true; }

  formatDate(d: Date | string | null | undefined): string {
    if (!d) return '—';
    return new Date(d as string).toLocaleDateString('th-TH', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  roleLabel(role: string): string {
    const map: Record<string, string> = {
      staff:      'เจ้าหน้าที่บัณฑิตวิทยาลัย',
      supervisor: 'อาจารย์ที่ปรึกษา',
      student:    'นักศึกษา',
    };
    return map[role?.toLowerCase()] ?? role;
  }

  get initials(): string {
    const p = this.profile();
    return ((p?.firstName?.[0] ?? '') + (p?.lastName?.[0] ?? '')).toUpperCase() || 'S';
  }
}
