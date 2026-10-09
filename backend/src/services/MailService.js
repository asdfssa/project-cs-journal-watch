/**
 * Mail Service
 * รองรับ 2 mode:
 *   - 'console' : log ไปที่ console (dev mode)
 *   - 'smtp'    : ส่ง email จริงผ่าน SMTP (production)
 *
 * ออกแบบเป็น interface เดียวกัน ทำให้สลับ mode ได้โดยไม่ต้องแก้ caller
 */
const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('../utils/logger');

let transporter = null;

if (config.mail.mode === 'smtp') {
  transporter = nodemailer.createTransport({
    host: config.mail.smtp.host,
    port: config.mail.smtp.port,
    secure: config.mail.smtp.port === 465,
    requireTLS: config.mail.smtp.port !== 465 && config.mail.smtp.requireTLS,
    auth: {
      user: config.mail.smtp.user,
      pass: config.mail.smtp.pass,
    },
  });
} else if (config.mail.mode !== 'console') {
  // mode ตั้งผิด (ไม่ใช่ 'console' หรือ 'smtp') — transporter จะเป็น null เงียบๆ
  // แล้วไปพังตอน sendMail() จริง (เช่นตอน login) แทนที่จะพังตอน startup ที่เห็นชัดกว่า
  throw new Error(`MailService: config.mail.mode ต้องเป็น 'console' หรือ 'smtp' — ได้ค่า "${config.mail.mode}"`);
}

class MailService {
  /**
   * ส่ง OTP ไปยัง email
   * @param {string} to - email ปลายทาง
   * @param {string} otpCode - OTP ตัวเลข
   * @param {string} purpose - 'login_2fa' | 'password_reset'
   */
  static async sendOtp(to, otpCode, purpose = 'login_2fa') {
    const subject =
      purpose === 'password_reset'
        ? 'Journal Watch - รหัสยืนยันการรีเซ็ตรหัสผ่าน'
        : 'Journal Watch - รหัสยืนยันเข้าสู่ระบบ (OTP)';

    if (config.mail.mode === 'console') {
      logger.otp(to, otpCode);
      return { success: true, mode: 'console' };
    }

    try {
      const info = await transporter.sendMail({
        from: config.mail.from,
        to,
        subject,
        text: `รหัส OTP ของคุณคือ: ${otpCode}\n\nรหัสนี้จะหมดอายุใน ${config.otp.expiresMinutes} นาที\n\nหากคุณไม่ได้ร้องขอรหัสนี้ กรุณาเพิกเฉยต่ออีเมลฉบับนี้`,
        html: MailService._buildOtpHtml(otpCode, config.otp.expiresMinutes, subject),
      });
      logger.success(`Email sent to ${to}`, { messageId: info.messageId });
      return { success: true, mode: 'smtp', messageId: info.messageId };
    } catch (err) {
      logger.error(`Email send failed: ${err.message}`, { to });
      return { success: false, error: err.message };
    }
  }

  // ============================================================
  // Pre-T3 Notifications
  // ============================================================

  /**
   * ส่งอีเมลแจ้งเตือนทุก event ของ Pre-T3
   * @param {string} to       - email ปลายทาง
   * @param {string} event    - 'advisor_pending' | 'advisor_rejected' | 'advisor_approved' | 'faculty_pending' |
   *                            'faculty_approved' | 'faculty_rejected' | 'major_advisor_approved' | 'major_advisor_rejected'
   * @param {object} data     - { studentName, journalName, issn?, preT3Id, remark?, meetingNo?, meetingDate? }
   */
  static async sendPreT3Notification(to, event, data) {
    const { subject, text, html } = MailService._buildPreT3Content(event, data);

    if (config.mail.mode === 'console') {
      console.log(`\n[MailService:PreT3] ─────────────────────────────────`);
      console.log(`  To      : ${to}`);
      console.log(`  Event   : ${event}`);
      console.log(`  Subject : ${subject}`);
      console.log(`  Body    : ${text}`);
      console.log(`─────────────────────────────────────────────────────\n`);
      return { success: true, mode: 'console' };
    }

    try {
      const info = await transporter.sendMail({
        from: config.mail.from,
        to,
        subject,
        text,
        html,
      });
      logger.success(`Pre-T3 email [${event}] sent to ${to}`, { messageId: info.messageId });
      return { success: true, mode: 'smtp', messageId: info.messageId };
    } catch (err) {
      logger.error(`Pre-T3 email [${event}] failed: ${err.message}`, { to });
      return { success: false, error: err.message };
    }
  }

  // ============================================================
  // Private builders
  // ============================================================

  // ============================================================
  // T3 Notifications
  // ============================================================

  /**
   * ส่งอีเมลแจ้งเตือนทุก event ของ T3
   * @param {string} to     - email ปลายทาง
   * @param {string} event  - 'advisor_pending' | 'advisor_rejected' | 'advisor_approved' | 'faculty_pending' |
   *                          'faculty_approved' | 'faculty_rejected' (มติคณะกรรมการ = ผลสุดท้ายของ T3) |
   *                          'major_advisor_approved' | 'major_advisor_rejected'
   * @param {object} data   - { studentName, journalName, articleTitle, t3Id, remark?, meetingNo?, meetingDate? }
   */
  static async sendT3Notification(to, event, data) {
    const { subject, text, html } = MailService._buildT3Content(event, data);

    if (config.mail.mode === 'console') {
      console.log(`\n[MailService:T3] ────────────────────────────────────`);
      console.log(`  To      : ${to}`);
      console.log(`  Event   : ${event}`);
      console.log(`  Subject : ${subject}`);
      console.log(`  Body    : ${text}`);
      console.log(`────────────────────────────────────────────────────\n`);
      return { success: true, mode: 'console' };
    }

    try {
      const info = await transporter.sendMail({
        from: config.mail.from,
        to,
        subject,
        text,
        html,
      });
      logger.success(`T3 email [${event}] sent to ${to}`, { messageId: info.messageId });
      return { success: true, mode: 'smtp', messageId: info.messageId };
    } catch (err) {
      logger.error(`T3 email [${event}] failed: ${err.message}`, { to });
      return { success: false, error: err.message };
    }
  }

  static _buildT3Content(event, data) {
    const { studentName, journalName, articleTitle, t3Id, remark, meetingNo, meetingDate } = data;

    const templates = {
      advisor_pending: {
        subject: `[Journal Watch] มีนิสิตยื่น T3 รอการอนุมัติ`,
        text: `นิสิต ${studentName} ได้ยื่นคำขอ T3 (ID: ${t3Id})\nบทความ: ${articleTitle}\nวารสาร: ${journalName}\nกรุณาเข้าสู่ระบบเพื่อตรวจสอบและอนุมัติ`,
      },
      advisor_rejected: {
        subject: `[Journal Watch] T3 ถูกปฏิเสธโดยอาจารย์ที่ปรึกษา`,
        text: `T3 ของคุณ (ID: ${t3Id})\nบทความ: ${articleTitle}\nถูกปฏิเสธ${remark ? `\nเหตุผล: ${remark}` : ''}\nกรุณาแก้ไขและติดต่ออาจารย์ที่ปรึกษา`,
      },
      faculty_pending: {
        subject: `[Journal Watch] มี T3 รอการพิจารณาจากคณะกรรมการ`,
        text: `T3 ของนิสิต ${studentName} (ID: ${t3Id})\nบทความ: ${articleTitle}\nวารสาร: ${journalName}\nอาจารย์ที่ปรึกษาอนุมัติแล้ว กรุณาเข้าสู่ระบบเพื่อพิจารณา`,
      },
      advisor_approved: {
        subject: `[Journal Watch] อาจารย์ที่ปรึกษาอนุมัติ T3 แล้ว — รอ Staff พิจารณา`,
        text: `T3 ของคุณ (ID: ${t3Id})\nบทความ: ${articleTitle}\nวารสาร: ${journalName}\nอาจารย์ที่ปรึกษาทุกท่านอนุมัติเรียบร้อยแล้ว\nขณะนี้อยู่ระหว่างรอเจ้าหน้าที่คณะพิจารณา กรุณารอการแจ้งเตือนในขั้นตอนถัดไป`,
      },
      // มติคณะกรรมการบัณฑิตศึกษาเป็นผลสุดท้ายของ T3 (v3 ตัดขั้นบัณฑิตวิทยาลัยออกแล้ว)
      faculty_approved: {
        subject: `[Journal Watch] T3 ผ่านมติคณะกรรมการบัณฑิตศึกษาแล้ว 🎉`,
        text: `T3 ของคุณ (ID: ${t3Id})\nบทความ: ${articleTitle}\nวารสาร: ${journalName}\nผ่านมติคณะกรรมการบัณฑิตศึกษาแล้ว${meetingNo ? `\nการประชุมครั้งที่: ${meetingNo}${meetingDate ? ` วันที่: ${meetingDate}` : ''}` : ''}\nขั้นตอนการพิจารณาเสร็จสิ้น`,
      },
      faculty_rejected: {
        subject: `[Journal Watch] T3 ไม่ผ่านมติคณะกรรมการบัณฑิตศึกษา`,
        text: `T3 ของคุณ (ID: ${t3Id})\nบทความ: ${articleTitle}\nวารสาร: ${journalName}\nไม่ผ่านมติคณะกรรมการบัณฑิตศึกษา${remark ? `\nเหตุผล: ${remark}` : ''}\nกรุณาติดต่อเจ้าหน้าที่เพื่อสอบถามรายละเอียด`,
      },
      major_advisor_approved: {
        subject: `[Journal Watch] แจ้งเตือน: อาจารย์ที่ปรึกษาหลักอนุมัติ T3 ของนิสิต ${studentName} แล้ว`,
        text: `อาจารย์ที่ปรึกษาหลักได้อนุมัติ T3 ของนิสิต ${studentName} (ID: ${t3Id}) แล้ว\nบทความ: ${articleTitle}\n\nนี่เป็นเพียงอีเมลแจ้งเตือนเท่านั้น ไม่ต้องดำเนินการใดๆ เพิ่มเติม (ระบบอนุมัติในส่วนของท่านให้อัตโนมัติแล้ว)\nหากท่านยังไม่เคยได้รับแจ้งหรือพูดคุยเรื่องนี้มาก่อน กรุณาติดต่ออาจารย์ที่ปรึกษาหลักเพื่อสอบถามรายละเอียด`,
      },
      major_advisor_rejected: {
        subject: `[Journal Watch] แจ้งเตือน: อาจารย์ที่ปรึกษาหลักปฏิเสธ T3 ของนิสิต ${studentName}`,
        text: `อาจารย์ที่ปรึกษาหลักได้ปฏิเสธ T3 ของนิสิต ${studentName} (ID: ${t3Id})\nบทความ: ${articleTitle}${remark ? `\nเหตุผล: ${remark}` : ''}\n\nนี่เป็นเพียงอีเมลแจ้งเตือนเท่านั้น ไม่ต้องดำเนินการใดๆ เพิ่มเติม\nหากท่านยังไม่เคยได้รับแจ้งหรือพูดคุยเรื่องนี้มาก่อน กรุณาติดต่ออาจารย์ที่ปรึกษาหลักเพื่อสอบถามรายละเอียด`,
      },
    };

    const tmpl = templates[event] || {
      subject: '[Journal Watch] แจ้งเตือน T3',
      text: `มีการอัปเดต T3 (ID: ${t3Id})`,
    };

    return {
      subject: tmpl.subject,
      text:    tmpl.text,
      html:    MailService._buildPreT3Html(tmpl.subject, tmpl.text),
    };
  }

  static _buildPreT3Content(event, data) {
    const { studentName, journalName, issn, preT3Id, remark, meetingNo, meetingDate } = data;

    const templates = {
      advisor_pending: {
        subject: `[Journal Watch] มีนิสิตยื่น Pre-T3 รอการอนุมัติ`,
        text: `นิสิต ${studentName} ได้ยื่นคำขอ Pre-T3 (ID: ${preT3Id})\nวารสาร: ${journalName} (ISSN: ${issn})\nกรุณาเข้าสู่ระบบเพื่อตรวจสอบและอนุมัติ`,
      },
      advisor_rejected: {
        subject: `[Journal Watch] Pre-T3 ถูกปฏิเสธโดยอาจารย์ที่ปรึกษา`,
        text: `Pre-T3 ของคุณ (ID: ${preT3Id}) สำหรับวารสาร ${journalName}\nถูกปฏิเสธ${remark ? `\nเหตุผล: ${remark}` : ''}\nกรุณาแก้ไขและยื่นใหม่อีกครั้ง`,
      },
      faculty_pending: {
        subject: `[Journal Watch] มี Pre-T3 รอการพิจารณาจากคณะกรรมการ`,
        text: `Pre-T3 ของนิสิต ${studentName} (ID: ${preT3Id})\nวารสาร: ${journalName}\nอาจารย์ที่ปรึกษาอนุมัติแล้ว กรุณาเข้าสู่ระบบเพื่อพิจารณา`,
      },
      advisor_approved: {
        subject: `[Journal Watch] อาจารย์ที่ปรึกษาอนุมัติ Pre-T3 แล้ว — รอ Staff พิจารณา`,
        text: `Pre-T3 ของคุณ (ID: ${preT3Id}) สำหรับวารสาร ${journalName}\nอาจารย์ที่ปรึกษาทุกท่านอนุมัติเรียบร้อยแล้ว\nขณะนี้อยู่ระหว่างรอเจ้าหน้าที่คณะพิจารณา กรุณารอการแจ้งเตือนในขั้นตอนถัดไป`,
      },
      faculty_approved: {
        subject: `[Journal Watch] Pre-T3 ได้รับการอนุมัติแล้ว`,
        text: `Pre-T3 ของคุณ (ID: ${preT3Id}) สำหรับวารสาร ${journalName}\nได้รับการอนุมัติจากคณะกรรมการบัณฑิตศึกษาแล้ว${meetingNo ? `\nครั้งที่: ${meetingNo} วันที่: ${meetingDate}` : ''}\nคุณสามารถยื่น T3 ต่อไปได้`,
      },
      faculty_rejected: {
        subject: `[Journal Watch] Pre-T3 ถูกปฏิเสธโดยคณะกรรมการ`,
        text: `Pre-T3 ของคุณ (ID: ${preT3Id}) สำหรับวารสาร ${journalName}\nถูกปฏิเสธ${remark ? `\nเหตุผล: ${remark}` : ''}\nกรุณาแก้ไขและยื่นใหม่อีกครั้ง`,
      },
      major_advisor_approved: {
        subject: `[Journal Watch] แจ้งเตือน: อาจารย์ที่ปรึกษาหลักอนุมัติ Pre-T3 ของนิสิต ${studentName} แล้ว`,
        text: `อาจารย์ที่ปรึกษาหลักได้อนุมัติ Pre-T3 ของนิสิต ${studentName} (ID: ${preT3Id}) แล้ว\nวารสาร: ${journalName}\n\nนี่เป็นเพียงอีเมลแจ้งเตือนเท่านั้น ไม่ต้องดำเนินการใดๆ เพิ่มเติม (ระบบอนุมัติในส่วนของท่านให้อัตโนมัติแล้ว)\nหากท่านยังไม่เคยได้รับแจ้งหรือพูดคุยเรื่องนี้มาก่อน กรุณาติดต่ออาจารย์ที่ปรึกษาหลักเพื่อสอบถามรายละเอียด`,
      },
      major_advisor_rejected: {
        subject: `[Journal Watch] แจ้งเตือน: อาจารย์ที่ปรึกษาหลักปฏิเสธ Pre-T3 ของนิสิต ${studentName}`,
        text: `อาจารย์ที่ปรึกษาหลักได้ปฏิเสธ Pre-T3 ของนิสิต ${studentName} (ID: ${preT3Id}) สำหรับวารสาร ${journalName}${remark ? `\nเหตุผล: ${remark}` : ''}\n\nนี่เป็นเพียงอีเมลแจ้งเตือนเท่านั้น ไม่ต้องดำเนินการใดๆ เพิ่มเติม\nหากท่านยังไม่เคยได้รับแจ้งหรือพูดคุยเรื่องนี้มาก่อน กรุณาติดต่ออาจารย์ที่ปรึกษาหลักเพื่อสอบถามรายละเอียด`,
      },
    };

    const tmpl = templates[event] || {
      subject: '[Journal Watch] แจ้งเตือน Pre-T3',
      text: `มีการอัปเดต Pre-T3 (ID: ${preT3Id})`,
    };

    return {
      subject: tmpl.subject,
      text:    tmpl.text,
      html:    MailService._buildPreT3Html(tmpl.subject, tmpl.text),
    };
  }

  // ============================================================
  // Account Approved Notification
  // ============================================================

  /**
   * ส่งอีเมลแจ้งเตือนเมื่อบัญชีได้รับการอนุมัติ
   * @param {string} to        - email ปลายทาง
   * @param {string} fullName  - ชื่อ-นามสกุล ผู้ใช้
   */
  static async sendAccountApproved(to, fullName) {
    const subject = '[Journal Watch] บัญชีของคุณได้รับการอนุมัติแล้ว';
    const text = `เรียน ${fullName}\n\nบัญชีผู้ใช้ของคุณในระบบ Journal Watch ได้รับการอนุมัติจากผู้ดูแลระบบเรียบร้อยแล้ว\nคุณสามารถเข้าสู่ระบบและเริ่มใช้งานได้ทันที\n\nหากมีข้อสงสัยกรุณาติดต่อผู้ดูแลระบบ`;

    if (config.mail.mode === 'console') {
      console.log(`\n[MailService:AccountApproved] ───────────────────────`);
      console.log(`  To      : ${to}`);
      console.log(`  Subject : ${subject}`);
      console.log(`  Body    : ${text}`);
      console.log(`────────────────────────────────────────────────────\n`);
      return { success: true, mode: 'console' };
    }

    try {
      const info = await transporter.sendMail({
        from: config.mail.from,
        to,
        subject,
        text,
        html: MailService._buildPreT3Html(subject, text),
      });
      logger.success(`Account approved email sent to ${to}`, { messageId: info.messageId });
      return { success: true, mode: 'smtp', messageId: info.messageId };
    } catch (err) {
      logger.error(`Account approved email failed: ${err.message}`, { to });
      return { success: false, error: err.message };
    }
  }

  static _escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  static _buildPreT3Html(title, body) {
    const lines = body.split('\n').map(l => `<p style="margin:4px 0;">${MailService._escapeHtml(l)}</p>`).join('');
    return `
      <div style="font-family:'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#fff;border:1px solid #eee;border-radius:8px;">
        <h2 style="color:#1a73e8;margin-top:0;font-size:16px;">${MailService._escapeHtml(title)}</h2>
        <div style="color:#333;font-size:14px;line-height:1.6;">${lines}</div>
        <hr style="margin:20px 0;border:none;border-top:1px solid #eee;">
        <p style="color:#999;font-size:12px;margin:0;">Journal Watch — ระบบตรวจสอบคุณภาพวารสาร มหาวิทยาลัยมหาสารคาม</p>
      </div>
    `;
  }

  static _buildOtpHtml(otpCode, expiresMin, title) {
    return `
      <div style="font-family:'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#fff;border:1px solid #eee;border-radius:8px;">
        <h2 style="color:#f5a623;margin-top:0;">${MailService._escapeHtml(title)}</h2>
        <p>รหัส OTP ของคุณคือ:</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;padding:16px;background:#f9f9f9;border-radius:4px;margin:16px 0;">
          ${MailService._escapeHtml(otpCode)}
        </div>
        <p style="color:#666;font-size:14px;">รหัสนี้จะหมดอายุใน <strong>${MailService._escapeHtml(expiresMin)} นาที</strong></p>
        <p style="color:#999;font-size:12px;margin-top:24px;">หากคุณไม่ได้ร้องขอรหัสนี้ กรุณาเพิกเฉยต่ออีเมลฉบับนี้</p>
      </div>
    `;
  }
}

module.exports = MailService;