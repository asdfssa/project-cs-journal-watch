export interface OtpRes {
    success: boolean;
    message: string;
    data:    Data;
}

export interface Data {
    otpToken:    string;
    maskedEmail: string;
    expiresIn:   number;
}
