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
// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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