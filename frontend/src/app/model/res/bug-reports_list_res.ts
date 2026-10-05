export interface BugReportsListRes {
    success: boolean;
    data:    Data;
}

export interface Data {
    rows:       any[];
    total:      number;
    page:       number;
    limit:      number;
    totalPages: number;
}
