/**
 * UnwantedJournal Controller
 * Base path: /api/admin/unwanted-journals
 * เฉพาะ Admin, SuperAdmin, Staff
 */
const db = require('../config/database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { parse } = require('csv-parse/sync');
const { serverError } = require('../utils/errorResponse');
const { parsePagination, normalizeIssn, nonStringField } = require('../utils/input');
const { toMysqlDate } = require('../utils/date');

const MAX_IMPORT_ROWS = 2000;
const { verifyFileType, MIME_TO_EXT } = require('../middlewares/upload');

// ลบไฟล์แบบไม่ throw — ใช้ใน multer callback (Express 4 จับ error ใน callback ไม่ได้ → unhandled rejection)
// ไฟล์หาย/ลบไม่ได้ไม่ควรทำให้ request พังหรือไปลบไฟล์อื่นใน catch
const removeFile = (p) => fs.promises.unlink(p).catch(() => {});

// -------------------------------------------------------
// Multer config สำหรับ evidence file (PDF, JPG, PNG, WEBP)
// บันทึกลง uploads/unwanted/evidence/
// นามสกุลไฟล์ยึดตาม MIME ที่ fileFilter อนุมัติเท่านั้น ไม่ใช้นามสกุลจาก client (กัน
// stored XSS จากไฟล์ .html/.svg ปลอม Content-Type — ดูรายละเอียดที่ middlewares/upload.js)
// -------------------------------------------------------
const EVIDENCE_ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

const evidenceStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), 'uploads', 'unwanted', 'evidence');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = MIME_TO_EXT[file.mimetype] || '.bin';
    // randomUUID กันชื่อชนกันเมื่ออัปโหลดพร้อมกันในมิลลิวินาทีเดียว (ไฟล์หลังจะทับไฟล์แรก)
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  },
});

const uploadEvidence = multer({
  storage: evidenceStorage,
  fileFilter: (req, file, cb) => {
    if (EVIDENCE_ALLOWED_MIME.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('ประเภทไฟล์ไม่ถูกต้อง รองรับเฉพาะ PDF, JPG, PNG, WEBP เท่านั้น'), false);
    }
  },
  // fieldSize 64KB = ขนาด TEXT ของคอลัมน์ note
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10, fieldSize: 64 * 1024 },
}).single('evidence_file');

// เขียนตาราง msu_unwanted_journals ทีละคน (ล็อกระดับ MySQL ข้าม connection/instance) — คอลัมน์ issn เป็นแค่ INDEX
// ไม่ใช่ UNIQUE การ "เช็คซ้ำแล้วค่อย insert" จึงชนกันได้ถ้าสองคำขอมาพร้อมกัน (B52)
const WRITE_LOCK = 'msu_unwanted_journals_write';
async function acquireWriteLock() {
  const conn = await db.getConnection();
  try {
    const [[r]] = await conn.query('SELECT GET_LOCK(?, 10) AS got', [WRITE_LOCK]);
    if (r.got !== 1) throw Object.assign(new Error('unwanted-journals write lock timeout'), { code: 'LOCK_TIMEOUT' });
  } catch (e) { conn.release(); throw e; }
  return async () => {
    try { await conn.query('SELECT RELEASE_LOCK(?)', [WRITE_LOCK]); } finally { conn.release(); }
  };
}

// ISSN (normalize แล้ว) ซ้ำกับแถวอื่นไหม — เทียบทั้งแบบมี/ไม่มีขีด เผื่อแถวเก่าเก็บไม่มีขีด
async function issnExists(issn, exceptId = 0) {
  const [rows] = await db.query(
    'SELECT unwanted_id FROM msu_unwanted_journals WHERE issn IN (?, ?) AND unwanted_id != ? LIMIT 1',
    [issn, issn.replace('-', ''), exceptId]
  );
  return rows.length > 0;
}

class UnwantedJournalController {

  // ============================================================
  // GET /api/unwanted-journals/check/:issn
  // ตรวจสอบว่า ISSN อยู่ในรายการวารสารที่ไม่พึงประสงค์ของระบบหรือไม่
  // ทุก role ที่ login แล้วใช้ได้ (Student, Supervisor, Staff, Admin, SuperAdmin)
  // ============================================================
  static async checkByIssn(req, res, next) {
    try {
      if (!req.params.issn?.trim()) {
        return res.status(400).json({ success: false, message: 'กรุณาระบุ ISSN' });
      }
      const issn = normalizeIssn(req.params.issn);
      if (!issn) {
        return res.status(400).json({ success: false, message: 'รูปแบบ ISSN ไม่ถูกต้อง (เช่น 1234-5678)' });
      }

      const [rows] = await db.query(
        `SELECT
          unwanted_id, issn, journal_name, publisher,
          note, recorded_date, created_at
         FROM msu_unwanted_journals
         WHERE issn IN (?, ?)
         LIMIT 1`,
        [issn, issn.replace('-', '')]
      );

      const found = rows.length > 0;

      return res.json({
        success: true,
        data: {
          isUnwanted: found,
          journal: found ? rows[0] : null,
        },
      });
    } catch (err) { next(err); }
  }

  // ============================================================
  // GET /api/admin/unwanted-journals
  // Query: search, page, limit
  // ============================================================
  static async getAll(req, res, next) {
    try {
      const { search } = req.query;
      const { page, limit, offset } = parsePagination(req.query);

      let where = ['1=1'];
      const params = [];

      if (search) {
        const like = `%${search}%`;
        // ISSN เก็บเป็น XXXX-XXXX → ค้น "12345678" ต้องเทียบแบบตัดขีดด้วย ไม่งั้นไม่เจอ
        const digits = String(search).replace(/[\s-]/g, '');
        if (digits.length >= 4 && /^[0-9Xx]+$/.test(digits)) {
          where.push("(journal_name LIKE ? OR issn LIKE ? OR REPLACE(issn, '-', '') LIKE ? OR publisher LIKE ?)");
          params.push(like, like, `%${digits}%`, like);
        } else {
          where.push('(journal_name LIKE ? OR issn LIKE ? OR publisher LIKE ?)');
          params.push(like, like, like);
        }
      }

      const whereSQL = where.join(' AND ');

      const [countRows] = await db.query(
        `SELECT COUNT(*) AS total FROM msu_unwanted_journals uj WHERE ${whereSQL}`,
        params
      );

      const [rows] = await db.query(
        `SELECT
          uj.unwanted_id, uj.issn, uj.journal_name, uj.publisher,
          uj.note, uj.evidence_file_path, uj.recorded_date,
          uj.created_at,
          u.first_name, u.last_name, u.msu_mail
         FROM msu_unwanted_journals uj
         LEFT JOIN users u ON u.user_id = uj.created_by
         WHERE ${whereSQL}
         ORDER BY uj.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, Number(limit), offset]
      );

      // ผู้สร้างรายการ (ชื่อ/อีเมล) และ path ไฟล์บนเซิร์ฟเวอร์ เห็นได้เฉพาะผู้จัดการรายการ — role อื่นได้แค่ว่ามีไฟล์หรือไม่
      // evidence_file_path ของ role อื่นเป็นเส้นทางดาวน์โหลดตาม id (FE ใช้เป็นแค่ตัวบอกว่ามีไฟล์) ไม่ใช่ path จริง (B49)
      const isManager = ['Admin', 'SuperAdmin', 'Staff'].includes(req.user.role);
      const journals = rows.map(r => {
        const has_evidence = !!r.evidence_file_path;
        if (isManager) return { ...r, has_evidence };
        return {
          ...r,
          first_name: null, last_name: null, msu_mail: null,
          has_evidence,
          evidence_file_path: has_evidence ? `/unwanted-journals/${r.unwanted_id}/evidence` : null,
        };
      });

      return res.json({
        success: true,
        data: {
          journals,
          pagination: {
            total: Number(countRows[0].total),
            page:  Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(Number(countRows[0].total) / Number(limit)),
          },
        },
      });
    } catch (err) { next(err); }
  }

  // ============================================================
  // POST /api/admin/unwanted-journals/single
  // Content-Type: multipart/form-data
  // Fields: issn?, journal_name, publisher?, note?, recorded_date
  // File:   evidence_file? (PDF/JPG/PNG/WEBP, max 10 MB)
  // ============================================================
  static async createOne(req, res, next) {
    uploadEvidence(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ success: false, message: err.message });
      }

      let release = null;
      try {
        // เช็ค magic bytes จริง — fileFilter เช็คได้แค่ Content-Type ที่ client ส่งมา ปลอมได้
        if (req.file && !(await verifyFileType(req.file.path))) {
          removeFile(req.file.path);
          return res.status(400).json({
            success: false,
            message: 'ไฟล์หลักฐานมีเนื้อหาไม่ตรงกับประเภทไฟล์ที่ประกาศไว้ (รองรับเฉพาะ PDF, JPG, PNG, WEBP)',
          });
        }

        // multipart field ซ้ำ (issn=a&issn=b) ได้ array → .trim() พัง 500 — ต้องเป็นข้อความเท่านั้น
        const badField = nonStringField(req.body, ['issn', 'journal_name', 'publisher', 'note', 'recorded_date']);
        if (badField) {
          if (req.file) removeFile(req.file.path);
          return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: `${badField} ต้องเป็นข้อความ` });
        }

        const { issn, journal_name, publisher, note, recorded_date } = req.body;

        if (!journal_name?.trim()) {
          if (req.file) removeFile(req.file.path);
          return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อวารสาร' });
        }
        if (!recorded_date) {
          if (req.file) removeFile(req.file.path);
          return res.status(400).json({ success: false, message: 'กรุณาระบุวันที่บันทึก' });
        }

        const issnNorm = issn?.trim() ? normalizeIssn(issn) : null;
        if (issn?.trim() && !issnNorm) {
          if (req.file) removeFile(req.file.path);
          return res.status(400).json({ success: false, message: 'รูปแบบ ISSN ไม่ถูกต้อง (เช่น 1234-5678)' });
        }

        if (issnNorm) {
          release = await acquireWriteLock();
          if (await issnExists(issnNorm)) {
            if (req.file) removeFile(req.file.path);
            return res.status(400).json({ success: false, message: `ISSN ${issn} มีอยู่ในรายการแล้ว` });
          }
        }

        const evidenceFilePath = req.file
          ? path.relative(process.cwd(), req.file.path).replace(/\\/g, '/')
          : null;

        await db.query(
          `INSERT INTO msu_unwanted_journals
             (issn, journal_name, publisher, note, evidence_file_path, recorded_date, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            issnNorm,
            journal_name.trim(),
            publisher?.trim() || null,
            note?.trim() || null,
            evidenceFilePath,
            recorded_date,
            req.user.sub,
          ]
        );

        return res.status(201).json({ success: true, message: 'เพิ่มวารสารเรียบร้อยแล้ว' });
      } catch (err2) {
        if (req.file) removeFile(req.file.path);
        if (err2.code === 'LOCK_TIMEOUT') return res.status(503).json({ success: false, code: 'BUSY', message: 'ระบบกำลังบันทึกรายการอื่นอยู่ กรุณาลองใหม่อีกครั้ง' });
        next(err2);
      } finally {
        if (release) await release();
      }
    });
  }

  // ============================================================
  // POST /api/admin/unwanted-journals/import
  // multipart/form-data: file = CSV
  // CSV columns: journal_name, issn, publisher, note, recorded_date
  // ============================================================
  static async importCsv(req, res, next) {
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 10, fieldSize: 10 * 1024 },
    }).single('file');

    upload(req, res, async (err) => {
      if (err) return res.status(400).json({ success: false, message: 'อัปโหลดไฟล์ไม่สำเร็จ: ' + err.message });
      if (!req.file) return res.status(400).json({ success: false, message: 'กรุณาแนบไฟล์ CSV' });

      let release = null;
      try {
        let records;
        try {
          records = parse(req.file.buffer, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            bom: true,
          });
        } catch (parseErr) {
          return res.status(400).json({ success: false, message: 'ไฟล์ CSV ไม่ถูกต้อง: ' + parseErr.message });
        }

        if (!records.length)
          return res.status(400).json({ success: false, message: 'ไฟล์ CSV ว่างเปล่า' });
        if (records.length > MAX_IMPORT_ROWS)
          return res.status(400).json({ success: false, code: 'TOO_MANY_ROWS', message: `ไฟล์มี ${records.length} แถว เกินที่รองรับ (สูงสุด ${MAX_IMPORT_ROWS} แถวต่อไฟล์) กรุณาแบ่งไฟล์` });

        const errors = [];
        release = await acquireWriteLock();

        records.forEach(r => {
          r._issn = r.issn?.trim() ? normalizeIssn(r.issn) : null;
          r._date = toMysqlDate(r.recorded_date); // null = ไม่ได้ใส่, undefined = รูปแบบ/วันที่ผิด
        });

        // ISSN ที่มีอยู่แล้วใน DB — query ครั้งเดียว (เดิมต่อแถว) · นับซ้ำในไฟล์ด้วย Map (เดิม filter ต่อแถว = O(n²))
        const fileIssns = new Map();
        for (const r of records) if (r._issn) fileIssns.set(r._issn, (fileIssns.get(r._issn) || 0) + 1);
        const existingIssns = new Set();
        if (fileIssns.size) {
          const [dbRows] = await db.query(
            'SELECT issn FROM msu_unwanted_journals WHERE issn IN (?)',
            [[...fileIssns.keys()].flatMap(i => [i, i.replace('-', '')])]
          );
          for (const r of dbRows) existingIssns.add(normalizeIssn(r.issn));
        }
        for (let i = 0; i < records.length; i++) {
          const row = records[i];
          const rowNum = i + 2;

          if (!row.journal_name?.trim()) errors.push(`Row ${rowNum}: ไม่มี journal_name`);
          if (row.journal_name && row.journal_name.length > 255) errors.push(`Row ${rowNum}: journal_name ยาวเกิน 255 ตัวอักษร`);
          if (row.publisher && row.publisher.length > 255) errors.push(`Row ${rowNum}: publisher ยาวเกิน 255 ตัวอักษร`);
          if (row._date === null) errors.push(`Row ${rowNum}: ไม่มี recorded_date`);
          else if (row._date === undefined) errors.push(`Row ${rowNum}: recorded_date "${row.recorded_date}" ไม่ถูกต้อง (ใช้ YYYY-MM-DD)`);

          if (row.issn?.trim() && !row._issn) errors.push(`Row ${rowNum}: รูปแบบ ISSN ไม่ถูกต้อง (${row.issn})`);

          // เช็คซ้ำใน DB
          if (row._issn && existingIssns.has(row._issn)) errors.push(`Row ${rowNum}: ISSN ${row.issn} มีอยู่ในรายการแล้ว`);

          // เช็คซ้ำในไฟล์เดียวกัน (เทียบหลัง normalize — 12345678 กับ 1234-5678 คือตัวเดียวกัน)
          if (row._issn && fileIssns.get(row._issn) > 1) errors.push(`Row ${rowNum}: ISSN ${row.issn} ซ้ำในไฟล์`);
        }

        if (errors.length) {
          return res.status(400).json({
            success: false,
            message: `พบ ${errors.length} ปัญหาใน CSV — ไม่มีข้อมูลถูก import`,
            errors,
          });
        }

        let imported = 0;
        const conn = await db.getConnection();
        try {
          await conn.beginTransaction();

          for (const row of records) {
            await conn.query(
              `INSERT INTO msu_unwanted_journals
                 (issn, journal_name, publisher, note, recorded_date, created_by)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                row._issn,
                row.journal_name.trim(),
                row.publisher?.trim() || null,
                row.note?.trim() || null,
                row._date,
                req.user.sub,
              ]
            );
            imported++;
          }

          await conn.commit();
        } catch (txErr) {
          await conn.rollback();
          throw txErr;
        } finally {
          conn.release();
        }

        return res.json({
          success: true,
          message: `Import สำเร็จ ${imported} รายการ`,
          data: { imported },
        });
      } catch (err) {
        if (err.code === 'LOCK_TIMEOUT') return res.status(503).json({ success: false, code: 'BUSY', message: 'ระบบกำลังบันทึกรายการอื่นอยู่ กรุณาลองใหม่อีกครั้ง' });
        next(err);
      } finally {
        if (release) await release();
      }
    });
  }

  // ============================================================
  // PATCH /api/admin/unwanted-journals/:id
  // Content-Type: multipart/form-data
  // Fields: issn?, journal_name?, publisher?, note?, recorded_date?,
  //         clear_evidence? (= "true" เพื่อลบไฟล์หลักฐานที่มีอยู่)
  // File:   evidence_file? (อัปโหลดไฟล์ใหม่แทนไฟล์เดิม)
  // ============================================================
  static async updateOne(req, res, next) {
    uploadEvidence(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ success: false, message: err.message });
      }

      let release = null;
      try {
        // เช็ค magic bytes จริง — fileFilter เช็คได้แค่ Content-Type ที่ client ส่งมา ปลอมได้
        if (req.file && !(await verifyFileType(req.file.path))) {
          removeFile(req.file.path);
          return res.status(400).json({
            success: false,
            message: 'ไฟล์หลักฐานมีเนื้อหาไม่ตรงกับประเภทไฟล์ที่ประกาศไว้ (รองรับเฉพาะ PDF, JPG, PNG, WEBP)',
          });
        }

        // multipart field ซ้ำ (issn=a&issn=b) ได้ array → .trim() พัง 500 — ต้องเป็นข้อความเท่านั้น
        const badField = nonStringField(req.body, ['issn', 'journal_name', 'publisher', 'note', 'recorded_date']);
        if (badField) {
          if (req.file) removeFile(req.file.path);
          return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: `${badField} ต้องเป็นข้อความ` });
        }

        const { id } = req.params;
        const [target] = await db.query(
          `SELECT * FROM msu_unwanted_journals
           WHERE unwanted_id = ?`,
          [id]
        );
        if (!target.length) {
          if (req.file) removeFile(req.file.path);
          return res.status(404).json({ success: false, message: 'ไม่พบวารสาร' });
        }

        const cur = target[0];
        const body = req.body;

        const merged = {
          issn:          body.issn          !== undefined ? body.issn?.trim() || null : cur.issn,
          journal_name:  body.journal_name  !== undefined ? body.journal_name.trim()  : cur.journal_name,
          publisher:     body.publisher     !== undefined ? body.publisher?.trim() || null : cur.publisher,
          note:          body.note          !== undefined ? body.note?.trim() || null : cur.note,
          recorded_date: body.recorded_date !== undefined ? body.recorded_date : cur.recorded_date,
        };

        if (!merged.journal_name) {
          if (req.file) removeFile(req.file.path);
          return res.status(400).json({ success: false, message: 'ชื่อวารสารห้ามว่าง' });
        }
        if (body.issn !== undefined && merged.issn) {
          merged.issn = normalizeIssn(merged.issn);
          if (!merged.issn) {
            if (req.file) removeFile(req.file.path);
            return res.status(400).json({ success: false, message: 'รูปแบบ ISSN ไม่ถูกต้อง (เช่น 1234-5678)' });
          }
        }

        // เช็ค ISSN ซ้ำกับ record อื่น (schema เป็นแค่ INDEX ไม่ใช่ UNIQUE เลย DB ไม่กันให้)
        if (merged.issn && merged.issn !== cur.issn) {
          release = await acquireWriteLock();
          if (await issnExists(merged.issn, Number(id))) {
            if (req.file) removeFile(req.file.path);
            return res.status(400).json({ success: false, message: `ISSN ${merged.issn} มีอยู่ในรายการแล้ว` });
          }
        }

        // คำนวณ evidence_file_path ใหม่ — ยังไม่ลบไฟล์เก่าตอนนี้ รอ UPDATE สำเร็จก่อน
        // (ลบก่อนแล้ว UPDATE ล้มเหลวทีหลัง จะเหลือ DB row ชี้ไฟล์ที่ไม่มีอยู่จริง)
        let newEvidencePath = cur.evidence_file_path;
        let oldPathToDelete = null;
        if (req.file) {
          if (cur.evidence_file_path) {
            oldPathToDelete = path.join(process.cwd(), cur.evidence_file_path);
          }
          newEvidencePath = path.relative(process.cwd(), req.file.path).replace(/\\/g, '/');
        } else if (body.clear_evidence === 'true') {
          if (cur.evidence_file_path) {
            oldPathToDelete = path.join(process.cwd(), cur.evidence_file_path);
          }
          newEvidencePath = null;
        }

        await db.query(
          `UPDATE msu_unwanted_journals
           SET issn = ?, journal_name = ?, publisher = ?, note = ?,
               evidence_file_path = ?, recorded_date = ?
           WHERE unwanted_id = ?`,
          [merged.issn, merged.journal_name, merged.publisher, merged.note,
           newEvidencePath, merged.recorded_date, id]
        );

        // UPDATE สำเร็จแล้วค่อยลบไฟล์เก่าทิ้ง
        if (oldPathToDelete) removeFile(oldPathToDelete);

        return res.json({ success: true, message: 'แก้ไขวารสารเรียบร้อยแล้ว' });
      } catch (err2) {
        if (req.file) removeFile(req.file.path);
        if (err2.code === 'LOCK_TIMEOUT') return res.status(503).json({ success: false, code: 'BUSY', message: 'ระบบกำลังบันทึกรายการอื่นอยู่ กรุณาลองใหม่อีกครั้ง' });
        next(err2);
      } finally {
        if (release) await release();
      }
    });
  }

  // ============================================================
  // GET /api/unwanted-journals/:id/evidence
  // ดาวน์โหลด/ดูไฟล์หลักฐาน
  // ทุก role ที่ login แล้วเข้าดูได้
  // ============================================================
  static async getEvidenceFile(req, res, next) {
    try {
      const { id } = req.params;
      const [rows] = await db.query(
        `SELECT evidence_file_path FROM msu_unwanted_journals
         WHERE unwanted_id = ?`,
        [id]
      );

      if (!rows.length)
        return res.status(404).json({ success: false, message: 'ไม่พบวารสาร' });

      const filePath = rows[0].evidence_file_path;
      if (!filePath)
        return res.status(404).json({ success: false, message: 'ไม่มีไฟล์หลักฐาน' });

      const absPath = path.join(process.cwd(), filePath);
      if (!fs.existsSync(absPath))
        return res.status(404).json({ success: false, message: 'ไม่พบไฟล์บนเซิร์ฟเวอร์' });

      // บังคับ Content-Disposition: attachment เสมอ — กัน browser เปิด/render ไฟล์แทน download ตรงๆ
      return res.download(absPath, `evidence${path.extname(absPath)}`);
    } catch (err) { next(err); }
  }

  // ============================================================
  // DELETE /api/admin/unwanted-journals/:id  (hard delete)
  // ============================================================
  static async deleteOne(req, res, next) {
    try {
      const { id } = req.params;
      const [target] = await db.query(
        `SELECT unwanted_id, evidence_file_path FROM msu_unwanted_journals
         WHERE unwanted_id = ?`,
        [id]
      );
      if (!target.length)
        return res.status(404).json({ success: false, message: 'ไม่พบวารสาร' });

      await db.query(
        `DELETE FROM msu_unwanted_journals WHERE unwanted_id = ?`,
        [id]
      );

      // ลบไฟล์หลักฐานหลัง DELETE สำเร็จ — ไฟล์หายไปแล้วก็ไม่เป็นไร
      if (target[0].evidence_file_path) {
        fs.promises.unlink(path.join(process.cwd(), target[0].evidence_file_path)).catch(() => {});
      }

      return res.json({ success: true, message: 'ลบวารสารเรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }
}

module.exports = UnwantedJournalController;