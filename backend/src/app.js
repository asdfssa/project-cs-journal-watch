/**
 * Express Application
 * ตั้งค่า middleware ทั่วไป + mount routes
 */
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const config = require('./config');
const routes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middlewares/errorHandler');
const cookieParser = require('cookie-parser');
const app = express();

// Trust proxy (สำหรับเอา real IP ตอน deploy หลัง reverse proxy)
app.set('trust proxy', 1);

// Security headers
// CSP: script ห้าม inline (กัน XSS ขโมย token ใน localStorage) — อนุญาตเฉพาะ origin ที่หน้าเว็บใช้จริง
// (Google Fonts, icon จาก jsDelivr, Google Sign-In, Cloudflare Turnstile, รูปโปรไฟล์ Google)
// เพิ่ม origin ใหม่ให้ FE ต้องแก้ตรงนี้ — ถ้าเจอ CSP violation ใน console ให้ดู directive ที่ถูกบล็อก
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        // static.cloudflareinsights.com = Cloudflare Web Analytics beacon ที่ Cloudflare ฉีดเข้าหน้าเว็บเอง
        scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client', 'https://challenges.cloudflare.com', 'https://static.cloudflareinsights.com'],
        // index.html ที่ Angular build มี <link media="print" onload="this.media='all'"> — อนุญาตเฉพาะ handler นี้ด้วย hash
        scriptSrcAttr: ["'unsafe-hashes'", "'sha256-MhtPZXr7+LpJUY5qtMutB+qWfQtMaPccfe7QXtCcEYc='"],
        // Angular ใส่ <style> ของ component ตอน runtime → ต้อง 'unsafe-inline' (เสี่ยงต่ำกว่า inline script มาก)
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net', 'https://accounts.google.com/gsi/style'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://*.googleusercontent.com'],
        connectSrc: ["'self'", 'https://accounts.google.com/gsi/', 'https://cloudflareinsights.com'],
        frameSrc: ['https://accounts.google.com/gsi/', 'https://challenges.cloudflare.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, // ให้ popup Google Sign-In ทำงาน
  })
);

// CORS
app.use(
  cors({
    origin: config.cors.origin,
    credentials: true,
  })
);

// Query: key ซ้ำ (?a=1&a=2) ใช้ค่าแรก และไม่รับ nested object (?a[b]=1) — controller ทุกตัวคาดว่าเป็น string
app.set('query parser', 'simple');
app.use((req, _res, next) => {
  for (const k in req.query) if (Array.isArray(req.query[k])) req.query[k] = req.query[k][0];
  next();
});

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser()); 

// API routes
app.use('/api/v3', routes);

// 404 handler (สำหรับ /api/v3/* ที่ไม่มี)
app.use('/api/v3', notFoundHandler);

// Frontend (Angular build ที่ copy มาตอน docker build) — path อื่นที่ไม่ใช่ไฟล์จริงตกไป index.html
const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir, { index: false }));
app.get(/^\/(?!api\/).*/, (req, res, next) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(frontendDir, 'index.html'), (err) => err && next());
});

// Global error handler
app.use(errorHandler);

module.exports = app;
