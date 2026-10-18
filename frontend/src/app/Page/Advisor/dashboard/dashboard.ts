import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../../auth.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private auth = inject(AuthService);

  get advisorName()  {
    const u = this.auth.user;
    return u ? `${u.firstName} ${u.lastName}`.trim() : '';
  }
  get advisorEmail() { return this.auth.user?.msuMail ?? ''; }
  get userPicture()  { return this.auth.userPicture; }
}
