/**
 * Server Entry Point
 */
const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const RefreshTokenModel = require('./models/RefreshTokenModel');
const OtpModel = require('./models/OtpModel');

/**
 * จุดเริ่มต้นของโปรเซส (npm start → node src/server.js): โหลด app.js แล้ว listen ที่ config.port
 * การเชื่อม DB เกิดตอน require config/database.js (ผ่าน model ต่างๆ) — ต่อไม่ได้โปรเซสจะ exit(1)
 */
const server = app.listen(config.port, () => {
  logger.success(`Server running on http://localhost:${config.port}`);
  logger.info(`Environment: ${config.env}`);
  logger.info(`Mail mode: ${config.mail.mode}`);
  logger.info(`UI test page: http://localhost:${config.port}/`);
});

// Cleanup job — ลบ refresh/reset token และ OTP ที่หมดอายุ/ใช้ไปแล้วทิ้ง กัน DB บวม
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 ชม. (index บน expires_at ทำให้การลบถูกมาก)

/**
 * งานล้างข้อมูลหมดอายุ รันตอนสตาร์ตและซ้ำทุก CLEANUP_INTERVAL_MS
 * เรียก RefreshTokenModel.deleteExpired (ตาราง auth_tokens) และ OtpModel.deleteExpired (ตาราง otp_requests) พร้อมกัน แล้ว log จำนวนแถวที่ลบ
 */
async function runCleanup() {
  try {
    const [tokens, otps] = await Promise.all([
      RefreshTokenModel.deleteExpired(),
      OtpModel.deleteExpired(),
    ]);
    logger.info(`[Cleanup] ลบ auth_tokens หมดอายุ ${tokens} แถว, otp_requests ${otps} แถว`);
  } catch (err) {
    logger.error(`[Cleanup] ล้มเหลว: ${err.message}`);
  }
}

runCleanup();
setInterval(runCleanup, CLEANUP_INTERVAL_MS);

// promise ที่ reject โดยไม่มีใครจับ — Node 20 จะ kill process ทั้งตัว (ทุกคนหลุด + container restart)
// log ไว้แทน; ส่วน uncaughtException ปล่อยให้ล่มตามเดิม (state ไม่น่าเชื่อแล้ว ให้ Docker restart)
process.on('unhandledRejection', (reason) => {
  logger.error(`[unhandledRejection] ${reason?.stack || reason}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down...');
  server.close(() => process.exit(0));
});
