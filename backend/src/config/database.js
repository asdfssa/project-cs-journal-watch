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