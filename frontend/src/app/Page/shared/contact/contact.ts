import { Component, AfterViewInit, OnInit, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from '../../../auth.service';
import { Constants } from '../../../comfig/constants';
import { GetContactStaffRes, Staff } from '../../../model/res/get_contact_staff_res';

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [RouterModule, CommonModule],
  templateUrl: './contact.html',
  styleUrl: './contact.scss',
})
export class Contact implements OnInit, AfterViewInit {
  private http          = inject(HttpClient);
  protected authService = inject(AuthService);
  private constants     = inject(Constants);

  staffList   = signal<Staff[]>([]);
  isLoading   = signal(true);
  loadError   = signal(false);

  private observer!: IntersectionObserver;

  ngOnInit(): void {
    const token = this.authService.token;
    const headers = token
      ? new HttpHeaders({ Authorization: `Bearer ${token}` })
      : new HttpHeaders();

    this.http.get<GetContactStaffRes>(`${this.constants.API_ENDPOINT}/user/staff`, { headers })
      .subscribe({
        next: (res) => {
          if (res.success) this.staffList.set(res.data.staff);
          this.isLoading.set(false);
          setTimeout(() => this.observeAnimations(), 0);
        },
        error: () => {
          this.loadError.set(true);
          this.isLoading.set(false);
          setTimeout(() => this.observeAnimations(), 0);
        },
      });
  }

  ngAfterViewInit(): void {
    window.scrollTo({ top: 0, behavior: 'instant' });
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            this.observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.10 }
    );
    this.observeAnimations();
  }

  private observeAnimations(): void {
    document.querySelectorAll('.animate:not(.visible)').forEach(el => this.observer?.observe(el));
  }

  getInitials(s: Staff): string {
    return `${s.firstName.charAt(0)}${s.lastName.charAt(0)}`.toUpperCase();
  }

  hasContact(s: Staff): boolean {
    return !!(s.phone || s.facebookId || s.lineId || s.msuMail);
  }
}
