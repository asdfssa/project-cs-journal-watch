# ตอบคำถามฝั่ง Frontend — 9-10-2569

ตอบจากโค้ด backend จริง + ยิงทดสอบกับ MySQL (stack `jw_test`) ทุกข้อที่ระบุว่า "ทดสอบแล้ว" · ข้อที่ BE แก้เพิ่มและ deploy ขึ้นระบบจริงแล้วมีเครื่องหมาย ✅ (X27, X39, X44)

## 1. X27 — CORS / CSP สำหรับโดเมน api ⚠️
ขอโทษครับ ข้อ E ในเอกสารผมคัดข้อความเดิมจากรายงานบั๊กมา (คืน `/api/v3` + proxy) ทั้งที่ตกลงกันแล้วว่าใช้ `https://api.farmlnwza007.online/api/v3` ต่อ — **ถือตามที่ตกลงกัน**

**BE แก้และ deploy ขึ้นระบบจริงแล้ว** ✅ (ทดสอบผ่านโดเมน `api.farmlnwza007.online` จริงแล้ว):
- CSP `connect-src` เพิ่ม `https://api.farmlnwza007.online` แล้ว (`backend/src/app.js`)
- CORS: `CORS_ORIGIN=http://localhost:4200,https://journal.farmlnwza007.online` + `credentials: true` · preflight จาก `journal.*` ได้ `Access-Control-Allow-Origin: https://journal.farmlnwza007.online` และ `Access-Control-Allow-Credentials: true`
- คุกกี้ refresh: ไม่ต้องแก้ `journal.*` กับ `api.*` อยู่ใน **site เดียวกัน** (โดเมนหลัก `farmlnwza007.online` เหมือนกัน) คุกกี้ `SameSite=Strict` จึงยังถูกส่งกับ request ข้าม origin ที่ใส่ `withCredentials` ได้ · คุกกี้เป็น host-only ของ `api.*`, `HttpOnly`, `Secure` (production), `path=/api/v3/auth` → ถูกส่งเฉพาะ `/auth/*` ตามที่ FE ทำอยู่
- FE ต้อง: `withCredentials: true` กับ `/auth/refresh`, `/auth/logout` (และ `/auth/login`, `/auth/verify-otp`, `/auth/google` เพราะ BE ตั้งคุกกี้ตอนล็อกอินสำเร็จ — ถ้าไม่ใส่ เบราว์เซอร์จะไม่เก็บคุกกี้)

เหลือฝั่ง FE: ใส่ `withCredentials` ตามข้างบน แล้วทดสอบ X28 ในเบราว์เซอร์จริงได้เลย

## 2. X28 — refresh ไม่มีคุกกี้ → status อะไร
`POST /auth/refresh` (ทดสอบแล้ว):

| กรณี | status | `code` | BE ล้างคุกกี้ |
|---|---|---|---|
| ไม่มีคุกกี้ | **401** | `NO_REFRESH_TOKEN` | ใช่ |
| token ไม่ถูกต้อง/หมดอายุ/ถูกใช้ไปแล้วนอกช่วงผ่อนผัน | **401** | `INVALID_REFRESH_TOKEN` | ใช่ |
| บัญชีถูกระงับ | **401** | `ACCOUNT_UNAVAILABLE` | ใช่ |
| ยิงเกิน 30 ครั้ง/15 นาที/IP | **429** | `RATE_LIMIT` | ไม่ |
| DB ล่ม/error ภายใน | **500/503** | — | ไม่ |
| refresh ซ้อน 2 แท็บภายใน 10 วินาที | 200 | — | ไม่ออกคุกกี้ใหม่ (ใช้ใบที่แท็บแรกได้ไป) |

→ BE ไม่เคยตอบ 400/403 จาก refresh · **logout เฉพาะ 401** ก็พอ (400/403 ที่ FE เผื่อไว้ไม่เป็นไร) · **429/5xx/network error ห้าม logout** ให้ลองใหม่ภายหลัง

## 3. X39 — ปฏิเสธ Staff ที่ Pending
**ตัดสินใจแล้ว: ทาง ข. — `PATCH /manage/users/:id/suspend` รับบัญชี Pending ได้แล้ว (deploy แล้ว)** ✅
- เรียก `PATCH /manage/users/:id/suspend` กับบัญชีที่ `account_status = 'Pending'` → บัญชีกลายเป็น `Suspended` (ไม่มี endpoint `reject` แยก ไม่เปลี่ยน schema)
- response: `200 { success: true, message: 'ปฏิเสธบัญชีที่รออนุมัติเรียบร้อยแล้ว', data: { pending_approvals: 0 } }` (บัญชี Active ที่ถูกระงับยังได้ข้อความเดิม `ระงับบัญชีเรียบร้อยแล้ว`)
- สิทธิ์: **Staff ที่สมัครรออนุมัติปฏิเสธได้โดย Admin/SuperAdmin เท่านั้น** (Staff ไม่มีสิทธิ์ระงับ/ปฏิเสธ Staff ด้วยกัน → 403) · นิสิต/อาจารย์ที่ Pending ปฏิเสธได้โดย Staff ด้วย
- ผลของการปฏิเสธ: คนที่ถูกปฏิเสธ**สมัครซ้ำด้วยอีเมลเดิมไม่ได้** (ได้ 403 `ACCOUNT_SUSPENDED`) กรองดูได้ด้วย `?status=Suspended` · อนุมัติบัญชีที่ถูกปฏิเสธไปแล้วผ่าน `/approve` → 400 (Admin ยังคืนสถานะผ่าน `/activate` ได้ถ้าเปลี่ยนใจ)
- ที่ FE ต้องทำ: เมื่อแถวเป็น Pending ให้แสดงปุ่ม "ปฏิเสธ" เรียก `/suspend` (ปุ่มระงับเดิมของ Active ไม่เปลี่ยน)

## 4. X40 — role ใน JWT
- access token payload มี field **`role`** (และ `sub`, `username`, `firstName`, `lastName`, `msuMail`, `degreeLevel`, `type: "access"`, `iat`, `exp`, `iss`) — ตัวอย่างจริง: `{"sub":7,"role":"Student","firstName":"Stu1","lastName":"T","msuMail":"stu1@msu.ac.th","degreeLevel":"Master","type":"access",...}` → FE decode role ใหม่จาก token ได้เลย
- `/auth/refresh` ตอบ `{ success, data: { accessToken } }` **อย่างเดียว ไม่มี user** (ไม่ต้องเพิ่ม ใช้ token พอ)
- กลไก: ถ้า admin เปลี่ยน role ระหว่างที่ผู้ใช้ล็อกอิน request ถัดไปได้ **401 `ROLE_CHANGED`** (ทดสอบแล้ว) → FE refresh → ได้ token ที่มี role ปัจจุบันจาก DB → อัปเดต role จาก token นั้น

## 5. X42 — หมายเหตุตอนอาจารย์อนุมัติ
**รับและบันทึกแล้ว** ทั้ง `PATCH /pre-t3/:id/advisor-review` และ `PATCH /t3/:id/advisor-review` ตอน `{ action: 'approve', remark: '...' }` (ทดสอบทั้งสองตัว) · แสดงใน `advisor_approval.remark` ของ: รายละเอียด (`GET /pre-t3/:id`, `/t3/:id`), `/pending`, `/history` → ตัวอย่าง `"advisor_approval": {"status":"Approved","user_id":3,"remark":"อนุมัติ ผ่านเกณฑ์ครบ","approved_at":"2026-10-09T04:44:16.000Z"}`
(ไม่ใช่กรณีเดียวกับ X33 — X33 คือ `remark` ที่ **นิสิต** กรอกตอนยื่น Pre-T3 ซึ่ง BE ยังไม่มีคอลัมน์เก็บ)

## 6. X43 — ข้อมูลในรายการรอของ staff
**มีครบ** ใน `GET /pre-t3/pending` ตัวอย่างจริง 1 รายการ (ตัดส่วนที่ไม่เกี่ยวออก):
```json
{
  "pre_t3_id": 10, "student_name": "Stu3 T", "student_email": "stu3@msu.ac.th",
  "overall_status": "Pending",
  "journal_snapshot": { "issn": "1212-3434", "journal_name": "Probe Journal", "indexed_database": "Scopus", "quartile_or_tier": "Q1" },
  "student_snapshot": { "degree_level": "Master", "study_plan_code": "Master_A1", "curriculum_year": "2566" },
  "article_info": { "title_en": "Probe Title", "title_th": "ชื่อบทความทดสอบ", "authors": "A, B", "doi": "10.1/x", "publish_year": null, "abstract": null },
  "advisor_approval": { "status": "Approved", "user_id": 3, "remark": "อนุมัติ ผ่านเกณฑ์ครบ", "approved_at": "..." },
  "faculty_com_approval": { "status": "Pending", "meeting_no": null, "meeting_date": null, "remark": null }
}
```
→ ชื่อบทความ = `article_info.title_en` / `title_th` (อาจเป็น `null` ถ้านิสิตไม่กรอก) · ระดับการศึกษา = `student_snapshot.degree_level` (`Master` | `Doctoral`)

## 7. X44 / X45 — รายชื่อผู้ใช้
- **staff ใช้ `GET /manage/users` ได้เหมือน admin** (Staff, Admin, SuperAdmin เข้าได้): query `role`, `status`, `search` (ชื่อ/นามสกุล/อีเมล), `page`, `limit` (ค่าเริ่มต้น 20, สูงสุด 1000) · response `{ data: { users: [...], pagination: { total, page, limit, totalPages } } }` · ไม่มี Admin/SuperAdmin ในรายการ · นิสิตแต่ละคนมี `advisors: { Major: {...}, Co_1: {...}, Co_2: {...} }`
- **`student_count` ของอาจารย์: เพิ่มแล้ว (deploy แล้ว)** ✅ แถว `role = "Supervisor"` ของ `GET /manage/users` มี `student_count` เป็นตัวเลข = จำนวนนิสิตที่อาจารย์คนนั้นเป็น Major / Co_1 / Co_2 (นับคนละครั้งแม้ถือหลายช่อง, ไม่มีนิสิต = 0) · แถว role อื่นไม่มี field นี้ · นับจากฐานข้อมูลทั้งหมด ไม่ขึ้นกับหน้าที่โหลด จึงใช้กับการแบ่งหน้าได้ · ตัวอย่าง `{"user_id":10,"role":"Supervisor","first_name":"Sup1","advisors":{},"student_count":4,...}`
- `GET /admin/admins` **รับ `page`/`limit`** (response `{ data: { admins: [...], pagination: {...} } }`) — SuperAdmin เท่านั้น

## 8. X48 — กฎรหัสผ่าน
ใช้กฎชุดเดียวกัน 2 ที่ (`reset-password` และ `สร้าง Admin`):
- ยาว **8–128 ตัว** · ต้องมี **ตัวพิมพ์ใหญ่** `[A-Z]` · **ตัวพิมพ์เล็ก** `[a-z]` · **ตัวเลข** `[0-9]` · **ไม่บังคับ**อักขระพิเศษ
- regex: `^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{8,128}$`
- `POST /auth/reset-password` ต้องส่ง **`confirmPassword`** ที่ตรงกับ `newPassword` ด้วย (ไม่ส่ง = 400 validation) พร้อม `otpCode` (ตัวเลข 6 หลัก) · ผ่านแล้ว BE ตัดทุกเซสชันของบัญชีนั้น
- รหัสผ่านตอนล็อกอินไม่ตรวจกฎนี้ (แค่ 1–128 ตัว) · ผู้สร้าง Admin ได้รหัสผิดกฎ → 400 `WEAK_PASSWORD`

## 9. X31 — ยืนยัน enum
- `publication_details.status` ที่ BE ตอบกลับ: **`Published` | `Accepted`** เท่านั้น (ENUM ใน DB) · ตอนส่งมา BE ยอมรับตัวเล็กได้ (มีคำว่า "published" ไม่สนตัวพิมพ์ = Published ที่เหลือ = Accepted)
- `innovation_type` ที่ตอบกลับ: **`Commercial` | `Social_Economic` | `Policy_Public` | `None`** ถูกต้อง (ตอนส่งมา BE จับจากคำภาษาอังกฤษในวงเล็บ เช่น "(Commercial)"; ไม่ตรงอะไร = `None`)
- เพิ่มเติม `publication_details.type` ที่ตอบกลับ: `International_Journal` (1.0), `National_TCI_Tier1` (0.8), `National_TCI_Tier2` (0.6) · ใน DB ยังมีค่า `International_Conference`, `National_Conference`, `Intl_Journal_Faculty_Recognized` แต่ BE ปัจจุบันไม่สร้างขึ้นมา
