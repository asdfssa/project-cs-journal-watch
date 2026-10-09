/**
 * Routes Index
 * รวม routes ทั้งหมดเข้าด้วยกัน
 */
const express = require('express');
const authRoutes = require('./authRoutes');
const journalRoutes = require('./journalRoutes');
const adminRoutes = require('./adminRoutes');
const userManageRoutes = require('./userManageRoutes');

const router = express.Router();
const unwantedJournalRoutes = require('./unwantedJournalRoutes');
const preT3Routes = require('./preT3Routes');
const t3Routes = require('./t3Routes');
const uploadRoutes = require('./uploadRoutes');
const userRoutes = require('./userRoutes');
// Health check — ตรวจ DB ด้วย (SELECT 1 ภายใน 3 วินาที) ไม่งั้น DB ล่มก็ยังตอบ ok
// FE (server-status.service) ใช้ status === 'ok' แยก "เซิร์ฟเวอร์ล่ม" ออกจาก "ขัดข้องชั่วคราว"
const db = require('../config/database');
router.get('/health', async (req, res) => {
  let timer;
  try {
    await Promise.race([
      db.query('SELECT 1'),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('db timeout')), 3000); }),
    ]);
    res.json({ status: 'ok', db: 'ok', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', db: 'down', timestamp: new Date().toISOString() });
  } finally {
    clearTimeout(timer);
  }
});

router.use('/auth', authRoutes);
router.use('/journal', journalRoutes);
router.use('/admin', adminRoutes);
router.use('/manage/users', userManageRoutes);

router.use('/unwanted-journals', unwantedJournalRoutes);
router.use('/pre-t3', preT3Routes);
router.use('/t3', t3Routes);
router.use('/upload', uploadRoutes);
router.use('/user', userRoutes);
module.exports = router;