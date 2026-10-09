# Backend แก้ไขแล้ว — 9-10-2569 (สำหรับทีม Frontend)

ไฟล์นี้สรุปทุกอย่างที่ Backend แก้ใน session นี้ เพื่อให้ฝั่ง Frontend ตรวจว่าโค้ด FE สอดคล้องกับ BE หรือไม่
ที่มา: `bugs-8-10-2569.md` · แก้เฉพาะโฟลเดอร์ `backend/` ไม่ได้แตะ `frontend/` · ยังไม่ได้ทดสอบ end-to-end กับ FE
Base path ของ API: `/api/v3` · ทุกการแก้มี commit แยกรหัสบั๊ก (`git log --oneline | grep B29`)

**วิธีอ่าน:** แต่ละหัวข้อบอกว่า BE ทำอะไร → สัญญา API ใหม่ → **☐ สิ่งที่ FE ควรตรวจ** (ติ๊กได้เมื่อตรวจแล้ว)

---

## A. สิ่งที่ทำให้ FE เดิมพังหรือแสดงผลต่าง (ตรวจก่อน)

| # | เรื่อง | ต้องทำ |
|---|---|---|
| A1 | `POST /t3` (JSON) **ถูกลบแล้ว** เหลือ `POST /t3/with-files` ทางเดียว | ☐ ยืนยันว่า FE เรียกเฉพาะ `/t3/with-files` (หน้า `send-t3` เรียกอยู่แล้ว) |
| A2 | `/t3/with-files` **บังคับไฟล์ `acceptance_letter` และ `full_paper`** | ☐ FE บังคับสองไฟล์นี้ (มีแล้ว) และแสดงข้อความจาก `missing[]` |
| A3 | BE **เมิน** `publication_details.type` / `weight_score` ที่ FE ส่ง คำนวณจาก Pre-T3 เอง | ☐ ตรวจ `send-t3.ts` getter `weightLabel`/`isInternational` ให้ตรงกฎ BE (ดู B3) — **จุดที่อาจไม่ตรง: FE ใช้ "TCI กลุ่ม 1 = 0.8, อื่นๆ = 0.6" แต่ BE ตอบ 400 `INVALID_TIER` ถ้ากลุ่มไม่ใช่ 1 หรือ 2** |
| A4 | ค่า `weight_score`, `impact_factor`, `citescore` ตอนนี้เป็น **number** (เดิมเป็นสตริง `"0.60"`) | ☐ ค้นหาโค้ดที่เทียบ/ต่อสตริงกับค่าเหล่านี้ (ที่ใช้ `number` pipe ไม่กระทบ) |
| A5 | เปลี่ยนอีเมล Admin ต้องส่ง **`current_password`** | ☐ ฟอร์มแก้ Admin ของ SuperAdmin (`manage-users`) ที่แก้อีเมลได้ ต้องเพิ่มช่องรหัสผ่านของผู้ทำรายการ ไม่งั้นได้ 400 (หน้าโปรไฟล์ไม่ส่งอีเมล ไม่กระทบ) |
| A6 | `GET /unwanted-journals` ซ่อนข้อมูลผู้สร้างจาก Student/Supervisor | ☐ หน้า `msu-unwanted` ต้องไม่พังเมื่อ `first_name`/`last_name`/`msu_mail` เป็น `null` (ตอนนี้แสดง `—` อยู่แล้ว) |
| A7 | `PATCH /manage/users/:id/advisors` เปลี่ยนความหมาย: ฟิลด์ที่ไม่ส่ง = คงเดิม | ☐ ตรวจว่า FE ส่ง Major ครบเสมอ (ส่ง `""` ที่ Major → 400 `MAJOR_REQUIRED`) |

---

## B. รายละเอียดแต่ละการแก้

### B1. กัน Pre-T3 / T3 ซ้ำ (B29)
- **Pre-T3:** `journal_snapshot.issn` ถูก normalize เป็น `XXXX-XXXX` ก่อนบันทึก (ส่ง `12345678` ก็ได้ ตอบกลับเป็น `1234-5678`) ISSN ไม่ครบ 8 หลัก → 400 `INVALID_JOURNAL`
- นิสิตคนเดียวกันมี Pre-T3 ISSN เดียวกันที่ `Pending`/`Approved` อยู่แล้ว → **409 `PRE_T3_DUPLICATE`** (ใช้กับ `PATCH /pre-t3/:id/resubmit` ด้วย)
- **T3:** Pre-T3 ใบเดียวมี T3 ที่ `Pending`/`Approved` อยู่แล้ว → **409 `T3_ALREADY_EXISTS`** · T3 ที่ถูก `Rejected`/`Cancelled` แล้ว **ยื่นใหม่บน Pre-T3 เดิมได้** · Pre-T3 ไม่ `Approved` → 400 `PRE_T3_NOT_APPROVED`
- `POST /pre-t3`, `POST /t3/with-files`: จำกัด **10 ครั้ง/15 นาที/ผู้ใช้** เกิน → **429 `RATE_LIMIT`**
- ☐ FE: แสดงข้อความของ 409/429 (ตอนนี้น่าจะขึ้น error ทั่วไป) · ปุ่มยื่นควร disable ระหว่างส่งเพื่อลดการกดซ้ำ

### B2. ยื่น T3 พร้อมไฟล์ (B30, X32)
`POST /t3/with-files` (multipart)
- ฟิลด์ข้อความ (JSON string): `pre_t3_id`, `journal_snapshot`, `paper_and_research_details`, `publication_details`, `journal_metrics`
- ไฟล์ **บังคับ:** `acceptance_letter`, `full_paper` · ไฟล์ทางเลือก: `journal_cover`, `table_of_contents`, `database_evidence`, `peer_review_result` · ชนิด PDF/JPG/PNG/WEBP ไม่เกิน 10 MB
- BE ตรวจเนื้อไฟล์จริง (ไม่เชื่อ Content-Type): ไม่ตรง → 400 `INVALID_FILE_CONTENT`
- สร้าง T3 และบันทึกไฟล์ใน transaction เดียวกัน: ถ้าอะไรล้ม ไม่มี T3 ค้างและไม่มีไฟล์กำพร้า (กด retry ไม่ได้ T3 ซ้ำ)
- สำเร็จ → 201 `{ data: { t3_id, uploaded } }`
- ☐ FE: ข้อความ error ของ `MISSING_REQUIRED_FILES` (`missing: ["acceptance_letter", ...]`), `FILE_TOO_LARGE`, `INVALID_FILE_TYPE`, `INVALID_FILE_CONTENT`
- ☐ FE (X32 ฝั่ง FE ที่ยังค้าง): T3 เก่าที่สร้างไว้โดยไม่มีไฟล์ยังอยู่ในระบบ → ปุ่มดู/ดาวน์โหลดของแถวที่ `*_path` เป็น `null` ควร disable และโหลดล้มเหลวต้องมี toast

### B3. type และน้ำหนักคะแนน T3 มาจาก Pre-T3 (B31)
| Pre-T3 | `publication_details.type` ที่ BE ใช้ | `weight_score` |
|---|---|---|
| `indexed_database = Scopus` | `International_Journal` | 1.0 |
| `TCI` และ `quartile_or_tier` มีเลข 1 | `National_TCI_Tier1` | 0.8 |
| `TCI` และมีเลข 2 | `National_TCI_Tier2` | 0.6 |
| `TCI` อื่นๆ / อ่านเลขไม่ได้ | — | **400 `INVALID_TIER`** (เดิมเดา Tier2 เงียบๆ) |

- FE ไม่ต้องส่ง `type`/`weight_score` แล้ว (ส่งมาก็ถูกเมิน)
- ☐ FE: ให้ `weightLabel` ที่แสดงบนหน้าจอตรงตารางนี้ · จัดการ `INVALID_TIER` โดยแนะนำให้ยื่น Pre-T3 ใหม่

### B4. Pre-T3 ปฏิเสธวารสารต้องห้าม (B31)
- `POST /pre-t3` และ `PATCH /pre-t3/:id/resubmit` ถ้า ISSN อยู่ใน `msu_unwanted_journals` → **400 `UNWANTED_JOURNAL`**
- ☐ FE: แสดงข้อความ · (X37 ที่ค้างอยู่: หน้าค้นหาถ้าเช็ครายการต้องห้ามล้มเหลวต้องไม่ถือว่า "ผ่านเกณฑ์")

### B5. วันที่ประชุม (B40)
`PATCH /pre-t3/:id/faculty-review`, `PATCH /t3/:id/faculty-review` — `meeting_date`
- รับ `YYYY-MM-DD` ที่เป็นวันจริง หรือ ISO พร้อม timezone (BE แปลงเป็นวันที่ตามเวลาไทย เช่น `2026-07-15T17:00:00Z` → `2026-07-16`)
- รูปแบบผิด/วันไม่มีจริง → **400 `INVALID_DATE`**
- ☐ FE: ส่ง `YYYY-MM-DD` ตรงๆ (มีแล้วตาม X26) และแสดง `INVALID_DATE`

### B6. เปลี่ยน/แก้อาจารย์ที่ปรึกษา (B32)
`PATCH /manage/users/:id/advisors` body `{ advisor_major_mail?, advisor_co1_mail?, advisor_co2_mail? }`
- ไม่ส่งฟิลด์ = คงเดิม · ส่ง `""` ที่ co1/co2 = ถอดออก · ถอด Major ไม่ได้ · body ว่าง → 400 `NOTHING_TO_UPDATE`
- อาจารย์ต้องเป็น Supervisor ที่ `Active` (400 `ADVISOR_NOT_ACTIVE`) และห้ามซ้ำกันระหว่างช่อง (400 `DUPLICATE_ADVISOR`)
- เปลี่ยนอาจารย์แล้ว คำขอ Pending ของนิสิตย้ายไปอาจารย์ใหม่ให้อัตโนมัติ (ที่ตัดสินไปแล้วไม่ถูกแตะ) → `data.requests_reassigned`
- ถอด Co ที่ยังมีคำขอรออนุมัติ → **409 `ADVISOR_HAS_PENDING_REQUESTS`**
- `PATCH /manage/users/:id/suspend` (ระงับ Supervisor) → response มี `data.pending_approvals` และข้อความเตือนถ้ามีคำขอค้าง
- ☐ FE: แสดงข้อความ error ใหม่ · หลังระงับอาจารย์ ถ้า `pending_approvals > 0` แจ้งแอดมินให้ไปเปลี่ยนอาจารย์ของนิสิต

### B7. เปลี่ยนอีเมล Admin (B34)
`PATCH /admin/admins/:id`
- ถ้า `msu_mail` เปลี่ยนจากเดิม ต้องส่ง **`current_password`** (รหัสผ่านของ "ผู้ทำรายการ" ไม่ใช่เจ้าของบัญชีที่ถูกแก้): ไม่ส่ง → 400 `PASSWORD_REQUIRED` · ผิด → 403 `INVALID_PASSWORD` · ผิดเกิน 5 ครั้ง/15 นาที → 429 `RATE_LIMIT`
- สำเร็จ → ตัด refresh token ทุกเซสชันของบัญชีนั้น · response `data.relogin_required = true`
- แก้ชื่อ/คำนำหน้าอย่างเดียว (หรือส่งอีเมลเดิม) ไม่ต้องใช้รหัสผ่าน
- ☐ FE: ฟอร์มแก้อีเมล Admin เพิ่มช่องรหัสผ่านและจัดการ `relogin_required` (ถ้าแก้อีเมลของตัวเอง ให้พาไปล็อกอินใหม่)

### B8. สิทธิ์จัดการ Admin (B35)
- สร้าง/ระงับ/คืนสถานะ/แก้ Admin คนอื่น เฉพาะ **SuperAdmin** · Admin แก้ได้เฉพาะของตัวเอง · `createAdmin` ใช้ validator ชุดเดียวกับ login (username 4–50 ตัว `[a-zA-Z0-9_.-]`)
- `suspend`/`activate` Admin ตรวจสถานะปัจจุบัน: ระงับได้เฉพาะ `Active`, คืนสถานะได้เฉพาะ `Suspended` (ไม่ตรง → 400) (B54)
- ☐ FE: ซ่อนปุ่มตามสิทธิ์ (มีแล้ว) และแสดงข้อความ 400

### B9. วารสารต้องห้าม (B52, B49, B44)
- ค้นด้วย ISSN ไม่มีขีด/มีช่องว่างได้ (`12345678` เจอ `1234-5678`) · `GET /unwanted-journals/check/:issn` เทียบทั้งสองรูปแบบ
- เพิ่ม/แก้/import พร้อมกันถูกจัดคิว: ถ้ารอ lock เกิน 10 วินาที → **503 `BUSY`** (ให้ผู้ใช้ลองใหม่)
- **ตามบทบาท (B49):** Admin/SuperAdmin/Staff เห็นครบเหมือนเดิม (+`has_evidence`) · Student/Supervisor ได้ `first_name`/`last_name`/`msu_mail` เป็น `null` และ `evidence_file_path` เป็นเส้นทางดาวน์โหลด `/unwanted-journals/:id/evidence` (ไม่ใช่ path บนเซิร์ฟเวอร์) ใช้ตรวจ "มีไฟล์หรือไม่" ได้เหมือนเดิม
- ไฟล์หลักฐานชื่อสุ่ม (UUID) และไม่ค้างเมื่อ 400 (B44)
- ☐ FE: ใช้ `evidence_file_path` เป็นแค่ตัวบอกว่ามีไฟล์ แล้วดาวน์โหลดผ่าน endpoint เดิมตาม `unwanted_id` (ห้ามเอาค่านี้ไปประกอบ URL ไฟล์เอง) · จัดการ 503 `BUSY`

### B10. import CSV (B39, B54)
`POST /manage/users/import` และ `POST /unwanted-journals/import` (all-or-nothing)
- ตรวจรายแถวก่อนเขียน: ผู้ใช้ — `role`, อีเมลรูปแบบถูก/ไม่ซ้ำ (เทียบไม่สนตัวพิมพ์), `degree_level` ∈ {Master, Doctoral}, `curriculum_year` ∈ {2560, 2566}, `study_plan_code` ตาม enum, ความยาว `phone`/`prefix` · วารสาร — `journal_name`, `recorded_date` เป็นวันจริง `YYYY-MM-DD`, ISSN ถูกรูปแบบและไม่ซ้ำ (ทั้งใน DB และในไฟล์)
- ผิด → 400 พร้อม `errors: ["Row 3: ...", ...]` ครบทุกแถว · เกิน 2000 แถว → 400 `TOO_MANY_ROWS`
- ☐ FE (X35 ที่ยังค้าง): แสดงรายการ `errors[]` เป็นลิสต์ใน modal (ตอนนี้เก็บแค่ `message`)

### B11. ตรวจชนิดข้อมูลที่ส่งมา (B45, B46)
- field ผู้ใช้/โปรไฟล์/วารสารต้องห้ามที่ส่งเป็น object หรือ array → **400 `INVALID_INPUT`** (เดิม 500) ครอบ: สร้าง/แก้ผู้ใช้, `PATCH /user/profile` (`phone`, `facebook_id`, `line_id`), เพิ่ม/แก้วารสารต้องห้าม
- `:id` ใน URL ไม่ใช่ตัวเลข → **400 `INVALID_ID`** ทุก router
- ☐ FE: ส่งสตริง/ตัวเลขตามเดิมไม่กระทบ

### B12. ค้นหา (B53)
- ช่องค้นหาผู้ใช้/วารสารต้องห้าม: `%` และ `_` ที่พิมพ์ถูกมองเป็นตัวอักษรธรรมดา (ค้นด้วย `%` ไม่ได้ทุกแถวอีกแล้ว)
- รายการรอ Faculty (`/pre-t3/pending`, `/t3/pending` ของ Staff) จำกัดสูงสุด 1000 แถว เรียงเก่าสุดก่อน

### B13. ประวัติและสถิติ (B43, B54, B51)
- ประวัติของอาจารย์/Staff (`/pre-t3/history`, `/t3/history`) เรียงตามเวลาตัดสินล่าสุดก่อน (เดิมเรียงตาม `updated_at`)
- `GET /admin/stats`: เพิ่ม `pre_t3.cancelled` และ `t3.cancelled` (เพิ่มอย่างเดียว) ☐ FE: ปรับ interface `get_stats_res.ts` ถ้าต้องการแสดง
- DECIMAL → number (ดู A4) · Google login คืน `degreeLevel` (B50)

### B14. Scrape / Scopus (B41)
- `GET /journal/scopus/scrape?issn=` ไม่พบ ISSN → **404** (เดิมรอ ~20 วินาทีแล้ว 500)
- ผู้ใช้หนึ่งคนค้น scrape ได้ทีละ 1 คำขอ → ซ้อน = **429 `SCRAPER_USER_BUSY`** · คิวเต็มหรือรอเกิน 60 วินาที = **429 `SCRAPER_BUSY`**
- Scopus API: key ที่ถูกปฏิเสธ (401/403) ถูกข้ามอัตโนมัติ · ถ้าไม่เหลือ key → `SCOPUS_QUOTA_EXCEEDED` (รหัสเดิมของระบบ ข้อความบอกว่าจะเปลี่ยนไปค้นแบบ scraping)
- ☐ FE: ปุ่มค้น scrape ควร disable ระหว่างรอผล และแสดงข้อความ 429/404

### B15. ล็อกอิน / OTP / เซสชัน (B47, B48, X28 BE, B37, B54)
- OTP เก็บแบบ HMAC (ผู้ใช้ไม่เห็นความต่าง) · **OTP ที่ออกก่อน deploy จะใช้ไม่ได้** ให้ขอใหม่
- ขอ OTP ซ้ำภายใน 60 วินาที → **429 `OTP_COOLDOWN`** (มี `retryAfter` วินาที)
- ความยาว OTP ตาม `OTP_LENGTH` ใน `.env` (ค่าเริ่มต้น 6) ☐ FE: ช่อง OTP ฝัง 6 หลัก (`maxlength="6"`) ถ้าจะเปลี่ยนความยาวต้องแก้ FE ด้วย
- `POST /auth/refresh`: ผ่อนผัน 10 วินาทีให้ refresh ซ้อนจาก 2 แท็บ (ได้ access token ใหม่ แต่ไม่ออกคุกกี้ใหม่) · ล้างคุกกี้ refresh **เฉพาะ 401** · ☐ FE (X28): ยังต้องเลิกเก็บ `refreshToken` ใน localStorage, ส่ง `{}` + คุกกี้, ลอง refresh ตอน boot, logout เฉพาะ 401
- `POST /auth/google` limiter ปรับเป็น 100 ครั้ง/15 นาที/IP (นิสิตหลัง NAT เดียวกัน)

### B16. ที่ไม่กระทบ FE แต่ควรรู้
Node 22 (Dockerfile) · อัปเกรดไลบรารีที่มีช่องโหว่ (multer, nodemailer, file-type, csv-parse, qs) — production audit เหลือ 0 (B28) · ซ่อน/ไม่เก็บ Scopus API key จริง (B49) · บังคับ STARTTLS ส่งเมล (B53) · JSON body จำกัด 100 KB และจำกัดจำนวนฟิลด์ multipart (B38) · แก้ ReDoS (B26)

---

## C. ที่ BE ยังไม่ได้แก้ (FE อย่าเพิ่งคาดหวัง)

**ตั้งใจเลื่อน:** B27 ส่วน DB user ไม่ใช่ root · B33 refresh token reuse detection · B36 ตัด `gmail.com` (ช่วงทดสอบ) · ส่วนย่อยของ B37 (lockout ต่อบัญชี), B41, B42, B52 (eISSN), B53, B54

**มีฝั่ง BE ที่ยังไม่ได้ทำ (ไม่ได้ตั้งใจเลื่อน):**

| รหัส | ที่ค้างฝั่ง BE | ผลกับ FE |
|---|---|---|
| X33 | Pre-T3 ไม่มีคอลัมน์ `remark` (หมายเหตุของนิสิตถูกทิ้ง) | ตัดสินใจ: เพิ่มคอลัมน์ หรือ FE เอาช่องออก |
| X34 | `GET /user/staff` ต้อง login แต่หน้า `/contact` เป็น public | คนยังไม่ล็อกอินเห็น "โหลดข้อมูลไม่ได้" |
| X39 | ไม่มี endpoint ปฏิเสธ Staff ที่ Pending | ปุ่มปฏิเสธใช้ไม่ได้ |
| X41 | SPA fallback ตอบ `index.html` ให้ไฟล์ static ที่ไม่มี | แท็บเก่าหลัง redeploy ค้าง |
| X49 | BE ไม่เช็ค scheme http/https ของ `journalUrl` | FE ควรใส่ `rel="noopener noreferrer"` และเช็ค scheme ฝั่งตัวเองก่อน |

---

## D. error code ใหม่ทั้งหมด (สำหรับทำตารางข้อความใน FE)

| HTTP | `code` | ที่มา |
|---|---|---|
| 400 | `MISSING_REQUIRED_FILES` (+`missing[]`) | B2 |
| 400 | `INVALID_FILE_CONTENT` | B2 |
| 400 | `INVALID_TIER` | B3 |
| 400 | `PRE_T3_NOT_APPROVED` | B1 |
| 400 | `INVALID_JOURNAL` | B1 |
| 400 | `UNWANTED_JOURNAL` | B4 |
| 400 | `INVALID_DATE` | B5 |
| 400 | `NOTHING_TO_UPDATE`, `MAJOR_REQUIRED`, `ADVISOR_NOT_ACTIVE`, `DUPLICATE_ADVISOR` | B6 |
| 400 | `PASSWORD_REQUIRED` | B7 |
| 400 | `TOO_MANY_ROWS` | B10 |
| 400 | `INVALID_INPUT`, `INVALID_ID` | B11 |
| 403 | `INVALID_PASSWORD` | B7 |
| 409 | `T3_ALREADY_EXISTS`, `PRE_T3_DUPLICATE` | B1 |
| 409 | `ADVISOR_HAS_PENDING_REQUESTS` | B6 |
| 429 | `RATE_LIMIT` (ยื่นถี่เกิน / ยืนยันรหัสผ่านผิดเกิน) | B1, B7 |
| 429 | `OTP_COOLDOWN` (+`retryAfter`) | B15 |
| 429 | `SCRAPER_BUSY`, `SCRAPER_USER_BUSY` | B14 |
| 503 | `BUSY` (จัดการวารสารต้องห้ามพร้อมกัน) | B9 |

โครงสร้าง error เหมือนเดิม: `{ success: false, code, message, ...ข้อมูลเพิ่ม }` ใช้ `message` (ภาษาไทย) แสดงเป็นค่าเริ่มต้นได้ทันที

---

## E. ฝั่ง FE ที่ค้างอยู่ (ของเพื่อน) — ดูรายละเอียดใน `bugs-8-10-2569.md`
บล็อกการทดสอบอื่นๆ: **X27** (`API_ENDPOINT` กลับเป็น absolute + ลบ proxy) และ **X28 ฝั่ง FE** (refresh token) · ที่เหลือ X29–X49 และ F19–F35 ค้นด้วย `- [ ]`
