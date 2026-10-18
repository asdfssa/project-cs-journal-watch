/**
 * X49: URL ที่ผู้ใช้กรอกเอง (เช่น journal_url ของนิสิต) แสดงเป็นลิงก์ได้เฉพาะ http(s)
 * กันลิงก์แปลกๆ เช่น javascript:, data:, file: (Angular sanitize javascript: อยู่แล้ว แต่ data:/file: ยังผ่าน)
 */
export function isHttpUrl(v: string | null | undefined): boolean {
  return /^https?:\/\/\S+$/i.test((v ?? '').trim());
}
