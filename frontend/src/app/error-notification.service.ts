import { Injectable, signal } from '@angular/core';

export const SERVER_ERROR_MESSAGE = 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง หรือติดต่อ admin';

@Injectable({ providedIn: 'root' })
export class ErrorNotificationService {
  message = signal<string | null>(null);

  private hideTimer?: ReturnType<typeof setTimeout>;

  show(message: string, durationMs = 6000): void {
    clearTimeout(this.hideTimer);
    this.message.set(message);
    this.hideTimer = setTimeout(() => this.message.set(null), durationMs);
  }

  dismiss(): void {
    clearTimeout(this.hideTimer);
    this.message.set(null);
  }
}
