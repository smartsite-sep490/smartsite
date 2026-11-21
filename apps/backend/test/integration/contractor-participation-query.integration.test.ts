import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ContractorParticipationQueryService } from '../../src/modules/workforce/directory/contractor-participation-query.service.js';
import type { AuthenticatedUser } from '../../src/modules/auth/auth.service.js';
import { UserRole } from '../../src/database/entities/user.entity.js';

test('retired global contractor directory denies Admin and scoped roles without reading operational data', async () => {
  const service = new ContractorParticipationQueryService();
  const siteId = randomUUID();
  for (const role of [UserRole.ADMIN, UserRole.SITE_MANAGER, UserRole.SAFETY_OFFICER]) {
    const actor = {
      id: randomUUID(),
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role, siteId: role === UserRole.ADMIN ? null : siteId }],
    } as AuthenticatedUser;
    await assert.rejects(service.contractors(actor), { status: 403 });
    await assert.rejects(service.participations(actor, randomUUID()), { status: 403 });
  }
});
