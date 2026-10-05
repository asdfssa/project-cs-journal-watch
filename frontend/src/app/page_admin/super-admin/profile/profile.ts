import { Component, signal, computed, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from '../../../auth.service';
import { Constants } from '../../../comfig/constants';
import { GetMyProfileRes, Data } from '../../../model_admin/res/get_my_profile_res';
import { PatchMyProfileReq } from '../../../model_admin/req/patch_my_profile_req';

@Component({
  selector: 'app-profile',
  imports: [CommonModule, FormsModule],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile implements OnInit {
  private http      = inject(HttpClient);
  private auth      = inject(AuthService);
  private constants = inject(Constants);

  me        = signal<Data | null>(null);
  isLoading = signal(true);
  loadError = signal<string | null>(null);

  isEditing  = signal(false);
  isSaving   = signal(false);
  saveResult = signal<'success' | 'error' | null>(null);

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
    return ((d.firstName.charAt(0) ?? '') + (d.lastName.charAt(0) ?? '')).toUpperCase()
      || d.username.charAt(0).toUpperCase()
      || 'A';
  });

  userPicture = '';

  stats = computed(() => {
    const d = this.me();
    return [
      { label: 'User ID', value: d ? `#${d.userId}` : '—', color: '#1B3A6B' },
      { label: 'Role',    value: d?.role          ?? '—',   color: '#C07800' },
      { label: 'สถานะ',  value: d?.accountStatus ?? '—',   color: '#1A7A42' },
    ];
  });

  ngOnInit() {
    window.scrollTo({ top: 0 });
    this.loadProfile();
  }

  private headers() {
    return new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
  }

  private syncEditFields(d: Data) {
    this.prefix.set(d.prefix        ?? '');
    this.firstName.set(d.firstName);
    this.lastName.set(d.lastName);
    this.phone.set(d.phone          ?? '');
    this.facebookId.set(d.facebookId ?? '');
    this.lineId.set(d.lineId        ?? '');
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
  }

  saveProfile() {
    if (!this.me()) return;
    this.isSaving.set(true);
    this.saveResult.set(null);

    const body: PatchMyProfileReq = {
      prefix:      this.prefix(),
      first_name:  this.firstName(),
      last_name:   this.lastName(),
      phone:       this.phone(),
      facebook_id: this.facebookId(),
      line_id:     this.lineId(),
    };

    this.http.patch(
      `${this.constants.API_ENDPOINT}/user/profile`,
      body,
      { headers: this.headers() },
    ).subscribe({
      next: () => {
        this.saveResult.set('success');
        this.isSaving.set(false);
        setTimeout(() => {
          this.isEditing.set(false);
          this.loadProfile();
        }, 800);
      },
      error: () => {
        this.saveResult.set('error');
        this.isSaving.set(false);
      },
    });
  }

  formatDate(d: Date | string | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleString('th-TH', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }
}
