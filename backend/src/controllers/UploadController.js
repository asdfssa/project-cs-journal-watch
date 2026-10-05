/**
 * UploadController
 * จัดการไฟล์แนบสำหรับ T3
 *
 * Endpoints:
 *   POST   /api/upload/t3/:id/files   → อัปโหลดไฟล์แนบ (หลายไฟล์พร้อมกันได้)
 *   DELETE /api/upload/t3/:id/files/:field → ลบไฟล์แนบ field นั้น
 *   GET    /api/upload/t3/:id/files/:field → ดาวน์โหลด/ดูไฟล์
 */
const path = require('path');
const fs   = require('fs');
const T3Model = require('../models/T3Model');
const { serverError } = require('../utils/errorResponse');
const { verifyFileType } = require('../middlewares/upload');

// map field name → key ใน journal_evidence_files JSON
const FIELD_TO_KEY = {
  acceptance_letter:  'acceptance_letter_path',
  full_paper:         'full_paper_path',
  journal_cover:      'journal_cover_path',
  table_of_contents:  'table_of_contents_path',
  database_evidence:  'database_evidence_path',
  peer_review_result: 'peer_review_result_path',
};

class UploadController {
  // ============================================================
  // POST /api/upload/t3/:id/files
  // Role: Student (ของตัวเอง)
  // Body: multipart/form-data — fields ตาม T3_FIELDS
  // ============================================================
  static async uploadFiles(req, res) {
    try {
      const t3Id     = parseInt(req.params.id);
      const studentId = req.user.sub;

      const row = await T3Model.findById(t3Id);
      if (!row) {
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'ไม่พบ T3 นี้' });
      }
      if (row.student_id !== studentId) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์อัปโหลดไฟล์นี้' });
      }
      if (row.overall_status === 'Approved') {
        return res.status(400).json({ success: false, code: 'ALREADY_APPROVED', message: 'ไม่สามารถแก้ไขไฟล์หลังจาก T3 ได้รับการอนุมัติแล้ว' });
      }

      if (!req.files || Object.keys(req.files).length === 0) {
        return res.status(400).json({ success: false, code: 'NO_FILES', message: 'ไม่พบไฟล์ที่อัปโหลด' });
      }

      // ดึง evidence files ปัจจุบัน
      const parseJson = (val) => {
        if (typeof val === 'string') { try { return JSON.parse(val); } catch { return {}; } }
        return val || {};
      };

      const evidenceFiles = parseJson(row.journal_evidence_files);

      // วนทุก field ที่ upload มา
      const uploaded = {};
      for (const [fieldName, fileArr] of Object.entries(req.files)) {
        const key = FIELD_TO_KEY[fieldName];
        if (!key) continue;

        const file = fileArr[0];

        // เช็ค magic bytes จริง — fileFilter เช็คได้แค่ Content-Type ที่ client ส่งมา ปลอมได้
        const isValidType = await verifyFileType(file.path);
        if (!isValidType) {
          fs.unlinkSync(file.path);
          return res.status(400).json({
            success: false,
            code: 'INVALID_FILE_CONTENT',
            message: `ไฟล์ "${fieldName}" มีเนื้อหาไม่ตรงกับประเภทไฟล์ที่ประกาศไว้ (รองรับเฉพาะ PDF, JPG, PNG, WEBP)`,
          });
        }

        const relativePath = path.relative(process.cwd(), file.path).replace(/\\/g, '/');

        // ถ้ามีไฟล์เก่าอยู่ → ลบออกก่อน
        if (evidenceFiles[key]) {
          const oldPath = path.join(process.cwd(), evidenceFiles[key]);
          if (fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
          }
        }

        evidenceFiles[key] = relativePath;
        uploaded[fieldName] = relativePath;

        // อัปเดต DB — หนึ่งแถวต่อหนึ่งไฟล์ใน t3_evidence_files
        await T3Model.upsertEvidenceFile(t3Id, fieldName, relativePath);
      }

      return res.json({
        success: true,
        message: `อัปโหลดสำเร็จ ${Object.keys(uploaded).length} ไฟล์`,
        data: { uploaded },
      });
    } catch (err) {
      return serverError(res, err, 'UploadController.uploadFiles');
  }
  }

  // ============================================================
  // DELETE /api/upload/t3/:id/files/:field
  // Role: Student (ของตัวเอง)
  // ============================================================
  static async deleteFile(req, res) {
    try {
      const t3Id      = parseInt(req.params.id);
      const fieldName = req.params.field;
      const studentId = req.user.sub;

      const key = FIELD_TO_KEY[fieldName];
      if (!key) {
        return res.status(400).json({ success: false, code: 'INVALID_FIELD', message: `field ไม่ถูกต้อง: ${fieldName}` });
      }

      const row = await T3Model.findById(t3Id);
      if (!row) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'ไม่พบ T3 นี้' });
      if (row.student_id !== studentId) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์ลบไฟล์นี้' });
      }
      if (row.overall_status === 'Approved') {
        return res.status(400).json({ success: false, code: 'ALREADY_APPROVED', message: 'ไม่สามารถลบไฟล์หลังจาก T3 ได้รับการอนุมัติแล้ว' });
      }

      const parseJson = (val) => {
        if (typeof val === 'string') { try { return JSON.parse(val); } catch { return {}; } }
        return val || {};
      };

      const evidenceFiles = parseJson(row.journal_evidence_files);

      if (!evidenceFiles[key]) {
        return res.status(404).json({ success: false, code: 'FILE_NOT_FOUND', message: 'ไม่พบไฟล์ที่ต้องการลบ' });
      }

      // ลบไฟล์จาก disk
      const filePath = path.join(process.cwd(), evidenceFiles[key]);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      await T3Model.removeEvidenceFile(t3Id, fieldName);

      return res.json({ success: true, message: 'ลบไฟล์เรียบร้อย' });
    } catch (err) {
      return serverError(res, err, 'UploadController.deleteFile');
  }
  }

  // ============================================================
  // GET /api/upload/t3/:id/files/:field
  // Role: Student (ของตัวเอง), Supervisor (ของนิสิตตัวเอง), Staff/Admin
  // ============================================================
  static async downloadFile(req, res) {
    try {
      const t3Id      = parseInt(req.params.id);
      const fieldName = req.params.field;
      const { role, sub: userId } = req.user;

      const key = FIELD_TO_KEY[fieldName];
      if (!key) {
        return res.status(400).json({ success: false, code: 'INVALID_FIELD', message: `field ไม่ถูกต้อง: ${fieldName}` });
      }

      const row = await T3Model.findById(t3Id);
      if (!row) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'ไม่พบ T3 นี้' });

      // ตรวจสิทธิ์
      if (role === 'Student' && row.student_id !== userId) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์ดูไฟล์นี้' });
      }
      if (role === 'Supervisor') {
        const parseJson = (val) => { try { return typeof val === 'string' ? JSON.parse(val) : val; } catch { return {}; } };
        const isMyStudent =
          String(parseJson(row.advisor_approval)?.user_id)       === String(userId) ||
          String(parseJson(row.co_advisor_1_approval)?.user_id)  === String(userId) ||
          String(parseJson(row.co_advisor_2_approval)?.user_id)  === String(userId);
        if (!isMyStudent) {
          return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์ดูไฟล์นี้' });
        }
      }

      const parseJson = (val) => {
        if (typeof val === 'string') { try { return JSON.parse(val); } catch { return {}; } }
        return val || {};
      };

      const evidenceFiles = parseJson(row.journal_evidence_files);

      if (!evidenceFiles[key]) {
        return res.status(404).json({ success: false, code: 'FILE_NOT_FOUND', message: 'ยังไม่มีไฟล์นี้' });
      }

      const filePath = path.join(process.cwd(), evidenceFiles[key]);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, code: 'FILE_MISSING', message: 'ไม่พบไฟล์บน server' });
      }

      // บังคับ Content-Disposition: attachment เสมอ — กัน browser เปิด/render ไฟล์แทน
      // download ตรงๆ (จุดเดิมของ stored XSS ถ้ามีไฟล์หลุดผ่าน magic-byte check มาได้)
      res.download(filePath, `${fieldName}${path.extname(filePath)}`);
    } catch (err) {
      return serverError(res, err, 'UploadController.downloadFile');
  }
  }
}

module.exports = UploadController;