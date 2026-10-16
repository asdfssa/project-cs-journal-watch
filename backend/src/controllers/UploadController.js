/**
 * UploadController
 * จัดการไฟล์แนบสำหรับ T3
 *
 * Endpoints:
 *   GET    /api/upload/t3/:id/files/:field → ดาวน์โหลด/ดูไฟล์
 */
const path = require('path');
const fs   = require('fs');
const T3Model = require('../models/T3Model');
const { serverError } = require('../utils/errorResponse');

// map field name → key ใน journal_evidence_files JSON
const FIELD_TO_KEY = {
  acceptance_letter:  'acceptance_letter_path',
  full_paper:         'full_paper_path',
  journal_cover:      'journal_cover_path',
  table_of_contents:  'table_of_contents_path',
  database_evidence:  'database_evidence_path',
  peer_review_result: 'peer_review_result_path',
};

/**
 * Controller ดาวน์โหลดไฟล์แนบของ T3 — ผูกใน routes/uploadRoutes.js (base path /api/v3/upload)
 * การอัปโหลดไม่ได้อยู่ที่นี่: ไฟล์เข้าระบบพร้อมการยื่น T3 ที่ T3Controller.submitWithFiles
 */
class UploadController {
  /**
   * เรียกจาก: routes/uploadRoutes.js — GET /t3/:id/files/:field (requireAuth → requireRole ทุก role ที่ login)
   * รับ: req.params.id (t3_id, requireNumericId ตรวจแล้ว), req.params.field (ชื่อ field เช่น full_paper ต้องอยู่ใน FIELD_TO_KEY), req.user (sub, role)
   * ลำดับ: T3Model.findById → ตรวจสิทธิ์ (Student ต้องเป็นเจ้าของ, Supervisor ต้องเป็นอาจารย์ในคำร้อง) → หา path จาก journal_evidence_files[field]
   *   → ตรวจว่าไฟล์อยู่บนดิสก์จริง (uploads/t3/{t3_id}/{field}/...) → res.download (บังคับ attachment)
   * ตอบ error: 400 INVALID_FIELD · 404 NOT_FOUND/FILE_NOT_FOUND/FILE_MISSING · 403 FORBIDDEN
   */
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