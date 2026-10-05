import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { AuthService } from '../../../auth.service';
import { Constants } from '../../../comfig/constants';
import { GetProfileRes, Data as ProfileData, Advisor } from '../../../model/res/get_profile_res';
import { EditProfileReq } from '../../../model/req/Edit_Profile_req';

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

  /* ── State ── */
  isLoading  = signal(true);
  isSaving   = signal(false);
  isEditing  = signal(false);
  saveResult = signal<'success' | 'error' | null>(null);
  me         = signal<ProfileData | null>(null);

  toggleEdit(): void { this.isEditing.update(v => !v); }

  /* ── Editable fields ── */
  phone      = signal('');
  facebookId = signal('');
  lineId     = signal('');

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

  get advisorMain(): Advisor | null {
    return this.me()?.advisors.find((a: Advisor) => a.advisorType === 'Major') ?? null;
  }

  get advisorCo(): Advisor[] {
    return this.me()?.advisors.filter((a: Advisor) => a.advisorType !== 'Major') ?? [];
  }

  ngOnInit(): void {
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .get<GetProfileRes>(`${this.constants.API_ENDPOINT}/user/profile`, { headers })
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        this.isLoading.set(false);
        if (!res?.success) return;
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
    const body: EditProfileReq = {
      phone:       this.phone(),
      facebook_id: this.facebookId(),
      line_id:     this.lineId(),
    };

    this.http
      .patch(`${this.constants.API_ENDPOINT}/user/profile`, body, { headers })
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        this.isSaving.set(false);
        this.saveResult.set(res ? 'success' : 'error');
        if (res) setTimeout(() => { this.saveResult.set(null); this.isEditing.set(false); }, 1500);
        else setTimeout(() => this.saveResult.set(null), 3000);
      });
  }

  stats = [
    { value: 0, label: 'ค้นหา',  color: '#1A7A42' },
    { value: 0, label: 'Pre-T3', color: '#C07800'  },
    { value: 0, label: 'บันทึก', color: '#1A5FAB'  },
  ];
}
