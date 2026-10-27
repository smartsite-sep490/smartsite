import { participateContractor } from '../support/contractor-participation.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import source from '../support/test-data-source.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { SiteRepresentativesService } from '../../src/modules/users/site-representatives.controller.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { WorkforceConfigurationService } from '../../src/modules/workforce/directory/workforce-configuration.service.js';
import { UserEntity, UserRole } from '../../src/database/entities/user.entity.js';
import { UserRoleAssignmentEntity } from '../../src/database/entities/user-role-assignment.entity.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { JwtService } from '@nestjs/jwt';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';
import { createTestConfig } from '../support/config.js';

after(async () => {
  if (source.isInitialized) await source.destroy();
});

test('revoking a single Site Manager assignment releases the Site, preserves other roles and revokes sessions', async () => {
  if (!source.isInitialized) await source.initialize();
  const sites = new SiteConfigurationService(source);
  const users = new UsersService(source, sites);
  const auth = new AuthService(source, new AuthTokenService(new JwtService(), createTestConfig()));
  const site = await sites.create({ code: randomUUID(), name: 'Revocation site' });
  const other = await sites.create({ code: randomUUID(), name: 'Other revocation site' });
  const account = await users.create({
    username: `manager-${randomUUID()}`,
    displayName: 'Manager',
    temporaryPassword: 'TempDemo2026!',
    roleAssignments: [
      { role: UserRole.SITE_MANAGER, siteId: site.id },
      { role: UserRole.SAFETY_OFFICER, siteId: other.id },
    ],
  });
  const login = await auth.login(account.username, 'TempDemo2026!', AuthClientType.MOBILE);
  await users.revokeSiteManager(account.id, other.id);
  assert.equal((await auth.authenticate(login.accessToken)).user.id, account.id);
  const updated = await users.revokeSiteManager(account.id, site.id);
  assert.deepEqual(updated.roleAssignments, [{ role: UserRole.SAFETY_OFFICER, siteId: other.id }]);
  await assert.rejects(auth.authenticate(login.accessToken));
  await users.revokeSiteManager(account.id, site.id);
  const next = await users.create({
    username: `manager-${randomUUID()}`,
    displayName: 'Next',
    temporaryPassword: 'TempDemo2026!',
    roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId: site.id }],
  });
  const empty = await users.revokeSiteManager(next.id, site.id);
  assert.deepEqual(empty.roleAssignments, []);
});

test('one manager per Site survives concurrent creation and replacement; different Sites remain independent', async () => {
  if (!source.isInitialized) await source.initialize();
  const sites = new SiteConfigurationService(source);
  const users = new UsersService(source, sites);
  const site = await sites.create({ code: randomUUID(), name: 'Ownership test' });
  const other = await sites.create({ code: randomUUID(), name: 'Other site' });
  const input = (siteId: string) => ({
    username: `manager-${randomUUID()}`,
    displayName: 'Manager',
    temporaryPassword: 'TempDemo2026!',
    roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId }],
  });
  const results = await Promise.allSettled([
    users.create(input(site.id)),
    users.create(input(site.id)),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  assert.equal(
    await source
      .getRepository(UserRoleAssignmentEntity)
      .countBy({ siteId: site.id, role: UserRole.SITE_MANAGER }),
    1,
  );
  const otherManager = await users.create(input(other.id));
  await assert.rejects(
    users.replaceRoleAssignments(otherManager!.id, {
      roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId: site.id }],
    }),
    { status: 409 },
  );
  assert.equal((await users.get(otherManager!.id)).roleAssignments[0]?.siteId, other.id);
});

test('Site Manager representative creation is atomic, scoped and supports multiple contractors', async () => {
  if (!source.isInitialized) await source.initialize();
  const sites = new SiteConfigurationService(source);
  const users = new UsersService(source, sites);
  const workforce = new WorkforceConfigurationService(source);
  const reps = new SiteRepresentativesService(source, users, workforce);
  const site = await sites.create({ code: randomUUID(), name: 'Representative test' });
  const other = await sites.create({ code: randomUUID(), name: 'Other site' });
  const first = await workforce.createContractor(site.id, {
    code: `C-${randomUUID()}`,
    name: 'First contractor',
  });
  const second = await workforce.createContractor(site.id, {
    code: `C-${randomUUID()}`,
    name: 'Second contractor',
  });
  await participateContractor(source, site.id, first.id);
  await participateContractor(source, site.id, second.id);
  const input = () => ({
    username: `rep-${randomUUID()}`,
    displayName: 'Representative',
    temporaryPassword: 'TempDemo2026!',
  });
  for (const contractor of [first, second]) {
    const user = await reps.create(site.id, contractor.id, input());
    assert.deepEqual(user!.roleAssignments, [
      { role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: site.id },
    ]);
  }
  assert.equal((await users.listSiteRepresentatives(site.id)).total, 2);
  assert.equal((await users.listSiteRepresentatives(other.id)).total, 0);
  const failed = input();
  await assert.rejects(reps.create(other.id, first.id, failed), { status: 404 });
  assert.equal(
    await source.getRepository(UserEntity).existsBy({ username: failed.username }),
    false,
  );
});
