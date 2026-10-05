export interface T3HistorySatffRes {
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
    t3_id:                      number;
    pre_t3_id:                  number;
    student_name:               string;
    student_email:              string;
    issn:                       string;
    overall_status:             string;
    journal_snapshot:           JournalSnapshot;
    paper_and_research_details: PaperAndResearchDetails;
    publication_details:        PublicationDetails;
    advisor_approval:           Approval;
    faculty_com_approval:       FacultyCOMApproval;
    grad_school_approval:       Approval;
    created_at:                 Date;
    updated_at:                 Date;
}

export interface Approval {
    remark:             null;
    status:             string;
    user_id?:           number;
    approved_at:        Date;
    approved_by_email?: null;
}

export interface FacultyCOMApproval {
    remark:       null;
    status:       string;
    meeting_no:   string;
    approved_at:  Date;
    meeting_date: Date;
}

export interface JournalSnapshot {
    issn:         string;
    journal_name: string;
}

export interface PaperAndResearchDetails {
    title_thai:           string;
    first_author:         string;
    title_english:        string;
    innovation_type:      string;
    innovation_detail:    string;
    corresponding_author: string;
}

export interface PublicationDetails {
    type:               string;
    issue:              string;
    status:             string;
    volume:             string;
    publish_year:       string;
    weight_score:       number;
    specified_database: string;
}
