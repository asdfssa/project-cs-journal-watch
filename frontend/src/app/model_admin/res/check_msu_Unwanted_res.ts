export interface CheckMsuUnwantedRes {
    success: boolean;
    data:    Data;
}

export interface Data {
    isUnwanted: boolean;
    journal:    Journal;
}

export interface Journal {
    unwanted_id:   number;
    issn:          string;
    journal_name:  string;
    publisher:     string;
    note:          string;
    recorded_date: Date;
    created_at:    Date;
}
