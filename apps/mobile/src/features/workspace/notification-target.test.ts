import { expect, it } from 'vitest';
import type { UserNotificationResponse } from '@smartsite/api-client';
import { notificationTarget } from './notification-target';
const notification = (target: UserNotificationResponse['target']) =>
  ({ target }) as UserNotificationResponse;
it('opens the exact day for a missing leader roll-call review', () => {
  const notice = {
    ...notification({ siteId: 'a', dayId: 'zone-review-day', tab: 'attendance' }),
    event: 'ZONE_REVIEW_REQUIRED',
  } as UserNotificationResponse;
  expect(notificationTarget(notice, 'a', 'contractor')).toEqual({
    route: 'attendance',
    id: 'zone-review-day',
  });
  expect(notificationTarget(notice, 'other', 'contractor')).toBeNull();
});
it('opens the exact attendance day for an absence review notice', () => {
  const notice = {
    ...notification({ siteId: 'a', dayId: 'missing-gate-day', tab: 'attendance' }),
    event: 'ABSENCE_REVIEW_REQUIRED',
  } as UserNotificationResponse;
  expect(notificationTarget(notice, 'a', 'contractor')).toEqual({
    route: 'attendance',
    id: 'missing-gate-day',
  });
  expect(notificationTarget(notice, 'other', 'contractor')).toBeNull();
});
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
  ).toEqual({ route: 'requests', id: 'swap-1', kind: 'SWAP', requestView: 'INCOMING' });
});
it('opens leave and overtime requests instead of the attendance day for both mobile roles', () => {
  const notice = notification({
    siteId: 'a',
    dayId: 'day',
    tab: 'attendance',
    requestId: 'time-request',
    requestType: 'TIME',
  });
  for (const role of ['worker', 'contractor'] as const)
    expect(notificationTarget(notice, 'a', role)).toEqual({
      route: 'requests',
      id: 'time-request',
      kind: 'TIME',
    });
  expect(notificationTarget(notice, 'other', 'contractor')).toBeNull();
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
    actionId: 'action-a',
  });
  expect(notificationTarget(handover, 'a', 'worker')).toBeNull();
  expect(notificationTarget(handover, 'b', 'contractor')).toBeNull();
});

it('keeps old handover notices without an action target compatible', () => {
  expect(
    notificationTarget(
      notification({
        siteId: 'a',
        incidentId: 'incident-a',
        tab: 'incidents',
      } as UserNotificationResponse['target']),
      'a',
      'contractor',
    ),
  ).toEqual({ route: 'assigned', id: 'incident-a', kind: 'incident' });
});
