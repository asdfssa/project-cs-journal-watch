export interface GetT3Res {
    success: boolean;
    data:    Datum[];
}

export interface Datum {
    t3_id:                      number;
    pre_t3_id:                  number;
    issn:                       string;
    overall_status:             string;
    journal_snapshot:           JournalSnapshot;
    paper_and_research_details: PaperAndResearchDetails;
    publication_details:        PublicationDetails;
    journal_metrics:            JournalMetrics;
    advisor_approval:           Approval;
    faculty_com_approval:       FacultyCOMApproval;
    grad_school_approval:       Approval;
    submission_date:            null;
    submission_round_cutoff:    null;
    created_at:                 Date;
    updated_at:                 Date;
}

export interface Approval {
    remark:             null;
    status:             string;
    user_id?:           number;
    approved_at:        null;
    approved_by_email?: null;
}

export interface FacultyCOMApproval {
    remark:       null;
    status:       string;
    meeting_no:   null;
    approved_at:  null;
    meeting_date: null;
}

export interface JournalMetrics {
    citescore:        number;
    score_year:       string;
    impact_factor:    number;
    has_impact_score: boolean;
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
