import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import source from '../support/test-data-source.js';
import { ContractorParticipationQueryService } from '../../src/modules/workforce/directory/contractor-participation-query.service.js';
import {
  ContractorEntity,
  ContractorSiteParticipationEntity,
  SiteEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
} from '../../src/database/entities/index.js';
import type { AuthenticatedUser } from '../../src/modules/auth/auth.service.js';

after(async () => {
  if (source.isInitialized) await source.destroy();
});

test('global contractor participation reads paginate all intervals and recheck Admin authorization', async () => {
  await source.initialize();
  const service = new ContractorParticipationQueryService(source);
  const userId = randomUUID();
  await source.getRepository(UserEntity).save({
    id: userId,
    username: userId,
    displayName: 'Synthetic admin',
    passwordHash: 'unused',
    isActive: true,
    mustChangePassword: false,
  });
  await source
    .getRepository(UserRoleAssignmentEntity)
    .save({ id: randomUUID(), userId, role: UserRole.ADMIN, siteId: null });
  const actor: AuthenticatedUser = {
    id: userId,
    username: userId,
    displayName: 'Synthetic',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
  };
  const contractor = await source
    .getRepository(ContractorEntity)
    .save({ id: randomUUID(), code: randomUUID(), name: 'Participation fixture', isActive: true });
  const other = await source
    .getRepository(ContractorEntity)
    .save({ id: randomUUID(), code: randomUUID(), name: 'Other fixture', isActive: true });
  const sites = await source.getRepository(SiteEntity).save(
    ['A', 'B'].map((name) => ({
      id: randomUUID(),
      code: randomUUID(),
      name: `Participation ${name}`,
    })),
  );
  const intervals = [
    { siteId: sites[0]!.id, validFrom: new Date('2020-01-01'), validUntil: null, isActive: true },
    {
      siteId: sites[0]!.id,
      validFrom: new Date('2000-01-01'),
      validUntil: new Date('2001-01-01'),
      isActive: true,
    },
    { siteId: sites[1]!.id, validFrom: new Date('2090-01-01'), validUntil: null, isActive: true },
    { siteId: sites[1]!.id, validFrom: new Date('2000-01-01'), validUntil: null, isActive: false },
  ];
  await source
    .getRepository(ContractorSiteParticipationEntity)
    .save(intervals.map((p) => ({ ...p, id: randomUUID(), contractorId: contractor.id })));
  await source
    .getRepository(ContractorSiteParticipationEntity)
    .save({ ...intervals[0]!, id: randomUUID(), contractorId: other.id });
  const first = await service.participations(actor, contractor.id, 0, 2);
  const second = await service.participations(actor, contractor.id, 2, 2);
  assert.equal(first.total, 4);
  assert.equal(second.total, 4);
  assert.equal(new Set([...first.items, ...second.items].map((p) => p.id)).size, 4);
  assert.deepEqual(
    first.items.map((p) => p.status),
    ['EXPIRED', 'ACTIVE'],
  );
  assert.deepEqual(
    second.items.map((p) => p.status),
    ['INACTIVE', 'FUTURE'],
  );
  assert.equal(first.items[1]!.validUntil, null);
  assert.equal(first.items[0]!.site.id, sites[0]!.id);
  assert.equal((await service.participations(actor, other.id)).total, 1);
  await source.getRepository(ContractorEntity).update(contractor.id, { isActive: false });
  assert.ok(
    (await service.participations(actor, contractor.id)).items.every(
      (p) => p.status === 'INACTIVE',
    ),
  );
  const directory = await service.contractors(actor, 0, 1);
  assert.equal(directory.items.length, 1);
  assert.ok(directory.total >= 2);
  await assert.rejects(service.participations(actor, randomUUID()), { status: 404 });
  await assert.rejects(service.participations(actor, 'bad-id'), { status: 400 });
  await assert.rejects(service.participations(actor, contractor.id, -1), { status: 400 });
  for (const denied of [
    { ...actor, isActive: false },
    { ...actor, mustChangePassword: true },
    { ...actor, roleAssignments: [] },
    { ...actor, roleAssignments: [{ role: UserRole.ADMIN, siteId: sites[0]!.id }] },
    { ...actor, roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId: sites[0]!.id }] },
    {
      ...actor,
      roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: sites[0]!.id }],
    },
  ]) {
    await assert.rejects(service.participations(denied, contractor.id), { status: 403 });
    await assert.rejects(service.contractors(denied), { status: 403 });
  }
  await source.getRepository(UserEntity).update(userId, { isActive: false });
  await assert.rejects(service.participations(actor, contractor.id), { status: 403 });
  await source.getRepository(UserEntity).update(userId, { isActive: true });
  await source.getRepository(UserRoleAssignmentEntity).delete({ userId });
  await assert.rejects(service.participations(actor, contractor.id), { status: 403 });
});
