/**
 * Shared helpers for `request_approvals` — ใช้ร่วมกันระหว่าง PreT3Model และ T3Model
 * (โครงสร้าง approval workflow เหมือนกันทุกประการ ต่างกันแค่ request_type)
 */
const db = require('../config/database');

function slotFromApproval(approvalRow, { withMeeting = false } = {}) {
  if (!approvalRow) {
    return withMeeting
      ? { status: 'Pending', meeting_no: null, meeting_date: null, remark: null, approved_at: null }
      : { status: 'N/A', user_id: null, remark: null, approved_at: null };
  }
  if (withMeeting) {
    return {
      status:       approvalRow.status,
      meeting_no:   approvalRow.meeting_no,
      meeting_date: approvalRow.meeting_date,
      remark:       approvalRow.remark,
      approved_at:  approvalRow.decided_at,
    };
  }
  return {
    status:      approvalRow.status,
    user_id:     approvalRow.approver_id,
    remark:      approvalRow.remark,
    approved_at: approvalRow.decided_at,
  };
}

/**
 * ดึง request_approvals ของหลาย request_id พร้อมกัน แล้ว group เป็น
 * { [request_id]: { Advisor: row, Co_Advisor_1: row, ... } }
 */
async function fetchApprovalsMap(requestType, requestIds) {
  if (!requestIds.length) return {};
  const [rows] = await db.query(
    `SELECT request_id, step, approver_id, status, remark, meeting_no, meeting_date, decided_at
       FROM request_approvals
      WHERE request_type = ? AND request_id IN (?)`,
    [requestType, requestIds]
  );
  const map = {};
  for (const r of rows) {
    if (!map[r.request_id]) map[r.request_id] = {};
    map[r.request_id][r.step] = r;
  }
  return map;
}

/**
 * Advisor (major/co) อนุมัติหรือปฏิเสธ slot ของตัวเองใน request_approvals
 * ถ้าอาจารย์หลักอนุมัติ → auto-approve co-advisors ที่ยัง Pending
 * คืน null ถ้าไม่มี slot ที่ pending ของ advisorId นี้ ไม่งั้นคืน { anyRejected, allApproved }
 * (การอัปเดต overall_status ของตาราง request หลักเป็นหน้าที่ของ caller เอง
 * เพราะแต่ละฝั่งมี column ปลีกย่อยต่างกัน เช่น last_rejected_at)
 *
 * @param {object} conn - connection/pool ที่มี .query() — ส่ง transaction connection
 *   เข้ามาเพื่อให้ atomic กับ UPDATE overall_status ที่ caller ทำต่อ
 */
async function reviewAdvisorSlot(conn, requestType, requestId, advisorId, action, remark) {
  if (!['approve', 'reject'].includes(action)) {
    throw new Error(`reviewAdvisorSlot: invalid action "${action}"`);
  }

  const [pendingSlot] = await conn.query(
    `SELECT approval_id, step FROM request_approvals
      WHERE request_type = ? AND request_id = ?
        AND step IN ('Advisor','Co_Advisor_1','Co_Advisor_2')
        AND approver_id = ? AND status = 'Pending'
      LIMIT 1`,
    [requestType, requestId, advisorId]
  );
  if (!pendingSlot.length) return null;

  const newStatus = action === 'approve' ? 'Approved' : 'Rejected';
  await conn.query(
    `UPDATE request_approvals SET status = ?, remark = ?, decided_at = NOW() WHERE approval_id = ?`,
    [newStatus, remark, pendingSlot[0].approval_id]
  );

  if (action === 'approve' && pendingSlot[0].step === 'Advisor') {
    await conn.query(
      `UPDATE request_approvals SET status = 'Approved', decided_at = NOW()
        WHERE request_type = ? AND request_id = ?
          AND step IN ('Co_Advisor_1','Co_Advisor_2') AND status = 'Pending'`,
      [requestType, requestId]
    );
  }

  const [advisorSteps] = await conn.query(
    `SELECT status FROM request_approvals
      WHERE request_type = ? AND request_id = ?
        AND step IN ('Advisor','Co_Advisor_1','Co_Advisor_2')`,
    [requestType, requestId]
  );

  const anyRejected = advisorSteps.some(s => s.status === 'Rejected');
  const allApproved = advisorSteps.every(s => s.status === 'Approved');

  return { anyRejected, allApproved };
}

/**
 * รัน fn(conn) ในทรานแซกชันเดียว — commit ถ้าสำเร็จ, rollback + release ถ้า throw
 */
async function withTransaction(fn) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { slotFromApproval, fetchApprovalsMap, reviewAdvisorSlot, withTransaction };
