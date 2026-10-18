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
    /** สาขาวิชา (เฉพาะนิสิต) — null = ยังไม่ระบุ · ค่าดู departments.ts */
    department:      null | string;
    created_at:      Date;
    advisors:        Advisors;
    /** X44: เฉพาะแถว Supervisor — จำนวนนิสิตที่เป็น Major + Co_1 + Co_2 (backend นับจาก DB ทั้งหมด) */
    student_count?:  number;
}

export enum AccountStatus {
    Active = "Active",
    Pending = "Pending",
    Suspended = "Suspended",
}

export interface Advisors {
    Major?: Co1;
    Co_1?:  Co1;
    Co_2?:  Co1;
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
