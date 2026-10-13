import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import source from '../support/test-data-source.js';
import { cleanupSiteAccess } from '../support/cleanup-site-access.js';
import { SiteAccessSetupService } from '../../src/modules/workforce/access/site-access-setup.service.js';
import { ContractorZoneRegrant1791940000001 } from '../../src/database/migrations/1791940000001-ContractorZoneRegrant.js';
import {
  SiteEntity,
  ContractorEntity,
  ContractorSiteParticipationEntity,
  ZoneEntity,
  UserEntity,
  UserRoleAssignmentEntity,
  UserRole,
  ZoneType,
  ZoneRestrictionPolicy,
  AccessAuditEntity,
  ContractorZonePermissionEntity,
} from '../../src/database/entities/index.js';

test('date-only contractor Zone grants use inclusive local days, DST, participation bounds, scope and retry', async () => {
  await source.initialize();
  const siteId = randomUUID(),
    otherSiteId = randomUUID(),
    contractorId = randomUUID(),
    participationId = randomUUID(),
    zoneId = randomUUID(),
    foreignZoneId = randomUUID(),
    userId = randomUUID();
  const actor = {
    id: userId,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId }],
  };
  const service = new SiteAccessSetupService(source);
  const input = {
    requestId: randomUUID(),
    siteContractorId: participationId,
    zoneId,
    startDate: '2026-10-12',
    endDate: '2026-10-12',
    timezone: 'Asia/Ho_Chi_Minh',
  };
  try {
    await source
      .getRepository(SiteEntity)
      .save(
        [siteId, otherSiteId].map((id) => ({ id, code: id, name: 'Synthetic date grant Site' })),
      );
    await source.getRepository(UserEntity).save({
      id: userId,
      username: userId,
      displayName: 'Synthetic manager',
      passwordHash: 'synthetic-unused',
      isActive: true,
      mustChangePassword: false,
    });
    await source
      .getRepository(UserRoleAssignmentEntity)
      .save({ id: randomUUID(), userId, siteId, role: UserRole.SITE_MANAGER });
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
    await source.getRepository(ZoneEntity).save(
      [
        { id: zoneId, siteId },
        { id: foreignZoneId, siteId: otherSiteId },
      ].map((z) => ({
        ...z,
        code: z.id,
        name: 'Synthetic Zone',
        type: ZoneType.STANDARD,
        restrictionPolicy: ZoneRestrictionPolicy.NONE,
        requiredPpe: [],
      })),
    );
    const permission = await service.grantContractor(actor, siteId, input);
    assert.equal(permission.validFrom.toISOString(), '2026-10-11T17:00:00.000Z');
    assert.equal(permission.validUntil.toISOString(), '2026-10-12T17:00:00.000Z');
    assert.equal((await service.grantContractor(actor, siteId, input)).id, permission.id);
    assert.equal(
      await source.getRepository(AccessAuditEntity).countBy({ entityId: permission.id }),
      1,
    );
    await assert.rejects(
      service.grantContractor(actor, siteId, { ...input, endDate: '2026-10-13' }),
      { status: 409 },
    );
    await assert.rejects(
      service.grantContractor(actor, siteId, { ...input, requestId: randomUUID() }),
      { status: 409 },
    );
    await service.revoke(actor, siteId, permission.id, 'contractor');
    const regrantInput = { ...input, requestId: randomUUID() };
    const concurrent = await Promise.allSettled([
      service.grantContractor(actor, siteId, regrantInput),
      service.grantContractor(actor, siteId, { ...input, requestId: randomUUID() }),
    ]);
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
    const winner = concurrent.find((result) => result.status === 'fulfilled');
    const loser = concurrent.find((result) => result.status === 'rejected');
    assert.equal(loser?.reason.status, 409);
    const regranted = winner!.value;
    assert.notEqual(regranted.id, permission.id);
    assert.equal(regranted.revokedAt, null);
    assert.ok(
      (
        await source
          .getRepository(ContractorZonePermissionEntity)
          .findOneByOrFail({ id: permission.id })
      ).revokedAt,
    );
    // Old retries preserve the revoked result; only a new request creates a grant.
    assert.ok((await service.grantContractor(actor, siteId, input)).revokedAt);
    assert.equal(
      (await service.grantContractor(actor, siteId, { ...input, requestId: regranted.id })).id,
      regranted.id,
    );
    await assert.rejects(
      service.grantContractor(actor, siteId, { ...input, requestId: randomUUID() }),
      { status: 409 },
    );
    assert.equal(
      await source.getRepository(AccessAuditEntity).countBy({ entityId: permission.id }),
      2,
    );
    assert.equal(
      await source.getRepository(AccessAuditEntity).countBy({ entityId: regranted.id }),
      1,
    );
    const runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await assert.rejects(
        new ContractorZoneRegrant1791940000001().down(runner),
        /preservation plan/,
      );
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
    assert.equal(await source.getRepository(ContractorZonePermissionEntity).countBy({ zoneId }), 2);
    for (const [day, hours] of [
      ['2026-03-08', 23],
      ['2026-11-01', 25],
    ] as const) {
      const dst = await service.grantContractor(actor, siteId, {
        ...input,
        requestId: randomUUID(),
        startDate: day,
        endDate: day,
        timezone: 'America/New_York',
      });
      assert.equal(+dst.validUntil - +dst.validFrom, hours * 3600_000);
    }
    for (const patch of [
      { startDate: '2026-02-30' },
      { startDate: '2026-10-12T10:00:00Z' },
      { endDate: '2026-10-11' },
      { timezone: 'bad-zone' },
      { timezone: '+07:00' },
      { timezone: '' },
      { validFrom: '2026-10-12T10:00:00Z' },
    ])
      await assert.rejects(service.grantContractor(actor, siteId, { ...input, ...patch }), {
        status: 400,
      });
    for (const roleAssignments of [
      [],
      [{ role: UserRole.ADMIN, siteId: null }],
      [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId }],
      [{ role: UserRole.SITE_MANAGER, siteId: otherSiteId }],
    ])
      await assert.rejects(service.grantContractor({ ...actor, roleAssignments }, siteId, input), {
        status: 403,
      });
    await assert.rejects(
      service.grantContractor({ ...actor, mustChangePassword: true }, siteId, input),
      { status: 403 },
    );
    await assert.rejects(
      service.grantContractor(actor, siteId, { ...input, zoneId: foreignZoneId }),
      { status: 404 },
    );
    await assert.rejects(
      service.grantContractor(actor, siteId, { ...input, siteContractorId: randomUUID() }),
      { status: 404 },
    );
    await source.getRepository(ContractorSiteParticipationEntity).update(participationId, {
      validFrom: new Date('2026-10-12T03:00:00Z'),
      validUntil: new Date('2026-10-13T03:00:00Z'),
    });
    const clipped = await service.grantContractor(actor, siteId, {
      ...input,
      requestId: randomUUID(),
      endDate: '2026-10-13',
    });
    assert.equal(clipped.validFrom.toISOString(), '2026-10-12T03:00:00.000Z');
    assert.equal(clipped.validUntil.toISOString(), '2026-10-13T03:00:00.000Z');
    await assert.rejects(
      service.grantContractor(actor, siteId, {
        ...input,
        requestId: randomUUID(),
        startDate: '2026-10-14',
        endDate: '2026-10-14',
      }),
      { status: 409 },
    );
    // Timestamp callers retain their existing exact-interval behavior.
    const legacy = await service.grantContractor(actor, siteId, {
      requestId: randomUUID(),
      siteContractorId: participationId,
      zoneId,
      validFrom: '2026-10-12T04:00:00Z',
      validUntil: '2026-10-12T05:00:00Z',
    });
    assert.equal(legacy.validFrom.toISOString(), '2026-10-12T04:00:00.000Z');
    assert.equal(legacy.validUntil.toISOString(), '2026-10-12T05:00:00.000Z');
  } finally {
    await cleanupSiteAccess(source, [siteId, otherSiteId]);
    await source.getRepository(ZoneEntity).delete([zoneId, foreignZoneId]);
    await source.getRepository(ContractorSiteParticipationEntity).delete(participationId);
    await source.getRepository(ContractorEntity).delete(contractorId);
    await source.getRepository(UserRoleAssignmentEntity).delete({ userId });
    await source.getRepository(UserEntity).delete(userId);
    await source.getRepository(SiteEntity).delete([siteId, otherSiteId]);
    await source.destroy();
  }
});
