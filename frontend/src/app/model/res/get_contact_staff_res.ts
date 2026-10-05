export interface GetContactStaffRes {
    success: boolean;
    data:    Data;
}

export interface Data {
    staff: Staff[];
    total: number;
}

export interface Staff {
    userId:     number;
    prefix:     null;
    firstName:  string;
    lastName:   string;
    faculty:    null;
    department: null;
    msuMail:    string;
    phone:      null;
    facebookId: null;
    lineId:     null;
}
