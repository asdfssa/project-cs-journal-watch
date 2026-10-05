/**
 * Upload Middleware
 * ใช้ multer เก็บไฟล์ลง Local disk
 * path: uploads/t3/{t3_id}/{field_name}/{timestamp}.{ext}
 *
 * Security: ป้องกัน stored XSS จากไฟล์แนบ (เดิมเก็บนามสกุลไฟล์ตามที่ client ส่งมา
 * ตรงๆ ไม่ตรวจ — อัปโหลดไฟล์ .html/.svg ปลอม Content-Type เป็น PDF ได้ แล้ว browser
 * เปิดไฟล์นั้นแบบ render แทน download ก็รัน script ได้ทันที)
 *   1. นามสกุลไฟล์ที่เก็บจริง ยึดตาม MIME ที่ fileFilter อนุมัติเท่านั้น ไม่ใช้ของ client
 *   2. หลัง multer เขียนไฟล์เสร็จ ต้องเช็ค magic bytes จริงด้วย verifyFileType() ก่อนใช้งาน
 *      (fileFilter เช็คได้แค่ header Content-Type ที่ client ส่งมา ปลอมง่าย)
 *   3. ตอน serve ไฟล์กลับ ต้องบังคับ Content-Disposition: attachment เสมอ (ดู UploadController)
 */
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const { fromFile: fileTypeFromFile, fromBuffer: fileTypeFromBuffer } = require('file-type');

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

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // req.params.id มาจาก URL ตรงๆ — ต้องเช็คว่าเป็นเลขจำนวนเต็มบวกเท่านั้นก่อนเอาไปต่อ path
    // กัน path traversal (เช่น ../../ ที่ผ่าน URL-encoding มา) เขียนไฟล์นอก uploads/
    if (!/^\d+$/.test(String(req.params.id))) {
      return cb(new Error('t3 id ไม่ถูกต้อง'));
    }
    const dir = path.join(process.cwd(), 'uploads', 't3', req.params.id, file.fieldname);

    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = MIME_TO_EXT[file.mimetype] || '.bin';
    cb(null, `${Date.now()}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`ประเภทไฟล์ไม่ถูกต้อง รองรับเฉพาะ PDF, JPG, PNG, WEBP เท่านั้น`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
});

// สำหรับ upload หลายไฟล์พร้อมกัน (แต่ละ field 1 ไฟล์)
const uploadT3Fields = upload.fields(
  T3_FIELDS.map(name => ({ name, maxCount: 1 }))
);

// Memory storage — ใช้กับ endpoint ที่ยังไม่มี t3_id (submit + upload พร้อมกัน)
const uploadT3FieldsMemory = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
}).fields(T3_FIELDS.map(name => ({ name, maxCount: 1 })));

/**
 * เช็คว่าไฟล์เป็นชนิดที่อนุญาตจริง โดยอ่าน magic bytes ของเนื้อไฟล์ (ไม่ใช่ดูแค่
 * Content-Type/นามสกุลที่ client ส่งมา ซึ่งปลอมได้) — รับได้ทั้ง path บน disk หรือ Buffer
 * @param {string|Buffer} source
 * @returns {Promise<boolean>}
 */
async function verifyFileType(source) {
  const detected = Buffer.isBuffer(source)
    ? await fileTypeFromBuffer(source)
    : await fileTypeFromFile(source);
  return !!detected && ALLOWED_MIME_TYPES.includes(detected.mime);
}

module.exports = {
  upload,
  uploadT3Fields,
  uploadT3FieldsMemory,
  T3_FIELDS,
  ALLOWED_MIME_TYPES,
  MIME_TO_EXT,
  verifyFileType,
};