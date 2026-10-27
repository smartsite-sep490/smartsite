import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { participateContractor } from '../support/contractor-participation.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { SiteRepresentativesService } from '../../src/modules/users/site-representatives.controller.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { WorkforceConfigurationService } from '../../src/modules/workforce/directory/workforce-configuration.service.js';
import { MainWorkforceCreateService } from '../../src/modules/workforce/main-workforce-create.service.js';
import { UserEntity, UserRole } from '../../src/database/entities/user.entity.js';
import { UserRoleAssignmentEntity } from '../../src/database/entities/user-role-assignment.entity.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { JwtService } from '@nestjs/jwt';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';
import { createTestConfig } from '../support/config.js';

const database = createIsolatedTestDatabase({ canonical: true });
const source = database.dataSource;

before(async () => {
  await database.initialize();
});

after(async () => {
  await database.dispose();
});

test('revoking a single Site Manager assignment releases the Site, preserves other roles and revokes sessions', async () => {
  if (!source.isInitialized) await source.initialize();
  const sites = new SiteConfigurationService(source);
  const users = new UsersService(source, sites);
  const auth = new AuthService(source, new AuthTokenService(new JwtService(), createTestConfig()));
  const admin = await users.create({
    username: `revoke-admin-${randomUUID()}`,
    displayName: 'Synthetic revoke Admin',
    temporaryPassword: 'TempDemo2026!',
    roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
  });
  const context = { actorUserId: admin.id };
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
  await users.revokeSiteManager(account.id, other.id, context);
  assert.equal((await auth.authenticate(login.accessToken)).user.id, account.id);
  const updated = await users.revokeSiteManager(account.id, site.id, context);
  assert.deepEqual(updated.roleAssignments, [{ role: UserRole.SAFETY_OFFICER, siteId: other.id }]);
  await assert.rejects(auth.authenticate(login.accessToken));
  await users.revokeSiteManager(account.id, site.id, context);
  const next = await users.create({
    username: `manager-${randomUUID()}`,
    displayName: 'Next',
    temporaryPassword: 'TempDemo2026!',
    roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId: site.id }],
  });
  const empty = await users.revokeSiteManager(next.id, site.id, context);
  assert.deepEqual(empty.roleAssignments, []);
});

test('one manager per Site survives concurrent creation and replacement; different Sites remain independent', async () => {
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
  const sites = new SiteConfigurationService(source);
  const users = new UsersService(source, sites);
  const workforce = new WorkforceConfigurationService(source);
  const reps = new SiteRepresentativesService(source, users, workforce);
  const site = await sites.create({ code: randomUUID(), name: 'Representative test' });
  const other = await sites.create({ code: randomUUID(), name: 'Other site' });
  const input = () => ({
    username: `rep-${randomUUID()}`,
    displayName: 'Representative',
    temporaryPassword: 'TempDemo2026!',
  });
  const manager = await users.create({
    username: `manager-${randomUUID()}`,
    displayName: 'Representative setup Manager',
    temporaryPassword: 'TempDemo2026!',
    roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId: site.id }],
  });
  const otherManager = await users.create({
    username: `manager-${randomUUID()}`,
    displayName: 'Other Site Manager',
    temporaryPassword: 'TempDemo2026!',
    roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId: other.id }],
  });
  const creation = new MainWorkforceCreateService(source);
  const createContractor = (name: string) =>
    creation.createSiteContractor(
      site.id,
      { code: `C-${randomUUID()}`, name },
      { actorUserId: manager!.id },
    );
  const first = await createContractor('First contractor');
  const second = await createContractor('Second contractor');
  for (const contractor of [first, second]) {
    await participateContractor(source, site.id, contractor.id);
    const user = await reps.create(site.id, contractor.id, input(), { actorUserId: manager!.id });
    assert.deepEqual(user!.roleAssignments, [
      { role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: site.id },
    ]);
  }
  assert.equal((await users.listSiteRepresentatives(site.id)).total, 2);
  assert.equal((await users.listSiteRepresentatives(other.id)).total, 0);
  const failed = input();
  await assert.rejects(reps.create(other.id, first.id, failed, { actorUserId: otherManager!.id }), {
    status: 404,
  });
  assert.equal(
    await source.getRepository(UserEntity).existsBy({ username: failed.username }),
    false,
  );
});
