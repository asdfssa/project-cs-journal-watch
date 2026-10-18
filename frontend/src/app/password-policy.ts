/**
 * X48: กฎรหัสผ่านเดียวกับ backend (ยืนยันแล้ว 9-10-2569) — ใช้กับ reset-password และการสร้าง Admin
 * 8–128 ตัว · ต้องมีตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก และตัวเลข · ไม่บังคับอักขระพิเศษ
 */
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{8,128}$/;
export const PASSWORD_RULE_TEXT = 'รหัสผ่าน 8–128 ตัว ต้องมีตัวพิมพ์ใหญ่ (A-Z) ตัวพิมพ์เล็ก (a-z) และตัวเลข (0-9)';

/** ข้อความบอกว่ายังขาดอะไร (ว่าง = ผ่าน) */
export function passwordProblem(pw: string): string {
  if (!pw) return '';
  if (pw.length < 8)   return 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร';
  if (pw.length > 128) return 'รหัสผ่านยาวได้ไม่เกิน 128 ตัวอักษร';
  const missing = [
    !/[A-Z]/.test(pw) ? 'ตัวพิมพ์ใหญ่' : '',
    !/[a-z]/.test(pw) ? 'ตัวพิมพ์เล็ก' : '',
    !/[0-9]/.test(pw) ? 'ตัวเลข' : '',
  ].filter(Boolean);
  return missing.length ? `รหัสผ่านต้องมี${missing.join(' ')}` : '';
}
