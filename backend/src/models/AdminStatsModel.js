/**
 * Admin Stats Model
 * สถิติรวมสำหรับ dashboard ผู้ดูแล (ตาราง users, pre_t3_requests, t3_requests, msu_unwanted_journals, journals_cache)
 * ผู้เรียก: AdminController.getStats
 */
const db = require('../config/database');
const config = require('../config');

class AdminStatsModel {
  /**
   * สถิติ 4 ชุดด้วย query ขนานกัน — คืนแถวสรุปแถวเดียวของแต่ละชุด (ค่ายังเป็นผลดิบจาก MySQL ผู้เรียกแปลงเป็น Number)
   * @returns {Promise<{users:object, preT3:object, t3:object, unwanted:object, journalCache:object}>}
   */
  static async getOverview() {
    const [
      [userRows],
      [preT3Rows],
      [t3Rows],
      [unwantedRows],
      [cacheRows],
    ] = await Promise.all([
      db.query(`
          SELECT
            COUNT(*)                                              AS total,
            SUM(role = 'Student')                                AS students,
            SUM(role = 'Supervisor')                             AS supervisors,
            SUM(role = 'Staff')                                  AS staff,
            SUM(role IN ('Admin','SuperAdmin'))                  AS admins,
            SUM(account_status = 'Pending')                     AS pending,
            SUM(account_status = 'Active')                      AS active,
            SUM(account_status = 'Suspended')                   AS suspended
          FROM users
        `),
      db.query(`
          SELECT COUNT(*) AS total,
            SUM(overall_status = 'Pending')  AS pending,
            SUM(overall_status = 'Approved') AS approved,
            SUM(overall_status = 'Rejected') AS rejected,
            SUM(overall_status = 'Cancelled') AS cancelled
          FROM pre_t3_requests
        `),
      db.query(`
          SELECT COUNT(*) AS total,
            SUM(overall_status = 'Pending')  AS pending,
            SUM(overall_status = 'Approved') AS approved,
            SUM(overall_status = 'Rejected') AS rejected,
            SUM(overall_status = 'Cancelled') AS cancelled
          FROM t3_requests
        `),
      db.query(`
          SELECT COUNT(*) AS total
          FROM msu_unwanted_journals
        `),
      // นับเฉพาะแถวที่ยังไม่หมดอายุ (แถวหมดอายุรอถูกลบอัตโนมัติและไม่ถือว่าอยู่ใน cache)
      db.query(`
          SELECT COUNT(*) AS total,
            COALESCE(SUM(database_source = 'Scopus'), 0)  AS scopus,
            COALESCE(SUM(database_source = 'TCI'), 0)    AS tci,
            COALESCE(SUM(fetch_method = 'API'), 0)       AS via_api,
            COALESCE(SUM(fetch_method = 'Scraping'), 0)  AS via_scraping
          FROM journals_cache
          WHERE last_updated >= NOW() - INTERVAL ? HOUR
        `, [config.cache.ttlHours]),
    ]);

    return { users: userRows[0], preT3: preT3Rows[0], t3: t3Rows[0], unwanted: unwantedRows[0], journalCache: cacheRows[0] };
  }
}

module.exports = AdminStatsModel;
