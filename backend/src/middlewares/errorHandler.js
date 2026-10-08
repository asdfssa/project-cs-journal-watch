/**
 * Global Error Handler
 * จับ error ที่ throw/next(err) จาก controller/service แล้วแปลงเป็น HTTP response ภาษาไทย
 */
const { AuthError } = require('../services/AuthService');
const { parseError } = require('../utils/errorResponse');
const logger = require('../utils/logger');

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

function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    code:    'ROUTE_NOT_FOUND',
    message: `ไม่พบ endpoint ${req.method} ${req.originalUrl}`,
  });
}

module.exports = { errorHandler, notFoundHandler };
