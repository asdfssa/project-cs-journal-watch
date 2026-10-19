//Unix epoch = จำนวนมิลลิวินาทีตั้งแต่ 1970-01-01T00:00:00Z

const fs = require('fs');                
const path = require('path');             
const crypto = require('crypto');         
const config = require('../config');     

const PER_SECOND_LIMIT = Number(process.env.SCOPUS_PER_SECOND_LIMIT) || 5;
const UNAVAILABLE_MS = 60 * 60 * 1000;    
const BURST_COOLDOWN_MS = 30 * 1000;      
const REJECTED_MS = 24 * 60 * 60 * 1000; 
const DEFAULT_WEEKLY_LIMIT = 20000;

const STATE_DIR = path.join(__dirname, '..', '..', 'data');
const STATE_FILE = path.join(STATE_DIR, 'scopus-proxy-state.json');

const keyId = (key) => crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);

// ===== class: ตัวจัดการ key =====
class ScopusProxyService {
  constructor() {                         
    const persisted = this._loadState();  

    const hasLegacy = config.scopus.apiKeys.some(key => persisted[key]);

    let clearedExpired = false;          
    this.keys = config.scopus.apiKeys.map((key, index) => {   
      const saved = persisted[keyId(key)] || persisted[key] || {};  
      const stillLocked = saved.unavailableUntil > Date.now();     
      if (saved.unavailableUntil && !stillLocked) clearedExpired = true; 
      return {
        key,                           
        index,                           
        weeklyLimit: saved.weeklyLimit ?? DEFAULT_WEEKLY_LIMIT,        
        weeklyRemaining: saved.weeklyRemaining ?? DEFAULT_WEEKLY_LIMIT,
        weeklyResetAt: saved.weeklyResetAt ?? null,                    
        unavailableUntil: stillLocked ? saved.unavailableUntil : null, // พักถึงเมื่อไร (หน่วย ms) null = ใช้ได้
        recentRequestTimestamps: [],      // สมุดจดเวลาที่เลือกใช้ key (ไว้นับต่อวินาที ไม่บันทึกลงไฟล์)
      };
    });
    this.currentIndex = 0;                // ตัวชี้ว่ารอบหน้าเริ่มดู key ตัวไหน
    this._writeQueue = Promise.resolve(); // คิวเขียนไฟล์ กันเขียนซ้อนกันจนไฟล์พัง
    if (hasLegacy || clearedExpired) this._persist().catch(() => {});  // ต้องเขียนไฟล์ใหม่ทันที
  }

  // ===== เลือก key =====
  async getNextKey() {                    
    const total = this.keys.length;       
    let attempts = 0;                     // นับว่าดู key ไปแล้วกี่ตัวในรอบนี้

    while (attempts < total) {            // ลองไม่เกิน 1 รอบวงของ key
      const keyObj = this.keys[this.currentIndex];            // หยิบ key ตัวที่ถึงคิว
      this.currentIndex = (this.currentIndex + 1) % total;    // ขยับตัวชี้ไปตัวถัดไป วนกลับต้นเมื่อสุด
      attempts++;                         

      if (this._isLocked(keyObj)) continue;                  
      if (keyObj.weeklyRemaining !== null && keyObj.weeklyRemaining <= 0) {  
        if (keyObj.weeklyResetAt && Date.now() / 1000 >= keyObj.weeklyResetAt) {  
          keyObj.weeklyRemaining = keyObj.weeklyLimit;        
          await this._persist();                           
        } else {
          continue;                                          
        }
      }
      if (this._isThrottled(keyObj)) continue;                // ยิงครบลิมิตต่อวินาทีแล้ว → ข้าม

      keyObj.recentRequestTimestamps.push(Date.now());        // จดเวลาตอน "เลือก"
      return keyObj;                                        
    }

    throw Object.assign(new Error('All Scopus API keys ...'), { code: 'SCOPUS_QUOTA_EXCEEDED' });
  }

  // ===== หลังยิงสำเร็จ =====
  async incrementUsage(keyIndex, rateLimitHeaders = null) {   
    const keyObj = this.keys[keyIndex];  
    if (!keyObj) return;                 
    this._applyRateLimitHeaders(keyObj, rateLimitHeaders);    // อ่านโควตาล่าสุดจาก header ของ Elsevier มาอัปเดต
    await this._persist();                
  }

  // ===== เมื่อได้ 429 =====
  async markKeyUnavailable(keyIndex, rateLimitHeaders = null) {
    const keyObj = this.keys[keyIndex];
    if (!keyObj) return;
    this._applyRateLimitHeaders(keyObj, rateLimitHeaders);    // อัปเดตโควตาจาก header (ถ้ามี)

    const quotaExhausted = keyObj.weeklyRemaining !== null && keyObj.weeklyRemaining <= 0;   
    const resetMs = keyObj.weeklyResetAt ? keyObj.weeklyResetAt * 1000 : null;                // แปลงเวลา reset จากวินาทีเป็น ms

    const quotaKnownLeft = keyObj.weeklyRemaining !== null && keyObj.weeklyRemaining > 0;     // รู้ว่าโควตายังเหลือไหม
    keyObj.unavailableUntil = (quotaExhausted && resetMs && resetMs > Date.now())
      ? resetMs                                                  
      : Date.now() + (quotaKnownLeft ? BURST_COOLDOWN_MS : UNAVAILABLE_MS);
                                                                
    console.warn(`[ScopusProxy] key #${keyIndex} ได้ 429 ...`); 
    await this._persist();                                       
  }

  // ===== เมื่อ key ถูกปฏิเสธ =====
  async markKeyRejected(keyIndex) {       // เรียกเมื่อได้ 401/403
    const keyObj = this.keys[keyIndex];
    if (!keyObj) return;
    console.error(`[ScopusProxy] key #${keyIndex} ถูกปฏิเสธ ...`);   
    keyObj.unavailableUntil = Date.now() + REJECTED_MS;          // พักไป 24 ชั่วโมง
    try { await this._persist(); } catch (_) { }                
  }

  // ===== อ่าน header ของ Elsevier =====
  _applyRateLimitHeaders(keyObj, rateLimitHeaders) {
    if (!rateLimitHeaders) return;                               
    const limit = parseInt(rateLimitHeaders['x-ratelimit-limit'], 10);         // โควตาทั้งหมด
    const remaining = parseInt(rateLimitHeaders['x-ratelimit-remaining'], 10); // โควตาที่เหลือ
    const reset = parseInt(rateLimitHeaders['x-ratelimit-reset'], 10);         // เวลา reset (วินาที)
    if (!isNaN(limit)) keyObj.weeklyLimit = limit;               // แปลงได้ถึงจะอัปเดต (กัน NaN ทับค่าเดิม)
    if (!isNaN(remaining)) keyObj.weeklyRemaining = remaining;
    if (!isNaN(reset)) keyObj.weeklyResetAt = reset;
  }

  // ===== ดูสถานะ (หน้า dashboard) =====
  getStatus() {
    return this.keys.map(k => ({
      index: k.index,                                  
      weeklyUsage: k.weeklyLimit - k.weeklyRemaining, 
      weeklyLimit: k.weeklyLimit,                     
      remaining: k.weeklyRemaining,                   
      weeklyResetAt: k.weeklyResetAt,                 
      isAvailable: !this._isLocked(k),                 
      keyPreview: k.key ? `…${k.key.slice(-4)}` : 'N/A',   // โชว์แค่ 4 ตัวท้าย ไม่เปิดเผย key เต็ม
    }));
  }

  // ===== ฟังก์ชันภายใน =====
  _isLocked(keyObj) {                                  // key ถูกพักอยู่ไหม
    if (keyObj.unavailableUntil === null) return false;         
    if (Date.now() < keyObj.unavailableUntil) return true;      
    keyObj.unavailableUntil = null;                             
    return false;                                              
  }

  _isThrottled(keyObj) {                               
    const now = Date.now();                                       
    keyObj.recentRequestTimestamps = keyObj.recentRequestTimestamps.filter(t => now - t < 1000);
                                                                 // เก็บเฉพาะเวลาที่ห่างไม่ถึง 1 วินาที (ทิ้งอันเก่า)
    return keyObj.recentRequestTimestamps.length >= PER_SECOND_LIMIT;   // เหลือถึง 5 = ชนลิมิต
  }

  _loadState() {                                      
    try {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');           
      return JSON.parse(raw);                                   
    } catch (_) {
      return {};                                                
    }
  }

  async _persist() {                                   // เขียนสถานะลงไฟล์
    const snapshot = {};                                         
    for (const k of this.keys) {
      snapshot[keyId(k.key)] = {                                 
        weeklyLimit: k.weeklyLimit,
        weeklyRemaining: k.weeklyRemaining,
        weeklyResetAt: k.weeklyResetAt,
        unavailableUntil: k.unavailableUntil,                    
      };
    }
    const task = this._writeQueue.catch(() => {}).then(() => this._writeAtomic(snapshot));
    this._writeQueue = task.catch(() => {});                     
    return task;                                                 
  }

  async _writeAtomic(snapshot) {                       // เขียนไฟล์แบบ atomic
    await fs.promises.mkdir(STATE_DIR, { recursive: true });    
    const tmpFile = `${STATE_FILE}.${process.pid}.tmp`;          // ไฟล์ชั่วคราว (มีเลข process กันชื่อชน)
    await fs.promises.writeFile(tmpFile, JSON.stringify(snapshot, null, 2));   // เขียนลงไฟล์ชั่วคราวก่อน
    await fs.promises.rename(tmpFile, STATE_FILE);               // แล้วสลับชื่อทับไฟล์จริง
  }
}

module.exports = new ScopusProxyService();            