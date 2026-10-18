import { Component, signal, computed, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, forkJoin } from 'rxjs';
import { AuthService, ADMIN_PROFILE_UPDATED } from '../../../auth.service';
import { Constants } from '../../../comfig/constants';
import { GetMyProfileRes, Data } from '../../../model_admin/res/get_my_profile_res';
import { PatchMyProfileReq } from '../../../model_admin/req/patch_my_profile_req';
import { PatchAdminReq } from '../../../model_admin/req/patch_admin_req';
import { apiFailure, failMsg } from '../../../server-status.service';
import { AppSelect } from '../../../Components/app-select/app-select';

@Component({
  selector: 'app-profile',
  imports: [CommonModule, FormsModule, AppSelect],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile implements OnInit {
  readonly prefixOptions = ['นาย', 'นาง', 'นางสาว', 'ดร.', 'ผศ.', 'รศ.', 'ศ.'];

  private http      = inject(HttpClient);
  private auth      = inject(AuthService);
  private constants = inject(Constants);

  me        = signal<Data | null>(null);
  isLoading = signal(true);
  loadError = signal<string | null>(null);

  isEditing  = signal(false);
  isSaving   = signal(false);
  saveResult = signal<'success' | 'error' | null>(null);
  saveError  = signal('');

  prefix     = signal('');
  firstName  = signal('');
  lastName   = signal('');
  phone      = signal('');
  facebookId = signal('');
  lineId     = signal('');

  fullName = computed(() => {
    const d = this.me();
    if (!d) return '';
    return `${d.prefix ?? ''} ${d.firstName} ${d.lastName}`.trim();
  });

  initials = computed(() => {
    const d = this.me();
    if (!d) return 'A';
    return ((d.firstName?.charAt(0) ?? '') + (d.lastName?.charAt(0) ?? '')).toUpperCase()
      || (d.username?.charAt(0) ?? 'A').toUpperCase()
      || 'A';
  });

  userPicture = '';

  stats = computed(() => {
    const d = this.me();
    return [
      { label: 'Role',    value: d?.role          ?? '—',   color: '#C07800' },
      { label: 'สถานะ',  value: d?.accountStatus ?? '—',   color: '#1A7A42' },
    ];
  });

  ngOnInit() { this.loadProfile(); }

  private headers() {
    return new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
  }

  private syncEditFields(d: Data) {
    this.prefix.set(d.prefix     ?? '');
    this.firstName.set(d.firstName);
    this.lastName.set(d.lastName);
    this.phone.set(d.phone       ?? '');
    this.facebookId.set(d.facebookId ?? '');
    this.lineId.set(d.lineId     ?? '');
  }

  loadProfile() {
    this.isLoading.set(true);
    this.loadError.set(null);
    this.http.get<GetMyProfileRes>(`${this.constants.API_ENDPOINT}/user/profile`, { headers: this.headers() })
      .subscribe({
        next: res => {
          if (res.success) {
            this.me.set(res.data);
            this.syncEditFields(res.data);
          } else {
            this.loadError.set('ไม่สามารถโหลดข้อมูลได้');
          }
          this.isLoading.set(false);
        },
        error: () => {
          this.loadError.set('เกิดข้อผิดพลาดในการเชื่อมต่อ');
          this.isLoading.set(false);
        },
      });
  }

  toggleEdit() {
    if (this.isEditing()) {
      const d = this.me();
      if (d) this.syncEditFields(d);
      this.saveResult.set(null);
    }
    this.isEditing.update(v => !v);

    // บนจอมือถือ .pf-edit-card โผล่มาท้ายสุดของหน้า ไกลจากปุ่ม "แก้ไขข้อมูลส่วนตัว"
    // ที่อยู่บนการ์ดแรกสุด ผู้ใช้กดแล้วมองไม่เห็นฟอร์มที่เพิ่งเปิดขึ้นมาเลยถ้าไม่เลื่อนเอง
    if (this.isEditing() && window.innerWidth <= 720) {
      setTimeout(() => {
        document.querySelector('.pf-edit-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    }
  }

  saveProfile() {
    if (!this.me()) return;
    this.isSaving.set(true);
    this.saveResult.set(null);

    // ข้อมูลแยก 2 เส้นตาม backend (X15):
    //   คำนำหน้า/ชื่อ/นามสกุล → PATCH /admin/admins/:id (id ของตัวเอง)
    //   เบอร์โทร/Facebook/Line → PATCH /user/profile (เส้นนี้ไม่รับชื่อ)
    // ยิงเฉพาะเส้นที่มีการเปลี่ยน
    const d = this.me()!;
    const nameBody: PatchAdminReq = {
      prefix:     this.prefix().trim(),
      first_name: this.firstName().trim(),
      last_name:  this.lastName().trim(),
    };
    const contactBody: PatchMyProfileReq = {
      phone:       this.phone(),
      facebook_id: this.facebookId(),
      line_id:     this.lineId(),
    };
    const nameChanged = nameBody.prefix !== (d.prefix ?? '')
                     || nameBody.first_name !== d.firstName
                     || nameBody.last_name  !== d.lastName;
    const contactChanged = contactBody.phone !== (d.phone ?? '')
                        || contactBody.facebook_id !== (d.facebookId ?? '')
                        || contactBody.line_id     !== (d.lineId ?? '');

    const requests: Observable<unknown>[] = [];
    if (nameChanged) {
      requests.push(this.http.patch(`${this.constants.API_ENDPOINT}/admin/admins/${d.userId}`, nameBody, { headers: this.headers() }));
    }
    if (contactChanged) {
      requests.push(this.http.patch(`${this.constants.API_ENDPOINT}/user/profile`, contactBody, { headers: this.headers() }));
    }
    if (!requests.length) {               // ไม่มีอะไรเปลี่ยน
      this.isSaving.set(false);
      this.isEditing.set(false);
      return;
    }

    forkJoin(requests).subscribe({
      next: () => {
        this.saveResult.set('success');
        this.isSaving.set(false);
        if (nameChanged) window.dispatchEvent(new Event(ADMIN_PROFILE_UPDATED));   // N14
        setTimeout(() => {
          this.isEditing.set(false);
          this.loadProfile();
        }, 800);
      },
      error: (err) => {
        // อีกเส้นอาจบันทึกชื่อสำเร็จไปแล้ว — ให้ sidebar โหลดชื่อจริงล่าสุดด้วย (N14)
        if (nameChanged) window.dispatchEvent(new Event(ADMIN_PROFILE_UPDATED));
        this.saveError.set(failMsg(apiFailure(err)));
        this.saveResult.set('error');
        this.isSaving.set(false);
        this.loadProfile();   // อีกเส้นอาจบันทึกสำเร็จไปแล้ว — โหลดค่าจริงล่าสุด
      },
    });
  }

  /** ชื่อ-นามสกุลห้ามว่าง (backend บังคับ) */
  get canSave(): boolean {
    return !!this.firstName().trim() && !!this.lastName().trim();
  }

  formatDate(d: Date | string | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleString('th-TH', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }
}
