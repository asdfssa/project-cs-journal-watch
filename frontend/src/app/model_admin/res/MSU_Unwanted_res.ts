export interface MSUUnwantedRes {
    success: boolean;
    data:    Data;
}

export interface Data {
    journals:   Journal[];
    pagination: Pagination;
}

export interface Journal {
    unwanted_id:        number;
    issn:               string;
    journal_name:       string;
    publisher:          string;
    note:               string;
    evidence_file_path: null;
    recorded_date:      Date;
    created_at:         Date;
    first_name:         string;
    last_name:          string;
    msu_mail:           string;
}

export interface Pagination {
    total:      number;
    page:       number;
    limit:      number;
    totalPages: number;
}
