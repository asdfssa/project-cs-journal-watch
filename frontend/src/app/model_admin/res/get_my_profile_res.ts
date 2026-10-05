export interface GetMyProfileRes {
    success: boolean;
    data:    Data;
}

export interface Data {
    userId:        number;
    role:          string;
    prefix:        string | null;
    firstName:     string;
    lastName:      string;
    faculty:       string | null;
    department:    string | null;
    msuMail:       string;
    phone:         string | null;
    facebookId:    string | null;
    lineId:        string | null;
    accountStatus: string;
    lastLoginAt:   Date;
    username:      string;
}
