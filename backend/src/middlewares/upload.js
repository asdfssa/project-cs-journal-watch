/**
 * Upload Middleware
 * ใช้ multer รับไฟล์แนบ T3 ไว้ใน memory (POST /t3/with-files) — controller เขียนลง
 * uploads/t3/{t3_id}/{field_name}/{timestamp}.{ext} หลังตรวจ magic bytes ผ่านแล้ว
 *
 * Security: ป้องกัน stored XSS จากไฟล์แนบ (เดิมเก็บนามสกุลไฟล์ตามที่ client ส่งมา
 * ตรงๆ ไม่ตรวจ — อัปโหลดไฟล์ .html/.svg ปลอม Content-Type เป็น PDF ได้ แล้ว browser
 * เปิดไฟล์นั้นแบบ render แทน download ก็รัน script ได้ทันที)
 *   1. นามสกุลไฟล์ที่เก็บจริง ยึดตาม MIME ที่ fileFilter อนุมัติเท่านั้น ไม่ใช้ของ client
 *   2. ก่อนใช้งานไฟล์ ต้องเช็ค magic bytes จริงด้วย verifyFileType()
 *      (fileFilter เช็คได้แค่ header Content-Type ที่ client ส่งมา ปลอมง่าย)
 *   3. ตอน serve ไฟล์กลับ ต้องบังคับ Content-Disposition: attachment เสมอ (ดู UploadController)
 */
const multer = require('multer');
// file-type v22 เป็น ESM-only → โหลดแบบ dynamic import (require ไม่ได้)
const loadFileType = () => import('file-type');

// ประเภทไฟล์ที่อนุญาต
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

// นามสกุลไฟล์ที่เก็บจริงบน disk — ยึดตาม MIME ที่ผ่าน filter เท่านั้น ไม่ใช้นามสกุลจาก client
const MIME_TO_EXT = {
  'application/pdf': '.pdf',
  'image/jpeg':       '.jpg',
  'image/png':         '.png',
  'image/webp':       '.webp',
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// Field names ที่ใช้ใน T3
const T3_FIELDS = [
  'acceptance_letter',
  'full_paper',
  'journal_cover',
  'table_of_contents',
  'database_evidence',
  'peer_review_result',
];

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`ประเภทไฟล์ไม่ถูกต้อง รองรับเฉพาะ PDF, JPG, PNG, WEBP เท่านั้น`), false);
  }
};

// Memory storage — ใช้กับ endpoint ที่ยังไม่มี t3_id (submit + upload พร้อมกัน)
const uploadT3FieldsMemory = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  // FE ส่ง 5 ช่องข้อความ (JSON string) + ไฟล์สูงสุด 6 — กันยัดช่องข้อความรัวๆ ลง RAM
  limits: { fileSize: MAX_FILE_SIZE, files: T3_FIELDS.length, fields: 20, fieldSize: 100 * 1024, parts: 20 + T3_FIELDS.length },
}).fields(T3_FIELDS.map(name => ({ name, maxCount: 1 })));

/**
 * เช็คว่าไฟล์เป็นชนิดที่อนุญาตจริง โดยอ่าน magic bytes ของเนื้อไฟล์ (ไม่ใช่ดูแค่
 * Content-Type/นามสกุลที่ client ส่งมา ซึ่งปลอมได้) — รับได้ทั้ง path บน disk หรือ Buffer
 * @param {string|Buffer} source
 * @returns {Promise<boolean>}
 */
async function verifyFileType(source) {
  const { fileTypeFromBuffer, fileTypeFromFile } = await loadFileType();
  const detected = Buffer.isBuffer(source)
    ? await fileTypeFromBuffer(source)
    : await fileTypeFromFile(source);
  return !!detected && ALLOWED_MIME_TYPES.includes(detected.mime);
}

module.exports = {
  uploadT3FieldsMemory,
  T3_FIELDS,
  ALLOWED_MIME_TYPES,
  MIME_TO_EXT,
  verifyFileType,
};