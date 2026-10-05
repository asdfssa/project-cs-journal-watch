export interface DetilsBugReportsRes {
    success: boolean;
    data:    Data;
}

export interface Data {
    report_id:           number;
    category:            string;
    title:               string;
    description:         string;
    page_url:            string;
    screenshot_path:     null;
    status:              string;
    resolved_note:       null;
    resolved_at:         Date;
    created_at:          Date;
    updated_at:          Date;
    reporter_id:         number;
    reporter_first_name: string;
    reporter_last_name:  string;
    reporter_email:      string;
    reporter_role:       string;
    resolver_id:         number;
    resolver_first_name: string;
    resolver_last_name:  string;
}
