/**
 * JournalCache
 * cache ผลค้นวารสาร (Scopus/TCI, ทั้ง API และ Scraper) ในตาราง journals_cache — ใช้ร่วมกันทุก service
 * เรียกจาก: ScopusService, TCIService, ScopusScraper, TCIScraper (ผ่าน JournalCache.shared())
 *
 * กติกา: TTL นับจากเวลาดึงข้อมูล (อ่านไม่ต่ออายุ) · ไม่ cache ผล null/error · cache พังต้องไม่ทำให้การค้นล้ม
 * ผล Scraping ไม่ทับผล API ที่ยังไม่หมดอายุ · แถวหมดอายุถูกลบตอน save (ไม่ถี่กว่า purgeIntervalMinutes)
 */
const JSON_COLS = ['scopus_quartile_data', 'subject_areas'];
const BOOL_COLS = ['scopus_discontinued', 'tci_inactive'];
const NUM_COLS = ['scopus_citescore', 'scopus_sjr', 'scopus_snip'];
const SCOPUS_ONLY = [
  'scopus_quartile_data', 'scopus_best_quartile', 'scopus_best_percentile', 'scopus_h_index', 'scopus_total_docs',
  'open_access', 'open_access_type', 'scopus_citescore', 'scopus_sjr', 'scopus_snip', 'scopus_discontinued',
  'subject_areas', 'coverage_start_year', 'coverage_end_year',
];
const TCI_ONLY = [
  'tci_tier', 'tci_status', 'tci_inactive', 'main_area', 'major_area', 'minor_area', 'volume_per_year', 'issue_per_volume',
];
const COMMON = [
  'issn', 'database_source', 'eissn', 'journal_name', 'journal_name_th', 'publisher', 'publisher_th', 'website',
  'abbrev_name', 'prev_name', 'prev_name_th', 'fetch_method',
];
// ลำดับเดียวกับพารามิเตอร์ของ INSERT (last_updated ตั้งด้วย NOW() ใน SQL)
const COLUMNS = [...COMMON, ...SCOPUS_ONLY, ...TCI_ONLY];

const SOURCES = ['Scopus', 'TCI'];
const KEY_COLS = ['issn', 'database_source'];
const UPSERT_SQL = `INSERT INTO journals_cache (${COLUMNS.join(', ')}, last_updated)
  VALUES (${COLUMNS.map(() => '?').join(', ')}, NOW())
  ON DUPLICATE KEY UPDATE ${COLUMNS.filter(c => !KEY_COLS.includes(c)).map(c => `${c} = VALUES(${c})`).join(', ')}, last_updated = NOW()`;
const FIND_SQL = `SELECT * FROM journals_cache
  WHERE database_source = ? AND (issn = ? OR eissn = ?) AND last_updated >= NOW() - INTERVAL ? HOUR LIMIT 1`;
const PURGE_SQL = 'DELETE FROM journals_cache WHERE last_updated < NOW() - INTERVAL ? HOUR';

/**
 * @param {object} deps db = { query }, ttlHours, purgeIntervalMinutes, now() = ms (ทดสอบ), log(...)
 */
function createJournalCache({ db, ttlHours, purgeIntervalMinutes, now = Date.now, log = console.error }) {
  let lastPurge = 0;

  // ตัวเลข/X ล้วน ไม่มีขีด (รูปเดียวกับที่ service เก็บ) — pickIssns ใน utils/input ทำแบบเดียวกัน
  const clean = (issn) => String(issn ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();

  async function find(issn, source) {
    const [rows] = await db.query(FIND_SQL, [source, issn, issn, ttlHours]);
    return rows[0] || null;
  }

  // แถวจาก DB → object รูปแบบเดียวกับผล fetch สด (เฉพาะ field ของฝั่งนั้น) + fromCache
  function toResult(row) {
    const keep = row.database_source === 'Scopus' ? SCOPUS_ONLY : TCI_ONLY;
    const out = {};
    for (const c of [...COMMON, ...keep]) {
      let v = row[c] ?? null;
      if (v !== null) {
        if (JSON_COLS.includes(c) && typeof v === 'string') v = JSON.parse(v);
        else if (BOOL_COLS.includes(c)) v = Boolean(Number(v));
        else if (NUM_COLS.includes(c)) v = Number(v);
      }
      out[c] = v;
    }
    out.fromCache = true;
    out.cached_at = row.last_updated;
    return out;
  }

  function toParams(data) {
    return COLUMNS.map((c) => {
      const v = data[c] ?? null;
      if (v === null) return BOOL_COLS.includes(c) ? 0 : null;
      if (JSON_COLS.includes(c)) return JSON.stringify(v);
      if (BOOL_COLS.includes(c)) return v ? 1 : 0;
      return v;
    });
  }

  async function purgeIfDue() {
    if (now() - lastPurge < purgeIntervalMinutes * 60_000) return;
    lastPurge = now();
    try {
      await db.query(PURGE_SQL, [ttlHours]);
    } catch (e) {
      log('[JournalCache] purge ไม่สำเร็จ:', e.message);
    }
  }

  return {
    /** @returns {Promise<object|null>} null = ไม่มี/หมดอายุ/DB พัง (ผู้เรียกไปดึงสดต่อ) */
    async get(issn, source) {
      try {
        const row = await find(clean(issn), source);
        return row ? toResult(row) : null;
      } catch (e) {
        log('[JournalCache] อ่าน cache ไม่สำเร็จ:', e.message);
        return null;
      }
    },

    /** data = ผล fetch สดจาก service (ต้องมี issn + database_source) · ไม่ throw */
    async save(data) {
      if (!data || !data.issn || !SOURCES.includes(data.database_source)) return;
      try {
        const issn = clean(data.issn);
        if (data.fetch_method === 'Scraping') {
          const fresh = await find(issn, data.database_source);
          if (fresh && fresh.fetch_method === 'API') return;
        }
        await db.query(UPSERT_SQL, toParams({ ...data, issn, eissn: data.eissn ? clean(data.eissn) : null }));
      } catch (e) {
        log('[JournalCache] บันทึก cache ไม่สำเร็จ:', e.message);
        return;
      }
      await purgeIfDue();
    },
  };
}

let instance;
/** instance จริง (ต่อ DB จริง) — require ตอนเรียกครั้งแรกเพื่อให้เทสต์ที่ไม่ต้องใช้ DB โหลดโมดูลนี้ได้ */
function shared() {
  if (!instance) {
    instance = createJournalCache({
      db: require('../config/database'),
      ttlHours: require('../config').cache.ttlHours,
      purgeIntervalMinutes: require('../config').cache.purgeIntervalMinutes,
    });
  }
  return instance;
}

module.exports = { createJournalCache, shared, COLUMNS };
