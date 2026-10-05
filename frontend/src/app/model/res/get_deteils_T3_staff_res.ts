export interface GetDeteilsT3StaffRes {
    success: boolean;
    data:    Data;
}

export interface Data {
    t3_id:                      number;
    pre_t3_id:                  number;
    student_id:                 number;
    student_name:               string;
    student_email:              string;
    issn:                       string;
    overall_status:             string;
    journal_snapshot:           JournalSnapshot;
    student_snapshot:           StudentSnapshot;
    paper_and_research_details: PaperAndResearchDetails;
    publication_details:        PublicationDetails;
    journal_metrics:            JournalMetrics;
    journal_evidence_files:     JournalEvidenceFiles;
    advisor_approval:           Approval;
    co_advisor_1_approval:      Approval;
    co_advisor_2_approval:      Approval;
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
    user_id?:           number | null;
    approved_at:        Date | null;
    approved_by_email?: null;
}

export interface FacultyCOMApproval {
    remark:       null;
    status:       string;
    meeting_no:   string;
    approved_at:  Date;
    meeting_date: Date;
}

export interface JournalEvidenceFiles {
    full_paper_path:         string;
    journal_cover_path:      string;
    acceptance_letter_path:  string;
    database_evidence_path:  string;
    table_of_contents_path:  string;
    peer_review_result_path: string;
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

export interface StudentSnapshot {
    degree_level:    string;
    curriculum_year: string;
    study_plan_code: string;
}
