export interface GetAdvisorProfileRes {
    success: boolean;
    data:    Data;
}

export interface Data {
    userId:        number;
    role:          string;
    prefix:        string;
    firstName:     string;
    lastName:      string;
    department:    string;
    msuMail:       string;
    phone:         string;
    facebookId:    string;
    lineId:        string;
    accountStatus: string;
}
