export interface VerifyOtpRes {
    success: boolean;
    message: string;
    data:    Data;
}

export interface Data {
    accessToken:  string;
    user:         User;
}

export interface User {
    userId:    number;
    username:  string;
    role:      string;
    firstName: string;
    lastName:  string;
}
