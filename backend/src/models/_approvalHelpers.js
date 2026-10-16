/**
 * Shared helpers for `request_approvals` — ใช้ร่วมกันระหว่าง PreT3Model และ T3Model
 * (โครงสร้าง approval workflow เหมือนกันทุกประการ ต่างกันแค่ request_type)
 */
const db = require('../config/database');

/**
 * แปลงแถว request_approvals 1 step เป็น object 'ช่อง' ที่ frontend คุ้นเคย (advisor_approval, faculty_com_approval ฯลฯ)
 * เรียกจาก: PreT3Model._attachDerived และ T3Model._attachDerived (ตอนประกอบผลอ่านทุก endpoint)
 * @param {object|undefined} approvalRow แถวของ step นั้น (undefined = ไม่มีช่องนี้ เช่นไม่มีอาจารย์ร่วม)
 * @param {{withMeeting?:boolean}} [opts] true สำหรับ Faculty_Committee (พก meeting_no/meeting_date)
 * @returns {object} ปกติ { status, user_id, remark, approved_at } · withMeeting { status, meeting_no, meeting_date, remark, approved_at } · ไม่มีแถว: status 'N/A' (หรือ 'Pending' ถ้า withMeeting)
 */
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
 *
 * เรียกจาก: PreT3Model._attachDerived และ T3Model._attachDerived (query เดียวสำหรับทั้งรายการ ไม่ใช่ต่อแถว)
 * @param {'Pre_T3'|'T3'} requestType
 * @param {number[]} requestIds
 * @returns {Promise<object>} ผลส่งต่อให้ slotFromApproval แปลงทีละ step
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
 * อาจารย์ที่ปรึกษาหลัก (step 'Advisor') อนุมัติหรือปฏิเสธ — เป็นสิทธิ์ของอาจารย์หลักคนเดียว
 * อาจารย์ร่วมไม่มีสิทธิ์ตัดสิน (ผลขึ้นกับอาจารย์หลัก) แถวของอาจารย์ร่วมเก็บไว้บอกว่าเป็นที่ปรึกษาของคำร้องนี้
 * ถ้าอาจารย์หลักอนุมัติ → ช่องอาจารย์ร่วมที่ยัง Pending ถูกอนุมัติตามอัตโนมัติ (ไม่ใช่การกดของอาจารย์ร่วม)
 * คืน null ถ้าอาจารย์หลักคนนี้ไม่มีช่องที่ pending ไม่งั้นคืน { anyRejected, allApproved }
 * (การอัปเดต overall_status ของตาราง request หลักเป็นหน้าที่ของ caller เอง
 * เพราะแต่ละฝั่งมี column ปลีกย่อยต่างกัน เช่น last_rejected_at)
 *
 * @param {object} conn - connection/pool ที่มี .query() — ส่ง transaction connection
 *   เข้ามาเพื่อให้ atomic กับ UPDATE overall_status ที่ caller ทำต่อ
 *
 * เรียกจาก: PreT3Model.advisorReview และ T3Model.advisorReview (ภายใน transaction ที่ล็อกแถวคำร้องไว้แล้ว)
 * @param {string} requestType 'Pre_T3' | 'T3'
 * @param {number} requestId
 * @param {number} advisorId user_id ของอาจารย์ที่กด (req.user.sub)
 * @param {'approve'|'reject'} action
 * @param {string|null} remark
 * @returns {Promise<{anyRejected:boolean, allApproved:boolean}|null>} ผลส่งกลับ controller ผ่าน Model เพื่อเลือกอีเมลที่จะส่ง
 */
async function reviewAdvisorSlot(conn, requestType, requestId, advisorId, action, remark) {
  if (!['approve', 'reject'].includes(action)) {
    throw new Error(`reviewAdvisorSlot: invalid action "${action}"`);
  }

  const [pendingSlot] = await conn.query(
    `SELECT approval_id FROM request_approvals
      WHERE request_type = ? AND request_id = ?
        AND step = 'Advisor'
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

  if (action === 'approve') {
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
 *
 * เรียกจาก: PreT3Model / T3Model ทุก method ที่เขียนหลายตาราง (create, advisorReview, facultyReview, resubmit)
 * @param {(conn: import('mysql2/promise').PoolConnection) => Promise<*>} fn
 * @returns {Promise<*>} ค่าที่ fn คืน
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

/**
 * ข้อมูลมุมมองของอาจารย์ที่ login ต่อคำร้องหนึ่งใบ (ใช้กับ endpoint ฝั่งอาจารย์: /pending /history /:id)
 *  - my_role   : 'Major' | 'Co_1' | 'Co_2' | null — เป็นอะไรของคำร้องนี้ (ถ้าถือหลายช่อง ให้ Major ก่อน)
 *  - can_review: true เมื่อเป็นอาจารย์หลัก ช่องของตัวเองยัง Pending และคำร้องยัง Pending
 *
 * เรียกจาก: PreT3Controller และ T3Controller (getPending, getById, getHistory แนบให้ฝั่ง Supervisor · advisorReview ใช้ตรวจสิทธิ์ก่อนตัดสิน)
 * @param {object} row ผลจาก Model.findXxx (ต้องผ่าน _attachDerived แล้ว เพราะอ่าน advisor_approval / co_advisor_*_approval / overall_status)
 * @param {number} userId req.user.sub
 * @returns {{my_role:'Major'|'Co_1'|'Co_2'|null, can_review:boolean}}
 */
function advisorViewFields(row, userId) {
  const me = String(userId);
  const my_role = String(row.advisor_approval?.user_id) === me ? 'Major'
    : String(row.co_advisor_1_approval?.user_id) === me ? 'Co_1'
    : String(row.co_advisor_2_approval?.user_id) === me ? 'Co_2'
    : null;
  const can_review = my_role === 'Major'
    && row.advisor_approval.status === 'Pending'
    && row.overall_status === 'Pending';
  return { my_role, can_review };
}

/**
 * สร้างข้อความ SQL (EXISTS) = 'ยังมีอาจารย์อย่างน้อยหนึ่งช่องที่ยังไม่ Approved'
 * เรียกจาก: advisorsAllApproved (ในไฟล์นี้) และ WHERE ของ PreT3Model.cancel / T3Model.cancel
 * @param {'Pre_T3'|'T3'} requestType ใส่ตรงลงใน SQL — ต้องเป็นค่าคงที่จากโค้ดเท่านั้น ห้ามส่งค่าจากผู้ใช้
 * @param {string} idCol นิพจน์คอลัมน์ id ของตารางหลัก เช่น 'p.pre_t3_id' หรือ '?'
 */
// advisor ทุกคนอนุมัติแล้ว = เรื่องรอเจ้าหน้าที่นำเข้าประชุม → นิสิตยกเลิกไม่ได้
// (SQL เดียวกันนี้ใช้ใน WHERE ของ cancel() เพื่อกัน race กับ advisor กดอนุมัติ)
const advisorNotAllApprovedSql = (requestType, idCol) => `EXISTS (
  SELECT 1 FROM request_approvals ra
   WHERE ra.request_type = '${requestType}' AND ra.request_id = ${idCol}
     AND ra.step IN ('Advisor', 'Co_Advisor_1', 'Co_Advisor_2') AND ra.status <> 'Approved')`;

/**
 * เรียกจาก: PreT3Controller.cancel และ T3Controller.cancel (ใช้เช็คก่อนยกเลิกว่าอาจารย์อนุมัติครบแล้วหรือยัง เพื่อตอบ ADVISOR_APPROVED)
 * @param {'Pre_T3'|'T3'} requestType
 * @param {number} requestId
 * @returns {Promise<boolean>} true = ทุกช่องอาจารย์ Approved แล้ว
 */
async function advisorsAllApproved(requestType, requestId) {
  const [rows] = await db.query(
    `SELECT 1 AS ok FROM DUAL WHERE NOT ${advisorNotAllApprovedSql(requestType, '?')}`, [requestId]);
  return rows.length > 0;
}

module.exports = { slotFromApproval, fetchApprovalsMap, reviewAdvisorSlot, withTransaction, advisorViewFields, advisorNotAllApprovedSql, advisorsAllApproved };
