/**
 * Application Configuration
 * โหลด environment variables และ validate ค่าที่จำเป็น
 */
require('dotenv').config();

const required = ['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(`❌ Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

// JWT_SECRET ใช้เซ็น access/OTP/reset token — ค่าตัวอย่างใน .env.example อยู่บน GitHub public
// ใครรู้ก็ปลอม token ได้ → production ห้าม start ด้วยค่าตัวอย่างหรือค่าสั้นเกินไป
if (process.env.NODE_ENV === 'production' &&
    (process.env.JWT_SECRET.startsWith('dev_jwt_secret') || process.env.JWT_SECRET.length < 32)) {
  console.error('❌ JWT_SECRET ยังเป็นค่าตัวอย่างหรือสั้นกว่า 32 ตัว — สร้างใหม่ด้วย: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  process.exit(1);
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,

  db: {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
    socketPath: process.env.DB_SOCKET || undefined,
    connectionLimit: 10,
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',  // เปลี่ยนจาก 2h → 15m
    otpExpiresIn: process.env.JWT_OTP_EXPIRES_IN || '10m',
    refreshExpiresMs: parseInt(process.env.JWT_REFRESH_EXPIRES_MS, 10) || 7 * 24 * 60 * 60 * 1000, // 7 วัน
  },

  otp: {
    length: parseInt(process.env.OTP_LENGTH, 10) || 6,
    expiresMinutes: parseInt(process.env.OTP_EXPIRES_MINUTES, 10) || 10,
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS, 10) || 5,
  },

  mail: {
    mode: process.env.MAIL_MODE || 'console',
    from: process.env.MAIL_FROM || 'noreply@example.com',
    smtp: {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  },

  cors: {
    // รับได้หลาย origin คั่นด้วย , (frontend ที่เสิร์ฟจาก container เดียวกันเป็น same-origin ไม่ต้องใส่)
    origin: (process.env.CORS_ORIGIN || 'http://localhost:4200').split(',').map(o => o.trim()),
  },
    google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    // GOOGLE_ALLOWED_DOMAIN รับได้หลาย domain คั่นด้วย , (เช่น "msu.ac.th,gmail.com" ตอน dev
    // เพื่อทดสอบด้วย Google account ส่วนตัว) — allowedDomain ตัวแรกใช้โชว์ใน error message
    allowedDomains: (process.env.GOOGLE_ALLOWED_DOMAIN || 'msu.ac.th').split(',').map(d => d.trim()),
    get allowedDomain() { return this.allowedDomains[0]; },
  },
  scopus: {
    apiKeys: [
      process.env.SCOPUS_API_KEY_1,
      process.env.SCOPUS_API_KEY_2,
      process.env.SCOPUS_API_KEY_3,
      process.env.SCOPUS_API_KEY_4,
      process.env.SCOPUS_API_KEY_5,
      process.env.SCOPUS_API_KEY_6,
      process.env.SCOPUS_API_KEY_7,
      process.env.SCOPUS_API_KEY_8,
      process.env.SCOPUS_API_KEY_9,
      process.env.SCOPUS_API_KEY_10,
    ].filter(Boolean),
    baseUrl: 'https://api.elsevier.com',
  },

  scraper: {
    headless: process.env.SCRAPER_HEADLESS !== 'false',
    slowMo: parseInt(process.env.SCRAPER_SLOW_MO, 10) || 400,
    maxConcurrent: parseInt(process.env.SCRAPER_MAX_CONCURRENT, 10) || 2,  // Chromium พร้อมกันสูงสุด
    maxQueue: parseInt(process.env.SCRAPER_MAX_QUEUE, 10) || 10,           // คิวรอเกินนี้ → 429 SCRAPER_BUSY
  },

  // CAPTCHA เมื่อค้นวารสารถี่ (Cloudflare Turnstile) — ไม่ตั้ง TURNSTILE_SECRET = ปิด
  captcha: {
    turnstileSecret: process.env.TURNSTILE_SECRET || '',
    freeRequests: parseInt(process.env.CAPTCHA_FREE_REQUESTS, 10) || 20,  // ต่อผู้ใช้ต่อ window (การค้น 1 ครั้ง ≈ 2 request)
    windowMs: 5 * 60 * 1000,
  },
};
