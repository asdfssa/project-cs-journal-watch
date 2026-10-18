import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { AuthService } from '../../../auth.service';
import { Constants } from '../../../comfig/constants';
import { GetAdvisorProfileRes, Data as ProfileData } from '../../../model/res/get_advisor_profile_res';
import { PatchAdvisorReq } from '../../../model/req/patch_advisor_req';
import { apiFailure, failMsg } from '../../../server-status.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile implements OnInit {
  private auth      = inject(AuthService);
  private http      = inject(HttpClient);
  private constants = inject(Constants);

  isLoading  = signal(true);
  isSaving   = signal(false);
  isEditing  = signal(false);
  saveResult = signal<'success' | 'error' | null>(null);
  saveError  = signal('');
  me         = signal<ProfileData | null>(null);

  phone      = signal('');
  facebookId = signal('');
  lineId     = signal('');

  /**
   * N12: กด "ยกเลิก" ต้องคืนค่าเดิม — เดิมแค่สลับโหมด ค่าที่พิมพ์ค้างอยู่
   * เปิดแก้ไขรอบหน้าจะเห็นค่าที่ไม่ได้บันทึก และถูกบันทึกไปด้วยถ้ากดบันทึกทีหลัง
   */
  toggleEdit(): void {
    if (this.isEditing()) {
      const m = this.me();
      this.phone.set(m?.phone ?? '');
      this.facebookId.set(m?.facebookId ?? '');
      this.lineId.set(m?.lineId ?? '');
      this.saveResult.set(null);
    }
    this.isEditing.update(v => !v);
  }

  get userPicture() { return this.auth.userPicture; }

  get fullName(): string {
    const d = this.me();
    if (!d) return '';
    return `${d.prefix ?? ''} ${d.firstName} ${d.lastName}`.trim();
  }

  get initials(): string {
    const d = this.me();
    return (d?.firstName?.[0] ?? '').toUpperCase();
  }

  ngOnInit(): void {
    this.loadProfile();
  }

  // N15: โหลดไม่สำเร็จ ≠ ไม่มีข้อมูล — แสดงข้อความ + ปุ่มลองใหม่ แทนหน้าว่าง
  loadError = signal('');

  loadProfile(): void {
    this.isLoading.set(true);
    this.loadError.set('');
    let failure: unknown = null;
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .get<GetAdvisorProfileRes>(`${this.constants.API_ENDPOINT}/user/profile`, { headers })
      .pipe(catchError(err => { failure = err; return of(null); }))
      .subscribe(res => {
        this.isLoading.set(false);
        if (!res?.success) {
          this.loadError.set(failMsg(failure ? apiFailure(failure) : res, 'โหลดข้อมูลโปรไฟล์ไม่สำเร็จ กรุณาลองใหม่'));
          return;
        }
        this.me.set(res.data);
        this.phone.set(res.data.phone ?? '');
        this.facebookId.set(res.data.facebookId ?? '');
        this.lineId.set(res.data.lineId ?? '');
      });
  }

  saveProfile(): void {
    this.isSaving.set(true);
    this.saveResult.set(null);

    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    const body: PatchAdvisorReq = {
      phone:       this.phone(),
      facebook_id: this.facebookId(),
      line_id:     this.lineId(),
    };

    this.http
      .patch(`${this.constants.API_ENDPOINT}/user/profile`, body, { headers })
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.isSaving.set(false);
        const ok = (res as { success?: boolean } | null)?.success !== false;
        this.saveResult.set(ok ? 'success' : 'error');
        // F21: อัปเดตข้อมูลที่แสดงในโหมดดูด้วย — เดิมยังโชว์ค่าก่อนแก้จนกว่าจะ reload หน้า
        if (ok) this.me.update(m => m && { ...m, phone: body.phone, facebookId: body.facebook_id, lineId: body.line_id });
        if (ok) setTimeout(() => { this.saveResult.set(null); this.isEditing.set(false); }, 1500);
        else this.saveError.set(failMsg(res));
      });
  }
}
