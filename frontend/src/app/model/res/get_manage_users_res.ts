export interface GetManageUsersRes {
    success: boolean;
    data:    Data;
}

export interface Data {
    users:      User[];
    pagination: Pagination;
}

export interface Pagination {
    total:      number;
    page:       number;
    limit:      number;
    totalPages: number;
}

export interface User {
    user_id:         number;
    prefix:          null | string;
    first_name:      string;
    last_name:       string;
    msu_mail:        string;
    role:            Role;
    degree_level:    DegreeLevel | null;
    account_status:  AccountStatus;
    phone:           null | string;
    facebook_id:     null | string;
    line_id:         null | string;
    curriculum_year: null | string;
    study_plan_code: null | string;
    created_at:      Date;
    last_login_at:   Date | null;
    advisors:        Advisors;
}

export enum AccountStatus {
    Active = "Active",
    Suspended = "Suspended",
}

export interface Advisors {
    Major?: Co1;
    Co_1?:  Co1;
}

export interface Co1 {
    mail: string;
    name: string;
}

export enum DegreeLevel {
    Doctoral = "Doctoral",
    Master = "Master",
}

export enum Role {
    Staff = "Staff",
    Student = "Student",
    Supervisor = "Supervisor",
}
