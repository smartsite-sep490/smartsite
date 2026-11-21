export interface RequestPasswordResetCommand {
  identifier: string;
  language?: 'vi' | 'en';
}
export interface ConfirmPasswordResetCommand {
  identifier: string;
  code: string;
  password: string;
}
export interface SetAccountEmailCommand {
  email: string;
  currentPassword: string;
  language?: 'vi' | 'en';
}
export interface VerifyAccountEmailCommand {
  code: string;
}
export interface AccountEmailChallengeResponse {
  accepted: true;
}
