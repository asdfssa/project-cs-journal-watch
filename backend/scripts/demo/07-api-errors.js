/**
 * DEMO 7: ระบบตอบอย่างไรเมื่อใส่ค่าผิด / ไม่มีสิทธิ์ / ยิงถี่เกินไป (ยิง HTTP ไป backend ที่รันอยู่ใน Docker)
 * ทุกเคสต้องไม่ได้ 500 — แต่ละเคสแสดง "คาดหวัง" เทียบ "ได้จริง" แล้วสรุปผ่าน/ไม่ผ่าน
 *
 * รัน: node scripts/demo/07-api-errors.js [--limit] [--busy]
 *   (ไม่ใส่ flag) A) ไม่มี/ผิด token  B) ISSN ผิดรูปแบบ/ไม่มีจริง  C) Student ถูกห้ามแก้รายการต้องห้าม
 *   --limit       D) ยิง /scrape ซ้ำ 12 ครั้งจน RATE_LIMIT (10 ครั้ง/5 นาที) — ใช้ ISSN ผิดรูปแบบ ไม่เปิด Chromium
 *   --busy        E) ผู้ใช้เดียวยิง /tci/scrape พร้อมกัน 2 คำขอ — ตัวที่ 2 ต้องได้ SCRAPER_USER_BUSY (เปิด Chromium 1 ครั้ง)
 *
 * ข้อควรระวัง: ผู้ใช้ทดสอบค้นฟรีได้ 20 ครั้ง/5 นาที (เกินแล้วระบบขอ CAPTCHA 428) รันซ้ำเกิน ~3 รอบติดกันให้รอ 5 นาที · --limit ทำให้ IP นี้ติด limit 5 นาที (ล้างด้วย: docker restart journal_watch_backend)
 * เคส B มี 1 คำขอไป Scopus API (ISSN ที่ไม่มีจริง) อาจกินโควตา 1 request · ไม่เขียน DB
 * token: ออกเองในหน่วยความจำด้วย JWT_SECRET ให้ผู้ใช้ Student ที่ Active (เหมือน 05/06) · เปลี่ยนปลายทางด้วย DEMO_BASE_URL
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const db = require('../../src/config/database');
const { issueAccessToken } = require('../../src/utils/jwt');

const BASE = process.env.DEMO_BASE_URL || 'http://127.0.0.1:13002';
const args = process.argv.slice(2);
const line = (t) => console.log(`\n=== ${t} ===`);

async function call(method, p, token) {
  const res = await fetch(`${BASE}/api/v3${p}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(120000),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, code: body.code || '', message: body.message || '' };
}

const results = [];
// want = status ที่คาดหวัง, wantCode = code ที่คาดหวัง (ถ้ามี)
async function expect(label, req, want, wantCode = '') {
  const r = await req;
  const ok = r.status === want && (!wantCode || r.code === wantCode);
  results.push({ 'เคสทดสอบ': label, 'คาดหวัง': `${want}${wantCode ? ' ' + wantCode : ''}`, 'ได้จริง': `${r.status}${r.code ? ' ' + r.code : ''}`, 'ผล': ok ? 'ผ่าน' : 'ไม่ผ่าน' });
  return r;
}

(async () => {
  const [students] = await db.query(
    "SELECT user_id, username, role, first_name, last_name, msu_mail, degree_level FROM users WHERE account_status = 'Active' AND role = 'Student' ORDER BY user_id LIMIT 2"
  );
  const user = students[0];
  if (!user) throw new Error('ไม่พบผู้ใช้ Student ที่ Active ใน DB');
  const token = issueAccessToken(user);
  // เคส D ใช้ Student อีกคน (ถ้ามี): ตัวนับ CAPTCHA แยกตามผู้ใช้ — ผู้ใช้ที่เพิ่งค้นไปเยอะจะเจอ 428 ก่อนถึง RATE_LIMIT ซึ่งแยกตาม IP
  const limitToken = issueAccessToken(students[1] || user);
  console.log(`ปลายทาง: ${BASE}\nผู้ใช้ทดสอบ: user_id=${user.user_id} role=${user.role}`);

  // CAPTCHA นับต่อผู้ใช้ 20 ครั้ง/5 นาที — รันซ้ำถี่ๆ จะได้ 428 ก่อนถึงขั้น validate ทำให้เคส B เพี้ยน จึงเช็คก่อนเริ่ม
  const probe = await call('GET', '/journal/tci?issn=abc', token);
  if (probe.status === 428) {
    console.log('\nโควตาค้นฟรีของผู้ใช้ทดสอบหมด (ระบบขอ CAPTCHA, 428) — รอ 5 นาที หรือ docker restart journal_watch_backend แล้วรันใหม่');
    return;
  }

  line('A) การยืนยันตัวตน');
  await expect('ไม่แนบ token', call('GET', '/journal/tci?issn=0858-0855'), 401, 'NO_TOKEN');
  await expect('token ปลอม', call('GET', '/journal/tci?issn=0858-0855', 'not.a.jwt'), 401, 'INVALID_TOKEN');
  await expect('ไม่แนบ token (เส้น scrape)', call('GET', '/journal/scopus/scrape?issn=0028-0836'), 401, 'NO_TOKEN');

  line('B) ข้อมูลนำเข้าผิด');
  await expect('ไม่ส่ง ISSN', call('GET', '/journal/tci', token), 400);
  await expect('ISSN ผิดรูปแบบ "abc"', call('GET', '/journal/scopus?issn=abc', token), 400);
  await expect('ISSN ผิดรูปแบบ (ตัวอักษรแทรก) "12ab-5678"', call('GET', '/journal/tci?issn=12ab-5678', token), 400);
  await expect('TCI: ISSN ไม่มีจริง 9999-9990', call('GET', '/journal/tci?issn=9999-9990', token), 404);
  await expect('Scopus: ISSN ไม่มีจริง 9999-9990', call('GET', '/journal/scopus?issn=9999-9990', token), 404);

  line('C) สิทธิ์ตาม role (Student แก้รายการวารสารต้องห้ามไม่ได้)');
  await expect('Student POST /unwanted-journals/single', call('POST', '/unwanted-journals/single', token), 403, 'FORBIDDEN');
  await expect('Student POST /unwanted-journals/import', call('POST', '/unwanted-journals/import', token), 403, 'FORBIDDEN');
  await expect('Student DELETE /unwanted-journals/1', call('DELETE', '/unwanted-journals/1', token), 403, 'FORBIDDEN');
  await expect('Student GET /unwanted-journals/check/0007-9235 (อ่านได้)', call('GET', '/unwanted-journals/check/0007-9235', token), 200);

  if (args.includes('--limit')) {
    line('D) ยิง /scrape ถี่เกิน limit (12 ครั้ง ISSN ผิดรูปแบบ — ไม่เปิด Chromium)');
    const seq = [];
    let limited = null;
    for (let i = 1; i <= 12; i++) {
      const r = await call('GET', '/journal/tci/scrape?issn=abc', limitToken);
      seq.push(r.status);
      if (r.status === 429 && !limited) limited = { at: i, code: r.code };
    }
    console.log(`  status ตามลำดับ: ${seq.join(' ')}`);
    results.push({
      'เคสทดสอบ': 'ยิง /tci/scrape 12 ครั้งติด',
      'คาดหวัง': '400 ... แล้ว 429 RATE_LIMIT',
      'ได้จริง': limited ? `429 ${limited.code} ที่ครั้งที่ ${limited.at}` : `ไม่เจอ 429 (${[...new Set(seq)].join(',')})`,
      'ผล': limited?.code === 'RATE_LIMIT' && !seq.some(s => s >= 500) ? 'ผ่าน' : 'ไม่ผ่าน',
    });
  }

  if (args.includes('--busy')) {
    line('E) ผู้ใช้เดียวยิง scrape พร้อมกัน 2 คำขอ (รอ Chromium สักครู่)');
    const [a, b] = await Promise.all([
      call('GET', '/journal/tci/scrape?issn=0858-0855', token),
      call('GET', '/journal/tci/scrape?issn=0858-0855', token),
    ]);
    const got = [a, b].map(r => `${r.status}${r.code ? ' ' + r.code : ''}`).sort();
    results.push({
      'เคสทดสอบ': 'scrape พร้อมกัน 2 คำขอ (ผู้ใช้เดียว)',
      'คาดหวัง': '200 + 429 SCRAPER_USER_BUSY',
      'ได้จริง': got.join(' + '),
      'ผล': [a, b].some(r => r.status === 200) && [a, b].some(r => r.code === 'SCRAPER_USER_BUSY') ? 'ผ่าน' : 'ไม่ผ่าน',
    });
  }

  line('สรุปผล');
  console.table(results);
  const failed = results.filter(r => r['ผล'] !== 'ผ่าน').length;
  console.log(failed ? `ไม่ผ่าน ${failed}/${results.length} เคส` : `ผ่านทั้งหมด ${results.length}/${results.length} เคส`);
})()
  .catch(e => console.error('ผิดพลาด:', e.cause?.code || '', e.message))
  .finally(() => db.end());
