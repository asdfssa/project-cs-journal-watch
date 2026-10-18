let gsiPromise: Promise<void> | null = null;

/**
 * F16: โหลด Google Identity Services ครั้งเดียวแล้วแชร์ promise ระหว่างหน้า login / register
 * เดิมแต่ละหน้าเช็คแค่ว่ามี <script> อยู่แล้วหรือยัง ถ้ามีก็ resolve ทันที — แต่สคริปต์อาจยังโหลดไม่เสร็จ
 * (เช่นสลับหน้า login ↔ register เร็วๆ) → `google is not defined`
 * ตอนนี้ resolve ก็ต่อเมื่อ window.google.accounts.id พร้อมใช้จริง
 */
export function loadGoogleIdentity(): Promise<void> {
  const ready = () => !!(window as any).google?.accounts?.id;
  if (ready()) return Promise.resolve();
  if (gsiPromise) return gsiPromise;

  gsiPromise = new Promise<void>((resolve, reject) => {
    const done = () => (ready() ? resolve() : reject(new Error('Google Identity Services not available')));
    let script = document.getElementById('google-gsi-script') as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id    = 'google-gsi-script';
      script.src   = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', done, { once: true });
    script.addEventListener('error', () => reject(new Error('โหลดสคริปต์ Google ไม่สำเร็จ')), { once: true });
  }).catch(err => {
    gsiPromise = null;            // ให้ลองใหม่ได้รอบหน้า
    document.getElementById('google-gsi-script')?.remove();
    throw err;
  });
  return gsiPromise;
}
