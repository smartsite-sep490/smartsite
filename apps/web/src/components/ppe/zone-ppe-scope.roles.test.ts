import { expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { deriveZonePpeCapabilities, getZonePpeScopeKey } from './zone-ppe-scope';

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

it('isolates policy and region drafts while retaining the legacy combined-section identity', () => {
  const cache = new QueryClient();
  const scope = {
    apiUrl: 'https://api.example.test',
    sessionScope: 'session',
    credentialId: 1,
    siteId: 'site-a',
    token: 'synthetic-private-token',
    canManageZones: true,
    canManageRegions: true,
  };
  const all = { ...scope, section: 'all' as const };
  const zones = { ...scope, section: 'zones' as const };
  const regions = { ...scope, section: 'regions' as const };
  expect(getZonePpeScopeKey(cache, scope)).toBe(getZonePpeScopeKey(cache, all));
  expect(getZonePpeScopeKey(cache, zones)).not.toBe(getZonePpeScopeKey(cache, regions));
  expect(getZonePpeScopeKey(cache, all)).not.toBe(getZonePpeScopeKey(cache, zones));
  expect(getZonePpeScopeKey(cache, regions)).not.toContain(scope.token);
});
