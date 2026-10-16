/**
 * CAPTCHA เมื่อค้นถี่ (Cloudflare Turnstile — ตรวจที่ backend)
 *
 * นับจำนวน request ค้นวารสารต่อผู้ใช้ใน RAM: ช่วง windowMs แรกใช้ได้ freeRequests ครั้ง
 * เกินจากนั้นต้องแนบ header X-Captcha-Token (Turnstile token) — ผ่านแล้วได้โควตาใหม่อีกชุด
 * (หน้าค้นหายิง scopus + tci ต่อการค้น 1 ครั้ง ส่วน token ใช้ได้ครั้งเดียว — ให้โควตาใหม่จึงไม่ต้องขอ token ทุก request)
 *
 * ตัวนับอยู่ใน RAM ได้: ใช้แค่ตัดสินว่า "ควรขอ CAPTCHA หรือยัง" — restart แล้วหายแค่ได้ค้นฟรีเพิ่มอีกชุด
 * ไม่ตั้ง TURNSTILE_SECRET = ปิดฟีเจอร์นี้ (ผ่านทุก request) จนกว่า frontend จะรองรับ 428
 */
const config = require('../config');
const { clientIp } = require('./rateLimit');

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const counters = new Map(); // user_id → { count, resetAt }

/**
 * ถาม Cloudflare Turnstile (siteverify) ว่า token ที่ client แนบมาใช้ได้ไหม
 * เรียกจาก: captchaIfFrequent ในไฟล์นี้
 * ส่งออกไป Cloudflare: secret (config.captcha.turnstileSecret) + response (token) + remoteip (ถ้ามี) · timeout 5 วินาที
 * @param {string} token ค่าจาก header X-Captcha-Token
 * @param {string} [ip] IP จริงของ client (จาก rateLimit.clientIp)
 * @returns {Promise<boolean>} true = Cloudflare ยืนยัน · throw = ติดต่อ Cloudflare ไม่ได้ (ผู้เรียกตอบ 503)
 */
async function verifyTurnstile(token, ip) {
  const body = new URLSearchParams({ secret: config.captcha.turnstileSecret, response: token });
  if (ip) body.append('remoteip', ip);
  const r = await fetch(VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
  const data = await r.json();
  return data.success === true;
}

/**
 * Middleware จำกัดการค้นวารสารถี่ๆ ต่อผู้ใช้ — เกินโควตาฟรีต้องผ่าน CAPTCHA
 * เรียกจาก: routes/journalRoutes.js (GET /journal/scopus, /tci, /scopus/scrape, /tci/scrape) ต่อจาก requireAuth
 * อ่าน req.user.sub (ที่ requireAuth ใส่ไว้) เป็น key ของตัวนับใน RAM: Map(user_id → { count, resetAt })
 * ขั้นตอน: ไม่ตั้ง TURNSTILE_SECRET → ผ่านเลย · ยังไม่เกิน freeRequests → นับแล้วผ่าน
 *   · เกินโควตา → ต้องมี header X-Captcha-Token → verifyTurnstile → ผ่านแล้วตั้งตัวนับใหม่ (นับ request นี้เป็น 1)
 * ตอบ 428 CAPTCHA_REQUIRED / CAPTCHA_INVALID, 503 CAPTCHA_UNAVAILABLE · ผ่านแล้ว next() → (scrapeLimiter) → JournalController
 */
async function captchaIfFrequent(req, res, next) {
  const { turnstileSecret, freeRequests, windowMs } = config.captcha;
  if (!turnstileSecret) return next();

  const now = Date.now();
  if (counters.size > 5000) {
    for (const [k, v] of counters) if (v.resetAt <= now) counters.delete(k);
  }
  let c = counters.get(req.user.sub);
  if (!c || c.resetAt <= now) {
    c = { count: 0, resetAt: now + windowMs };
    counters.set(req.user.sub, c);
  }

  if (c.count < freeRequests) {
    c.count++;
    return next();
  }

  const token = req.get('X-Captcha-Token');
  if (!token) {
    return res.status(428).json({
      success: false,
      code: 'CAPTCHA_REQUIRED',
      message: 'คุณค้นหาบ่อยเกินไป กรุณายืนยันว่าไม่ใช่บอท',
    });
  }

  let ok;
  try {
    ok = await verifyTurnstile(token, clientIp(req));
  } catch (err) {
    return res.status(503).json({
      success: false,
      code: 'CAPTCHA_UNAVAILABLE',
      message: 'ไม่สามารถตรวจสอบ CAPTCHA ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง',
    });
  }
  if (!ok) {
    return res.status(428).json({
      success: false,
      code: 'CAPTCHA_INVALID',
      message: 'การยืนยัน CAPTCHA ไม่ผ่าน กรุณาลองใหม่',
    });
  }

  counters.set(req.user.sub, { count: 1, resetAt: now + windowMs }); // ผ่านแล้วได้โควตาใหม่ (นับ request นี้ด้วย)
  next();
}

module.exports = { captchaIfFrequent };
