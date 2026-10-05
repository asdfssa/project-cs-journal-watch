# Frontend Fix — สิ่งที่แก้ (2026-10-05)

ตอนนี้ frontend ถูก build รวมเข้า backend container เดียวกัน (Express เสิร์ฟไฟล์ Angular)
เปิดใช้งานที่ https://journal.farmlnwza007.online ผ่าน Cloudflare tunnel ตัวเดียว

## 1. Base URL ของ API — `src/app/comfig/constants.ts`

```ts
// เดิม
API_ENDPOINT = 'https://api.farmlnwza007.online/api/v2';
// ใหม่
API_ENDPOINT = '/api/v3';
```

- ใช้ path แบบ relative เพราะหน้าเว็บกับ API อยู่ origin เดียวกันแล้ว (ไม่ต้องพึ่ง CORS)
- เปลี่ยน v2 → v3 ให้ตรงกับ backend ตัวปัจจุบัน (mount ที่ `/api/v3`, cookie refresh ผูก path `/api/v3/auth`)
  โครง endpoint เหมือนเดิมทุกกลุ่ม ต่างแค่ prefix

## 2. Dev proxy — `proxy.conf.json` (ไฟล์ใหม่) + `angular.json` (serve.options.proxyConfig)

ตอน `ng serve` request ที่ขึ้นต้นด้วย `/api` จะถูก proxy ไปที่ `https://api.farmlnwza007.online`
ใครพัฒนา frontend ก็ยังรัน `npm start` แล้วยิง public API ทดสอบได้เหมือนเดิม ไม่ต้องแก้ constants
(public API `/api/v3` ใช้ได้เฉพาะตอนที่ stack `my_app` ของเครื่อง server เปิดอยู่)

## 3. Build production ผ่าน — `angular.json` (configurations.production)

`ng build` แบบ production ไม่เคยผ่านมาก่อน เลยแก้ 2 อย่าง:

- **budgets**: scss หลายไฟล์ใหญ่เกิน 8kB (มีถึง ~40kB) และ initial bundle เกิน 1MB
  - `initial`: warning 500kB → 1MB, error 1MB → 2MB
  - `anyComponentStyle`: warning 4kB → 16kB, error 8kB → 64kB
- **`optimization.fonts: false`**: ไม่ให้ build ดึง Google Fonts มาฝังในไฟล์ CSS (build ล้มถ้าเน็ตดึงไม่ได้)
  ฟอนต์ยังโหลดจาก Google ตอนเปิดหน้าเว็บเหมือนเดิม

## 4. เปิด tab ใหม่แล้วโดนให้ล็อกอินใหม่ — `src/app/Login/login/login.ts`

สาเหตุ: token อยู่ใน localStorage (ใช้ร่วมกันทุก tab) อยู่แล้ว แต่ route `''` redirect ไป `/login` เสมอ
และหน้า login ไม่เช็คว่าล็อกอินอยู่

แก้: ใน `ngOnInit` ถ้า `authService.isLoggedIn` และมี user → `navigate` ไป dashboard ตาม role ทันที
และแยก logic เลือกหน้าออกมาเป็น `dashboardFor(role)` ใช้ร่วมกับหลังล็อกอิน Google

| role | ไปที่ |
|---|---|
| Supervisor | `/advisor/dashboard` |
| Staff | `/staff/dashboard` |
| อื่นๆ (Student) | `/dashboard` |

## 5. แบบเดียวกันสำหรับ admin — `src/app/Login/login_admin/login.ts`

ใน constructor ถ้ามี `auth_token` และ `localStorage.user.role` เป็น
`SuperAdmin` → `/super-admin/dashboard`, `Admin` → `/admin/dashboard`
(key `user` ถูกตั้งหลังผ่าน OTP เท่านั้น คนที่ยังค้างขั้น OTP จะไม่ถูกพาข้าม — เงื่อนไขเดียวกับ `adminGuard`)

## ไฟล์ที่เกี่ยวข้องแต่ไม่ได้ใช้แล้วตอน deploy

`Dockerfile`, `nginx.conf`, `docker-compose.yml` ในโฟลเดอร์ frontend ไม่ได้ถูกใช้ใน deploy ปัจจุบัน
(build ผ่าน `backend/Dockerfile` stage `frontend-build` แทน) — ยังไม่ได้ลบ

---

# ยังไม่ได้แก้ — ปัญหาระบบ session / refresh token (ตรวจ 2026-10-05)

สิ่งที่ทำงานถูกแล้ว (`auth.interceptor.ts`): เจอ 401 → `POST /api/v3/auth/refresh`
(refresh token ส่งผ่าน httpOnly cookie `jw_refresh_token` อัตโนมัติ) → ยิง request เดิมซ้ำ,
มีหลาย request 401 พร้อมกันจะ refresh ครั้งเดียว, refresh ไม่ผ่าน → `logout()` + ไปหน้า `/login`

## A. refresh ทำงานได้เพราะบังเอิญ — `src/app/auth.service.ts`

`refreshAccessToken()` เช็ค `localStorage.auth_refresh_token` ก่อนยิง (`if (!rt) return of(null)`)
และส่งไปใน body แต่ backend:
- ไม่ได้ส่ง `refreshToken` มาใน response ของ login (ส่งทาง cookie อย่างเดียว) → `setLoggedIn` เก็บเป็น string `"undefined"`
- `/auth/refresh` อ่านจาก cookie อย่างเดียว ไม่อ่าน body

ตอนนี้ผ่านเพราะ `"undefined"` เป็น truthy ถ้า key นี้หายไปเมื่อไหร่จะไม่ refresh และดีดออกทันที

**แนวทางแก้:** ตัดการอ่าน/เก็บ `auth_refresh_token` ทิ้ง ยิง `/auth/refresh` ด้วย body ว่าง `{}` เสมอ (cookie ไปเอง)

## B. ฝั่ง admin ไม่ได้ใช้ระบบ refresh จริง

- `page_admin/shared/req-otp/req-otp.ts` เขียน localStorage เอง (`auth_token`, `user`) ไม่ผ่าน `AuthService`
  → signal `isLoggedIn` ของ `AuthService` ยังเป็น `false` (อ่านค่าครั้งเดียวตอนสร้าง service)
  จนกว่าจะรีโหลดหน้า → ระหว่างนั้น token หมดอายุ interceptor จะไม่ refresh/ไม่ดีดออก เห็นแค่ error
  (ประเมินจากโค้ด ยังไม่ได้ทดสอบกับบัญชีจริง)
- refresh ไม่ผ่าน interceptor พาไป `/login` (หน้านิสิต) แทน `/login-admin`

**แนวทางแก้:** ให้ req-otp เรียก method ของ `AuthService` เพื่ออัปเดต signal (หรือให้ `isLoggedIn` อ่าน localStorage ทุกครั้ง)
และให้ interceptor เลือกหน้า login ตาม role (`Admin`/`SuperAdmin` → `/login-admin`)

## C. logout ของ Student / Advisor / Staff ไม่ revoke refresh token

`Components/sidebar_user`, `sidebar-advisor`, `sidebar-staff` → `logout()` แค่ล้าง localStorage
ไม่ได้เรียก `POST /api/v3/auth/logout` → refresh token ใน cookie ยังใช้ได้อีก 7 วัน
(เครื่องที่ใช้ร่วมกัน คนต่อไปเรียก `/auth/refresh` ได้ token ใหม่) — ฝั่ง admin (`sidebar_admin`) เรียกถูกแล้ว

**แนวทางแก้:** ย้ายการเรียก `/auth/logout` ไปไว้ใน `AuthService.logout()` ที่เดียว ทุก sidebar ได้ไปด้วย

## D. ไม่มีการดีดออกเมื่อไม่ได้ใช้งาน (idle timeout)

frontend ไม่มี idle timer — ตอนนี้ดีดออกเมื่อ refresh token หมดอายุเท่านั้น
ซึ่ง backend ตั้งไว้ 7 วัน และต่ออายุใหม่ทุกครั้งที่ refresh (เข้าเว็บสักครั้งใน 7 วัน = ล็อกอินค้างตลอด)

**แนวทางแก้ (ฝั่ง backend `.env` ไม่ต้องแก้ frontend):**
```
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_MS=3600000   # ไม่ใช้งานเกิน 1 ชม. → ดีดออก
```
refresh ต้องนานกว่า access เสมอ ไม่งั้นคนที่ใช้งานอยู่จะโดนเตะกลางคัน
ข้อจำกัด: จะดีดออกตอนกด/โหลดข้อมูลครั้งถัดไป ถ้าอยากให้เด้งเองทั้งที่เปิดหน้าค้าง ต้องเพิ่ม idle timer ฝั่ง frontend

## E. refresh พร้อมกันจาก 2 tab แล้วโดน logout (เกิดจาก backend B4 — refresh token ใช้ได้ครั้งเดียวแบบเข้มงวด)

ตั้งแต่ backend commit `fix(B3,B4)` refresh token แต่ละตัวใช้ได้ **ครั้งเดียวจริงๆ** (กัน token ถูกขโมยไปยิงแข่ง)
ถ้า 2 tab ยิง `POST /auth/refresh` ในจังหวะเดียวกันเป๊ะ tab ที่ช้ากว่าจะได้ 401 → interceptor `logout()`
ล้าง localStorage ทุก tab (เกิดยาก — ปกติ tab แรก refresh เสร็จและได้ cookie ใหม่ก่อน)

**แนวทางแก้ (`auth.interceptor.ts` / `auth.service.ts`):** ตอน refresh ได้ 401 ให้ **ลอง refresh ซ้ำอีก 1 ครั้ง**
หลังรอสั้นๆ (เช่น 300–500ms) ก่อนจะ logout — ตอนนั้นเบราว์เซอร์มี cookie ตัวใหม่ที่อีก tab ได้มาแล้ว จึงผ่าน
```ts
refreshAccessToken(): Observable<string | null> {
  const call = () => this.http.post<...>(`${API}/auth/refresh`, {});
  return call().pipe(
    catchError(() => timer(400).pipe(switchMap(() => call()))),  // retry 1 ครั้ง
    map(res => { localStorage.setItem('auth_token', res.data.accessToken); return res.data.accessToken; }),
    catchError(() => of(null)),
  );
}
```
(ทำพร้อมข้อ A ได้เลย — ตัด `auth_refresh_token` ออก ยิง body `{}` เพราะ backend อ่านจาก cookie อย่างเดียว)

## F. CAPTCHA ตอนค้นวารสารถี่ (backend B11 — Cloudflare Turnstile ตรวจที่ backend)

backend เพิ่ม `captchaIfFrequent` ที่ `GET /journal/scopus`, `/journal/tci`, `/journal/scopus/scrape`, `/journal/tci/scrape`
- ผู้ใช้แต่ละคนค้นได้ 20 request / 5 นาที (ค้น 1 ครั้ง ≈ 2 request) โดยไม่ต้องยืนยัน
- เกินจากนั้น backend ตอบ **`428 CAPTCHA_REQUIRED`** → FE ต้องให้ผู้ใช้ผ่าน Turnstile แล้วยิง request เดิมซ้ำพร้อม header
  **`X-Captcha-Token: <token>`** — ผ่านแล้วได้โควตาใหม่อีก 20 request
- token ผิด/หมดอายุ → `428 CAPTCHA_INVALID` (ให้แสดง widget ใหม่), ตรวจไม่ได้ → `503 CAPTCHA_UNAVAILABLE`
- ตอนนี้ **ยังปิดอยู่** (backend ยังไม่ตั้ง `TURNSTILE_SECRET`) — จะเปิดเมื่อ FE ทำข้อนี้เสร็จ

**วิธีทำ (หน้า search ทั้ง `Page/shared/search` และ `page_admin/shared/search`):**
1. ใส่ script `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` (โหลดครั้งเดียว แบบเดียวกับ Google GSI)
2. เมื่อได้ 428 → `turnstile.render('#captcha-box', { sitekey: '<SITE_KEY>', callback: token => retry(token) })`
3. `retry(token)` = ยิง request เดิมด้วย `headers: { 'X-Captcha-Token': token }` แล้วซ่อน widget
4. **ลบ CAPTCHA ฝั่ง client เดิม** (`localStorage.jw_captcha_ts` — bug F18) เพราะ Turnstile มาแทนแล้ว

SITE_KEY: ได้จาก Cloudflare dashboard → Turnstile (เจ้าของ backend จะส่งให้) — ทดสอบ local ใช้ test site key
`1x00000000000000000000AA` (ผ่านเสมอ) หรือ `3x00000000000000000000FF` (บังคับให้กดยืนยัน)

## G. หน้า search: ตัดสินใจสลับไป scraping จาก `code` แทน regex ข้อความ (backend B1/X25)

backend รันเป็น `NODE_ENV=production` แล้ว → error response **ไม่มี `debug.raw_message` อีกต่อไป**
`isApiQuotaError()` (`Page/shared/search/search.ts` และ `page_admin/shared/search/search.ts`) ยังใช้ได้ เพราะ backend ตั้ง
`message` ตอน quota หมดให้มีคำว่า "quota" ไว้แล้ว — แต่ควรเปลี่ยนไปเช็ค code ที่ชัดเจนแทน:
```ts
private isApiQuotaError(err: any): boolean {
  return err?.status === 503 && err?.error?.code === 'SCOPUS_QUOTA_EXCEEDED';
}
```
