import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-header-admin',
  imports: [CommonModule],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header {
  /** แสดงปุ่ม hamburger หรือไม่ (true เมื่ออยู่ในหน้าที่มี sidebar) */
  @Input() showToggle = false;

  /** สถานะ sidebar เปิด/ปิด — ใช้ bind class .open บนปุ่ม hamburger */
  @Input() sidebarOpen = false;

  /** emit เมื่อกดปุ่ม hamburger — parent รับไปสลับสถานะ sidebar */
  @Output() menuClick = new EventEmitter<void>();
}
