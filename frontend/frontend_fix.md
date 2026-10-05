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
