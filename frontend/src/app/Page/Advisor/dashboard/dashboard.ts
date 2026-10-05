import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { AuthService } from '../../../auth.service';
import { Constants } from '../../../comfig/constants';

interface PendingRequest {
  id: string;
  studentName: string;
  studentId: string;
  journalName: string;
  database: string;
  quartile: string;
  submittedDate: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard implements OnInit {
  private auth      = inject(AuthService);
  private router    = inject(Router);
  private http      = inject(HttpClient);
  private constants = inject(Constants);

  get advisorName()  {
    const u = this.auth.user;
    return u ? `${u.firstName} ${u.lastName}`.trim() : '';
  }
  get advisorEmail() { return this.auth.user?.msuMail ?? ''; }
  get userPicture()  { return this.auth.userPicture; }

  stats = { pending: 0, approved: 0, rejected: 0, students: 0 };

  pendingRequests: PendingRequest[] = [];

  steps = [
    { icon: '🔔', number: 'STEP 1', title: 'รับแจ้งคำร้อง',       desc: 'ระบบแจ้งเตือนเมื่อนิสิตยื่น Pre-T3 หรือ T3 เพื่อรอลงนาม',             color: '#2563EB' },
    { icon: '📋', number: 'STEP 2', title: 'ตรวจสอบ Checklist',   desc: 'ตรวจสอบผลการตรวจสอบ 9 ข้ออัตโนมัติและข้อมูลวารสาร',                   color: '#10B981' },
    { icon: '✅', number: 'STEP 3', title: 'ลงนามอนุมัติ',         desc: 'พิจารณาและลงนามอนุมัติหรือไม่อนุมัติพร้อมหมายเหตุ',                    color: '#F59E0B' },
    { icon: '📊', number: 'STEP 4', title: 'ติดตามผลคำร้อง',       desc: 'ติดตามความคืบหน้าคำร้องที่ผ่านการลงนามในขั้นถัดไป',                    color: '#8B5CF6' },
  ];

  ngOnInit(): void {
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });

    this.http
      .get<any>(`${this.constants.API_ENDPOINT}/advisor/dashboard`, { headers })
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        if (!res?.success) return;
        this.stats           = res.data.stats ?? this.stats;
        this.pendingRequests = res.data.pendingRequests ?? [];
      });
  }

  reviewRequest(id: string): void {
    this.router.navigate(['/advisor/pre-t3-review', id]);
  }
}
