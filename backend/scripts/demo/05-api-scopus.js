/**
 * DEMO 5: ยิง HTTP ไป backend ที่รันอยู่ (Docker) — ค้น Scopus 2 เส้นทางเทียบกัน
 *   GET /api/v3/journal/scopus         (Scopus API)
 *   GET /api/v3/journal/scopus/scrape  (Scraper: เปิด Chromium ใน container)
 *
 * รัน: node scripts/demo/05-api-scopus.js [ISSN]      (ค่าเริ่มต้น 0028-0836 = Nature)
 * เปลี่ยนปลายทาง: ตั้ง DEMO_BASE_URL (ค่าเริ่มต้น http://127.0.0.1:13002)
 * ดูหน้าต่าง Chromium ตอน scrape ได้ที่ noVNC: http://127.0.0.1:6082
 *
 * สคริปต์ออก access token อายุสั้น (อยู่ในหน่วยความจำ ไม่เก็บไฟล์) ให้ผู้ใช้ Student ที่ Active ใน DB จริง
 * ด้วย JWT_SECRET เดียวกับ backend — ไม่ต้อง login/OTP · ไม่เขียน DB · เส้น API กินโควตา Scopus 1 request
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const db = require('../../src/config/database');
const { issueAccessToken } = require('../../src/utils/jwt');
const { normalizeIssn } = require('../../src/utils/input');

const BASE = process.env.DEMO_BASE_URL || 'http://127.0.0.1:13002';
const line = (t) => console.log(`\n=== ${t} ===`);

async function get(pathAndQuery, token) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/v3${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(120000),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ms: Date.now() - t0, body };
}

(async () => {
  const issn = normalizeIssn(process.argv[2] || '0028-0836');
  if (!issn) { console.error('รูปแบบ ISSN ไม่ถูกต้อง (เช่น 1234-5678)'); process.exit(1); }

  const [[user]] = await db.query(
    "SELECT user_id, username, role, first_name, last_name, msu_mail, degree_level FROM users WHERE account_status = 'Active' ORDER BY role = 'Student' DESC, user_id LIMIT 1"
  );
  const token = issueAccessToken(user);
  console.log(`ปลายทาง: ${BASE}\nผู้ใช้ในการทดสอบ: user_id=${user.user_id} role=${user.role}`);

  const rows = {};
  for (const [label, p] of [['API', '/journal/scopus'], ['Scraper', '/journal/scopus/scrape']]) {
    line(`GET /api/v3${p}?issn=${issn}${label === 'Scraper' ? '  (รอสักครู่ เปิด Chromium)' : ''}`);
    const r = await get(`${p}?issn=${issn}`, token);
    console.log(`HTTP ${r.status}  ใช้เวลา ${r.ms} ms`);
    if (r.status !== 200) { console.log(`ล้มเหลว: ${r.body.code || ''} ${r.body.message || JSON.stringify(r.body)}`); continue; }
    const d = r.body.data;
    rows[label] = {
      'ชื่อวารสาร': d.journal_name, 'ผู้จัดพิมพ์': d.publisher, 'ISSN': d.issn,
      'CiteScore': d.scopus_citescore, 'Best Quartile': d.scopus_best_quartile,
      'SJR': d.scopus_sjr, 'SNIP': d.scopus_snip, 'fetch_method': d.fetch_method, 'เวลา (ms)': r.ms,
    };
  }

  if (Object.keys(rows).length) {
    line('เทียบผลลัพธ์ API vs Scraper');
    console.table(rows);
  }
})()
  .catch(e => console.error('ผิดพลาด:', e.cause?.code || '', e.message))
  .finally(() => db.end());
