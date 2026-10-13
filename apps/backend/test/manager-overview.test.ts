import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { ManagerOverviewController } from '../src/modules/workforce/management/manager-overview.controller.js';
import { ManagerOverviewService } from '../src/modules/workforce/management/manager-overview.service.js';
import { SiteManagerGuard } from '../src/modules/auth/site-manager.guard.js';
import { UserAuthGuard } from '../src/modules/auth/user-auth.guard.js';
import { AdminGuard } from '../src/modules/auth/user-auth.guard.js';
import { ContractorParticipationQueryController } from '../src/modules/workforce/directory/contractor-participation-query.controller.js';
import { ContractorParticipationQueryService } from '../src/modules/workforce/directory/contractor-participation-query.service.js';
import { UserRole } from '../src/database/entities/user.entity.js';

test('management HTTP reads require authentication and scoped Site Manager authorization', () => {
  const guards = Reflect.getMetadata(GUARDS_METADATA, ManagerOverviewController);
  assert.ok(guards.includes(UserAuthGuard));
  assert.ok(guards.includes(SiteManagerGuard));
});

test('global participation HTTP reads require Admin and fail closed when authorization storage is unavailable', async () => {
  const guards = Reflect.getMetadata(GUARDS_METADATA, ContractorParticipationQueryController);
  assert.ok(guards.includes(UserAuthGuard));
  assert.ok(guards.includes(AdminGuard));
  const source = new DataSource({ type: 'postgres' });
  const actor = {
    id: randomUUID(),
    username: 'synthetic',
    displayName: 'Synthetic',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
  };
  await assert.rejects(
    new ContractorParticipationQueryService(source).participations(actor, randomUUID()),
  );
  await assert.rejects(new ContractorParticipationQueryService(source).contractors(actor));
});
test('unavailable scope database cannot produce a management overview', async () => {
  const source = new DataSource({ type: 'postgres' });
  const siteId = randomUUID();
  const actor = {
    id: randomUUID(),
    username: 'synthetic',
    displayName: 'Synthetic',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId }],
  };
  await assert.rejects(new ManagerOverviewService(source).overview(actor, siteId));
});
