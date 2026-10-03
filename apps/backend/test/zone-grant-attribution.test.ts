import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ZoneAccessEffect } from '../src/database/entities/zone-access-grant.entity.js';
import type { AuthenticatedRequest } from '../src/modules/auth/auth.service.js';
import { ZoneAccessController } from '../src/modules/zones/zone-access.controller.js';
import type { ZoneAccessManagementService } from '../src/modules/zones/zone-access-management.service.js';

const userId = '00000000-0000-4000-8000-000000000001';
const siteId = '00000000-0000-4000-8000-000000000002';
const zoneId = '00000000-0000-4000-8000-000000000003';
const id = '00000000-0000-4000-8000-000000000004';
const request = { user: { id: userId } } as AuthenticatedRequest;

for (const method of ['createGrant', 'revokeGrant'] as const) {
  test(`MF06 HTTP ${method} attributes the command to USER rather than the internal SERVICE default`, async () => {
    let received: unknown[] | undefined;
    const access = {
      [method]: async (...args: unknown[]) => {
        received = args;
        return { id, siteId, zoneId };
      },
    } as unknown as ZoneAccessManagementService;
    const controller = new ZoneAccessController(access);
    if (method === 'createGrant')
      await controller.create(request, siteId, zoneId, {
        workerId: id,
        effect: ZoneAccessEffect.DENY,
        validFrom: '2026-10-01T00:00:00Z',
        validUntil: null,
      });
    else await controller.revoke(request, siteId, zoneId, id);
    assert.ok(received);
    assert.deepEqual(received.at(-1), { kind: 'USER', userId });
  });
}
