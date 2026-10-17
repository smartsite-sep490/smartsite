import { expect, it } from 'vitest';
import { deriveZonePpeCapabilities } from './zone-ppe-scope';

it.each([
  ['SITE_MANAGER', 'site-a', false, true],
  ['SITE_MANAGER', 'site-b', false, false],
  ['SITE_MANAGER', 'site-a', true, false],
  ['ADMIN', null, false, false],
  ['SAFETY_OFFICER', 'site-a', false, false],
  ['WORKER', 'site-a', false, false],
] as const)('configuration writes follow Main for %s at %s', (role, siteId, password, allowed) => {
  expect(
    deriveZonePpeCapabilities(
      { mustChangePassword: password, roleAssignments: [{ role, siteId }] },
      'site-a',
    ),
  ).toEqual({ canManageZones: allowed, canManageRegions: allowed });
});
