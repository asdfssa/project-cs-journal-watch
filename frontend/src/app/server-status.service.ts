import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, of, timeout } from 'rxjs';
import { Constants } from './comfig/constants';

export const SERVER_DOWN_MESSAGE = 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ในขณะนี้ กรุณาลองใหม่ภายหลัง';

/** errors: รายการข้อผิดพลาดรายแถวจาก backend (เช่น import CSV: ["Row 3: ..."]) — X35 */
export interface ApiFailure { success: false; message: string; errors?: string[]; }

/**
 * ใช้ใน catchError ของ request ที่เป็นการกระทำของผู้ใช้ (POST/PATCH/DELETE) แทน of(null)
 * เพื่อเก็บเหตุผลจาก backend ไว้แสดงใน UI — `catchError(err => of(apiFailure(err)))`
 * message ว่างได้ (4xx ที่ backend ไม่ส่งเหตุผล) → ผู้เรียกใส่ข้อความ fallback เอง
 */
export function apiFailure(err: unknown): ApiFailure {
  const e = err as HttpErrorResponse;
  const msg = e?.error?.message;
  const rows = e?.error?.errors;
  const errors = Array.isArray(rows) ? rows.filter((r: unknown): r is string => typeof r === 'string') : undefined;
  if (typeof msg === 'string' && msg.trim()) return { success: false, message: msg, ...(errors?.length ? { errors } : {}) };
  if (!e?.status)       return { success: false, message: SERVER_DOWN_MESSAGE };   // status 0 = ต่อไม่ได้
  if (e.status >= 500)  return { success: false, message: `เซิร์ฟเวอร์ขัดข้อง (HTTP ${e.status}) กรุณาลองใหม่อีกครั้ง` };
  return { success: false, message: '' };
}

/** ข้อความ error สำหรับแสดง: เหตุผลจาก backend ถ้ามี ไม่งั้นใช้ fallback */
export function failMsg(res: unknown, fallback = 'เกิดข้อผิดพลาด กรุณาลองใหม่'): string {
  const m = (res as { message?: unknown } | null)?.message;
  return typeof m === 'string' && m.trim() ? m : fallback;
}

// ใช้แยกให้ออกว่า error มาจาก "เซิร์ฟเวอร์ล่ม/ต่อไม่ได้" หรือ "backend ปฏิเสธจริง (เช่น รหัสผิด)"
// เดิมทุก error ที่ไม่มี message ถูกแสดงเป็น "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" ทำให้เข้าใจผิด
@Injectable({ providedIn: 'root' })
export class ServerStatusService {
  private http      = inject(HttpClient);
  private constants = inject(Constants);

  /** GET /health → true ถ้า backend ตอบ { status: 'ok' } ภายใน 5 วินาที */
  check(): Observable<boolean> {
    return this.http
      .get<{ status: string }>(`${this.constants.API_ENDPOINT}/health`)
      .pipe(
        timeout(5000),
        map(res => res?.status === 'ok'),
        catchError(() => of(false)),
      );
  }

  /**
   * แปล error ของ HTTP เป็นข้อความสำหรับผู้ใช้
   * - backend ส่ง message มา → ใช้ตามนั้น
   * - 4xx ไม่มี message → rejectedMessage (เช่น "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง")
   * - ต่อไม่ได้ / 5xx → เช็ค /health เพื่อบอกว่าเซิร์ฟเวอร์ล่ม หรือแค่ขัดข้องชั่วคราว
   */
  explain(err: HttpErrorResponse | unknown, rejectedMessage: string): Observable<string> {
    const e = err as HttpErrorResponse;
    const msg = e?.error?.message;
    if (typeof msg === 'string' && msg.trim()) return of(msg);
    if (e?.status >= 400 && e?.status < 500) return of(rejectedMessage);

    return this.check().pipe(
      map(ok => ok
        ? `เซิร์ฟเวอร์ขัดข้องชั่วคราว${e?.status ? ` (HTTP ${e.status})` : ''} กรุณาลองใหม่อีกครั้ง`
        : SERVER_DOWN_MESSAGE),
    );
  }
}
