export interface GetAdminListRes {
    success: boolean;
    data:    Data;
}

export interface Data {
    admins:     Admin[];
    pagination: Pagination;
}

export interface Admin {
    user_id:        number;
    username:       string;
    first_name:     string;
    last_name:      string;
    msu_mail:       string;
    role:           string;
    account_status: string;
    created_at:     Date;
    last_login_at:  Date;
}

export interface Pagination {
    total:      number;
    page:       number;
    limit:      number;
    totalPages: number;
}
