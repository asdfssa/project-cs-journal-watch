export interface GetPreT3DeteilsStaffRes {
    success: boolean;
    data:    Data;
}

export interface Data {
    pre_t3_id:              number;
    student_id:             number;
    student_name:           string;
    student_email:          string;
    overall_status:         string;
    resubmit_count:         number;
    last_rejected_at:       null;
    journal_snapshot:       JournalSnapshot;
    student_snapshot:       StudentSnapshot;
    student_info:           null;
    advisor_info:           null;
    article_info:           null;
    checklist_data:         { [key: string]: boolean };
    advisor_approval:       Approval;
    co_advisor_1_approval:  Approval;
    co_advisor_2_approval:  Approval;
    program_chair_approval: Approval;
    faculty_com_approval:   FacultyCOMApproval;
    created_at:             Date;
    updated_at:             Date;
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
    meeting_no:   string;
    approved_at:  Date;
    meeting_date: Date;
}

export interface JournalSnapshot {
    issn:             string;
    is_hijacked:      boolean;
    journal_url:      string;
    journal_name:     string;
    is_discontinued:  boolean;
    indexed_database: string;
    quartile_or_tier: string;
}

export interface StudentSnapshot {
    degree_level:    string;
    curriculum_year: null;
    study_plan_code: null;
}
