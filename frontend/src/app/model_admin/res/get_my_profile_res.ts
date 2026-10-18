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
    department:    string | null;
    msuMail:       string;
    phone:         string | null;
    facebookId:    string | null;
    lineId:        string | null;
    accountStatus: string;
    username:      string;
}
