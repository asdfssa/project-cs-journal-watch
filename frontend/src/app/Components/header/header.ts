import { Component, Input, Output, EventEmitter } from '@angular/core';

@Component({
  standalone: true,
  selector: 'app-header',
  imports: [],
  templateUrl: './header.html',
  styleUrls: ['./header.scss'],
})
export class Header {
  @Input() sidebarOpen  = true;
  @Input() showToggle   = true;
  @Output() menuClick   = new EventEmitter<void>();
}
