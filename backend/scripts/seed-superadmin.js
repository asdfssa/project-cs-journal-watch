/**
 * One-off seed script — สร้าง SuperAdmin คนแรกของระบบ (bootstrap)
 * ไม่มี public endpoint สำหรับสร้าง Admin/SuperAdmin ตั้งใจไว้ (ต้อง insert ตรงๆ)
 *
 * รันข้างใน container: docker compose exec backend node scripts/seed-superadmin.js
 */
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../src/config/database');

const USERNAME  = process.env.SEED_USERNAME  || 'superadmin';
const MSU_MAIL  = process.env.SEED_MSU_MAIL  || 'yossaphonh@gmail.com';
const FIRST_NAME = process.env.SEED_FIRST_NAME || 'Super';
const LAST_NAME  = process.env.SEED_LAST_NAME  || 'Admin';
const PASSWORD  = process.env.SEED_PASSWORD  || crypto.randomBytes(9).toString('base64url');

async function main() {
  const [existing] = await db.query(
    `SELECT user_id, username, msu_mail FROM users WHERE username = ? OR msu_mail = ?`,
    [USERNAME, MSU_MAIL]
  );
  if (existing.length) {
    console.log('มี user นี้อยู่แล้ว ไม่สร้างซ้ำ:', existing[0]);
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  await db.query(
    `INSERT INTO users (username, password_hash, msu_mail, role, first_name, last_name, account_status)
     VALUES (?, ?, ?, 'SuperAdmin', ?, ?, 'Active')`,
    [USERNAME, passwordHash, MSU_MAIL, FIRST_NAME, LAST_NAME]
  );

  console.log('สร้าง SuperAdmin สำเร็จ:');
  console.log('  username:', USERNAME);
  console.log('  password:', PASSWORD);
  console.log('  msu_mail:', MSU_MAIL, '(OTP จะส่งมาที่นี่)');
  process.exit(0);
}

main().catch((err) => {
  console.error('สร้าง SuperAdmin ไม่สำเร็จ:', err.message);
  process.exit(1);
});
