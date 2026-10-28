import { expect, it } from 'vitest';
import type { UserNotificationResponse } from '@smartsite/api-client';
import { notificationTarget } from './notification-target';
const notification = (target: UserNotificationResponse['target']) =>
  ({ target }) as UserNotificationResponse;
it('routes by the actual resource ID and type', () => {
  expect(
    notificationTarget(
      notification({ siteId: 'a', dayId: 'day-2', tab: 'attendance' }),
      'a',
      'worker',
    ),
  ).toEqual({ route: 'attendance', id: 'day-2' });
  expect(
    notificationTarget(
      notification({ siteId: 'a', checklistId: 'check-1', tab: 'checklists' }),
      'a',
      'contractor',
    ),
  ).toEqual({ route: 'assigned', id: 'check-1', kind: 'checklist' });
  expect(
    notificationTarget(
      notification({
        siteId: 'a',
        requestId: 'swap-1',
        requestType: 'SWAP',
        tab: 'schedule',
        view: 'coworker',
      }),
      'a',
      'worker',
    ),
  ).toEqual({ route: 'requests', id: 'swap-1', kind: 'SWAP' });
});
it('does not open another site or an assigned safety workspace for Worker', () => {
  expect(
    notificationTarget(
      notification({ siteId: 'b', dayId: 'other-day', tab: 'attendance' }),
      'a',
      'worker',
    ),
  ).toBeNull();
  expect(
    notificationTarget(
      notification({ siteId: 'a', checklistId: 'check-1', tab: 'checklists' }),
      'a',
      'worker',
    ),
  ).toBeNull();
});

it('opens a Safety handover Incident only for the current Site contractor workspace', () => {
  const handover = notification({
    siteId: 'a',
    incidentId: 'incident-a',
    actionId: 'action-a',
    tab: 'incidents',
  });
  expect(notificationTarget(handover, 'a', 'contractor')).toEqual({
    route: 'assigned',
    id: 'incident-a',
    kind: 'incident',
  });
  expect(notificationTarget(handover, 'a', 'worker')).toBeNull();
  expect(notificationTarget(handover, 'b', 'contractor')).toBeNull();
});
