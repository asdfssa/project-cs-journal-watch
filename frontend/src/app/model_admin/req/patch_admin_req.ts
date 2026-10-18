// PATCH /admin/admins/:id — ทุก field optional (ไม่ส่ง = คงค่าเดิม), prefix ส่ง '' เพื่อล้างค่า
export interface PatchAdminReq {
    prefix?:     string;
    first_name?: string;
    last_name?:  string;
    msu_mail?:   string;
    /** B34: บังคับเมื่อ msu_mail เปลี่ยน — รหัสผ่านของผู้ทำรายการ (ไม่ใช่ของบัญชีที่ถูกแก้) */
    current_password?: string;
}
