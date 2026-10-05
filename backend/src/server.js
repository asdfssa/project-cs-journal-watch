/**
 * Server Entry Point
 */
const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const RefreshTokenModel = require('./models/RefreshTokenModel');
const OtpModel = require('./models/OtpModel');

const server = app.listen(config.port, () => {
  logger.success(`Server running on http://localhost:${config.port}`);
  logger.info(`Environment: ${config.env}`);
  logger.info(`Mail mode: ${config.mail.mode}`);
  logger.info(`UI test page: http://localhost:${config.port}/`);
});

// Cleanup job — ลบ refresh/reset token และ OTP ที่หมดอายุ/ใช้ไปแล้วทิ้ง กัน DB บวม
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 ชม.

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

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down...');
  server.close(() => process.exit(0));
});
