export interface BugReportsRes {
    success: boolean;
    data:    Data;
}

export interface Data {
    rows:       Row[];
    total:      number;
    page:       number;
    limit:      number;
    totalPages: number;
}

export interface Row {
    report_id:           number;
    category:            string;
    title:               string;
    description:         string;
    page_url:            string;
    screenshot_path:     null;
    status:              string;
    resolved_note:       null;
    resolved_at:         Date | null;
    created_at:          Date;
    updated_at:          Date;
    reporter_id:         number;
    reporter_first_name: string;
    reporter_last_name:  string;
    reporter_email:      string;
    reporter_role:       string;
    resolver_id:         number | null;
    resolver_first_name: null | string;
    resolver_last_name:  null | string;
}
