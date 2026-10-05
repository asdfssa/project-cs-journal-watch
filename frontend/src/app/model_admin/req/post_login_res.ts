/** body ที่ส่งไป POST /auth/login */
export interface PostLoginReq {
  username: string;
  password: string;
}

/** response ที่ได้กลับมาจาก POST /auth/login */
export interface PostLoginRes {
  success: boolean;
  message: string;
  data: {
    otpToken: string;
    maskedEmail: string;
    expiresIn: number;
  };
}
