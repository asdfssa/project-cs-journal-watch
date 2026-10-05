import { Injectable } from "@angular/core";

@Injectable({
    providedIn:'root',
})
export class Constants{
    // relative path: ตอน deploy frontend ถูกเสิร์ฟจาก backend container เดียวกัน (same-origin)
    // ตอน ng serve จะ proxy /api ไปที่ public API ตาม proxy.conf.json
    public readonly API_ENDPOINT: string = '/api/v3';
}
