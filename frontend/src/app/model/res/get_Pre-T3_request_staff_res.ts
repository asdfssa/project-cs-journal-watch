export interface GetPreT3RequestStaffRes {
    success: boolean;
    data:    Datum[];
}

export interface Datum {
    pre_t3_id:             number;
    student_name:          string;
    student_email:         string;
    overall_status:        string;
    journal_snapshot:      JournalSnapshot;
    // X43: backend ส่งมาด้วย (ยืนยันแล้ว 9-10-2569) — title อาจเป็น null ถ้านิสิตไม่กรอก
    article_info?:         { title_en: string | null; title_th: string | null };
    student_snapshot?:     { degree_level: 'Master' | 'Doctoral' | null; study_plan_code?: string | null; curriculum_year?: string | null };
    checklist_data:        { [key: string]: boolean };
    advisor_approval:      Approval;
    co_advisor_1_approval: Approval;
    co_advisor_2_approval: Approval;
    faculty_com_approval:  FacultyCOMApproval;
    created_at:            Date;
}

export interface Approval {
    remark:      null;
    status:      string;
    user_id:     number | null;
    approved_at: Date | null;
}

export interface FacultyCOMApproval {
    remark:       null;
    status:       string;
    meeting_no:   null;
    approved_at:  null;
    meeting_date: null;
}

export interface JournalSnapshot {
    issn:             string;
    eissn:            string;
    sjr_score:        number;
    cite_score:       number;
    is_hijacked:      boolean;
    journal_url:      string;
    journal_name:     string;
    is_discontinued:  boolean;
    indexed_database: string;
    quartile_or_tier: string;
}
