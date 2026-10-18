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
    evidence_file_path: string | null;
    recorded_date:      Date;
    created_at:         Date;
    // B49: นิสิต/อาจารย์ได้ null (backend ซ่อนข้อมูลผู้บันทึก)
    first_name:         string | null;
    last_name:          string | null;
    msu_mail:           string | null;
}

export interface Pagination {
    total:      number;
    page:       number;
    limit:      number;
    totalPages: number;
}
