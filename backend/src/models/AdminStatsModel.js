/**
 * Admin Stats Model
 * สถิติรวมสำหรับ dashboard ผู้ดูแล (ตาราง users, pre_t3_requests, t3_requests, msu_unwanted_journals)
 * ผู้เรียก: AdminController.getStats
 */
const db = require('../config/database');

class AdminStatsModel {
  /**
   * สถิติ 4 ชุดด้วย query ขนานกัน — คืนแถวสรุปแถวเดียวของแต่ละชุด (ค่ายังเป็นผลดิบจาก MySQL ผู้เรียกแปลงเป็น Number)
   * @returns {Promise<{users:object, preT3:object, t3:object, unwanted:object}>}
   */
  static async getOverview() {
    const [
      [userRows],
      [preT3Rows],
      [t3Rows],
      [unwantedRows],
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
    ]);

    return { users: userRows[0], preT3: preT3Rows[0], t3: t3Rows[0], unwanted: unwantedRows[0] };
  }
}

module.exports = AdminStatsModel;
