export interface StaffActionReq {
    action:       string;
    meeting_no:   string;
    meeting_date: string;   // "YYYY-MM-DD" (X26 — ไม่ต้องแปลงเป็น Date)
}
