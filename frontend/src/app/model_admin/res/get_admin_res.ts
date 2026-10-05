export interface GetAdminRes {
    success: boolean;
    data:    Data;
}

export interface Data {
    userId:        number;
    role:          string;
    prefix:        null;
    firstName:     string;
    lastName:      string;
    msuMail:       string;
    phone:         null;
    accountStatus: string;
    lastLoginAt:   Date;
    username:      string;
    picture?:      string;   // Google profile picture URL (optional)
}
