import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { IsNull } from 'typeorm';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { ContractorTeamsService } from '../../src/modules/workforce/teams/contractor-teams.service.js';
import { ZoneEntryAuthorizationService } from '../../src/modules/zones/zone-entry-authorization.service.js';
import { TeamZonePermissions1791940000000 } from '../../src/database/migrations/1791940000000-TeamZonePermissions.js';
import {
  SiteEntity,
  ContractorEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
  ContractorRepresentativeAssignmentEntity,
  ContractorSiteParticipationEntity,
  ContractorZonePermissionEntity,
  ZoneEntity,
  ZoneType,
  ZoneRestrictionPolicy,
  WorkerEntity,
  WorkerSiteZoneAssignmentEntity,
  WorkerSiteZoneAssignmentStatus,
  ContractorTeamMembershipEntity,
  ContractorTeamEntity,
  TeamZonePermissionEntity,
  ZoneAccessGrantEntity,
  ZoneAccessEffect,
} from '../../src/database/entities/index.js';
const isolated = createIsolatedTestDatabase({ canonical: true });
const source = isolated.dataSource;
test('team Zones: migration scope constraints, bounded date grants, retries, inherited authorization and live revocation', async () => {
  await isolated.initialize();
  const siteId = randomUUID(),
    otherSite = randomUUID(),
    contractorId = randomUUID(),
    repId = randomUUID(),
    otherUser = randomUUID(),
    participationId = randomUUID(),
    zoneId = randomUUID(),
    cpId = randomUUID(),
    workerId = randomUUID(),
    assignmentId = randomUUID();
  const actor = {
    id: repId,
    username: repId,
    displayName: 'Synthetic rep',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId }],
  };
  const service = new ContractorTeamsService(source),
    authorization = new ZoneEntryAuthorizationService();
  try {
    await source
      .getRepository(SiteEntity)
      .save([siteId, otherSite].map((id) => ({ id, code: id, name: 'Synthetic Team Zone Site' })));
    await source.getRepository(UserEntity).save(
      [repId, otherUser].map((id) => ({
        id,
        username: id,
        displayName: 'Synthetic',
        passwordHash: 'synthetic-unused',
        isActive: true,
        mustChangePassword: false,
      })),
    );
    await source
      .getRepository(UserRoleAssignmentEntity)
      .save({ id: randomUUID(), userId: repId, siteId, role: UserRole.CONTRACTOR_REPRESENTATIVE });
    await source
      .getRepository(ContractorEntity)
      .save({ id: contractorId, code: contractorId, name: 'Synthetic contractor', isActive: true });
    await source.getRepository(ContractorSiteParticipationEntity).save({
      id: participationId,
      siteId,
      contractorId,
      isActive: true,
      validFrom: new Date('2020-01-01'),
      validUntil: new Date('2030-01-01'),
    });
    await source
      .getRepository(ContractorRepresentativeAssignmentEntity)
      .save({ id: randomUUID(), userId: repId, siteId, contractorId });
    await source.getRepository(ZoneEntity).save({
      id: zoneId,
      siteId,
      code: zoneId,
      name: 'Gạch',
      type: ZoneType.RESTRICTED,
      restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
      requiredPpe: [],
    });
    await source.getRepository(ContractorZonePermissionEntity).save({
      id: cpId,
      siteContractorId: participationId,
      zoneId,
      validFrom: new Date('2026-10-12T01:00:00Z'),
      validUntil: new Date('2026-10-12T16:00:00Z'),
      grantedBy: repId,
      revokedAt: null,
    });
    const team = await service.create(actor, siteId, contractorId, {
      requestId: randomUUID(),
      name: 'Team Gạch',
    });
    const input = {
      requestId: randomUUID(),
      contractorZonePermissionId: cpId,
      startDate: '2026-10-12',
      endDate: '2026-10-12',
      timezone: 'Asia/Ho_Chi_Minh',
    };
    // Do not depend on wall-clock eligibility of the synthetic fixed parent date.
    await source
      .getRepository(ContractorZonePermissionEntity)
      .update(cpId, { validUntil: new Date('2030-01-01') });
    const granted = await service.grantZone(actor, siteId, contractorId, team.id, input);
    const permission = await source
      .getRepository(TeamZonePermissionEntity)
      .findOneByOrFail({ id: granted.id });
    assert.equal(permission.validFrom.toISOString(), '2026-10-12T01:00:00.000Z');
    assert.equal(permission.validUntil.toISOString(), '2026-10-12T17:00:00.000Z');
    assert.equal(
      (await service.grantZone(actor, siteId, contractorId, team.id, input)).id,
      granted.id,
    );
    await assert.rejects(
      service.grantZone(actor, siteId, contractorId, team.id, {
        ...input,
        requestId: randomUUID(),
      }),
      { status: 409 },
    );
    await assert.rejects(
      source.getRepository(TeamZonePermissionEntity).save({ ...permission, id: randomUUID() }),
      (error: unknown) => (error as { driverError: { code: string } }).driverError.code === '23505',
    );
    assert.equal(
      (await service.detail(actor, siteId, contractorId, team.id)).zoneAssignments?.[0]?.zoneId,
      zoneId,
    );
    await assert.rejects(
      service.grantZone(actor, siteId, contractorId, team.id, { ...input, endDate: '2026-10-13' }),
      { status: 409 },
    );
    await assert.rejects(
      service.grantZone(actor, siteId, contractorId, team.id, {
        ...input,
        contractorZonePermissionId: randomUUID(),
      }),
      { status: 404 },
    );
    await assert.rejects(
      service.zoneSetup({ ...actor, id: otherUser }, siteId, contractorId, team.id),
      { status: 403 },
    );
    await assert.rejects(service.zoneSetup(actor, otherSite, contractorId, team.id), {
      status: 403,
    });
    await assert.rejects(
      service.zoneSetup({ ...actor, mustChangePassword: true }, siteId, contractorId, team.id),
      { status: 403 },
    );
    await assert.rejects(service.zoneSetup(actor, siteId, contractorId, randomUUID()), {
      status: 404,
    });
    const foreignTeam = await source.getRepository(ContractorTeamEntity).save({
      id: randomUUID(),
      siteId: otherSite,
      contractorId,
      name: 'Foreign',
      normalizedName: 'foreign',
      createdBy: repId,
    });
    await assert.rejects(
      source
        .getRepository(TeamZonePermissionEntity)
        .save({ ...permission, id: randomUUID(), teamId: foreignTeam.id }),
    );
    await assert.rejects(
      source
        .getRepository(TeamZonePermissionEntity)
        .save({ ...permission, id: randomUUID(), validUntil: new Date('2031-01-01') }),
    );
    await source.getRepository(WorkerEntity).save({
      id: workerId,
      siteId,
      contractorId,
      externalId: workerId,
      displayName: 'Synthetic worker',
      isActive: true,
    });
    const membership = await source.getRepository(ContractorTeamMembershipEntity).save({
      id: randomUUID(),
      siteId,
      contractorId,
      teamId: team.id,
      workerId,
      joinedAt: new Date('2020-01-01'),
      leftAt: null,
      assignedBy: repId,
      reason: 'Fixture',
    });
    const decision = {
      eventId: randomUUID(),
      siteId,
      zoneId,
      verifiedWorkerId: workerId,
      trackId: 1,
      evaluatedAt: new Date('2026-10-12T02:00:00Z'),
      restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
    };
    const evaluate = () => authorization.decide(source.manager, decision);
    assert.equal((await evaluate()).status, 'DENIED');
    await source.getRepository(WorkerSiteZoneAssignmentEntity).save({
      id: assignmentId,
      siteId,
      workerId,
      siteContractorId: participationId,
      zoneIds: [zoneId],
      status: WorkerSiteZoneAssignmentStatus.APPROVED,
      validFrom: new Date('2020-01-01'),
      validUntil: new Date('2030-01-01'),
      requestedByUserId: repId,
    });
    assert.equal((await evaluate()).status, 'ALLOWED');
    await source
      .getRepository(ContractorTeamMembershipEntity)
      .update(membership.id, { leftAt: new Date('2026-10-12T01:00:00Z') });
    assert.equal((await evaluate()).status, 'DENIED');
    await source
      .getRepository(ContractorTeamMembershipEntity)
      .update(membership.id, { leftAt: null });
    await source
      .getRepository(ContractorZonePermissionEntity)
      .update(cpId, { revokedAt: new Date('2026-10-12T01:00:00Z') });
    assert.equal((await evaluate()).status, 'DENIED');
    await assert.rejects(
      service.grantZone(actor, siteId, contractorId, team.id, {
        ...input,
        requestId: randomUUID(),
      }),
      { status: 409 },
    );
    const newParentId = randomUUID();
    const oldParent = await source
      .getRepository(ContractorZonePermissionEntity)
      .findOneByOrFail({ id: cpId });
    await source
      .getRepository(ContractorZonePermissionEntity)
      .save({ ...oldParent, id: newParentId, revokedAt: null });
    // A replacement parent does not revive team permissions tied to the revoked parent.
    assert.equal((await evaluate()).status, 'DENIED');
    assert.equal(
      (await service.zoneSetup(actor, siteId, contractorId, team.id)).permissions[0]!.effective,
      false,
    );
    await source.getRepository(ContractorZonePermissionEntity).delete(newParentId);
    await source.getRepository(ContractorZonePermissionEntity).update(cpId, { revokedAt: null });
    await source
      .getRepository(TeamZonePermissionEntity)
      .update(permission.id, { revokedAt: new Date('2026-10-12T01:00:00Z') });
    assert.equal((await evaluate()).status, 'DENIED');
    await source.getRepository(TeamZonePermissionEntity).update(permission.id, { revokedAt: null });
    await source.getRepository(ZoneAccessGrantEntity).save({
      id: randomUUID(),
      siteId,
      zoneId,
      workerId,
      effect: ZoneAccessEffect.DENY,
      validFrom: new Date('2020-01-01'),
      validUntil: new Date('2030-01-01'),
      revokedAt: null,
    });
    assert.equal((await evaluate()).status, 'DENIED');
    const runner = source.createQueryRunner();
    try {
      await assert.rejects(new TeamZonePermissions1791940000000().down(runner));
    } finally {
      await runner.release();
    }
    await service.revokeZone(actor, siteId, contractorId, team.id, permission.id);
    assert.equal(
      (await service.zoneSetup(actor, siteId, contractorId, team.id)).permissions[0]!.effective,
      false,
    );
    await service.revokeZone(actor, siteId, contractorId, team.id, permission.id);
    const replacement = await service.grantZone(actor, siteId, contractorId, team.id, {
      ...input,
      requestId: randomUUID(),
    });
    const edit = { ...input, requestId: randomUUID(), endDate: '2026-10-13' };
    await assert.rejects(
      service.grantZone(
        { ...actor, id: otherUser },
        siteId,
        contractorId,
        team.id,
        edit,
        replacement.id,
      ),
      { status: 403 },
    );
    await assert.rejects(
      service.grantZone(actor, otherSite, contractorId, team.id, edit, replacement.id),
      { status: 403 },
    );
    await assert.rejects(
      service.grantZone(actor, siteId, contractorId, team.id, edit, randomUUID()),
      { status: 409 },
    );
    let edited = await service.grantZone(
      actor,
      siteId,
      contractorId,
      team.id,
      edit,
      replacement.id,
    );
    assert.equal(
      (await service.grantZone(actor, siteId, contractorId, team.id, edit, replacement.id)).id,
      edited.id,
    );
    assert.ok(
      (await source.getRepository(TeamZonePermissionEntity).findOneByOrFail({ id: replacement.id }))
        .revokedAt,
    );
    assert.equal(
      await source
        .getRepository(TeamZonePermissionEntity)
        .countBy({ teamId: team.id, revokedAt: IsNull() }),
      1,
    );
    await assert.rejects(
      service.grantZone(actor, siteId, contractorId, team.id, edit, randomUUID()),
      { status: 409 },
    );
    const race = await Promise.allSettled(
      [1, 2].map(() =>
        service.grantZone(
          actor,
          siteId,
          contractorId,
          team.id,
          { ...edit, requestId: randomUUID() },
          edited.id,
        ),
      ),
    );
    assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(race.find((r) => r.status === 'rejected')?.reason.status, 409);
    edited = race.find((r) => r.status === 'fulfilled')!.value;
    await source.getRepository(WorkerEntity).update(workerId, { userId: repId });
    await source
      .getRepository(UserRoleAssignmentEntity)
      .save({ id: randomUUID(), userId: repId, siteId, role: UserRole.WORKER });
    assert.equal((await service.myTeam(actor, siteId)).teamName, 'Team Gạch');
    assert.equal((await service.myTeam(actor, siteId)).zones?.[0]?.id, edited.id);
    await source.getRepository(UserRoleAssignmentEntity).delete({ userId: repId });
    await assert.rejects(service.zoneSetup(actor, siteId, contractorId, team.id), { status: 403 });
  } finally {
    await isolated.dispose();
  }
});
