/**
 * Rate Limiter
 * ป้องกัน brute force attack บน login และ OTP endpoints
 * Dev mode: skip rate limit สำหรับ localhost และ Docker internal network
 */
const rateLimit = require('express-rate-limit');

const isDev = process.env.NODE_ENV !== 'production';

// NODE_ENV พิมพ์ผิด/ไม่ได้ตั้งใน production จะทำให้ isDev เป็น true แบบเงียบๆ
// (skip rate limit ให้ private IP ทั้งหมด) — log ให้เห็นชัดตอน startup กันหลุดโดยไม่รู้ตัว
if (isDev && process.env.NODE_ENV && process.env.NODE_ENV !== 'development') {
  console.warn(
    `[rateLimit] NODE_ENV="${process.env.NODE_ENV}" ไม่ใช่ "production" หรือ "development" ` +
    `— ระบบจะถือว่าเป็น dev mode และ skip rate limit ให้ localhost/private IP ตรวจสอบว่าตั้งค่าถูกต้องก่อน deploy จริง`
  );
}

// เช็คว่าเป็น loopback หรือ RFC1918 private range จริงๆ (10.0.0.0/8, 172.16.0.0/12,
// 192.168.0.0/16) — ของเดิมเช็คแค่ ip.startsWith('172.') ซึ่งครอบคลุมทั้ง 172.0.0.0/8
// (รวม public IP จริงของหลายเจ้า เช่น Cloudflare/Google ที่ขึ้นต้นด้วย 172 เหมือนกัน)
function isPrivateOrLoopback(ip) {
  if (!ip) return false;
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (ip === '::1' || v4 === '127.0.0.1' || v4.startsWith('127.')) return true;
  const parts = v4.split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// Skip localhost + Docker internal network ตอน dev
// ใช้ req.socket.remoteAddress (peer address จริงของ TCP connection) แทน req.ip
// เพราะ req.ip อ่านจาก header X-Forwarded-For ที่ client ปลอมได้เอง (ตั้ง trust proxy
// ไว้ที่ app.js) ถ้า server ไม่ได้อยู่หลัง reverse proxy จริง (ปกติตอน dev/staging)
// ก็จะปลอม header เป็น 127.0.0.1 บายพาส rate limit ได้ — remoteAddress ปลอมไม่ได้
const skipLocalhost = (req) => {
  if (!isDev) return false;
  const ip = req.socket?.remoteAddress || req.connection?.remoteAddress || '';
  return isPrivateOrLoopback(ip);
};

// 5 login attempts per 15 min per IP (username/password)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skip: skipLocalhost,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'เข้าสู่ระบบเกินจำนวนครั้งที่กำหนด กรุณารอ 15 นาทีแล้วลองใหม่',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 30 attempts per 15 min per IP (Google OAuth — ไม่มี brute force risk)
const googleLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skip: skipLocalhost,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'เข้าสู่ระบบเกินจำนวนครั้งที่กำหนด กรุณารอ 15 นาทีแล้วลองใหม่',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 10 OTP attempts per 10 min per IP
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  skip: skipLocalhost,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'ป้อน OTP เกินจำนวนครั้งที่กำหนด กรุณารอแล้วลองใหม่',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 20 register attempts per 15 min per IP
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skip: skipLocalhost,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'ลงทะเบียนเกินจำนวนครั้งที่กำหนด กรุณารอ 15 นาทีแล้วลองใหม่',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 30 refresh attempts per 15 min per IP — เหมือน endpoint auth อื่นๆ ที่มี rate
// limiter ครบทุกตัว จุดนี้เดิมไม่มีเลย ทั้งที่เป็น endpoint ที่ query DB ทุกครั้ง
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skip: skipLocalhost,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'ขอ refresh token เกินจำนวนครั้งที่กำหนด กรุณารอ 15 นาทีแล้วลองใหม่',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 5 forgot-password requests per 15 min per IP
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skip: skipLocalhost,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'ส่งคำขอรีเซ็ตรหัสผ่านเกินจำนวนครั้งที่กำหนด กรุณารอ 15 นาทีแล้วลองใหม่',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 10 scrape requests per 5 min per IP — endpoint เปิด headless browser จริงทุกครั้ง แพงมาก
const scrapeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  skip: skipLocalhost,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'เรียก scraping เกินจำนวนครั้งที่กำหนด กรุณารอ 5 นาทีแล้วลองใหม่',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { loginLimiter, googleLimiter, otpLimiter, registerLimiter, forgotPasswordLimiter, scrapeLimiter, refreshLimiter };
