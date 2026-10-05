export interface PreT3HistoryAdvisor {
    success: boolean;
    data:    Data;
}

export interface Data {
    items:      Item[];
    total:      number;
    page:       number;
    limit:      number;
    totalPages: number;
}

export interface Item {
    pre_t3_id:             number;
    student_name:          string;
    student_email:         string;
    overall_status:        string;
    resubmit_count:        number;
    journal_snapshot:      JournalSnapshot;
    article_info:          ArticleInfo | null;
    advisor_approval:      Approval;
    co_advisor_1_approval: Approval;
    co_advisor_2_approval: Approval;
    faculty_com_approval:  FacultyCOMApproval;
    created_at:            Date;
    updated_at:            Date;
}

export interface Approval {
    remark:      null;
    status:      Status;
    user_id:     number | null;
    approved_at: Date | null;
}

export enum Status {
    Approved = "Approved",
    NA = "N/A",
    Pending = "Pending",
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
    remark:       null | string;
    status:       string;
    meeting_no:   null | string;
    approved_at:  Date;
    meeting_date: Date | null;
}

export interface JournalSnapshot {
    issn:             string;
    eissn?:           string;
    sjr_score?:       number;
    cite_score?:      number;
    is_hijacked:      boolean;
    journal_url:      string;
    journal_name:     string;
    is_discontinued:  boolean;
    indexed_database: string;
    quartile_or_tier: string;
}
