export interface GetMeDataRes {
    success: boolean;
    data:    Data;
}

export interface Data {
    userId:         number;
    role:           string;
    prefix:         null;
    firstName:      string;
    lastName:       string;
    msuMail:        string;
    phone:          null;
    accountStatus:  string;
    lastLoginAt:    Date;
    degreeLevel:    null;
    curriculumYear: null;
    studyPlanCode:  null;
    advisors:       Advisor[];
}

export interface Advisor {
    advisorType: string;
    userId:      number;
    prefix:      null;
    firstName:   string;
    lastName:    string;
    msuMail:     string;
}
