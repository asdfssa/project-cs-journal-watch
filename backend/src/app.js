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
app.use(
  helmet({
    contentSecurityPolicy: false, // ปิดเพราะหน้า test ใช้ inline script
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
