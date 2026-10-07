# Journal Watch — Backend API

Backend ของระบบ **Journal Watch** สำหรับตรวจสอบสถานะวารสารวิชาการ (Scopus / TCI) และบริหารจัดการ
กระบวนการยื่นคำร้อง Pre-T3 / T3 ของนิสิต พัฒนาด้วย Node.js + Express ในรูปแบบ MVC

## ภาพรวมระบบ

ระบบนี้ใช้สำหรับ:
- ตรวจสอบว่าวารสารที่นิสิตต้องการตีพิมพ์ผลงานอยู่ในฐาน **Scopus** หรือ **TCI** (Thai-Journal Citation Index) หรือไม่
  ทั้งผ่าน API ทางการ และ fallback เป็น web scraping (Playwright) เมื่อ API ใช้ไม่ได้
- ตรวจสอบรายชื่อ **วารสารที่ไม่พึงประสงค์ (Unwanted/Predatory Journals)**
- จัดการคำร้อง **Pre-T3** และ **T3** (แบบฟอร์มขอตีพิมพ์/ตรวจสอบผลงาน) พร้อม workflow อนุมัติหลายขั้น
  (นิสิต → อาจารย์ที่ปรึกษา → เจ้าหน้าที่คณะ) รวมถึงแนบไฟล์หลักฐานได้
- ระบบผู้ใช้แบบ role-based (นิสิต, อาจารย์ที่ปรึกษา, เจ้าหน้าที่, แอดมิน, ซูเปอร์แอดมิน)

## Tech Stack

- **Runtime**: Node.js 20 (Docker image `node:20-bookworm-slim`)
- **Framework**: Express 4
- **Database**: MySQL 8
- **Authentication**: JWT (2-step: password → OTP) + Google OAuth (จำกัดโดเมน `msu.ac.th`) + Refresh token (cookie)
- **Password**: bcrypt cost 12
- **OTP**: SHA-256 hash, 6 หลัก, หมดอายุ 10 นาที
- **Email**: Nodemailer (รองรับ console mode สำหรับ dev / SMTP สำหรับ production)
- **Web Scraping**: Playwright (fallback เมื่อ Scopus/TCI API ใช้ไม่ได้)
- **File Upload**: Multer (แนบไฟล์หลักฐาน T3)
- **Security Middleware**: Helmet, CORS, express-rate-limit, express-validator

## Roles ในระบบ

| Role | สิทธิ์โดยสังเขป |
|---|---|
| `Student` | ยื่น Pre-T3/T3, ดูประวัติของตัวเอง |
| `Supervisor` (อาจารย์ที่ปรึกษา) | ตรวจ/อนุมัติคำร้องของนิสิตในความดูแล |
| `Staff` (เจ้าหน้าที่คณะ) | อนุมัติขั้นสุดท้าย, จัดการผู้ใช้ (บางส่วน) |
| `Admin` / `SuperAdmin` | จัดการผู้ใช้ทั้งหมด, จัดการแอดมิน, ดู dashboard สถิติ |

## Project Structure

```
journal-watch-backend/
├── db/init/                   # schema (001_schema.sql) — MySQL container รันอัตโนมัติตอนสร้าง volume ครั้งแรก
├── docker/
│   └── novnc/                 # ใช้ดู browser ของ Playwright scraper แบบ headful ผ่าน noVNC
├── scripts/                   # seed ผู้ใช้ (seed-superadmin.js, seed-user.js) และสคริปต์ทดสอบ Scopus/TCI
├── data/                      # ข้อมูลที่ mount เข้า container (/app/data)
├── uploads/                   # ไฟล์แนบที่อัปโหลด (mount เข้า container)
├── src/
│   ├── config/                # Config + DB connection pool
│   ├── controllers/           # HTTP handlers (รับ req → เรียก service/model → ส่ง res)
│   ├── middlewares/           # auth, validation, rate limit, upload, error handler
│   ├── models/                # Data access layer (SQL queries)
│   ├── routes/                # Route definitions แยกตามโมดูล
│   ├── services/              # Business logic (auth, mail, Scopus/TCI fetch & scrape)
│   ├── utils/                 # Helpers (logger, jwt, crypto, date, error response)
│   ├── validators/            # Input validation rules
│   ├── app.js                 # Express app setup (middleware, mount routes ที่ /api/v3)
│   └── server.js              # Entry point
├── Dockerfile
(docker-compose.yml อยู่ที่ root ของ Pro2: db + backend/frontend + cloudflared)
├── .env.example               # Template ของ environment vars
└── package.json
```

## Setup

โปรเจกต์รันผ่าน Docker Compose (MySQL 8 + backend ที่มี Playwright และ noVNC)

### 1. Configure environment
```bash
cp .env.example .env
# แก้ค่าใน .env ให้ตรงกับ DB, JWT secret, SMTP, Google OAuth, Scopus API key ของคุณ
```

ตัวแปรสำคัญใน `.env`:

| ตัวแปร | คำอธิบาย |
|---|---|
| `PORT` | พอร์ตที่ server รัน (ใน Docker compose ถูกตั้งเป็น 3000) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | การเชื่อมต่อ MySQL/MariaDB |
| `JWT_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_OTP_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_MS` | อายุ/secret ของ token แต่ละประเภท |
| `OTP_LENGTH`, `OTP_EXPIRES_MINUTES`, `OTP_MAX_ATTEMPTS` | ค่ากำหนดของ OTP |
| `MAIL_MODE`, `MAIL_FROM`, `SMTP_*` | โหมดส่งอีเมล (`console` สำหรับ dev, `smtp` สำหรับ production) |
| `CORS_ORIGIN` | origin ของ frontend ที่อนุญาต |
| `GOOGLE_CLIENT_ID`, `GOOGLE_ALLOWED_DOMAIN` | Google OAuth login (จำกัดเฉพาะโดเมนมหาวิทยาลัย) |
| `SCOPUS_API_KEY_1` … `SCOPUS_API_KEY_10` | API key สำหรับเรียก Scopus API (รองรับ rotate หลายคีย์) |
| `SCRAPER_HEADLESS` | เปิด/ปิด headless mode ของ Playwright scraper |

> **สำคัญ**: อย่าใส่ค่าจริงของ secret/API key ลงใน `.env.example` — ให้ใส่เฉพาะค่า placeholder เท่านั้น
> เพราะไฟล์นี้จะถูก commit เข้า git

### 2. Run
```bash
docker compose up -d --build        # รันที่ root ของ Pro2 (ไม่ใช่ใน backend/)
docker logs -f journal_watch_backend   # ดู log ของ backend
```

| Service | พอร์ตบนเครื่อง host |
|---|---|
| backend API | `13002` (3002 ติด Windows reserved port range) (→ container `3000`) |
| MySQL | `3310` (→ container `3306`) |
| noVNC / VNC (bind เฉพาะ localhost) | `6082` / `15902` |

`DB_HOST` และ `DB_PORT` ใน `.env` ถูก compose ทับเป็น `db:3306` ให้ backend ใน container อัตโนมัติ
schema ใน `db/init/` จะถูกรันตอนสร้าง volume ครั้งแรกเท่านั้น จากนั้นสร้างผู้ใช้เริ่มต้นด้วย
`scripts/seed-superadmin.js`

ทุก endpoint ของ API ถูก mount ไว้ที่ prefix **`/api/v3`**

## API Endpoints

### Authentication — `/api/v3/auth`

| Method | Path | คำอธิบาย | Auth |
|---|---|---|---|
| POST | `/login` | Step 1: username + password → OTP token | - |
| POST | `/verify-otp` | Step 2: OTP code → access token + refresh cookie | OTP token |
| POST | `/resend-otp` | ส่ง OTP ใหม่ | OTP token |
| POST | `/google` | Login ด้วย Google OAuth | - |
| POST | `/register-staff` | สมัคร staff ผ่าน Google login | - |
| POST | `/refresh` | ขอ access token ใหม่จาก refresh cookie | - |
| GET | `/me` | ข้อมูล user ปัจจุบัน | Access token |
| POST | `/logout` | Logout, revoke refresh token | - |
| POST | `/forgot-password` | ขอ OTP รีเซ็ตรหัสผ่าน (Admin/SuperAdmin) | - |
| POST | `/reset-password` | ตั้งรหัสผ่านใหม่ด้วย OTP | Reset token |

### Journal Lookup — `/api/v3/journal`

| Method | Path | คำอธิบาย | Auth |
|---|---|---|---|
| GET | `/scopus` | ค้นหาวารสารใน Scopus ด้วย ISSN (ผ่าน API) | Access token |
| GET | `/tci` | ค้นหาวารสารใน TCI ด้วย ISSN (ผ่าน API) | Access token |
| GET | `/scopus/scrape` | ค้นหา Scopus ด้วยวิธี scraping | Access token |
| GET | `/tci/scrape` | ค้นหา TCI ด้วยวิธี scraping | Access token |

### Unwanted / Predatory Journals — `/api/v3/unwanted-journals`

| Method | Path | คำอธิบาย | Auth |
|---|---|---|---|
| GET | `/` | รายการวารสารที่ไม่พึงประสงค์ | Access token |
| GET | `/check/:issn` | ตรวจสอบ ISSN ว่าอยู่ในลิสต์หรือไม่ | Access token |
| GET | `/:id/evidence` | ดาวน์โหลดไฟล์หลักฐาน | Access token |
| POST | `/single` | เพิ่มรายการ | Admin/SuperAdmin/Staff |
| POST | `/import` | นำเข้าจากไฟล์ CSV | Admin/SuperAdmin/Staff |
| PATCH | `/:id` | แก้ไขรายการ | Admin/SuperAdmin/Staff |
| DELETE | `/:id` | ลบรายการ | Admin/SuperAdmin/Staff |

### Pre-T3 — `/api/v3/pre-t3`

| Method | Path | คำอธิบาย | Auth |
|---|---|---|---|
| POST | `/` | นิสิตยื่นคำร้อง Pre-T3 | Student |
| GET | `/my` | ประวัติคำร้องของตัวเอง | Student |
| GET | `/pending` | รายการรอตรวจ | Supervisor/Staff |
| GET | `/history` | ประวัติการตรวจ | Supervisor/Staff |
| GET | `/:id` | รายละเอียดคำร้อง | ผู้เกี่ยวข้อง/Admin |
| PATCH | `/:id/advisor-review` | อาจารย์ที่ปรึกษา**หลัก**อนุมัติ/ไม่อนุมัติ (อาจารย์ร่วม → 403 `NOT_MAJOR_ADVISOR`) | Supervisor |
| PATCH | `/:id/faculty-review` | เจ้าหน้าที่คณะอนุมัติขั้นสุดท้าย | Staff |
| PATCH | `/:id/resubmit` | ยื่นใหม่หลังถูกตีกลับ | Student |
| PATCH | `/:id/cancel` | ยกเลิกคำร้องของตัวเอง | Student |

### T3 — `/api/v3/t3` (workflow เดียวกับ Pre-T3 แต่รองรับแนบไฟล์)

| Method | Path | คำอธิบาย | Auth |
|---|---|---|---|
| POST | `/` | ยื่นคำร้อง T3 | Student |
| POST | `/with-files` | ยื่นคำร้อง T3 พร้อมไฟล์แนบ (multipart) | Student |
| GET | `/my` | ประวัติของตัวเอง | Student |
| GET | `/pending` | รายการรอตรวจ | Supervisor/Staff |
| GET | `/history` | ประวัติการตรวจ | Supervisor/Staff |
| GET | `/:id` | รายละเอียดคำร้อง | ผู้เกี่ยวข้อง/Admin |
| PATCH | `/:id/advisor-review` | อาจารย์ที่ปรึกษา**หลัก**ตัดสิน (อาจารย์ร่วม → 403 `NOT_MAJOR_ADVISOR`) | Supervisor |
| PATCH | `/:id/faculty-review` | เจ้าหน้าที่คณะตัดสิน | Staff |
| PATCH | `/:id/cancel` | ยกเลิกคำร้องของตัวเอง | Student |

### File Upload — `/api/v3/upload`

| Method | Path | คำอธิบาย | Auth |
|---|---|---|---|
| GET | `/t3/:id/files/:field` | ดาวน์โหลด/ดูไฟล์แนบ | ผู้เกี่ยวข้อง/Admin |

### User Management — `/api/v3/manage/users` (Admin/SuperAdmin/Staff)

| Method | Path | คำอธิบาย | Auth |
|---|---|---|---|
| GET | `/` | รายชื่อผู้ใช้ | Admin/SuperAdmin/Staff |
| POST | `/single` | สร้างผู้ใช้ทีละคน | Admin/SuperAdmin/Staff |
| POST | `/import` | นำเข้าผู้ใช้จำนวนมาก | Admin/SuperAdmin/Staff |
| PATCH | `/:id/approve` | อนุมัติผู้ใช้ | Admin/SuperAdmin เท่านั้น |
| PATCH | `/:id/suspend` | ระงับผู้ใช้ | Admin/SuperAdmin/Staff |
| PATCH | `/:id/activate` | เปิดใช้งานผู้ใช้ | Admin/SuperAdmin/Staff |
| PATCH | `/:id/advisors` | ตั้งค่าอาจารย์ที่ปรึกษา | Admin/SuperAdmin/Staff |
| PATCH | `/:id` | แก้ไขข้อมูลผู้ใช้ | Admin/SuperAdmin/Staff |

### Admin — `/api/v3/admin` (Admin/SuperAdmin เท่านั้น)

| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/stats` | สถิติสำหรับ dashboard |
| GET | `/admins` | รายชื่อแอดมิน |
| POST | `/admins` | สร้างแอดมิน |
| PATCH | `/admins/:id/suspend` | ระงับแอดมิน |
| PATCH | `/admins/:id/activate` | เปิดใช้งานแอดมิน |
| PATCH | `/admins/:id` | แก้ไขแอดมิน |
| DELETE | `/admins/:id` | ลบแอดมิน |

### User Profile — `/api/v3/user` (ทุก role)

| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/profile` | โปรไฟล์ของตัวเอง |
| PATCH | `/profile` | แก้ไขโปรไฟล์ตัวเอง |
| GET | `/staff` | รายชื่อ staff/อาจารย์ |

### Health

| Method | Path | คำอธิบาย | Auth |
|---|---|---|---|
| GET | `/api/v3/health` | Health check | - |

## Login Flow

```
┌──────────────┐
│   Step 1     │
│  Username +  │
│  Password    │
└──────┬───────┘
       │ POST /api/v3/auth/login
       ▼
┌──────────────┐
│  Server      │
│  - bcrypt    │
│    verify    │
│  - send OTP  │ ───→ Email (10 min)
│  - issue     │
│    OTP token │
└──────┬───────┘
       │ { otpToken, maskedEmail }
       ▼
┌──────────────┐
│   Step 2     │
│   Enter OTP  │
└──────┬───────┘
       │ POST /api/v3/auth/verify-otp
       │ Header: Bearer <otpToken>
       │ Body:   { otpCode }
       ▼
┌──────────────┐
│  Server      │
│  - SHA-256   │
│    compare   │
│  - issue     │
│    access +  │
│    refresh   │
└──────┬───────┘
       │ { accessToken, user } + refresh cookie
       ▼
   Logged In ✓
```

รองรับ **Google OAuth** เป็นทางเลือกเข้าสู่ระบบเพิ่มเติม (จำกัดเฉพาะอีเมลโดเมน `msu.ac.th`)

## Journal Lookup Flow (Scopus / TCI)

1. เรียก API ทางการก่อน (`ScopusService` / `TCIService`)
2. ถ้า API ล้มเหลว/ไม่มีข้อมูล จะ fallback ไปที่ web scraping ด้วย Playwright
   (`ScopusScraper` / `TCIScraper`) — ดูผ่าน noVNC ได้เมื่อรันแบบ non-headless (`SCRAPER_HEADLESS=false`)
3. Scopus รองรับการหมุน API key หลายตัว (`ScopusProxyService`) เพื่อจัดการ rate limit รายสัปดาห์

## Security Features

- **Password**: bcrypt cost 12 (OWASP recommended ≥ 10)
- **OTP**: SHA-256 hashed at rest (DB leak ก็ใช้ไม่ได้)
- **OTP Lockout**: ผิด 5 ครั้ง → invalidate token
- **Rate Limit**: จำกัดจำนวนครั้งต่อ IP แยกตาม endpoint (login, OTP, Google, forgot-password)
- **JWT**: แยก token หลายประเภท (OTP token, access token, refresh token ผ่าน httpOnly cookie)
- **Generic error messages**: ป้องกัน username enumeration
- **Constant-time compare**: ป้องกัน timing attack
- **Helmet**: security headers
- **CORS**: configurable origin
- **Role-based access control**: ทุก endpoint ที่มีผลต่อข้อมูลถูกจำกัดด้วย role middleware

## Development Notes

- ตอน dev `MAIL_MODE=console` → OTP จะแสดงใน console ของ server แทนการส่งอีเมลจริง
- ตอน production เปลี่ยนเป็น `MAIL_MODE=smtp` พร้อมตั้งค่า SMTP credentials
- เปลี่ยน `JWT_SECRET` เป็น random string ที่ยาว ≥ 64 ตัวอักษร
- ห้าม commit ค่า secret จริง (API key, SMTP password, JWT secret) ลงใน `.env.example` หรือไฟล์ใด ๆ ที่เข้า git
- ดู log ด้วย `docker logs -f journal_watch_backend` (ไม่มี log viewer ผ่าน API)
- `docker/novnc/` ใช้สำหรับดูการทำงานของ Playwright scraper แบบ remote desktop เวลา debug

## License

MIT
