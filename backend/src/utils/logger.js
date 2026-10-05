/**
 * Simple Logger Utility
 * สำหรับ project ขนาดเล็ก ไม่จำเป็นต้องใช้ winston/pino
 * ถ้าต่อไประบบใหญ่ขึ้นค่อยเปลี่ยน
 */
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function timestamp() {
  return new Date().toISOString();
}

module.exports = {
  info: (msg, meta) => {
    console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.blue}INFO${colors.reset}  ${msg}`, meta || '');
  },
  success: (msg, meta) => {
    console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.green}OK${colors.reset}    ${msg}`, meta || '');
  },
  warn: (msg, meta) => {
    console.warn(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.yellow}WARN${colors.reset}  ${msg}`, meta || '');
  },
  error: (msg, meta) => {
    console.error(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.red}ERROR${colors.reset} ${msg}`, meta || '');
  },
  otp: (email, code) => {
    console.log(`\n${colors.cyan}╔════════════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.cyan}║          📧 OTP EMAIL (DEV MODE)              ║${colors.reset}`);
    console.log(`${colors.cyan}╠════════════════════════════════════════════════╣${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset}  To:   ${email.padEnd(40)}${colors.cyan}║${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset}  Code: ${colors.yellow}${code}${colors.reset}${' '.repeat(40 - code.length)}${colors.cyan}║${colors.reset}`);
    console.log(`${colors.cyan}╚════════════════════════════════════════════════╝${colors.reset}\n`);
  },
};
