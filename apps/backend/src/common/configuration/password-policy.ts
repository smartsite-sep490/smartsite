export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_POLICY_MESSAGE =
  'Password must be 8–128 characters and include an uppercase letter, a number, and a special character';

export const PASSWORD_POLICY_PATTERN =
  /^(?=[\s\S]{8,128}$)(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s])(?:[^\p{Cc}\p{Cs}])+$/u;

export function isValidPassword(value: unknown): value is string {
  return typeof value === 'string' && PASSWORD_POLICY_PATTERN.test(value);
}
