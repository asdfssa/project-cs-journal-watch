# รายงานสรุป: แก้บั๊ก Backend รอบ 2 และผลทดสอบ Docker

อัปเดต 2026-10-09 · อ้างอิง `bugs-8-10-2569.md` · แก้เฉพาะ `backend/` (ไม่ได้แตะ `frontend/`)

> **หมายเหตุ Frontend:** `frontend/` ในเครื่องตอนนี้**ยังไม่ใช่เวอร์ชันล่าสุด** (รอ pull จาก git ของเพื่อน)
> ผล build/ทดสอบด้านล่างที่เกี่ยวกับ FE จึงเป็นของเวอร์ชันที่มีอยู่ตอนนี้เท่านั้น ควร build ซ้ำหลัง pull
> ส่วนที่ทดสอบ Backend (API/DB) ไม่ขึ้นกับ FE

## 1. สรุปผลงาน

| รายการ | จำนวน |
|---|---|
| บั๊ก BE ที่แก้และ commit (ใน `bugs-8-10-2569.md` ติ๊ก `[x]`) | 29 รายการ (ดู `Backend_Fixed-9-10-2569.md` หัวข้อ 3) |
| ตั้งใจเลื่อน | B27 ส่วน DB user, B33, B36 และส่วนย่อยของ B37, B41, B42, B52, B53, B54 |
| เทสต์อัตโนมัติ (`backend/tests/`) | 16 ไฟล์ · 94 เคส |
| เอกสารให้ทีม FE | `Backend_Fixed-9-10-2569.md` |

## 2. ผลทดสอบ Docker (ทำแล้ว)

ใช้ stack แยกชื่อ `jw_test` (container `jw_test_db`, `jw_test_backend`, พอร์ต `127.0.0.1:23002`, ฐานข้อมูลใหม่ว่างเปล่า) **ไม่แตะ container เดิม `journal_watch_*` ที่กำลังรันอยู่** และไม่ใช้ `.env` จริง (ใช้ค่าทดสอบที่สร้างใหม่ + `MAIL_MODE=console`)

| ขั้น | ผล |
|---|---|
| `docker compose build` ด้วย Node 22 (ทั้ง stage frontend และ backend) | ✔ สำเร็จ ขนาด image ≈ 2.56 GB, Node ใน image = v22.23.3 |
| Backend start บน Node 22 (รวม native module `bcrypt`) | ✔ ต่อ DB ได้ `Server running` |
| เสิร์ฟ SPA (`GET /`) และ API (`/api/v3/auth/me` ไม่มี token) | ✔ 200 / 401 ตามคาด |
| เทสต์อัตโนมัติ 16 ไฟล์ **รันภายใน container Node 22** | ✔ ผ่านทั้งหมด 94/94 |
| E2E กับ MySQL จริง: Admin login + OTP, HMAC ของ OTP (B47), refresh token (X28 BE), OTP cooldown (B48) | ✔ 11/11 |

รายละเอียด E2E ที่ผ่าน: otp_hash ใน DB เป็น HMAC (ไม่ใช่ SHA-256 ล้วน) · OTP ผิด → `OTP_INVALID` · OTP ถูก → ได้ access token + คุกกี้ refresh · refresh หมุนคุกกี้ใหม่ · ใช้ใบเก่าซ้ำภายใน 10 วินาทีได้ access token โดยไม่ออกคุกกี้ใหม่ · token มั่ว → 401 และล้างคุกกี้ · ขอ OTP ซ้ำทันที → `OTP_COOLDOWN`

### ข้อสังเกตจากการทดสอบ
- `backend/db/init/001_schema.sql` ฝังชื่อฐานข้อมูล `journal_watch_v2` ถ้าตั้ง `DB_NAME` เป็นชื่ออื่น ตารางจะไปอยู่คนละฐานกับที่ app ต่อ (ไม่ใช่บั๊กใหม่ แต่ควรรู้)
- ตอนสร้างฐานข้อมูลครั้งแรก healthcheck ของ MySQL ผ่านตั้งแต่ช่วง init ชั่วคราว ทำให้ backend ลองต่อ DB แล้วล้มหนึ่งรอบ (ต้อง restart) เกิดเฉพาะการสร้าง volume ใหม่ ไม่เกิดกับ DB ที่มีอยู่แล้ว (ไม่ใช่ผลจากงานรอบนี้)

## 3. ยังไม่ได้ทดสอบ (ค้างอยู่)

เทสต์ข้างต้นทั้งหมดยังเป็น DB จำลองเป็นส่วนใหญ่ **สถานการณ์ต่อไปนี้ยังไม่ได้ลองกับ MySQL จริง**:

| บั๊ก | สิ่งที่ต้องลอง |
|---|---|
| B29 | ยื่น Pre-T3 ISSN ซ้ำ / ยื่น T3 ซ้ำ **พร้อมกัน** (ตรวจ `FOR UPDATE` จริง) · ยื่น T3 ใหม่หลังถูก reject |
| B30, X32 | `POST /t3/with-files` แนบ/ไม่แนบไฟล์ · ไฟล์ปลอม MIME · ล้มกลางทางแล้วไม่มีไฟล์ค้าง |
| B31 | type/weight จาก Pre-T3 (Scopus 1.0, TCI กลุ่ม 1/2) · ปฏิเสธ ISSN ต้องห้าม |
| B32 | เปลี่ยนอาจารย์ที่มีคำขอ Pending — **คำสั่ง `UPDATE ... JOIN` ยังไม่เคยรันกับ MySQL จริง** |
| B39, B52 | import CSV ไฟล์ใหญ่ · เพิ่มวารสารต้องห้าม ISSN เดียวกันพร้อมกัน (`GET_LOCK` จริง) |
| B40, B43, B51, B54 | วันที่ประชุมเวลาไทย · ลำดับประวัติ · DECIMAL เป็น number · stats `cancelled` |
| B45, B46, B49, B53 | object/array → 400 · `:id` ไม่ใช่ตัวเลข · ซ่อนผู้สร้างตาม role · ค้นด้วย `%` ใน MySQL |
| B34 | เปลี่ยนอีเมล Admin ด้วย/ไม่มีรหัสผ่าน · limiter 5 ครั้ง |
| B41 | scrape Scopus/TCI จริง (ต้องต่อเน็ต + API key) — ทดสอบด้วยของจำลองเท่านั้น |
| B53 | ส่งเมลผ่าน SMTP จริงด้วย `requireTLS` — ยังไม่ได้ลอง |
| อื่นๆ | Playwright/Chromium ใน container ทำงานได้จริงไหม · เปิดหน้าเว็บ FE (ต้องรอ pull เวอร์ชันล่าสุดก่อน) |

## 4. จุดที่ต้องจำก่อน deploy จริง
1. **Build ซ้ำหลัง pull frontend ล่าสุด** แล้วลองเปิดหน้าเว็บจริง
2. ตรวจ SMTP ว่ารองรับ STARTTLS (B53) ไม่งั้นตั้ง `SMTP_REQUIRE_TLS=false`
3. OTP ที่ออกก่อน deploy จะใช้ไม่ได้ (B47) ให้ผู้ใช้ขอใหม่
4. ไฟล์ `backend/data/scopus-proxy-state.json` เดิมยังมี API key จริงจนกว่า backend จะรีสตาร์ท (B49 เขียนทับเป็น hash ให้เอง)
5. ตอน deploy จริง: ตัด `gmail.com` (B36), DB user ไม่ใช่ root (B27), รันเป็น non-root และตั้งรหัส VNC (B42), พิจารณา reuse detection ของ refresh token (B33)
6. ลดอายุ access token เหลือ 15 นาทีเมื่อ FE refresh ใช้ได้จริง (X27/X28 FE)

## 5. บั๊กที่ผมนับพลาดไป: ส่วน BE ที่ยังไม่ได้ทำ
ก่อนหน้านี้ผมสรุปว่า "ฝั่ง BE ไม่มีข้อไหนค้าง" **ไม่ถูกต้อง** ในส่วน FE↔BE ของรายงานยังมี 5 ข้อที่มีฝั่ง BE และยังไม่ได้ทำ (ไม่ได้ตั้งใจเลื่อน):

| รหัส | ฝั่ง BE ที่ค้าง | ขนาด |
|---|---|---|
| X41 | SPA fallback ตอบ `index.html` (200) ให้ไฟล์ static ที่ไม่มี → ข้ามเมื่อ path มีนามสกุลไฟล์ | เล็ก (บรรทัดเดียวใน `app.js`) |
| X49 | ไม่เช็ค scheme http/https ของ `journalUrl` (phishing ได้) | เล็ก |
| X34 | `GET /user/staff` ต้อง login แต่หน้า `/contact` เป็น public — ต้องตัดสินใจว่าเปิด public (เฉพาะชื่อ/ช่องทางติดต่อ) หรือไม่ | เล็ก + ต้องตัดสินใจ |
| X39 | ไม่มี endpoint ปฏิเสธ Staff ที่ Pending | กลาง |
| X33 | Pre-T3 ไม่มีคอลัมน์ `remark` (แตะ schema) หรือให้ FE เอาช่องออก | ต้องตัดสินใจ |

## 6. วิธีทดสอบซ้ำ / ล้าง stack ทดสอบ
สคริปต์ทดสอบอยู่ใน scratchpad ของ session (`.../scratchpad/dtest/`: `compose.yml`, `test.env`, `lib.js`, `seed.js`, `e2e_auth.js`) ยังไม่ได้ย้ายเข้า repo

ล้าง stack ทดสอบ (ลบ container และ volume ของ `jw_test` เท่านั้น):

```bash
docker compose -p jw_test -f <path>/dtest/compose.yml --env-file <path>/dtest/test.env down -v
```
