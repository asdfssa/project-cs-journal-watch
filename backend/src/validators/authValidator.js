/**
 * Auth Validators
 * ใช้ express-validator สำหรับ validate + sanitize input
 */
const { body } = require('express-validator');

const loginValidator = [
  body('username')
    .trim()
    .notEmpty().withMessage('Username is required')
    .isLength({ min: 4, max: 50 }).withMessage('Username must be 4-50 characters')
    .matches(/^[a-zA-Z0-9_.-]+$/).withMessage('Username contains invalid characters')
    .toLowerCase(),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 1, max: 128 }).withMessage('Invalid password length'),
];

const verifyOtpValidator = [
  body('otpCode')
    .trim()
    .notEmpty().withMessage('OTP code is required')
    .isNumeric().withMessage('OTP must be numeric')
    .isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
];

const googleLoginValidator = [
  body('idToken')
    .trim()
    .notEmpty().withMessage('Google ID token is required')
    .isString().withMessage('Invalid token format'),
];

const forgotPasswordValidator = [
  body('username')
    .trim()
    .notEmpty().withMessage('Username is required')
    .isLength({ min: 4, max: 50 }).withMessage('Username must be 4-50 characters')
    .matches(/^[a-zA-Z0-9_.-]+$/).withMessage('Username contains invalid characters')
    .toLowerCase(),
];

const resetPasswordValidator = [
  body('otpCode')
    .trim()
    .notEmpty().withMessage('OTP code is required')
    .isNumeric().withMessage('OTP must be numeric')
    .isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  body('newPassword')
    .notEmpty().withMessage('New password is required')
    .isLength({ min: 8, max: 128 }).withMessage('Password must be 8-128 characters')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number'),
  body('confirmPassword')
    .notEmpty().withMessage('Confirm password is required')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Passwords do not match');
      }
      return true;
    }),
];

module.exports = {
  loginValidator,
  verifyOtpValidator,
  googleLoginValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
};