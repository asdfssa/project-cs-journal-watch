# สิ่งที่ Backend แก้ไข — สำหรับทีม Frontend

อัปเดต 2026-10-09 · ที่มา: `bugs-8-10-2569.md` (บั๊กรอบ 2) · แก้ที่ `backend/` เท่านั้น ไม่ได้แตะ `frontend/`
ทุกการแก้มีเทสต์ใน `backend/tests/` (`node --test tests/<ไฟล์>.test.js`) — **ยังไม่ได้ทดสอบกับ MySQL จริงจนกว่าจะรันใน Docker** (ดูหัวข้อสุดท้าย)

## 1. ต้องรู้ก่อน — การเปลี่ยนที่ทำให้ FE เดิมพังหรือแสดงผลต่าง

| # | เรื่อง | ผลกับ FE |
|---|---|---|
| 1 | **`POST /t3` (JSON) ถูกลบ** เหลือแค่ `POST /t3/with-files` (X32) | FE ปัจจุบันเรียก `/t3/with-files` อยู่แล้ว ไม่กระทบ เครื่องมืออื่นที่ยิง `/t3` จะได้ 404 |
| 2 | **`/t3/with-files` บังคับไฟล์ `acceptance_letter` + `full_paper`** ไม่ครบ → 400 `MISSING_REQUIRED_FILES` พร้อม `missing: [...]` (X32) | FE บังคับสองไฟล์นี้อยู่แล้ว แต่ควรแสดงข้อความจาก `missing` |
| 3 | **`publication_details.type` / `weight_score` ที่ FE ส่งมาถูกเมิน** BE คำนวณจาก Pre-T3 เอง: Scopus → International (1.0), TCI กลุ่ม 1 → 0.8, กลุ่ม 2 → 0.6 (B31) | ไม่ต้องส่ง `type` แล้ว · อ่านกลุ่ม TCI ไม่ได้ → 400 `INVALID_TIER` |
| 4 | **DECIMAL เป็น number แล้ว**: `weight_score`, `impact_factor`, `citescore` เดิมเป็นสตริง `"0.60"` ตอนนี้เป็น `0.6` (B51) | `number` pipe ใช้ได้เหมือนเดิม · ที่เทียบสตริงตรงๆ ต้องแก้ |
| 5 | **`GET /unwanted-journals` ตาม role** (B49): Student/Supervisor ได้ `first_name`/`last_name`/`msu_mail` เป็น `null`, `evidence_file_path` เป็นเส้นทางดาวน์โหลด (`/unwanted-journals/:id/evidence`) ไม่ใช่ path จริง, มี `has_evidence` เพิ่ม · Admin/SuperAdmin/Staff เห็นครบเหมือนเดิม | ปุ่มดูไฟล์ยังทำงาน (ใช้ `@if (j.evidence_file_path)` ต่อได้) · ผู้สร้างจะขึ้น `—` สำหรับ role ที่ไม่ใช่ผู้จัดการ |
| 6 | **เปลี่ยนอีเมล Admin ต้องส่ง `current_password`** ใน `PATCH /admin/admins/:id` (B34) | หน้าโปรไฟล์ไม่ได้ส่งอีเมล จึงไม่กระทบ · **ฟอร์ม "แก้ไข Admin" ของ SuperAdmin (`manage-users`) ถ้าแก้อีเมลจะได้ 400 จนกว่าจะเพิ่มช่องรหัสผ่านของผู้ทำรายการ** |
| 7 | **`PATCH /manage/users/:id/advisors` ไม่ลบอาจารย์ทั้งหมดอีกแล้ว** (B32): ฟิลด์ที่ไม่ส่ง = คงเดิม · ส่ง `""` ที่ co1/co2 = ถอดออก · ถอด Major ไม่ได้ | FE แอดมินส่งครบ 3 ช่องอยู่แล้ว ไม่กระทบ ยกเว้นนิสิตที่ไม่มี Major แล้วไม่กรอก → 400 `MAJOR_REQUIRED` |

## 2. error code ใหม่ที่ FE ควรแสดงข้อความ (ตอนนี้จะขึ้นเป็น error ทั่วไป)

| HTTP | code | เมื่อไหร่ |
|---|---|---|
| 409 | `T3_ALREADY_EXISTS` | Pre-T3 นี้มี T3 ที่ Pending/Approved อยู่แล้ว (T3 ที่ถูก reject/cancel ยื่นใหม่ได้) (B29) |
| 409 | `PRE_T3_DUPLICATE` | นิสิตมี Pre-T3 ISSN เดียวกันที่ Pending/Approved อยู่แล้ว · ใช้กับ resubmit ด้วย (B29) |
| 400 | `UNWANTED_JOURNAL` | ยื่น/ยื่นซ้ำ Pre-T3 ด้วย ISSN ที่อยู่ในรายการวารสารต้องห้าม (B31) |
| 400 | `INVALID_JOURNAL` | ISSN ไม่ครบ 8 หลัก (BE เก็บเป็น `XXXX-XXXX` เสมอ) (B29) |
| 400 | `INVALID_TIER` | ระบุประเภท/กลุ่มวารสารจาก Pre-T3 ไม่ได้ → ให้ยื่น Pre-T3 ใหม่ (B31) |
| 400 | `PRE_T3_NOT_APPROVED` | Pre-T3 ไม่ได้อยู่ในสถานะ Approved ตอนยื่น T3 |
| 400 | `MISSING_REQUIRED_FILES` | ไม่แนบไฟล์บังคับ (มี `missing[]`) (X32) |
| 429 | `RATE_LIMIT` | ยื่น Pre-T3/T3 เกิน 10 ครั้ง/15 นาที/คน (B29) |
| 400 | `INVALID_DATE` | `meeting_date` ผิดรูปแบบ/ไม่มีจริง — ส่ง `YYYY-MM-DD` (ISO พร้อม timezone ก็ได้ BE แปลงเป็นวันที่ไทยให้) (B40) |
| 400 | `INVALID_INPUT` | field ที่ควรเป็นค่าเดี่ยวถูกส่งเป็น object/array (B45) |
| 400 | `INVALID_ID` | `:id` ใน URL ไม่ใช่ตัวเลข (B46) |
| 400/403 | `PASSWORD_REQUIRED` / `INVALID_PASSWORD` | เปลี่ยนอีเมล Admin ไม่ส่ง/ส่งรหัสผ่านผิด · ผิดเกิน 5 ครั้ง/15 นาที → 429 `RATE_LIMIT` (B34) |
| 400 | `NOTHING_TO_UPDATE`, `MAJOR_REQUIRED`, `ADVISOR_NOT_ACTIVE`, `DUPLICATE_ADVISOR` | แก้อาจารย์ที่ปรึกษา (B32) |
| 409 | `ADVISOR_HAS_PENDING_REQUESTS` | ถอดอาจารย์ร่วมที่ยังมีคำขอรออนุมัติอยู่ (B32) |
| 400 | `TOO_MANY_ROWS` | import CSV เกิน 2000 แถว (B39) |
| 503 | `BUSY` | เขียนรายการวารสารต้องห้ามพร้อมกัน รอ lock เกิน 10 วินาที ให้ลองใหม่ (B52) |
| 429 | `SCRAPER_BUSY` / `SCRAPER_USER_BUSY` | คิว scrape เต็ม/รอเกิน 60 วินาที · ผู้ใช้เดียวกันมี scrape ค้างอยู่ (B41) |
| 404 | (ข้อความ not found) | scrape หา ISSN ไม่พบ (เดิม 500 หลังรอ ~20 วินาที) (B41) |
| 429 | `OTP_COOLDOWN` (+`retryAfter`) | ขอ OTP ใหม่ภายใน 60 วินาที (B48) |

Response ที่เพิ่ม field (เพิ่มอย่างเดียว ไม่กระทบของเดิม):
- `GET /admin/stats` → `pre_t3.cancelled`, `t3.cancelled` (B54) — FE `get_stats_res.ts` ยังไม่มี field นี้
- `PATCH /manage/users/:id/advisors` → `data.requests_reassigned` (B32)
- `PATCH /manage/users/:id/suspend` → `data.pending_approvals` + ข้อความเตือนถ้าอาจารย์ที่ถูกระงับมีคำขอค้างอยู่ (B32)
- `PATCH /admin/admins/:id` → `data.relogin_required` เมื่อเปลี่ยนอีเมล (เซสชันเดิมของบัญชีนั้นสิ้นสุด) (B34)
- import CSV (`/manage/users/import`, `/unwanted-journals/import`) ตอบ 400 พร้อม `errors: ["Row 3: ..."]` ครบทุกแถวที่ผิด (B39) — **FE ยังเก็บแค่ `message` (X35) จึงไม่เห็นรายละเอียดรายแถว**

## 3. รายการที่ Backend แก้แล้วทั้งหมด

| รหัส | เรื่อง | commit |
|---|---|---|
| B26 | ReDoS ใน T3 submit | `981aca1` |
| B27 | MySQL port 3310 bind `127.0.0.1` | `bbcda25` |
| B28 | อัปเกรด dependency ที่มีช่องโหว่ (production เหลือ 0) | `2b8ec48`, `eca61f6` |
| B29 | กัน T3/Pre-T3 ซ้ำ + limiter ต่อผู้ใช้ | `2e9f4f8` |
| B30 | เขียนไฟล์ T3 ใน transaction เดียวกับการสร้าง T3 | `d37d247` |
| B31 | type/weight จาก Pre-T3 + ปฏิเสธวารสารต้องห้ามตอนยื่น Pre-T3 | `a499b39` |
| B32 | แก้อาจารย์ที่ปรึกษา: partial PATCH, ย้ายคำขอที่ค้าง | `3dcadc1` |
| B34 | เปลี่ยนอีเมล Admin ต้องยืนยันรหัสผ่าน | `128fd21` |
| B35 | จัดการ Admin เฉพาะ SuperAdmin | `f3a515f` |
| B37 | `googleLimiter` 100/15 นาที/IP (ส่วนอื่นเลื่อน) | `217dc30` |
| B38 | JSON body ≤ 100kb, จำกัด multipart | `507252a` |
| B39 | CSV import: ตรวจรายแถว, query ครั้งเดียว | `0cdde9d` |
| B40 | `meeting_date` เวลาไทย | `a28f30a` |
| B41 | scraper/Scopus: 404, คิว, key ที่ถูกปฏิเสธ | `c454064` |
| B42 | Node 22 (ส่วนอื่นเลื่อน) | `361b790` |
| B43 | ประวัติเรียงตามเวลาตัดสิน | `530e0b6` |
| B44 | ไฟล์หลักฐานวารสารต้องห้ามไม่ค้างตอน 400 | `a3c9af4` |
| B45 | object/array ใน body → 400 | `73d4d90` |
| B46 | `:id` ไม่ใช่ตัวเลข → 400 | `c059f4c` |
| B47 | OTP เก็บด้วย HMAC | `ac68455` |
| B48 | OTP cooldown ต่อบัญชี | `b652815` |
| B49 | ซ่อนผู้สร้าง/path ไฟล์ และไม่เก็บ Scopus API key จริง | `15610fe` |
| B50 | Google login คืน `degreeLevel` | `e956e61` |
| B51 | DECIMAL เป็น number | `d7aeea9` |
| B52 | ค้น/เช็ค ISSN ไม่สนขีด + กันเพิ่มซ้ำพร้อมกัน (ส่วน eISSN เลื่อน) | `8354225` |
| B53 | STARTTLS, `CF-Connecting-IP`, escape LIKE, เพดาน pending | `185fcda` |
| B54 | stats นับ Cancelled, อีเมล import ไม่สนตัวพิมพ์, suspend/activate เช็คสถานะ, OTP validator | `1dc238b` |
| X28 (BE) | refresh: grace 10 วินาที, ล้างคุกกี้เฉพาะ 401 | `6a466fa` |
| X32 (BE) | บังคับไฟล์ T3 ฝั่ง server | `fccf306` |

**ตั้งใจเลื่อน (ไม่ใช่ลืม)**: B27 ส่วน DB user ไม่ใช่ root · B33 refresh token reuse detection · B36 ตัด gmail.com (ช่วงทดสอบ) · ส่วนที่เหลือของ B37, B41, B42, B52, B53, B54

## 4. งานฝั่ง FE ที่ยังค้าง (ของเพื่อน)

เรียงตามความสำคัญ รายละเอียด/ไฟล์/บรรทัดอยู่ใน `bugs-8-10-2569.md` (ค้นด้วย `- [ ]`):

**ต้องทำก่อน — บล็อกการทดสอบอย่างอื่น**
- **X27** `API_ENDPOINT` ใน `comfig/constants.ts` กลับเป็น `https://api.farmlnwza007.online/api/v3` (absolute) และลบ `proxy.conf.json` → CSP/CORS/คุกกี้ refresh พัง และ `ng serve` ยิงเข้า API จริง แก้: คืน `'/api/v3'` + proxy
- **X28 (FE)** เลิกเก็บ `refreshToken` ใน localStorage (BE ไม่ส่งใน body, ส่งเป็นคุกกี้ httpOnly), `POST /auth/refresh` ด้วย `{}`, ตอน boot ลอง refresh ก่อน logout, logout เฉพาะ 401

**ฟอร์ม/หน้าจอ — งาน FE↔BE (X29–X49)**
- **X29** Admin login/logout ไม่ผ่าน AuthService (frontend_fix B ยังอยู่)
- **X30** Logout ของ Student/Advisor/Staff ไม่เรียก `POST /auth/logout` (frontend_fix C ยังอยู่)
- **X31** สถานะ Published/Accepted ตัวพิมพ์ไม่ตรง + แสดง enum ดิบ (X9 ยังอยู่)
- **X33** หมายเหตุของนิสิตใน Pre-T3 ถูกทิ้ง (F4 ครึ่งเดียว) _(มีฝั่ง BE ด้วย ดูหัวข้อ 5)_
- **X34** `/contact` เป็นหน้า public แต่ API ต้อง login _(มีฝั่ง BE ด้วย ดูหัวข้อ 5)_
- **X35** Error รายแถวจาก CSV import ไม่ถูกแสดง
- **X36** เพิ่มวารสารต้องห้ามได้โดยไม่ใส่วันที่ แต่ BE บังคับ `recorded_date`
- **X37** ค้นหาวารสาร: เช็ครายการต้องห้ามล้มเหลว = ถือว่า "ไม่ต้องห้าม"
- **X38** Backup & Restore เป็น mock แต่มีเมนูจริง
- **X39** ลงทะเบียน Staff ที่ Pending อนุมัติได้อย่างเดียว ปฏิเสธไม่ได้ _(มีฝั่ง BE ด้วย ดูหัวข้อ 5)_
- **X40** Session ข้าม tab / role เปลี่ยนไม่ sync
- **X41** SPA fallback คืน index.html (200) ให้ไฟล์ static ที่ไม่มี _(มีฝั่ง BE ด้วย ดูหัวข้อ 5)_
- **X42** Advisor approve ทิ้ง remark
- **X43** Staff Pre-T3 card ไม่แสดงชื่อบทความ/ระดับ
- **X44** Staff manage-users ดึง `limit=1000` แล้วกรองฝั่ง client (`Page/staff/manage-users/manage-users.ts:53,125-127`)
- **X45** Admin list โหลดแค่ 20 คนแรก
- **X46** `file-download.ts:2-7` ไม่มี `image/webp` แต่ BE รับ WEBP → ดาวน์โหลดแล้วไม่มีนามสกุล
- **X47** Pre-T3 ส่งได้โดยชื่อวารสารว่าง
- **X48** Forgot-password FE เช็คแค่ยาว ≥ 8 (`Login/forgot-password/forgot-password.ts:42-45`) แต่ BE บังคับตัวใหญ่/เล็ก/ตัวเลข...
- **X49** `journalUrl` จากนิสิตแสดงเป็นลิงก์ `target="_blank"` ไม่มี `rel` (`Advisor/.../pre-t3-request.html:214`, `staff/.../h... _(มีฝั่ง BE ด้วย ดูหัวข้อ 5)_
- **X32 (FE)** disable ปุ่มดู/ดาวน์โหลดของแถวที่ `*_path` เป็น null + แสดง toast เมื่อโหลดไฟล์ไม่ได้ (BE บังคับไฟล์แล้ว แต่ T3 เก่ายังไม่มีไฟล์)

**Frontend ล้วน (F19–F35)**
- **F19** ปุ่ม Google "สมัคร Staff" หายหลังพยายามครั้งแรกล้มเหลว
- **F20** Build config ถอยหลัง (frontend_fix ข้อ 3)
- **F21** Profile (นิสิต/อาจารย์) แสดงข้อมูลเก่าหลังบันทึกสำเร็จ
- **F22** Cache รายละเอียดไม่ล้างตอน Refresh
- **F23** `window.open` หลัง async fetch โดน popup blocker
- **F24** โหลดล้มเหลวแสดงเหมือน "ไม่มีรายการ"
- **F25** Pre-T3 ที่ยกเลิกตอนอาจารย์ยัง Pending แสดงขั้นถัดไปเป็น "เสร็จแล้ว"
- **F26** Checklist ของอาจารย์ใช้ข้อความต่างจากของนิสิต
- **F27** Suspend ผู้ใช้ไม่มี confirm
- **F28** เลขที่ประชุมไม่ trim
- **F29** Zoneless: admin sidebar ใช้ field ธรรมดาใน subscribe `/auth/me` (`sidebar_admin/sidebar.ts:57-72`) → ชื่อ/รูปอัปเดตช้า
- **F30** `isRefreshing` ค้างถ้า refresh ถูก cancel (`auth.interceptor.ts:52-75` ไม่มี `finalize`) → 401 ถัดๆ ไปค้างตลอด
- **F31** `JSON.parse` localStorage ไม่มี try/catch (`auth.service.ts:95-98`, `sidebar_admin/sidebar.ts:34`) → ค่าเสีย = หน้าขาว
- **F32** Global toast แสดงแค่ 500 (`auth.interceptor.ts:35-37`)
- **F33** Access token + `otp_token` อยู่ใน localStorage (มี CSP ช่วยลดความเสี่ยง XSS)
- **F34** `console.log` ค้าง
- **F35** Dead code: `auth.guard.ts` ไม่ถูกใช้แล้ว; สถานะ "นัดประชุมแล้ว รอผล" ใน `pre-t3-status.ts:179,263-290,370-383` ไม่มีท...

**ที่ BE เพิ่มให้แล้วแต่ FE ยังไม่ใช้**: ข้อความสำหรับ error code ใหม่ในหัวข้อ 2, `cancelled` ใน stats, `current_password` ในฟอร์มแก้ Admin, แสดง `errors[]` รายแถวของ CSV (X35)

## 5. จุดที่ Backend ยังไม่ได้ทำแต่เกี่ยวกับ FE↔BE

ผมไล่ดูแล้วพบว่า 5 ข้อนี้อยู่ในส่วน "FE↔BE" ของรายงานและมีฝั่ง BE ที่**ยังไม่ได้แก้** (ไม่ได้ตั้งใจเลื่อน): X33 (คอลัมน์ `remark` ของ Pre-T3), X34 (`GET /user/staff` ต้อง login แต่หน้า `/contact` เป็น public), X39 (ไม่มี endpoint ปฏิเสธ Staff ที่ Pending), X41 (SPA fallback ตอบ `index.html` ให้ไฟล์ static ที่ไม่มี), X49 (BE ไม่เช็ค scheme http/https ของ `journalUrl`)
