export interface SendT3Req {
    pre_t3_id:                  number;
    journal_snapshot:           JournalSnapshot;
    paper_and_research_details: PaperAndResearchDetails;
    publication_details:        PublicationDetails;
    journal_metrics:            JournalMetrics;
}

export interface JournalMetrics {
    has_impact_score: boolean;
    impact_factor:    number;
    citescore:        number;
    score_year:       string;
}

export interface JournalSnapshot {
    issn:         string;
    journal_name: string;
}

export interface PaperAndResearchDetails {
    title_thai:           string;
    title_english:        string;
    first_author:         string;
    corresponding_author: string;
    innovation_type:      string;
    innovation_detail:    string;
}

export interface PublicationDetails {
    type:               string;
    weight_score:       number;
    specified_database: string;
    status:             string;
    volume:             string;
    issue:              string;
    publish_year:       string;
}
