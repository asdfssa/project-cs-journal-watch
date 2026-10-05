export interface GetProfileRes {
    success: boolean;
    data:    Data;
}

export interface Data {
    userId:         number;
    role:           string;
    prefix:         string;
    firstName:      string;
    lastName:       string;
    faculty:        string;
    department:     string;
    msuMail:        string;
    phone:          string;
    facebookId:     string;
    lineId:         string;
    accountStatus:  string;
    lastLoginAt:    Date;
    degreeLevel:    string;
    curriculumYear: string;
    studyPlanCode:  string;
    advisors:       Advisor[];
}

export interface Advisor {
    advisorType: string;
    userId:      number;
    prefix:      string | null;
    firstName:   string;
    lastName:    string;
    msuMail:     string;
}
