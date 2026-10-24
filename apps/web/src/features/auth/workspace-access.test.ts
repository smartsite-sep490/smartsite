import { expect, it } from 'vitest';
import { workspaceTabs } from './workspace-access';

it.each([
  ['ADMIN', null, true],
  ['SITE_MANAGER', 'site-a', true],
  ['SITE_MANAGER', null, false],
  ['SAFETY_OFFICER', 'site-a', false],
  ['CONTRACTOR_REPRESENTATIVE', 'site-a', false],
  ['WORKER', 'site-a', false],
] as const)('keeps setup navigation scoped for %s at %s', (role, siteId, allowed) => {
  expect(workspaceTabs([{ role, siteId }]).includes('camera-setup')).toBe(allowed);
});

it('retains Main navigation for combined roles and denies unassigned accounts', () => {
  expect(workspaceTabs([])).toEqual([]);
  const tabs = workspaceTabs([
    { role: 'SITE_MANAGER', siteId: 'site-a' },
    { role: 'CONTRACTOR_REPRESENTATIVE', siteId: 'site-b' },
  ]);
  expect(tabs).toContain('camera-setup');
  expect(tabs).toContain('contractor-teams');
  expect(tabs).toContain('schedule-setup');
  expect(tabs).not.toContain('accounts');
});
