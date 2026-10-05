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
  me         = signal<ProfileData | null>(null);

  phone      = signal('');
  facebookId = signal('');
  lineId     = signal('');

  toggleEdit(): void { this.isEditing.update(v => !v); }

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
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .get<GetAdvisorProfileRes>(`${this.constants.API_ENDPOINT}/user/profile`, { headers })
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
    const body: PatchAdvisorReq = {
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
}
