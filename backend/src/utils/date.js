/**
 * Date helpers
 */

// en-CA ให้รูปแบบ YYYY-MM-DD ตรงกับ MySQL DATE
const BANGKOK_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
});

function isRealDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * แปลงวันที่จาก client เป็น 'YYYY-MM-DD' สำหรับคอลัมน์ DATE (เช่น meeting_date)
 *  - 'YYYY-MM-DD' ที่เป็นวันจริง → ใช้ตามนั้น
 *  - ISO datetime ที่มี timezone (Z / +07:00) → วันที่ตามเวลา Asia/Bangkok
 *    (เดิม slice(0,10) จาก UTC: datepicker ไทยส่ง "2026-07-15T17:00:00Z" สำหรับ 16 ก.ค. → เก็บเป็น 15 ก.ค.)
 *  - ISO datetime ไม่มี timezone → ใช้ส่วนวันที่ตามที่เขียน
 * @param {*} value
 * @returns {string|null|undefined} 'YYYY-MM-DD' · null = ไม่ได้ส่ง · undefined = รูปแบบ/วันที่ไม่ถูกต้อง (ผู้เรียกตอบ 400)
 */
function toMysqlDate(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const v = value.trim();

  const plain = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.exec(v);
  if (plain) return isRealDate(+plain[1], +plain[2], +plain[3]) ? `${plain[1]}-${plain[2]}-${plain[3]}` : undefined;

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : BANGKOK_DATE.format(d);
  }
  return undefined;
}

module.exports = { toMysqlDate };
