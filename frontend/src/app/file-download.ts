/** นามสกุลไฟล์จาก MIME type ของ blob — ไฟล์หลักฐาน T3 รับ PDF/JPG/PNG/WEBP (B2) */
const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg':      'jpg',
  'image/jpg':       'jpg',
  'image/png':       'png',
  'image/webp':      'webp',   // X46: เดิมไม่มี → ดาวน์โหลดไฟล์ WEBP ได้ชื่อไม่มีนามสกุล
};

/**
 * F13: ดาวน์โหลด blob พร้อมนามสกุลไฟล์ — เดิมชื่อไฟล์ไม่มีนามสกุล (เช่น "full_paper_T3-4")
 * และ revoke URL ทันทีหลัง click ซึ่งบางเบราว์เซอร์ยังเริ่มดาวน์โหลดไม่ทัน
 */
export function downloadBlob(blob: Blob, baseName: string): void {
  const ext  = EXT_BY_MIME[blob.type?.toLowerCase()] ?? '';
  const name = ext && !baseName.toLowerCase().endsWith(`.${ext}`) ? `${baseName}.${ext}` : baseName;
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
