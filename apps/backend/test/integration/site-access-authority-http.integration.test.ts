import 'reflect-metadata';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource, type EntityManager } from 'typeorm';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { validateEnvironment, type BackendEnvironment } from '../../src/config/environment.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { SiteAccessSetupController } from '../../src/modules/workforce/access/site-access-setup.controller.js';
import type { AuthenticatedRequest } from '../../src/modules/auth/auth.service.js';
import {
  ContractorEntity,
  ContractorSiteParticipationEntity,
  ContractorZonePermissionEntity,
  WorkerEntity,
  WorkerSiteZoneAssignmentEntity,
  WorkerSiteZoneAssignmentStatus,
  UserRole,
} from '../../src/database/entities/index.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const database = createIsolatedTestDatabase({ canonical: true });
before(() => database.initialize());
after(() => database.dispose());

test('POST /sites/:siteId/access-setup/contractor-zone-permissions/dates enforces scoped SITE_MANAGER control, clamps half-open IANA dates, and attributes CONTRACTOR_PERMISSION to original bearer command', async () => {
  const suffix = randomUUID().slice(0, 8);
  const fixturePassword = 'SyntheticFixture123!';
  const usersService = new UsersService(
    database.dataSource,
    new SiteConfigurationService(database.dataSource),
  );
  await usersService.create({
    username: `access-admin-${suffix}`,
    displayName: 'Synthetic Access Admin',
    temporaryPassword: fixturePassword,
    roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
  });

  const [controlRow] = (await database.dataSource.query(
    'SELECT singleton, epoch_id FROM mf06_authority_control WHERE singleton = 1',
  )) as Array<{ singleton: number; epoch_id: string | null }>;
  assert.equal(controlRow?.singleton, 1);
  assert.equal(controlRow?.epoch_id, null);

  const environment = validateEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    LOG_FORMAT: 'json',
    SMARTSITE_AI_SERVICE_TOKEN: 'synthetic-unused-service-token-only',
    MF06_ENQUEUE_ENABLED: 'false',
    MF06_ASSESSMENT_READ_ENABLED: 'false',
    CORS_ORIGINS: 'http://localhost:5181',
    STORAGE_LOCAL_ROOT: join(tmpdir(), 'smartsite-software-http-unused-media'),
  });
  assert.equal(environment.MF06_ENQUEUE_ENABLED, false);
  assert.equal(environment.MF06_ASSESSMENT_READ_ENABLED, false);
  assert.deepEqual(environment.SMARTSITE_AI_PREVIEW_SOURCES, {});
  assert.equal(environment.SMARTSITE_AI_IDENTITY_URL, undefined);

  const config = new ConfigService<BackendEnvironment, true>(environment);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue(createLoggerParams(config, { write: () => undefined }))
    .overrideProvider(getDataSourceToken())
    .useValue(database.dataSource)
    .overrideProvider(DataSource)
    .useValue(database.dataSource)
    .compile();

  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });

  try {
    await configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);

    const request = (method: string, path: string, body?: unknown, token?: string) =>
      fetch(`${url}/api/v1${path}`, {
        method,
        signal: AbortSignal.timeout(5000),
        headers: {
          Origin: 'http://localhost:5181',
          'X-Request-Id': 'site-access-authority-fixture',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });

    const adminLogin = await request('POST', '/auth/login', {
      username: `access-admin-${suffix}`,
      password: fixturePassword,
      clientType: 'MOBILE',
    });
    assert.equal(adminLogin.status, 200);
    const admin = (await adminLogin.json()) as {
      accessToken: string;
      refreshToken: string;
      user: { id: string };
    };

    const siteResponse = await request(
      'POST',
      '/sites',
      { code: `ACC-SITE-${suffix}`, name: 'Công trường phân quyền' },
      admin.accessToken,
    );
    assert.equal(siteResponse.status, 201);
    const site = (await siteResponse.json()) as { id: string; name: string };

    const otherSiteResponse = await request(
      'POST',
      '/sites',
      { code: `ACC-OTHER-${suffix}`, name: 'Công trường khác' },
      admin.accessToken,
    );
    assert.equal(otherSiteResponse.status, 201);
    const otherSite = (await otherSiteResponse.json()) as { id: string; name: string };

    const managerResponse = await request(
      'POST',
      '/users',
      {
        username: `access-manager-${suffix}`,
        displayName: 'Synthetic Site Manager',
        temporaryPassword: fixturePassword,
        roleAssignments: [{ role: 'SITE_MANAGER', siteId: site.id }],
      },
      admin.accessToken,
    );
    assert.equal(managerResponse.status, 201);
    const managerUser = (await managerResponse.json()) as { id: string; username: string };

    const managerLogin = await request('POST', '/auth/login', {
      username: `access-manager-${suffix}`,
      password: fixturePassword,
      clientType: 'MOBILE',
    });
    assert.equal(managerLogin.status, 200);
    const manager = (await managerLogin.json()) as { accessToken: string; refreshToken: string };

    const zoneResponse = await request(
      'POST',
      `/sites/${site.id}/zones`,
      {
        code: `ACC-ZONE-${suffix}`,
        name: 'Khu vực kiểm soát nhà thầu',
        type: 'STANDARD',
        restrictionPolicy: 'NONE',
        requiredPpe: ['HARD_HAT'],
      },
      manager.accessToken,
    );
    assert.equal(zoneResponse.status, 201);
    const zone = (await zoneResponse.json()) as { id: string; siteId: string };
    assert.equal(zone.siteId, site.id);

    const contractorId = randomUUID();
    const participationId = randomUUID();
    const participationValidFrom = new Date('2026-10-15T01:30:00.000Z');
    const participationValidUntil = new Date('2026-10-20T00:00:00.000Z');

    await database.dataSource.getRepository(ContractorEntity).save({
      id: contractorId,
      code: `CTR-${suffix.toUpperCase()}`,
      name: 'Synthetic Contractor',
      isActive: true,
    });
    await database.dataSource.getRepository(ContractorSiteParticipationEntity).save({
      id: participationId,
      contractorId,
      siteId: site.id,
      validFrom: participationValidFrom,
      validUntil: participationValidUntil,
      isActive: true,
    });

    // 1. Unauthorized actor (ADMIN without SITE_MANAGER on site.id) and wrong-site control: 0 permission writes
    const rejectedInput = {
      requestId: randomUUID(),
      siteContractorId: participationId,
      zoneId: zone.id,
      startDate: '2026-10-15',
      endDate: '2026-10-16',
      timezone: 'Asia/Ho_Chi_Minh',
    };

    const adminForbidden = await request(
      'POST',
      `/sites/${site.id}/access-setup/contractor-zone-permissions/dates`,
      rejectedInput,
      admin.accessToken,
    );
    assert.equal(adminForbidden.status, 403);
    await adminForbidden.json();

    const wrongSiteForbidden = await request(
      'POST',
      `/sites/${otherSite.id}/access-setup/contractor-zone-permissions/dates`,
      rejectedInput,
      manager.accessToken,
    );
    assert.equal(wrongSiteForbidden.status, 403);
    await wrongSiteForbidden.json();

    assert.equal(
      await database.dataSource.getRepository(ContractorZonePermissionEntity).count(),
      0,
    );
    const initialPermissionFacts = (await database.dataSource.query(
      "SELECT fact_id FROM mf06_authority_fact WHERE source_kind = 'CONTRACTOR_PERMISSION'",
    )) as Array<{ fact_id: string }>;
    assert.equal(initialPermissionFacts.length, 0);
    const initialPermissionGaps = (await database.dataSource.query(
      "SELECT gap_id FROM mf06_authority_gap WHERE source_kind = 'CONTRACTOR_PERMISSION'",
    )) as Array<{ gap_id: string }>;
    assert.equal(initialPermissionGaps.length, 0);

    // 2. Authorized scoped SITE_MANAGER grant via /dates: half-open IANA interval clamping + DTO + canonical attribution
    const grantRequestId = randomUUID();
    const grantInput = {
      requestId: grantRequestId,
      siteContractorId: participationId,
      zoneId: zone.id,
      startDate: '2026-10-15',
      endDate: '2026-10-16',
      timezone: 'Asia/Ho_Chi_Minh',
    };

    const grantResponse = await request(
      'POST',
      `/sites/${site.id}/access-setup/contractor-zone-permissions/dates`,
      grantInput,
      manager.accessToken,
    );
    assert.equal(grantResponse.status, 201);
    const granted = (await grantResponse.json()) as {
      id: string;
      siteContractorId: string;
      zoneId: string;
      validFrom: string;
      validUntil: string;
      grantedBy: string;
      revokedAt: string | null;
    };

    // Unclamped 2026-10-15..2026-10-16 in Asia/Ho_Chi_Minh is [2026-10-14T17:00:00.000Z, 2026-10-16T17:00:00.000Z);
    // validFrom clamps to mid-day participation.validFrom (2026-10-15T01:30:00.000Z).
    assert.equal(granted.id, grantRequestId);
    assert.equal(granted.siteContractorId, participationId);
    assert.equal(granted.zoneId, zone.id);
    assert.equal(granted.validFrom, '2026-10-15T01:30:00.000Z');
    assert.equal(granted.validUntil, '2026-10-16T17:00:00.000Z');
    assert.equal(granted.grantedBy, managerUser.id);
    assert.equal(granted.revokedAt, null);

    const permissionFacts = (await database.dataSource.query(
      `SELECT fact_id, source_kind, source_id, command_id, transaction_id::text AS transaction_id, operation
       FROM mf06_authority_fact
       WHERE source_kind = 'CONTRACTOR_PERMISSION' AND source_id = $1`,
      [granted.id],
    )) as Array<{
      fact_id: string;
      source_kind: string;
      source_id: string;
      command_id: string | null;
      transaction_id: string;
      operation: string;
    }>;
    assert.equal(permissionFacts.length, 1);
    const fact = permissionFacts[0]!;
    assert.equal(fact.source_kind, 'CONTRACTOR_PERMISSION');
    assert.equal(fact.source_id, granted.id);
    assert.equal(fact.operation, 'INSERT');

    const permissionGaps = (await database.dataSource.query(
      `SELECT gap_id, reason
       FROM mf06_authority_gap
       WHERE source_kind = 'CONTRACTOR_PERMISSION' AND source_id = $1`,
      [granted.id],
    )) as Array<{ gap_id: string; reason: string }>;
    assert.deepEqual(
      permissionGaps,
      [],
      'Attributed CONTRACTOR_PERMISSION grant must not record an UNATTRIBUTED_WRITE authority gap',
    );
    assert.notEqual(
      fact.command_id,
      null,
      'CONTRACTOR_PERMISSION fact must link to a canonical mf06_authority_command',
    );

    const commands = (await database.dataSource.query(
      `SELECT command_id, actor_user_id, operation, request_hash, transaction_id::text AS transaction_id
       FROM mf06_authority_command
       WHERE command_id = $1`,
      [fact.command_id],
    )) as Array<{
      command_id: string;
      actor_user_id: string;
      operation: string;
      request_hash: string;
      transaction_id: string;
    }>;
    assert.equal(commands.length, 1);
    const commandRow = commands[0]!;
    assert.equal(commandRow.actor_user_id, managerUser.id);
    assert.equal(commandRow.operation, 'CONTRACTOR_ZONE_GRANT');
    assert.equal(commandRow.transaction_id, fact.transaction_id);
    assert.match(commandRow.request_hash, /^[0-9a-f]{64}$/);

    const actorUserIdLower = managerUser.id.toLowerCase();
    const candidateRequestHashes = [
      computeCanonicalPayloadHash({
        operation: 'CONTRACTOR_ZONE_GRANT',
        actorUserId: actorUserIdLower,
        request: {
          requestId: grantRequestId.toLowerCase(),
          siteContractorId: participationId.toLowerCase(),
          zoneId: zone.id.toLowerCase(),
          validFrom: granted.validFrom,
          validUntil: granted.validUntil,
          siteId: site.id.toLowerCase(),
          actorUserId: actorUserIdLower,
        },
      }),
      computeCanonicalPayloadHash({
        operation: 'CONTRACTOR_ZONE_GRANT',
        actorUserId: actorUserIdLower,
        request: grantInput,
      }),
      computeCanonicalPayloadHash({
        operation: 'CONTRACTOR_ZONE_GRANT',
        actorUserId: actorUserIdLower,
        request: { siteId: site.id, ...grantInput },
      }),
      computeCanonicalPayloadHash({
        operation: 'CONTRACTOR_ZONE_GRANT',
        actorUserId: actorUserIdLower,
        request: {
          requestId: grantRequestId,
          siteContractorId: participationId,
          zoneId: zone.id,
          validFrom: granted.validFrom,
          validUntil: granted.validUntil,
        },
      }),
    ];
    assert.ok(
      candidateRequestHashes.includes(commandRow.request_hash),
      'mf06_authority_command.request_hash must match canonical CONTRACTOR_ZONE_GRANT payload hash',
    );

    const witnesses = (await database.dataSource.query(
      `SELECT command_id, transaction_id::text AS transaction_id
       FROM mf06_authority_commit_witness
       WHERE command_id = $1`,
      [fact.command_id],
    )) as Array<{ command_id: string; transaction_id: string }>;
    assert.equal(witnesses.length, 1);
    assert.equal(witnesses[0]!.command_id, commandRow.command_id);
    assert.equal(witnesses[0]!.transaction_id, commandRow.transaction_id);

    // Retrying the same date grant retains the original permission and emits no
    // extra source revision. Explicit intervals retain the existing second route.
    const retry = await request(
      'POST',
      `/sites/${site.id}/access-setup/contractor-zone-permissions/dates`,
      grantInput,
      manager.accessToken,
    );
    assert.equal(retry.status, 201);
    assert.equal(((await retry.json()) as { id: string }).id, granted.id);
    const explicitId = randomUUID();
    const explicit = await request(
      'POST',
      `/sites/${site.id}/access-setup/contractor-zone-permissions`,
      {
        requestId: explicitId,
        siteContractorId: participationId,
        zoneId: zone.id,
        validFrom: '2026-10-17T01:30:00.000Z',
        validUntil: '2026-10-18T12:00:00.000Z',
      },
      manager.accessToken,
    );
    assert.equal(explicit.status, 201);
    assert.equal(((await explicit.json()) as { id: string }).id, explicitId);

    const workerId = randomUUID(),
      assignmentId = randomUUID();
    await database.dataSource.getRepository(WorkerEntity).save({
      id: workerId,
      siteId: site.id,
      contractorId,
      externalId: workerId,
      displayName: 'Synthetic permission worker',
      isActive: true,
    });
    await database.dataSource.getRepository(WorkerSiteZoneAssignmentEntity).save({
      id: assignmentId,
      workerId,
      siteId: site.id,
      siteContractorId: participationId,
      zoneIds: [zone.id],
      status: WorkerSiteZoneAssignmentStatus.APPROVED,
      validFrom: new Date(granted.validFrom),
      validUntil: new Date(granted.validUntil),
      requestedByUserId: managerUser.id,
      siteManagerDecidedByUserId: managerUser.id,
    });
    const workerInput = {
      requestId: randomUUID(),
      workerAssignmentId: assignmentId,
      contractorZonePermissionId: granted.id,
      validFrom: granted.validFrom,
      validUntil: granted.validUntil,
    };
    const managerWorker = await request(
      'POST',
      `/sites/${site.id}/access-setup/worker-zone-permissions`,
      workerInput,
      manager.accessToken,
    );
    assert.equal(managerWorker.status, 403);
    const workerGrant = await request(
      'POST',
      `/sites/${site.id}/access-setup/worker-zone-permissions`,
      workerInput,
      admin.accessToken,
    );
    assert.equal(workerGrant.status, 201);
    assert.equal(((await workerGrant.json()) as { id: string }).id, workerInput.requestId);
    const workerRevoke = await request(
      'POST',
      `/sites/${site.id}/access-setup/worker-zone-permissions/${workerInput.requestId}/revoke`,
      undefined,
      admin.accessToken,
    );
    assert.equal(workerRevoke.status, 201);
    const adminContractorRevoke = await request(
      'POST',
      `/sites/${site.id}/access-setup/contractor-zone-permissions/${granted.id}/revoke`,
      undefined,
      admin.accessToken,
    );
    assert.equal(adminContractorRevoke.status, 403);
    const contractorRevoke = await request(
      'POST',
      `/sites/${site.id}/access-setup/contractor-zone-permissions/${granted.id}/revoke`,
      undefined,
      manager.accessToken,
    );
    assert.equal(contractorRevoke.status, 201);
    const retryRevoke = await request(
      'POST',
      `/sites/${site.id}/access-setup/contractor-zone-permissions/${granted.id}/revoke`,
      undefined,
      manager.accessToken,
    );
    assert.equal(retryRevoke.status, 201);
    const attributed = await database.dataSource.query(`
      SELECT f.source_kind,f.source_id,f.operation,c.operation AS command_operation,c.actor_user_id,
             w.command_id AS witness_id
      FROM mf06_authority_fact f LEFT JOIN mf06_authority_command c USING(command_id)
      LEFT JOIN mf06_authority_commit_witness w USING(command_id)
      WHERE f.source_kind IN ('CONTRACTOR_PERMISSION','WORKER_PERMISSION')
      ORDER BY f.source_kind,f.source_id,f.revision`);
    assert.equal(attributed.length, 5); // 2 contractor inserts + 1 update, worker insert + update
    assert.ok(attributed.every((row: { witness_id: string | null }) => row.witness_id));
    assert.ok(
      attributed.every(
        (row: { source_kind: string; actor_user_id: string }) =>
          row.actor_user_id ===
          (row.source_kind === 'CONTRACTOR_PERMISSION' ? managerUser.id : admin.user.id),
      ),
    );
    assert.equal(
      attributed.filter(
        (row: { command_operation: string }) => row.command_operation === 'CONTRACTOR_ZONE_GRANT',
      ).length,
      2,
    );
    assert.equal(
      attributed.filter(
        (row: { command_operation: string }) => row.command_operation === 'CONTRACTOR_ZONE_REVOKE',
      ).length,
      1,
    );
    assert.equal(
      attributed.filter(
        (row: { command_operation: string }) => row.command_operation === 'WORKER_ZONE_GRANT',
      ).length,
      1,
    );
    assert.equal(
      attributed.filter(
        (row: { command_operation: string }) => row.command_operation === 'WORKER_ZONE_REVOKE',
      ).length,
      1,
    );
    assert.deepEqual(
      await database.dataSource.query(
        "SELECT gap_id FROM mf06_authority_gap WHERE source_kind IN ('CONTRACTOR_PERMISSION','WORKER_PERMISSION')",
      ),
      [],
    );

    // Hold only the transactional recheck of an actual bearer. Logging out
    // before the command claim must result in 401 and zero permission/fact writes.
    const guard = Reflect.get(app.get(SiteAccessSetupController), 'auth') as UserAuthGuard;
    const authenticate = guard.authenticateRequest.bind(guard);
    let release!: () => void, reached!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const claimed = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let intercept = true;
    guard.authenticateRequest = async (
      incoming: AuthenticatedRequest,
      transaction?: EntityManager,
    ) => {
      if (transaction && intercept) {
        intercept = false;
        reached();
        await held;
      }
      await authenticate(incoming, transaction);
    };
    try {
      const lateId = randomUUID();
      const late = request(
        'POST',
        `/sites/${site.id}/access-setup/contractor-zone-permissions/dates`,
        { ...grantInput, requestId: lateId },
        manager.accessToken,
      );
      await Promise.race([
        claimed,
        late.then(async (response) => {
          throw new Error(
            `Mutation returned HTTP ${response.status} before transactional bearer recheck: ${JSON.stringify(await response.json())}`,
          );
        }),
        new Promise<never>((_resolve, reject) => {
          const deadline = setTimeout(
            () => reject(new Error('Transactional bearer recheck was not reached')),
            3000,
          );
          deadline.unref();
        }),
      ]);
      const logout = await request('POST', '/auth/logout', {
        refreshToken: manager.refreshToken,
        clientType: 'MOBILE',
      });
      assert.equal(logout.status, 204);
      release();
      assert.equal((await late).status, 401);
      assert.equal(
        await database.dataSource
          .getRepository(ContractorZonePermissionEntity)
          .countBy({ id: lateId }),
        0,
      );
      assert.deepEqual(
        await database.dataSource.query(
          'SELECT fact_id FROM mf06_authority_fact WHERE source_id=$1',
          [lateId],
        ),
        [],
      );
    } finally {
      release();
      guard.authenticateRequest = authenticate;
    }
  } finally {
    await app.close();
  }
});
