export interface GetProfileStaffRes {
    success: boolean;
    data:    Data;
}

export interface Data {
    userId:        number;
    role:          string;
    prefix:        null;
    firstName:     string;
    lastName:      string;
    faculty:       null;
    department:    null;
    msuMail:       string;
    phone:         null;
    facebookId:    null;
    lineId:        null;
    accountStatus: string;
    lastLoginAt:   Date;
}
