import { ApiError } from '@smartsite/api-client';
import type { ProvisionableRoleAssignment } from '@smartsite/contracts';

export const ACCOUNT_ROLES = [
  'ADMIN',
  'SITE_MANAGER',
  'CONTRACTOR_REPRESENTATIVE',
  'SAFETY_OFFICER',
  'SECURITY_OFFICER',
  'WORKER',
] as const satisfies readonly ProvisionableRoleAssignment['role'][];

export function validAssignments(assignments: ProvisionableRoleAssignment[]): boolean {
  return (
    assignments.length > 0 &&
    assignments.every(
      (assignment, index) =>
        (assignment.role === 'ADMIN' ? assignment.siteId === null : Boolean(assignment.siteId)) &&
        assignments.findIndex(
          (other) => other.role === assignment.role && other.siteId === assignment.siteId,
        ) === index,
    )
  );
}

export function validTemporaryPassword(password: string): boolean {
  return /^(?=[\s\S]{8,128}$)(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s])(?:[^\p{Cc}\p{Cs}])+$/u.test(
    password,
  );
}

export function accountErrorKey(
  error: unknown,
  operation?: 'create' | 'roles' | 'password' | 'status',
): string {
  if (!(error instanceof ApiError)) return 'accounts.errorUnexpected';
  if (error.status === 401) return 'accounts.errorSession';
  if (error.status === 403) return 'accounts.denied';
  if (error.status === 404) return 'accounts.errorMissing';
  if (error.status === 409)
    return operation === 'roles' || operation === 'status'
      ? 'accounts.errorLastAdmin'
      : 'accounts.errorConflict';
  if (error.status === 400) return 'accounts.errorValidation';
  if (error.status === 429) return 'accounts.errorRate';
  return 'accounts.errorUnexpected';
}

export const accountControl =
  'min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-800 placeholder-slate-400 transition-all shadow-2xs hover:border-slate-300 focus:border-[#F66B17] focus:outline-none focus:ring-2 focus:ring-orange-100 disabled:bg-slate-50 disabled:text-slate-500';

export const accountButton =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition-all hover:bg-slate-50 hover:border-slate-300 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer';
