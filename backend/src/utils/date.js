/**
 * Date helpers
 */

/**
 * Frontend datepickers send a full ISO datetime string (e.g. "2026-07-16T00:00:00.000Z"),
 * but MySQL DATE columns reject that format under strict mode. Take just the date part.
 * @param {string|null|undefined} value
 * @returns {string|null} 'YYYY-MM-DD' or null
 */
function toMysqlDate(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

module.exports = { toMysqlDate };
