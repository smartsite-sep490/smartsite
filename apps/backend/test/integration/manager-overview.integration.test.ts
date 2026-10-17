import { participateContractor } from '../support/contractor-participation.js';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import source from '../support/test-data-source.js';
import { ManagerOverviewService } from '../../src/modules/workforce/management/manager-overview.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { WorkforceConfigurationService } from '../../src/modules/workforce/directory/workforce-configuration.service.js';
import type { AuthenticatedUser } from '../../src/modules/auth/auth.service.js';
import {
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
  WorkerEntity,
  ContractorTeamEntity,
  ContractorTeamMembershipEntity,
  ContractorSiteParticipationEntity,
  ContractorZonePermissionEntity,
  TeamZonePermissionEntity,
  ShiftEntity,
  ScheduleVersionEntity,
  WorkerScheduleEntity,
  ZoneType,
  ZoneRestrictionPolicy,
} from '../../src/database/entities/index.js';

after(async () => {
  if (source.isInitialized) await source.destroy();
});

test('manager overview: generated codes, Site isolation, current roster and dated Zone/schedule aggregation', async () => {
  await source.initialize();
  const sites = new SiteConfigurationService(source),
    workforce = new WorkforceConfigurationService(source),
    zones = new ZoneConfigurationService(source, sites),
    service = new ManagerOverviewService(source);
  const site = await sites.create({ code: randomUUID(), name: 'Manager overview fixture' });
  const other = await sites.create({ code: randomUUID(), name: 'Other overview fixture' });
  const userId = randomUUID();
  await source.getRepository(UserEntity).save({
    id: userId,
    username: userId,
    displayName: 'Manager',
    passwordHash: 'synthetic-unused',
    isActive: true,
    mustChangePassword: false,
  });
  await source
    .getRepository(UserRoleAssignmentEntity)
    .save({ id: randomUUID(), userId, siteId: site.id, role: UserRole.SITE_MANAGER });
  const actor: AuthenticatedUser = {
    id: userId,
    username: userId,
    displayName: 'Manager',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId: site.id }],
  };
  const contractors = await Promise.all([
    workforce.createContractor(site.id, { name: 'Alpha' }),
    workforce.createContractor(site.id, { name: 'Beta' }),
    workforce.createContractor(other.id, { name: 'Foreign' }),
  ]);
  assert.equal(new Set(contractors.map((c) => c.code)).size, 3);
  contractors.forEach((c) => assert.match(c.code, /^CTR-[0-9A-F-]{36}$/));
  await Promise.all(
    contractors.map((c, i) => participateContractor(source, i === 2 ? other.id : site.id, c.id)),
  );
  const contractor = contractors[0]!;
  const zoneInput = {
    name: 'Area',
    type: ZoneType.STANDARD,
    restrictionPolicy: ZoneRestrictionPolicy.NONE,
    requiredPpe: [],
  };
  const [zone, expiredZone, foreignZone] = await Promise.all([
    zones.create(site.id, zoneInput),
    zones.create(site.id, zoneInput),
    zones.create(other.id, zoneInput),
  ]);
  assert.notEqual(zone.code, expiredZone.code);
  assert.match(zone.code, /^ZONE-[0-9A-F-]{36}$/);
  await assert.rejects(workforce.createContractor(site.id, { name: '' }), { status: 400 });
  await assert.rejects(zones.create(site.id, { ...zoneInput, code: '' }), { status: 400 });
  const explicit = await workforce.createContractor(other.id, {
    code: 'LEGACY-' + randomUUID(),
    name: 'Legacy',
  });
  assert.ok(explicit.code.startsWith('LEGACY-'));
  const workers = await source.getRepository(WorkerEntity).save(
    [true, true, false].map((isActive) => ({
      id: randomUUID(),
      siteId: site.id,
      contractorId: contractor.id,
      externalId: randomUUID(),
      displayName: 'Synthetic worker',
      isActive,
    })),
  );
  const team = await source.getRepository(ContractorTeamEntity).save({
    id: randomUUID(),
    siteId: site.id,
    contractorId: contractor.id,
    name: 'Crew A',
    normalizedName: 'crew a',
    createdBy: userId,
  });
  await source.getRepository(ContractorTeamEntity).save({
    id: randomUUID(),
    siteId: other.id,
    contractorId: contractor.id,
    name: 'Foreign crew',
    normalizedName: 'foreign crew',
    createdBy: userId,
  });
  await source.getRepository(ContractorTeamMembershipEntity).save(
    workers.slice(0, 2).map((worker, i) => ({
      id: randomUUID(),
      siteId: site.id,
      contractorId: contractor.id,
      teamId: team.id,
      workerId: worker.id,
      joinedAt: new Date('2020-01-01'),
      leftAt: i === 1 ? new Date('2020-02-01') : null,
      assignedBy: userId,
      reason: 'Synthetic fixture',
    })),
  );
  const participation = await source
    .getRepository(ContractorSiteParticipationEntity)
    .findOneByOrFail({ siteId: site.id, contractorId: contractor.id });
  await source
    .getRepository(ContractorSiteParticipationEntity)
    .update(participation.id, { validFrom: new Date('2020-01-01') });
  const grants = await source.getRepository(ContractorZonePermissionEntity).save(
    [
      {
        zoneId: zone.id,
        validFrom: new Date('2026-10-11T17:00:00Z'),
        validUntil: new Date('2026-10-12T17:00:00Z'),
        revokedAt: null,
      },
      {
        zoneId: expiredZone.id,
        validFrom: new Date('2026-10-10T17:00:00Z'),
        validUntil: new Date('2026-10-11T17:00:00Z'),
        revokedAt: null,
      },
      {
        zoneId: expiredZone.id,
        validFrom: new Date('2026-10-11T17:00:00Z'),
        validUntil: new Date('2026-10-12T17:00:00Z'),
        revokedAt: new Date('2026-10-11T18:00:00Z'),
      },
      {
        zoneId: foreignZone.id,
        validFrom: new Date('2026-10-11T17:00:00Z'),
        validUntil: new Date('2026-10-12T17:00:00Z'),
        revokedAt: null,
      },
    ].map((p) => ({
      ...p,
      id: randomUUID(),
      siteContractorId: participation.id,
      grantedBy: userId,
    })),
  );
  const teamGrant = await source.getRepository(TeamZonePermissionEntity).save({
    id: randomUUID(),
    teamId: team.id,
    contractorZonePermissionId: grants[0]!.id,
    validFrom: new Date('2026-10-11T18:00:00Z'),
    validUntil: new Date('2026-10-12T16:00:00Z'),
    grantedBy: userId,
    revokedAt: null,
  });
  const shifts = await source.getRepository(ShiftEntity).save(
    [
      {
        name: 'Day',
        startsAt: new Date('2020-01-01T01:00:00Z'),
        endsAt: new Date('2020-01-01T10:00:00Z'),
      },
      {
        name: 'Night',
        startsAt: new Date('2020-01-01T15:00:00Z'),
        endsAt: new Date('2020-01-01T23:00:00Z'),
      },
    ].map((s) => ({ ...s, id: randomUUID(), siteId: site.id, timezone: 'Asia/Ho_Chi_Minh' })),
  );
  const version = await source
    .getRepository(ScheduleVersionEntity)
    .save({ id: randomUUID(), siteId: site.id, version: 1, effectiveFrom: new Date('2020-01-01') });
  await source.getRepository(WorkerScheduleEntity).save(
    workers.map((w, i) => {
      const s = shifts[i === 0 ? 1 : 0]!;
      return {
        id: randomUUID(),
        siteId: site.id,
        workerId: w.id,
        shiftId: s.id,
        scheduleVersionId: version.id,
        workDate: '2026-10-12',
        isActive: true,
      };
    }),
  );
  const overview = await service.overview(actor, site.id, 0, 1);
  assert.deepEqual(
    [overview.contractorCount, overview.zoneCount, overview.teamCount, overview.workerCount],
    [2, 2, 1, 2],
  );
  assert.equal(overview.contractors.items.length, 1);
  assert.equal(overview.contractors.total, 2);
  const input = { date: '2026-10-12', timezone: 'Asia/Ho_Chi_Minh' };
  const detail = await service.detail(actor, site.id, contractor.id, input);
  assert.equal(detail.teamCount, 1);
  assert.equal(detail.workerCount, 2);
  assert.equal(detail.teams[0]!.workerCount, 1);
  assert.deepEqual(detail.teams[0]!.zoneAssignments, [
    {
      id: teamGrant.id,
      zoneId: zone.id,
      name: zone.name,
      code: zone.code,
      validFrom: '2026-10-11T18:00:00.000Z',
      validUntil: '2026-10-12T16:00:00.000Z',
    },
  ]);
  assert.deepEqual(
    detail.zones.map((z) => z.id),
    [zone.id],
  );
  assert.equal(detail.scheduledWorkerCount, 2);
  assert.equal(detail.scheduledWorkersWithoutTeam, 1);
  assert.equal(detail.scheduledTeams.length, 1);
  assert.equal(detail.scheduledTeams[0]!.workerCount, 1);
  assert.equal(detail.scheduledTeams[0]!.shifts.length, 1);
  assert.equal(
    detail.scheduledTeams[0]!.shifts.find((s) => s.name === 'Night')!.endsAt,
    '2026-10-12T23:00:00.000Z',
  );
  const empty = await service.detail(actor, site.id, contractor.id, {
    ...input,
    date: '2026-10-13',
  });
  assert.equal(empty.zones.length, 0);
  assert.deepEqual(empty.teams[0]!.zoneAssignments, []);
  assert.equal(empty.scheduledTeams.length, 0);
  await assert.rejects(service.detail(actor, site.id, contractors[2]!.id, input), { status: 404 });
  for (const denied of [
    { ...actor, roleAssignments: [] },
    { ...actor, roleAssignments: [{ role: UserRole.ADMIN, siteId: null }] },
    { ...actor, roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: site.id }] },
    { ...actor, mustChangePassword: true },
  ])
    await assert.rejects(service.overview(denied, site.id), { status: 403 });
  await assert.rejects(service.overview(actor, other.id), { status: 403 });
  await assert.rejects(
    service.detail(actor, site.id, contractor.id, { ...input, date: '2026-02-30' }),
    { status: 400 },
  );
  await assert.rejects(
    service.detail(actor, site.id, contractor.id, { ...input, timezone: 'invalid-zone' }),
    { status: 400 },
  );
  await source
    .getRepository(ContractorZonePermissionEntity)
    .update(grants[0]!.id, { revokedAt: new Date() });
  assert.deepEqual(
    (await service.detail(actor, site.id, contractor.id, input)).teams[0]!.zoneAssignments,
    [],
  );
  await source
    .getRepository(ContractorZonePermissionEntity)
    .update(grants[0]!.id, { revokedAt: null });
  await source
    .getRepository(TeamZonePermissionEntity)
    .update(teamGrant.id, { revokedAt: new Date() });
  assert.deepEqual(
    (await service.detail(actor, site.id, contractor.id, input)).teams[0]!.zoneAssignments,
    [],
  );
  await source.getRepository(UserEntity).update(userId, { isActive: false });
  await assert.rejects(service.overview(actor, site.id), { status: 403 });
  await source.getRepository(UserEntity).update(userId, { isActive: true });
  await source.getRepository(UserRoleAssignmentEntity).delete({ userId });
  await assert.rejects(service.detail(actor, site.id, contractor.id, input), { status: 403 });
});
