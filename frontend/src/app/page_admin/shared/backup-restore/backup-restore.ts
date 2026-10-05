import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

interface Backup {
  name: string; size: string; createdAt: string; createdBy: string;
  status: 'success' | 'failed';
}

@Component({
  selector: 'app-backup-restore',
  imports: [CommonModule],
  templateUrl: './backup-restore.html',
  styleUrl: './backup-restore.scss',
})
export class BackupRestore {
  lastBackup = '10 มิ.ย. 2569 — 09:45 น.';

  backups: Backup[] = [
    { name: 'backup_20260610_0945.sql', size: '14.2 MB', createdAt: '10 มิ.ย. 2569 09:45',  createdBy: 'somchai.j',  status: 'success' },
    { name: 'backup_20260601_1200.sql', size: '13.8 MB', createdAt: '01 มิ.ย. 2569 12:00',  createdBy: 'somchai.j',  status: 'success' },
    { name: 'backup_20260520_0830.sql', size: '12.1 MB', createdAt: '20 พ.ค. 2569 08:30',   createdBy: 'somchai.j',  status: 'success' },
    { name: 'backup_20260510_1530.sql', size: '11.9 MB', createdAt: '10 พ.ค. 2569 15:30',   createdBy: 'somchai.j',  status: 'failed'  },
    { name: 'backup_20260501_0900.sql', size: '11.5 MB', createdAt: '01 พ.ค. 2569 09:00',   createdBy: 'somchai.j',  status: 'success' },
  ];
}
