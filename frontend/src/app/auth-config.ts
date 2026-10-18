export const GOOGLE_CLIENT_ID = '1063137162810-shg6ei3t1rdur18vfmc5il0ip4jseu60.apps.googleusercontent.com';

// Cloudflare Turnstile (site key เป็นค่าสาธารณะ ใส่ฝั่ง frontend ได้ — secret key อยู่ที่ backend เท่านั้น)
// ผูก hostname ไว้ที่ dashboard ของ Cloudflare ตอนนี้มีแค่ localhost — ก่อน deploy ต้องเพิ่ม journal.farmlnwza007.online
// (คนดูแล backend เป็นคนเพิ่มที่ dashboard) ไม่งั้น widget จะขึ้น error บนโดเมนจริง
// Test key (ผ่านเสมอ ใช้ทดสอบ): '1x00000000000000000000AA'
export const TURNSTILE_SITE_KEY = '0x4AAAAAACG1gENgXRjyMNW2';
