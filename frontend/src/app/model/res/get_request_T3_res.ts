export interface GetRequestT3Res {
    success: boolean;
    data:    Datum[];
}

export interface Datum {
    t3_id:                      number;
    pre_t3_id:                  number;
    student_name:               string;
    student_email:              string;
    overall_status:             string;
    journal_snapshot:           JournalSnapshot;
    paper_and_research_details: PaperAndResearchDetails;
    publication_details:        PublicationDetails;
    advisor_approval:           Approval;
    co_advisor_1_approval:      Approval;
    co_advisor_2_approval:      Approval;
    faculty_com_approval:       FacultyCOMApproval;
    created_at:                 Date;
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
