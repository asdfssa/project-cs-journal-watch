export interface T3ApprovedReq {
    action: string;
    remark?: string;   // X42: หมายเหตุตอนอนุมัติ (ไม่บังคับ) — backend บันทึกใน advisor_approval.remark
}
