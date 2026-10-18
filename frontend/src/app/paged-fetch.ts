import { HttpClient, HttpHeaders } from '@angular/common/http';
import { EMPTY, Observable, expand, map, reduce } from 'rxjs';

interface PagedRes<I> {
  success: boolean;
  data: { items: I[]; total: number; page: number; limit: number; totalPages: number };
}

const PAGE_LIMIT = 100;   // backend จำกัด limit ไม่เกิน 100
const MAX_PAGES  = 30;    // กันวนไม่รู้จบถ้า totalPages ผิดปกติ (สูงสุด 3,000 รายการ)

/**
 * F10: ดึงทุกหน้าของ endpoint แบบ ?page=&limit= แล้วรวม items เป็นก้อนเดียว
 * เดิมหน้าประวัติขอแค่ page=1&limit=20 → รายการเกิน 20 หายไปและตัวนับผิด
 * คืนค่ารูปเดียวกับ response เดิม (items ครบทุกหน้า) ใช้แทน http.get ได้ตรงๆ
 */
export function fetchAllPages<T extends PagedRes<unknown>>(
  http: HttpClient, url: string, headers: HttpHeaders,
): Observable<T> {
  const sep = url.includes('?') ? '&' : '?';
  const page = (n: number) => http.get<T>(`${url}${sep}page=${n}&limit=${PAGE_LIMIT}`, { headers });

  return page(1).pipe(
    expand(res => {
      const p = res?.data?.page ?? 1;
      const total = Math.min(res?.data?.totalPages ?? 1, MAX_PAGES);
      return res?.success && p < total ? page(p + 1) : EMPTY;
    }),
    reduce((acc: T | null, res: T) => acc
      ? { ...acc, data: { ...acc.data, items: [...acc.data.items, ...(res.data?.items ?? [])] } } as T
      : res, null),
    map(res => res as T),
  );
}
