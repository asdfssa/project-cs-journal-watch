export interface PreT3DetailsRes {
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
    student_info?:          StudentInfo;
    advisor_info:           AdvisorInfo;
    article_info:           ArticleInfo;
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
    approved_at: null;
}

export interface AdvisorInfo {
    remark:                null;
    co_advisor_1:          string;
    co_advisor_2:          null;
    main_advisor_name:     string;
    main_advisor_position: string;
}

export interface ArticleInfo {
    doi:          null;
    authors:      null;
    abstract:     null;
    title_en:     null;
    title_th:     null;
    publish_year: null;
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

export interface StudentInfo {
    phone:        string;
    faculty:      string;
    msu_mail:     string;
    full_name:    string;
    department:   string;
    student_id:   number;
    degree_level: string;
}

export interface StudentSnapshot {
    degree_level:    string;
    curriculum_year: string;
    study_plan_code: string;
}
