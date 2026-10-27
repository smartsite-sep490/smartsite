import type { RoleAssignmentResponse } from '@smartsite/contracts/management';

// Navigation is the union of explicitly assigned roles. An administrator may
// observe business workspaces; write capabilities remain scoped to their owners.
export function workspaceTabs(assignments: readonly RoleAssignmentResponse[]): string[] {
  const admin = assignments.some((r) => r.role === 'ADMIN' && r.siteId === null);
  const has = (...roles: string[]) =>
    assignments.some((r) => r.siteId !== null && roles.includes(r.role));
  const tabs: string[] = [];
  // This dashboard links to aggregate safety/camera monitoring. Representatives
  // use their scoped team workspace instead of these staff-only functions.
  if (admin || has('SITE_MANAGER', 'SAFETY_OFFICER')) tabs.push('dashboard');
  if (has('CONTRACTOR_REPRESENTATIVE'))
    tabs.push('contractor-teams', 'worker-onboarding', 'assigned-work');
  if (has('SITE_MANAGER', 'CONTRACTOR_REPRESENTATIVE', 'WORKER')) tabs.push('workforce');
  if (admin) tabs.push('accounts');
  if (admin || has('SITE_MANAGER')) tabs.push('site-setup');
  if (has('SITE_MANAGER', 'CONTRACTOR_REPRESENTATIVE')) tabs.push('schedule-setup');
  if (admin || has('SITE_MANAGER', 'CONTRACTOR_REPRESENTATIVE', 'SECURITY_OFFICER', 'WORKER'))
    tabs.push('access');
  if (admin || has('SITE_MANAGER', 'SAFETY_OFFICER')) tabs.push('live-monitoring', 'ppe', 'zones');
  if (admin || has('SITE_MANAGER', 'SAFETY_OFFICER')) tabs.push('incidents');
  if (has('WORKER', 'CONTRACTOR_REPRESENTATIVE', 'SAFETY_OFFICER')) tabs.push('worker-documents');
  return tabs;
}

export function defaultWorkspace(assignments: readonly RoleAssignmentResponse[]): string {
  const tabs = workspaceTabs(assignments);
  // Main opens the Safety overview directly instead of the aggregate dashboard.
  if (
    tabs.includes('incidents') &&
    assignments.some((r) => r.role === 'SAFETY_OFFICER') &&
    !assignments.some((r) =>
      ['ADMIN', 'SITE_MANAGER', 'CONTRACTOR_REPRESENTATIVE'].includes(r.role),
    )
  )
    return 'incidents';
  if (
    assignments.length &&
    assignments.every((r) => r.role === 'WORKER') &&
    tabs.includes('workforce')
  )
    return 'workforce';
  return tabs.includes('dashboard') ? 'dashboard' : (tabs[0] ?? 'no-access');
}

export function isSecurityWorkspaceOnly(assignments: readonly RoleAssignmentResponse[]): boolean {
  return (
    assignments.length > 0 &&
    assignments.every(({ role, siteId }) => role === 'SECURITY_OFFICER' && siteId !== null)
  );
}
