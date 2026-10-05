import { Component, signal, computed, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from '../../../auth.service';
import { Constants } from '../../../comfig/constants';
import { GetStatsRes, Data } from '../../../model_admin/res/get_stats_res';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard implements OnInit {
  private http      = inject(HttpClient);
  private auth      = inject(AuthService);
  private constants = inject(Constants);

  private rawUser = JSON.parse(localStorage.getItem('user') ?? '{}');
  userName = (`${this.rawUser?.firstName ?? ''} ${this.rawUser?.lastName ?? ''}`).trim()
             || (this.rawUser?.username ?? 'SuperAdmin');
  userInitials = ((this.rawUser?.firstName?.charAt(0) ?? '') + (this.rawUser?.lastName?.charAt(0) ?? '')).toUpperCase() || 'S';

  currentDate = signal(new Date().toLocaleDateString('th-TH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }));

  isLoading = signal(true);
  statsData = signal<Data | null>(null);
  loadError = signal<string | null>(null);

  totalRequests = computed(() => (this.statsData()?.pre_t3.total   ?? 0) + (this.statsData()?.t3.total   ?? 0));
  pendingAll    = computed(() => (this.statsData()?.pre_t3.pending  ?? 0) + (this.statsData()?.t3.pending  ?? 0));
  approvedAll   = computed(() => (this.statsData()?.pre_t3.approved ?? 0) + (this.statsData()?.t3.approved ?? 0));
  rejectedAll   = computed(() => (this.statsData()?.pre_t3.rejected ?? 0) + (this.statsData()?.t3.rejected ?? 0));

  ngOnInit() {
    window.scrollTo({ top: 0 });
    this.loadStats();
  }

  private loadStats() {
    this.isLoading.set(true);
    this.loadError.set(null);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http.get<GetStatsRes>(`${this.constants.API_ENDPOINT}/admin/stats`, { headers }).subscribe({
      next: res => {
        if (res.success) this.statsData.set(res.data);
        else this.loadError.set('ไม่สามารถโหลดข้อมูลได้');
        this.isLoading.set(false);
      },
      error: () => {
        this.loadError.set('เกิดข้อผิดพลาดในการเชื่อมต่อ API');
        this.isLoading.set(false);
      },
    });
  }

  pct(part: number, total: number): number {
    return total > 0 ? Math.min(100, Math.round((part / total) * 100)) : 0;
  }
}
