/**
 * Seed script — insert a Student/Supervisor user directly (no username/password,
 * matches how Google OAuth accounts are shaped — see chk_login_method).
 * ปกติ role พวกนี้สร้างได้แค่ผ่าน Admin (POST /manage/users/single) เท่านั้น
 *
 * รันข้างใน container:
 *   docker compose exec backend node scripts/seed-user.js <Student|Supervisor> <msu_mail> <first_name> <last_name>
 */
const db = require('../src/config/database');

const [role, msuMail, firstName, lastName] = process.argv.slice(2);
const ALLOWED_ROLES = ['Student', 'Supervisor'];

async function main() {
  if (!role || !msuMail || !firstName || !lastName) {
    console.error('Usage: node scripts/seed-user.js <Student|Supervisor> <msu_mail> <first_name> <last_name>');
    process.exit(1);
  }
  if (!ALLOWED_ROLES.includes(role)) {
    console.error(`role ต้องเป็น ${ALLOWED_ROLES.join(' หรือ ')}`);
    process.exit(1);
  }

  const [existing] = await db.query(`SELECT user_id, role FROM users WHERE msu_mail = ?`, [msuMail]);
  if (existing.length) {
    console.log('มี user นี้อยู่แล้ว ไม่สร้างซ้ำ:', existing[0]);
    process.exit(0);
  }

  const [result] = await db.query(
    `INSERT INTO users (msu_mail, role, first_name, last_name, account_status)
     VALUES (?, ?, ?, ?, 'Active')`,
    [msuMail, role, firstName, lastName]
  );

  console.log(`สร้าง ${role} สำเร็จ: user_id=${result.insertId}, msu_mail=${msuMail}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('สร้าง user ไม่สำเร็จ:', err.message);
  process.exit(1);
});
