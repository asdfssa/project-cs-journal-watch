export interface LoginRes {
    success: boolean;
    message: string;
    data:    Data;
}

export interface Data {
    accessToken:  string;
    user:         User;
}

export interface User {
    userId:      number;
    role:        string;
    firstName:   string;
    lastName:    string;
    msuMail:     string;
    degreeLevel: string | null;
}
