import { vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
export const gateFixture = (siteId: string) =>
  [1, 2, 3].map((n) => ({
    id: `a1000000-0000-4000-8000-00000000000${n}`,
    siteId,
    code: `G${n}`,
    name: `Gate ${n} — Synthetic entrance`,
    status: 'ACTIVE' as const,
  }));
export function mockGateCatalog() {
  vi.spyOn(SmartSiteManagementClient.prototype, 'listAllSiteGates').mockImplementation(
    async (_token, siteId) => ({ items: gateFixture(siteId), total: 3 }),
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'listVisitorGates').mockImplementation(
    async (siteId) => ({
      items: gateFixture(siteId).map(({ id, code, name }) => ({ id, code, name })),
    }),
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'listGateSources').mockImplementation(
    async (_token, siteId, gateId) => ({
      items: [
        {
          id: gateId.replace(/^a/, 'c'),
          siteId,
          gateId,
          name: 'Registered webcam',
          code: 'GATE-CAMERA',
        },
      ],
    }),
  );
}
