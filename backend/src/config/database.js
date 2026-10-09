/**
 * Database Connection Pool
 * ใช้ mysql2/promise สำหรับ async/await และ connection pooling
 */
const mysql = require('mysql2/promise');
const config = require('./index');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  
  // ปิด SSL สำหรับ MySQL ใน Docker (self-signed cert)
  ssl: false,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  queueLimit: 0,
  charset: 'utf8mb4',
  // คอลัมน์ DATE (recorded_date, meeting_date) ส่งเป็น "YYYY-MM-DD" ตรงๆ ไม่ผ่าน JS Date — ไม่มีปัญหา timezone
  // (ถ้าเป็น Date จะกลายเป็น ISO "…T00:00:00.000Z" ที่วันถอยหลังได้เมื่อ client แปลงเป็นเวลาท้องถิ่น)
  // ใช้ ['DATE'] ไม่ใช่ true: true จะทำให้ TIMESTAMP/DATETIME (created_at, decided_at ฯลฯ) กลายเป็น "YYYY-MM-DD HH:MM:SS"
  // ไม่มี Z แล้วเบราว์เซอร์อ่านเป็นเวลาท้องถิ่น → ทุกหน้าที่แสดงเวลาเพี้ยน 7 ชม.
  dateStrings: ['DATE'],
  // DECIMAL (weight_score, impact_factor, citescore) คืนเป็น number ตามที่ FE ประกาศไว้ (เดิม mysql2 คืนเป็นสตริง "0.60")
  // ปลอดภัยกับ DECIMAL(10,4) ของระบบนี้ — ไม่มีคอลัมน์ที่เกินความแม่นยำของ double
  decimalNumbers: true,
});

// ทดสอบ connection ตอน startup
pool
  .getConnection()
  .then((conn) => {
    console.log(`✓ Database connected: ${config.db.database}@${config.db.host}`);
    conn.release();
  })
  .catch((err) => {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  });

module.exports = pool;  