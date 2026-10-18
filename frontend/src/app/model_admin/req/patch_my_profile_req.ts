// PATCH /user/profile — backend อ่านแค่ 3 field นี้ (ชื่อ-นามสกุลแก้ผ่านหน้าจัดการ Admin โดย SuperAdmin)
export interface PatchMyProfileReq {
    phone:       string;
    facebook_id: string;
    line_id:     string;
}
