import type { UserNotificationResponse } from '@smartsite/api-client';
import type { NavigationTarget } from '../../SmartSiteMobileApp';
export function notificationTarget(
  notification: UserNotificationResponse,
  siteId: string,
  role: 'worker' | 'contractor',
): NavigationTarget | null {
  const target = notification.target;
  if (target.siteId !== siteId) return null;
  if (target.tab === 'documents' && 'workerId' in target)
    return role === 'worker'
      ? { route: 'profile', kind: 'documents' }
      : { route: 'workforce', id: target.workerId, kind: 'documents' };
  if ('checklistId' in target)
    return role === 'contractor'
      ? { route: 'assigned', id: target.checklistId, kind: 'checklist' }
      : null;
  if ('incidentId' in target)
    return role === 'contractor'
      ? { route: 'assigned', id: target.incidentId, kind: 'incident' }
      : null;
  if ('requestId' in target)
    return { route: 'requests', id: target.requestId, kind: target.requestType };
  if ('dayId' in target) return { route: 'attendance', id: target.dayId };
  if ('workDate' in target) return { route: 'schedule', workDate: target.workDate };
  return null;
}
