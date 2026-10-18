export interface GetPreT3RequestRes {
    success: boolean;
    data:    Datum[];
}

export interface Datum {
    // X16: มีเฉพาะ response ของอาจารย์ — can_review = เป็นอาจารย์หลัก + ช่องตัวเองยัง Pending + คำร้องยัง Pending
    my_role?:    'Major' | 'Co_1' | 'Co_2' | null;
    can_review?: boolean;
    pre_t3_id:             number;
    student_name:          string;
    student_email:         string;
    overall_status:        string;
    journal_snapshot:      JournalSnapshot;
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
    approved_at: null;
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
