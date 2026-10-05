import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../../auth.service';

@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss'],
})
export class Dashboard implements OnInit {
  ngOnInit(): void {
    window.scrollTo({ top: 0 });
  }

  get userName()    { return `${this.authService.user?.firstName ?? ''} ${this.authService.user?.lastName ?? ''}`.trim(); }
  get userEmail()   { return this.authService.user?.msuMail ?? ''; }
  get userRole()    { return this.authService.user?.role ?? ''; }
  get userPicture() { return this.authService.userPicture; }
 

  steps = [
    {
      number: 1,
      icon: '🔍',
      title: 'ค้นหาวารสารเป้าหมาย',
      desc: 'กรอกเลข ISSN ของวารสารที่ต้องการตีพิมพ์ ระบบจะตรวจสอบจาก Scopus และ TCI อัตโนมัติ',
      color: '#1C2744',
    },
    {
      number: 2,
      icon: '✅',
      title: 'ตรวจสอบผลการค้นหา',
      desc: 'ระบบแสดง Quartile, Tier, สถานะ Active/Discontinued และตรวจสอบว่าอยู่ใน MSU Unwanted หรือไม่',
      color: '#1A7A42',
    },
    {
      number: 3,
      icon: '📋',
      title: 'ยื่นคำร้อง Pre-T3',
      desc: 'กรอกข้อมูลบทความและวารสาร รอระบบตรวจสอบ Checklist 9 ข้ออัตโนมัติ แล้วส่งให้อาจารย์ที่ปรึกษาลงนาม',
      color: '#C07800',
    },
    {
      number: 4,
      icon: '○',
      title: 'รอผลการพิจารณา',
      desc: 'เจ้าหน้าที่นำคำร้องเข้าที่ประชุมบัณฑิตวิทยาลัย รอมติอนุมัติ/ไม่อนุมัติ',
      color: '#1A5FAB',
    },
    {
      number: 5,
      icon: '🎓',
      title: 'ยื่นคำร้อง T3',
      desc: 'หลังบทความได้รับการตอบรับ/ตีพิมพ์ ยื่น T3 พร้อมแนบ Letter of Acceptance และ Full Paper เพื่อขอจบการศึกษา',
      color: '#C0392B',
    },
  ];

  constructor(private authService: AuthService) {}
}