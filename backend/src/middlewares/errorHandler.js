/**
 * Global Error Handler
 * จับ error ที่ throw/next(err) จาก controller/service แล้วแปลงเป็น HTTP response ภาษาไทย
 */
const { AuthError } = require('../services/AuthService');
const { parseError } = require('../utils/errorResponse');
const logger = require('../utils/logger');

/**
 * Error middleware ตัวสุดท้ายของ app (app.use(errorHandler) ใน app.js)
 * ถูกเรียกเมื่อ: middleware/controller เรียก next(err) หรือ throw ในฟังก์ชัน sync · (controller ส่วนใหญ่ catch เองแล้วเรียก utils/errorResponse.serverError จึงไม่ถึงที่นี่)
 * AuthError (services/AuthService) → ตอบตาม statusCode/code/message ของมันเอง (+ retryAfter ถ้ามี)
 * error อื่น → utils/errorResponse.parseError แปลงเป็น code/message ภาษาไทย + log · นอก production แนบ `debug` ใน body
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
function errorHandler(err, req, res, next) {
  // AuthError ที่เรา throw เอง — มี statusCode และ message ที่กำหนดไว้แล้ว
  if (err instanceof AuthError) {
    return res.status(err.statusCode).json({
      success: false,
      code:    err.code,
      message: err.message,
      ...(err.retryAfter && { retryAfter: err.retryAfter }),
    });
  }

  // Error อื่น — แปลงเป็น Thai message
  const parsed = parseError(err);
  logger.error(`[GlobalErrorHandler] ${parsed.code}: ${parsed.raw}`, {
    path:   req.originalUrl,
    method: req.method,
    stack:  err.stack,
  });

  const body = {
    success: false,
    code:    parsed.code,
    message: parsed.message,
  };

  if (process.env.NODE_ENV !== 'production') {
    body.debug = {
      location:    `${req.method} ${req.originalUrl}`,
      error_type:  err.name || err.code || 'Error',
      raw_message: parsed.raw,
      timestamp:   new Date().toISOString(),
    };
  }

  return res.status(parsed.status || 500).json(body);
}

/**
 * ตอบ 404 ROUTE_NOT_FOUND สำหรับ /api/v3/* ที่ไม่มี route ตรง (app.use('/api/v3', notFoundHandler) ใน app.js)
 * ไม่รับ error — ถูกเรียกเมื่อไม่มี router ตัวไหนตอบ request ไปก่อน
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    code:    'ROUTE_NOT_FOUND',
    message: `ไม่พบ endpoint ${req.method} ${req.originalUrl}`,
  });
}

module.exports = { errorHandler, notFoundHandler };
