/**
 * UnwantedJournal Model
 * Data access layer สำหรับ table `msu_unwanted_journals` (รายการวารสารที่ไม่พึงประสงค์ของ มมส.)
 * ผู้เรียก: controllers/UnwantedJournalController เท่านั้น (PreT3Controller.isUnwantedIssn ยัง query ตารางนี้ตรงๆ)
 */
const db = require('../config/database');
const { normalizeIssn, likeContains } = require('../utils/input');

// เขียนตารางนี้ทีละคน (ล็อกระดับ MySQL ข้าม connection/instance) — คอลัมน์ issn เป็นแค่ INDEX
// ไม่ใช่ UNIQUE การ "เช็คซ้ำแล้วค่อย insert" จึงชนกันได้ถ้าสองคำขอมาพร้อมกัน (B52)
const WRITE_LOCK = 'msu_unwanted_journals_write';

class UnwantedJournalModel {
  /**
   * ขอ lock ระดับ MySQL (GET_LOCK) ก่อนเขียนตาราง เพื่อกันสองคำขอเช็คซ้ำแล้ว insert ชนกัน
   * เรียกจาก: UnwantedJournalController.createOne, importCsv, updateOne (เมื่อ ISSN เปลี่ยน)
   * @returns {Promise<() => Promise<void>>} ฟังก์ชันปล่อย lock ต้องเรียกใน finally · throw code 'LOCK_TIMEOUT' ถ้ารอเกิน 10 วินาที (ผู้เรียกตอบ 503 BUSY)
   */
  static async acquireWriteLock() {
    const conn = await db.getConnection();
    try {
      const [[r]] = await conn.query('SELECT GET_LOCK(?, 10) AS got', [WRITE_LOCK]);
      if (r.got !== 1) throw Object.assign(new Error('unwanted-journals write lock timeout'), { code: 'LOCK_TIMEOUT' });
    } catch (e) { conn.release(); throw e; }
    return async () => {
      try { await conn.query('SELECT RELEASE_LOCK(?)', [WRITE_LOCK]); } finally { conn.release(); }
    };
  }

  /**
   * ISSN (normalize แล้ว รูปแบบ XXXX-XXXX) ซ้ำกับแถวอื่นไหม — เทียบทั้งแบบมี/ไม่มีขีด เผื่อแถวเก่าเก็บไม่มีขีด
   * เรียกจาก: createOne, updateOne
   * @param {string} issn
   * @param {number} [exceptId] unwanted_id ที่ไม่นับ (ใช้ตอนแก้ไขแถวตัวเอง)
   */
  static async issnExists(issn, exceptId = 0) {
    const [rows] = await db.query(
      'SELECT unwanted_id FROM msu_unwanted_journals WHERE issn IN (?, ?) AND unwanted_id != ? LIMIT 1',
      [issn, issn.replace('-', ''), exceptId]
    );
    return rows.length > 0;
  }

  /**
   * ค้นแถวด้วย ISSN (normalize แล้ว) ทั้งแบบมี/ไม่มีขีด · เรียกจาก: checkByIssn
   * @returns {Promise<object|null>}
   */
  static async findByIssn(issn) {
    const [rows] = await db.query(
      `SELECT
          unwanted_id, issn, journal_name, publisher,
          note, recorded_date, created_at
         FROM msu_unwanted_journals
         WHERE issn IN (?, ?)
         LIMIT 1`,
      [issn, issn.replace('-', '')]
    );
    return rows[0] || null;
  }

  /**
   * รายการแบบแบ่งหน้า ค้นด้วยชื่อวารสาร/ผู้จัดพิมพ์/ISSN (ตัดขีดเทียบด้วย) · เรียกจาก: getAll
   * @param {{search?:string, limit:number|string, offset:number}} p
   * @returns {Promise<{rows:object[], total:number}>}
   */
  static async search({ search, limit, offset }) {
    const where = ['1=1'];
    const params = [];

    if (search) {
      const like = likeContains(search);
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
          uj.created_at
         FROM msu_unwanted_journals uj
         WHERE ${whereSQL}
         ORDER BY uj.created_at DESC
         LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );

    return { rows, total: Number(countRows[0].total) };
  }

  /**
   * เพิ่ม 1 แถว · เรียกจาก: createOne
   * @param {{issn:string|null, journal_name:string, publisher:string|null, note:string|null, evidence_file_path:string|null, recorded_date:string}} r
   */
  static async create({ issn, journal_name, publisher, note, evidence_file_path, recorded_date }) {
    await db.query(
      `INSERT INTO msu_unwanted_journals
             (issn, journal_name, publisher, note, evidence_file_path, recorded_date)
           VALUES (?, ?, ?, ?, ?, ?)`,
      [issn, journal_name, publisher, note, evidence_file_path, recorded_date]
    );
  }

  /**
   * ISSN (normalize แล้ว) ที่มีอยู่ใน DB แล้ว จากรายการที่ให้ — query ครั้งเดียว · เรียกจาก: importCsv
   * @param {string[]} issns รูปแบบ XXXX-XXXX
   * @returns {Promise<Set<string>>}
   */
  static async findExistingIssns(issns) {
    const existing = new Set();
    if (!issns.length) return existing;
    const [rows] = await db.query(
      'SELECT issn FROM msu_unwanted_journals WHERE issn IN (?)',
      [issns.flatMap(i => [i, i.replace('-', '')])]
    );
    for (const r of rows) existing.add(normalizeIssn(r.issn));
    return existing;
  }

  /**
   * เพิ่มหลายแถวใน transaction เดียว (พังแถวไหนก็ rollback ทั้งหมด) · เรียกจาก: importCsv
   * @param {{issn:string|null, journal_name:string, publisher:string|null, note:string|null, recorded_date:string}[]} rows
   * @returns {Promise<number>} จำนวนที่เพิ่ม
   */
  static async createMany(rows) {
    let imported = 0;
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      for (const row of rows) {
        await conn.query(
          `INSERT INTO msu_unwanted_journals
                 (issn, journal_name, publisher, note, recorded_date)
               VALUES (?, ?, ?, ?, ?)`,
          [row.issn, row.journal_name, row.publisher, row.note, row.recorded_date]
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
    return imported;
  }

  /** แถวเต็มตาม id (ไม่พบ = null) · เรียกจาก: updateOne */
  static async findById(id) {
    const [rows] = await db.query(
      `SELECT * FROM msu_unwanted_journals
           WHERE unwanted_id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  /** เฉพาะ id + path ไฟล์หลักฐานตาม id (ไม่พบ = null) · เรียกจาก: getEvidenceFile, deleteOne */
  static async findEvidenceById(id) {
    const [rows] = await db.query(
      `SELECT unwanted_id, evidence_file_path FROM msu_unwanted_journals
         WHERE unwanted_id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  /**
   * แก้ทุกคอลัมน์ที่แก้ได้ของแถว (ผู้เรียก merge ค่าเดิมมาแล้ว) · เรียกจาก: updateOne
   * @param {number|string} id
   * @param {{issn:string|null, journal_name:string, publisher:string|null, note:string|null, evidence_file_path:string|null, recorded_date:string}} r
   */
  static async update(id, { issn, journal_name, publisher, note, evidence_file_path, recorded_date }) {
    await db.query(
      `UPDATE msu_unwanted_journals
           SET issn = ?, journal_name = ?, publisher = ?, note = ?,
               evidence_file_path = ?, recorded_date = ?
           WHERE unwanted_id = ?`,
      [issn, journal_name, publisher, note, evidence_file_path, recorded_date, id]
    );
  }

  /** ลบแถวถาวร · เรียกจาก: deleteOne */
  static async deleteById(id) {
    await db.query(
      `DELETE FROM msu_unwanted_journals WHERE unwanted_id = ?`,
      [id]
    );
  }
}

module.exports = UnwantedJournalModel;
