/**
 * ล้างข้อมูลใน DB ทุกตาราง ยกเว้นผู้ใช้ role SuperAdmin (และ session/OTP ของ SuperAdmin เอง)
 * ใช้ก่อนส่งงานหรือก่อนเริ่มทดสอบรอบใหม่ — ย้อนกลับไม่ได้ จึงสำรองให้ก่อนเสมอ
 *
 * รัน:  node scripts/wipe-db-keep-superadmin.js            (แสดงจำนวนแถว แล้วถามให้พิมพ์ WIPE ยืนยัน)
 *       node scripts/wipe-db-keep-superadmin.js --dry-run   (แสดงว่าจะลบอะไร ไม่ลบจริง)
 *       node scripts/wipe-db-keep-superadmin.js --yes        (ไม่ถามยืนยัน)
 *       node scripts/wipe-db-keep-superadmin.js --no-backup  (ข้ามการสำรอง — ไม่แนะนำ)
 *
 *       node scripts/wipe-db-keep-superadmin.js --keep-uploads (ล้างเฉพาะ DB ไม่ลบไฟล์ใน uploads/)
 *
 * ขั้นตอน: ตรวจว่ามี SuperAdmin อย่างน้อย 1 คน → สำรองด้วย mysqldump ใน container jw_db ไปที่ ../backups_db/
 *          → ลบใน transaction เดียว (พังแล้ว rollback) → ตั้ง AUTO_INCREMENT ใหม่ → ลบไฟล์ทั้งหมดใน uploads/ (หลักฐาน T3, ไฟล์วารสารต้องห้าม)
 * uploads/ เก็บโฟลเดอร์หลักไว้ (docker mount ไว้) ลบเฉพาะของข้างใน · ไม่สำรองไฟล์ใน uploads/ (สำรองเฉพาะ DB)
 * ไม่แตะ: ไฟล์ data/scopus-proxy-state.json
 */
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { execFileSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../src/config/database');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ASSUME_YES = args.includes('--yes');
const NO_BACKUP = args.includes('--no-backup');
const KEEP_UPLOADS = args.includes('--keep-uploads');

// โฟลเดอร์ไฟล์ที่อัปโหลด (UPLOADS_DIR ใช้ตอนทดสอบสคริปต์เท่านั้น) — ต้องชื่อ "uploads" กันลบผิดที่
const UPLOADS = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'));
if (path.basename(UPLOADS) !== 'uploads') throw new Error(`UPLOADS_DIR ต้องเป็นโฟลเดอร์ชื่อ "uploads" (ได้ ${UPLOADS})`);

/** นับไฟล์/ขนาดทั้งหมดใต้ dir (ไม่มีโฟลเดอร์ = 0) */
function countFiles(dir) {
  let files = 0, bytes = 0;
  if (!fs.existsSync(dir)) return { files, bytes };
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const c = countFiles(p); files += c.files; bytes += c.bytes; }
    else { files++; bytes += fs.statSync(p).size; }
  }
  return { files, bytes };
}

// ตารางลูกก่อนตารางแม่ · SQL ส่วน WHERE = แถวที่ "จะถูกลบ" (ไม่มี = ลบหมด)
const SUPER = `(SELECT user_id FROM users WHERE role = 'SuperAdmin')`;
const TABLES = [
  ['otp_requests',          `user_id NOT IN ${SUPER}`],
  ['auth_tokens',           `user_id NOT IN ${SUPER}`],
  ['t3_evidence_files',     null],
  ['request_approvals',     null],
  ['t3_requests',           null],
  ['pre_t3_requests',       null],
  ['msu_unwanted_journals', null],
  ['advisor_assignments',   null],
  ['users',                 `role <> 'SuperAdmin'`],
];

const ask = (q) => new Promise((res) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => { rl.close(); res(a.trim()); });
});

function backup() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15); // YYYYMMDD_HHMMSS (UTC)
  const dir = path.join(__dirname, '..', '..', 'backups_db');
  const file = path.join(dir, `${process.env.DB_NAME}_before_wipe_${stamp}.sql`);
  fs.mkdirSync(dir, { recursive: true });
  const dump = execFileSync('docker', ['exec', 'jw_db', 'sh', '-c',
    `mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --events --triggers --default-character-set=utf8mb4 ${process.env.DB_NAME} 2>/dev/null`],
    { maxBuffer: 256 * 1024 * 1024 });
  if (!dump.toString('utf8').includes('Dump completed')) throw new Error('ไฟล์สำรองไม่สมบูรณ์ (ไม่มีบรรทัด "Dump completed")');
  fs.writeFileSync(file, dump);
  return file;
}

(async () => {
  console.log(`ฐานข้อมูล: ${process.env.DB_NAME} @ ${process.env.DB_HOST}${DRY_RUN ? '   [DRY-RUN: ไม่ลบจริง]' : ''}\n`);

  const [supers] = await db.query(`SELECT user_id, username, msu_mail FROM users WHERE role = 'SuperAdmin'`);
  if (!supers.length) throw new Error('ไม่พบ SuperAdmin ใน DB — ยกเลิก (ถ้าลบแล้วจะไม่มีใครล็อกอินได้)');
  console.log('SuperAdmin ที่จะเก็บไว้:'); console.table(supers);

  const rows = [];
  for (const [t, where] of TABLES) {
    const [[all]] = await db.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    const [[del]] = await db.query(`SELECT COUNT(*) AS n FROM \`${t}\`${where ? ` WHERE ${where}` : ''}`);
    rows.push({ ตาราง: t, ทั้งหมด: all.n, 'จะลบ': del.n, 'เหลือ': all.n - del.n });
  }
  console.table(rows);

  const up = countFiles(UPLOADS);
  console.log(KEEP_UPLOADS
    ? `uploads/: ${up.files} ไฟล์ (${(up.bytes / 1048576).toFixed(1)} MB) — เก็บไว้ (--keep-uploads)`
    : `uploads/: ${up.files} ไฟล์ (${(up.bytes / 1048576).toFixed(1)} MB) จะถูกลบทั้งหมด  [${UPLOADS}]`);

  if (!DRY_RUN && !ASSUME_YES) {
    if (!process.stdin.isTTY) throw new Error('ไม่ได้รันใน terminal — ใส่ --yes เพื่อยืนยัน');
    const a = await ask('พิมพ์ WIPE เพื่อยืนยันการลบ (อย่างอื่น = ยกเลิก): ');
    if (a !== 'WIPE') { console.log('ยกเลิก ไม่มีอะไรถูกลบ'); return; }
  }

  if (!DRY_RUN) {
    if (NO_BACKUP) console.log('ข้ามการสำรอง (--no-backup)');
    else { const f = backup(); console.log(`สำรองแล้ว: ${f}`); }
  }

  const conn = await db.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.beginTransaction();
    for (const [t, where] of TABLES) await conn.query(`DELETE FROM \`${t}\`${where ? ` WHERE ${where}` : ''}`);
    if (DRY_RUN) { await conn.rollback(); console.log('\nDRY-RUN: ทดลองลบแล้ว rollback — ข้อมูลไม่เปลี่ยน'); }
    else { await conn.commit(); console.log('\nลบเรียบร้อย'); }
  } catch (e) {
    await conn.rollback(); throw e;
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    conn.release();
  }

  if (!DRY_RUN) {
    // ALTER ทำ implicit commit จึงทำหลัง commit · MySQL ตั้งค่าเป็น max(id)+1 ให้เอง (users ที่เหลือ SuperAdmin จึงไม่ชน id)
    for (const [t] of TABLES) await db.query(`ALTER TABLE \`${t}\` AUTO_INCREMENT = 1`);
    const [after] = await db.query(`SELECT user_id, username, role FROM users`);
    console.log('ผู้ใช้ที่เหลือ:'); console.table(after);
    if (KEEP_UPLOADS) console.log('ไฟล์ใน uploads/ ไม่ถูกลบ (--keep-uploads)');
    else if (fs.existsSync(UPLOADS)) {
      for (const e of fs.readdirSync(UPLOADS)) fs.rmSync(path.join(UPLOADS, e), { recursive: true, force: true });
      console.log(`ลบไฟล์ใน uploads/ แล้ว ${up.files} ไฟล์ (เก็บโฟลเดอร์ uploads ไว้)`);
    }
  }
})()
  .catch((e) => { console.error('\nผิดพลาด:', e.message); process.exitCode = 1; })
  .finally(() => db.end());
