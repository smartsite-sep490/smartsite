import type { CorrectiveActionStatus, IncidentStatus } from '@smartsite/contracts';

export function incidentStatus(
  previous: IncidentStatus,
  actions: CorrectiveActionStatus[],
): IncidentStatus {
  if (previous === 'CLOSED') return 'CLOSED';
  if (!actions.length) return 'OPEN';
  const outstanding = actions.filter((status) => status !== 'CLOSED');
  if (previous === 'REOPENED' && outstanding.every((status) => status === 'ASSIGNED'))
    return 'REOPENED';
  if (actions.every((status) => status === 'VERIFIED' || status === 'CLOSED')) return 'VERIFIED';
  if (outstanding.every((status) => status === 'ASSIGNED')) return 'ASSIGNED';
  return 'IN_PROGRESS';
}
export function canCloseIncident(actions: CorrectiveActionStatus[], pending: boolean): boolean {
  return (
    !!actions.length &&
    !pending &&
    actions.every((status) => status === 'VERIFIED' || status === 'CLOSED')
  );
}
