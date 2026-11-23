import { expect, it } from 'vitest';
import {
  safetyViewFromSearch,
  safetyViewHref,
  legacySafetyHref,
} from './safety-operations-navigation';
import { defaultWorkspace } from '../../features/auth/workspace-access';

it.each([
  ['tab=alerts', 'Alerts'],
  ['tab=incidents', 'Incidents'],
  ['tab=checklists', 'Checklists'],
  ['tab=tasks', 'Safety Tasks'],
  ['incidentId=i&actionId=a', 'Incidents'],
  ['checklistId=c', 'Checklists'],
  ['alertId=a', 'Alerts'],
  ['', 'Alerts'],
])('opens the operational view described by %s', (search, view) => {
  expect(safetyViewFromSearch(new URLSearchParams(search))).toBe(view);
});
it('preserves only site context when explicitly changing workspaces', () => {
  expect(
    safetyViewHref('Checklists', new URLSearchParams('siteId=s&incidentId=i&actionId=a')),
  ).toBe('/incidents?siteId=s&tab=checklists');
});
it('keeps overview and document legacy links pointed at their single canonical screen', () => {
  expect(legacySafetyHref(new URLSearchParams('tab=documents&siteId=s&workerId=w'))).toBe(
    '/worker-documents?siteId=s&workerId=w',
  );
  expect(legacySafetyHref(new URLSearchParams('tab=overview&siteId=s'))).toBe(
    '/dashboard?siteId=s',
  );
  for (const tab of ['ppe-frames', 'episodes', 'identification'])
    expect(legacySafetyHref(new URLSearchParams({ tab }))).toBeNull();
});
it('opens the canonical dashboard for a Safety-only session', () => {
  expect(defaultWorkspace([{ role: 'SAFETY_OFFICER', siteId: 's' }])).toBe('dashboard');
  expect(defaultWorkspace([{ role: 'CONTRACTOR_REPRESENTATIVE', siteId: 's' }])).toBe(
    'contractor-teams',
  );
});

it('keeps the existing landing for mixed Safety and Worker roles', () => {
  expect(
    defaultWorkspace([
      { role: 'SAFETY_OFFICER', siteId: 's' },
      { role: 'WORKER', siteId: 's' },
    ]),
  ).toBe('incidents');
});
