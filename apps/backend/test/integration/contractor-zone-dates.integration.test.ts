import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
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

const isolated = createIsolatedTestDatabase({ canonical: true });
const source = isolated.dataSource;
test('date-only contractor Zone grants use inclusive local days, DST, participation bounds, scope and retry', async () => {
  await isolated.initialize();
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
    await source.query(
      "UPDATE contractor_site_participation SET valid_from='2026-10-15T00:00:00.000001Z',valid_until='2026-10-15T23:00:00.000009Z' WHERE id=$1",
      [participationId],
    );
    const preciseInput = {
      ...input,
      requestId: randomUUID(),
      startDate: '2026-10-15',
      endDate: '2026-10-15',
      timezone: 'UTC',
    };
    const beforePolicy = (
      await source.query('SELECT access_policy_version AS n FROM site WHERE id=$1', [siteId])
    )[0].n;
    const precise = await service.grantContractor(actor, siteId, preciseInput, {
      actorUserId: userId,
    });
    const [bounds] = await source.query(
      'SELECT g.valid_from=p.valid_from AS same_from,g.valid_until=p.valid_until AS same_until FROM contractor_zone_permission g JOIN contractor_site_participation p ON p.id=g.site_contractor_id WHERE g.id=$1',
      [precise.id],
    );
    assert.deepEqual(bounds, { same_from: true, same_until: true });
    assert.equal(
      (await source.query('SELECT access_policy_version AS n FROM site WHERE id=$1', [siteId]))[0]
        .n,
      beforePolicy + 1,
    );
    await source.query(
      'UPDATE contractor_zone_permission SET revoked_at=clock_timestamp() WHERE id=$1',
      [precise.id],
    );
    const counts = () =>
      source.query(
        `SELECT (SELECT count(*)::int FROM contractor_zone_permission) AS permissions,
      (SELECT count(*)::int FROM audit_log) AS audits,(SELECT count(*)::int FROM mf06_authority_command) AS commands,
      (SELECT count(*)::int FROM mf06_authority_fact) AS facts,(SELECT access_policy_version FROM site WHERE id=$1) AS policy`,
        [siteId],
      );
    const beforeFailure = await counts();
    await source.query(
      "CREATE FUNCTION test_date_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic date audit failure' USING ERRCODE='23514'; END $$; CREATE TRIGGER test_date_audit_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION test_date_audit_failure()",
    );
    try {
      await assert.rejects(
        service.grantContractor(
          actor,
          siteId,
          { ...preciseInput, requestId: randomUUID() },
          { actorUserId: userId },
        ),
        { code: '23514' },
      );
      assert.deepEqual(await counts(), beforeFailure);
    } finally {
      await source.query(
        'DROP TRIGGER test_date_audit_failure ON audit_log; DROP FUNCTION test_date_audit_failure()',
      );
    }
    await service.grantContractor(actor, siteId, preciseInput, { actorUserId: userId });
    assert.equal(
      (await source.query('SELECT access_policy_version AS n FROM site WHERE id=$1', [siteId]))[0]
        .n,
      beforePolicy + 1,
    );
  } finally {
    await isolated.dispose();
  }
});
