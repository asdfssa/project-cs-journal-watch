# Journal Watch — Project Checklist
> อัปเดต: 18 พฤษภาคม 2569 (ตรวจจาก source code จริง + Docker)

---

## 🔐 ระบบ Auth (6/6)

| สถานะ | รายการ |
|---|---|
| ✅ | Login — Username + Password + 2FA OTP (Admin) |
| ✅ | Login — Google OAuth |
| ✅ | Register Staff (Google) → รออนุมัติจาก Admin |
| ✅ | Refresh Token + Logout |
| ✅ | JWT + AuthGuard + Interceptor |
| ✅ | Rate Limiting + Account Lockout |

---

## 📚 ระบบค้นหาวารสาร (5/5)

| สถานะ | รายการ | หมายเหตุ |
|---|---|---|
| ✅ | ค้นหา TCI ด้วย ISSN (Scraping + Cache 7 วัน) | |
| ✅ | ค้นหา Scopus ด้วย ISSN (API + Cache 7 วัน) | |
| ✅ | Key Rotation + Proxy Status | |
| ✅ | ตรวจสอบ Pass/Fail ตามเกณฑ์ (Q2+, Tier 1-2, ไม่ Discontinued/Inactive) | |
| ✅ | Scopus Real-time Scraping (headless) | |

---

## 👑 ระบบ Admin (9/10)

| สถานะ | รายการ | หมายเหตุ |
|---|---|---|
| ✅ | Dashboard Stats (users, pre-t3, t3, cache) | |
| ✅ | Get Users (filter: role, status, search, pagination) | |
| ✅ | Create User (single) — role, degree_level, advisor | |
| ✅ | Import Users (bulk CSV) | |
| ✅ | Approve / Suspend / Activate User | |
| ✅ | Update User info | |
| ✅ | Update Advisors | |
| ✅ | System Logs `GET /api/admin/logs` — filter ทุก column | |
| ✅ | MSU Unwanted Journals — CRUD + Import CSV | |
| ✅ | จัดการ Admin คนอื่น (เพิ่ม/ลบ Admin, ห้ามแตะ SuperAdmin) | |

---

## 📋 ฟอร์ม Pre-T3 (6/6)

| สถานะ | รายการ | หมายเหตุ |
|---|---|---|
| ✅ | นิสิตยื่น Pre-T3 (checklist 9 ข้อ + journal snapshot) | `POST /api/pre-t3` |
| ✅ | Advisor อนุมัติ/ปฏิเสธ Pre-T3 ของนิสิตตัวเอง | `PATCH /api/pre-t3/:id/advisor-review` |
| Bypass | Program Chair อนุมัติ/ปฏิเสธ | ข้ามข้อนี้ไป เพราะจะทำแค่ นิสิต -> อาจารย์ที่ปรึกษา -> Staff |
| ✅ | Staff (Faculty Com) อนุมัติขั้นสุดท้าย | `PATCH /api/pre-t3/:id/faculty-review` |
| ✅ | ดูประวัติการยื่น + สถานะ Pre-T3 | `GET /api/pre-t3/my`, `GET /api/pre-t3/pending`, `GET /api/pre-t3/:id` |
| ✅ | แจ้งเตือนทางอีเมลทุก step | `MailService.sendPreT3Notification` |
| ✅ | นิสิตยื่นซ้ำหลังถูกปฏิเสธ | `PATCH /api/pre-t3/:id/resubmit` |

---

## 📄 ฟอร์ม T3 (6/6)

| สถานะ | รายการ | หมายเหตุ |
|---|---|---|
| ✅ | นิสิตยื่น T3 (ต้องมี Pre-T3 Approved ก่อน) | `POST /api/t3` — ข้อมูล: ชื่อบทความ, weight, ประเภทวารสาร, impact factor, เอกสารแนบ |
| ✅ | Advisor อนุมัติ/ปฏิเสธ T3 | `PATCH /api/t3/:id/advisor-review` |
| ✅ | Faculty Com อนุมัติ (meeting_no, meeting_date) | `PATCH /api/t3/:id/faculty-review` |
| ✅ | Grad School อนุมัติขั้นสุดท้าย (Staff บันทึกผลหลังได้อีเมลตอบกลับ) | `PATCH /api/t3/:id/grad-school-review` |
| ✅ | ดูประวัติการยื่น + สถานะ T3 | `GET /api/t3/my`, `GET /api/t3/pending`, `GET /api/t3/:id` |
| ✅ | แจ้งเตือนทางอีเมลทุก step | `MailService.sendT3Notification` |

---

## ⚙️ อื่นๆ (3/3)

| สถานะ | รายการ | หมายเหตุ |
|---|---|---|
| ✅ | Health Check + In-memory Logs (dev console) | `GET /api/logs` — ดู OTP ระหว่าง dev |
| ✅ | MSU Unwanted Journals — CRUD + Import CSV | `GET/POST/PATCH/DELETE /api/admin/unwanted-journals` |
| ✅ | อัปโหลดไฟล์แนบ T3 | `POST/GET/DELETE /api/upload/t3/:id/files` — รองรับ 6 fields |

---

## 🐛 Bug Report (3/3)

| สถานะ | รายการ | หมายเหตุ |
|---|---|---|
| ✅ | ผู้ใช้รายงานปัญหา | `POST /api/bug-reports` — ทุก role |
| ✅ | ดูรายงาน | `GET /api/bug-reports/my`, `GET /api/bug-reports`, `GET /api/bug-reports/:id` |
| ✅ | Admin อัปเดต status | `PATCH /api/bug-reports/:id/status` — in_progress / resolved / wontfix |

---

## 🐳 Docker (4/4)

| สถานะ | รายการ | หมายเหตุ |
|---|---|---|
| ✅ | Port Backend ลง Docker | Node.js + Playwright + Xvfb + noVNC |
| ✅ | MySQL ใช้ volume เดิม | `db_db_data` — ข้อมูลไม่หาย |
| ✅ | Cloudflare Tunnel รันใน Docker | `docker compose up` คำสั่งเดียวจบ |
| ✅ | noVNC ดูหน้าจอ Chromium | `http://localhost:6080/vnc.html` |

---

## 📌 กฎเหล็กของการสนทนา

1. **ถามก่อนแก้ไฟล์** — ขอดูเนื้อหาปัจจุบันก่อนเสมอ
2. **ถาม ng serve ทุกครั้ง** — หลังเขียนเสร็จแต่ละฟีเจอร์
3. **ถามก่อนเดา** — ถ้าไม่รู้ข้อมูล (DB schema, ฟอร์ม ฯลฯ) ถามก่อนเสมอ

## 📌 หมายเหตุสำคัญ

- `degree_level` ENUM: `Master` | `Doctoral` (ตัว M และ D ใหญ่)
- `curriculum_year` ENUM: `2560` | `2566`
- `study_plan_code` ENUM: `Master_A1`, `Master_A2`, `Master_B`, `Master_P1A1`, `Master_P1A2`, `Master_P2B`, `Doc_1_1`, `Doc_1_2`, `Doc_2_1`, `Doc_2_2`, `Doc_P1_1_1`, `Doc_P1_1_2`, `Doc_P2_2_1`, `Doc_P2_2_2`
- `account_status` ENUM: `Pending` | `Active` | `Suspended`
- `role` ENUM: `Student` | `Supervisor` | `Program_Chair` | `Staff` | `Admin` | `SuperAdmin`
- Log Routes `/api/logs` — in-memory เพื่อดู OTP ระหว่าง dev ไม่ใช่ system log จริง
- `SCRAPER_HEADLESS=false` ไว้ก่อนระหว่าง dev
- Docker: `docker compose up` คำสั่งเดียวเปิดทุก service (Backend + DB + Cloudflare + noVNC)
- noVNC: `http://localhost:6080/vnc.html` — ดูหน้าจอ Chromium scraping
- Docker files อยู่ที่ `my_app/docker/` และ `my_app/cloudflared/`


- docker compose up --build -d backend