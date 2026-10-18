export interface GetMyPreT3Res {
    success: boolean;
    data:    Datum[];
}

export interface Datum {
    pre_t3_id:            number;
    overall_status:       string;
    resubmit_count:       number;
    last_rejected_at:     null;
    journal_snapshot:     JournalSnapshot;
    checklist_data:       { [key: string]: boolean };
    article_info?:        { title_en?: string | null; title_th?: string | null };
    advisor_approval:     AdvisorApproval;
    faculty_com_approval: FacultyCOMApproval;
    created_at:           Date;
    updated_at:           Date;
}

export interface AdvisorApproval {
    remark:      string | null;
    status:      string;
    user_id:     number;
    approved_at: Date | null;
}

export interface FacultyCOMApproval {
    remark:       string | null;
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
