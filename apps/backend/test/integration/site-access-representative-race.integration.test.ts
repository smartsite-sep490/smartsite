import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { EntityManager, QueryRunner } from 'typeorm';
import { validateEnvironment, type BackendEnvironment } from '../../src/config/environment.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import {
  ContractorEntity,
  ContractorRepresentativeAssignmentEntity,
  ContractorRepresentativeGrantEntity,
  ContractorSiteParticipationEntity,
  UserRole,
  WorkerEntity,
  WorkerSiteZoneAssignmentEntity,
  WorkerSiteZoneAssignmentStatus,
  WorkerZonePermissionEntity,
  ZoneEntity,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/index.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { AuthService, type AuthenticatedRequest } from '../../src/modules/auth/auth.service.js';
import { configurationCommandContext } from '../../src/modules/auth/configuration-command-context.js';
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { SiteAccessSetupService } from '../../src/modules/workforce/access/site-access-setup.service.js';
import type { WorkforceActor } from '../../src/modules/workforce/directory/contractor-operations.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const database = createIsolatedTestDatabase({ canonical: true });
before(() => database.initialize());
after(() => database.dispose());

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createDeadline(
  ms: number,
  message: string,
): {
  promise: Promise<never>;
  cancel: () => void;
} {
  let timer: NodeJS.Timeout | undefined;
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref();
  });
  return {
    promise,
    cancel: () => {
      if (timer) clearTimeout(timer);
    },
  };
}

function createRealAccessServices() {
  const environment = validateEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    LOG_FORMAT: 'json',
    SMARTSITE_AI_SERVICE_TOKEN: 'synthetic-unused-service-token-only',
    MF06_ENQUEUE_ENABLED: 'false',
    MF06_ASSESSMENT_READ_ENABLED: 'false',
    CORS_ORIGINS: 'http://localhost:5181',
    STORAGE_LOCAL_ROOT: join(tmpdir(), 'smartsite-representative-race-unused-media'),
  });
  assert.equal(environment.MF06_ENQUEUE_ENABLED, false);
  assert.equal(environment.MF06_ASSESSMENT_READ_ENABLED, false);
  assert.equal(environment.SMARTSITE_AI_IDENTITY_URL, undefined);

  const config = new ConfigService<BackendEnvironment, true>(environment);
  const siteService = new SiteConfigurationService(database.dataSource);
  const usersService = new UsersService(database.dataSource, siteService);
  const tokenService = new AuthTokenService(new JwtService(), config);
  const authService = new AuthService(database.dataSource, tokenService);
  const authGuard = new UserAuthGuard(authService);
  const setupService = new SiteAccessSetupService(database.dataSource);

  const authenticateBearer = async (accessToken: string) => {
    const authorization = `Bearer ${accessToken}`;
    const req: AuthenticatedRequest = {
      headers: { authorization },
      rawHeaders: ['Authorization', authorization],
    };
    await authGuard.authenticateRequest(req);
    assert.ok(req.user, 'Expected UserAuthGuard to populate req.user');
    return {
      req,
      user: req.user,
      context: configurationCommandContext(req, authGuard),
    };
  };

  return {
    siteService,
    usersService,
    authService,
    authGuard,
    setupService,
    authenticateBearer,
  };
}

async function seedSiteContractorAndApprovedWorkerAssignment(
  suffix: string,
  services: ReturnType<typeof createRealAccessServices>,
) {
  const fixturePassword = 'SyntheticFixture123!';

  const [controlRow] = (await database.dataSource.query(
    'SELECT singleton, epoch_id FROM mf06_authority_control WHERE singleton = 1',
  )) as Array<{ singleton: number; epoch_id: string | null }>;
  assert.equal(controlRow?.singleton, 1);
  assert.equal(controlRow?.epoch_id, null);

  await services.usersService.create({
    username: `rep-race-admin-${suffix}`,
    displayName: 'Synthetic Representative Race Admin',
    temporaryPassword: fixturePassword,
    roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
  });
  const adminLogin = await services.authService.login(`rep-race-admin-${suffix}`, fixturePassword);
  const adminAuth = await services.authenticateBearer(adminLogin.accessToken);

  const site = await services.siteService.create(
    {
      code: `REP-SITE-${suffix.toUpperCase()}`,
      name: 'Công trường kiểm tra khóa đại diện nhà thầu',
    },
    adminAuth.context,
  );

  await services.usersService.create(
    {
      username: `rep-race-mgr-${suffix}`,
      displayName: 'Synthetic Scoped Site Manager',
      temporaryPassword: fixturePassword,
      roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId: site.id }],
    },
    adminAuth.context,
  );
  const managerLogin = await services.authService.login(`rep-race-mgr-${suffix}`, fixturePassword);
  const managerAuth = await services.authenticateBearer(managerLogin.accessToken);

  const zoneId = randomUUID();
  await database.dataSource.getRepository(ZoneEntity).save({
    id: zoneId,
    siteId: site.id,
    code: `REP-ZONE-${suffix.toUpperCase()}`,
    name: 'Khu vực kiểm tra quyền công nhân',
    type: ZoneType.STANDARD,
    restrictionPolicy: ZoneRestrictionPolicy.NONE,
    requiredPpe: ['HARD_HAT'],
    configurationLocked: false,
  });

  const contractorId = randomUUID();
  const participationId = randomUUID();
  const participationValidFrom = new Date('2026-10-15T01:30:00.000Z');
  const participationValidUntil = new Date('2026-10-20T00:00:00.000Z');

  await database.dataSource.getRepository(ContractorEntity).save({
    id: contractorId,
    code: `REP-CTR-${suffix.toUpperCase()}`,
    name: 'Synthetic Managed Contractor',
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

  const contractorPermissionRequestId = randomUUID();
  const permissionValidFrom = '2026-10-15T02:00:00.000Z';
  const permissionValidUntil = '2026-10-18T12:00:00.000Z';
  const contractorPermission = await services.setupService.grantContractor(
    managerAuth.user,
    site.id,
    {
      requestId: contractorPermissionRequestId,
      siteContractorId: participationId,
      zoneId,
      validFrom: permissionValidFrom,
      validUntil: permissionValidUntil,
    },
    managerAuth.context,
  );
  assert.equal(contractorPermission.id, contractorPermissionRequestId);

  const workerId = randomUUID();
  const assignmentId = randomUUID();
  await database.dataSource.getRepository(WorkerEntity).save({
    id: workerId,
    siteId: site.id,
    contractorId,
    externalId: `WKR-${suffix}`,
    displayName: 'Synthetic Approved Worker',
    isActive: true,
  });
  await database.dataSource.getRepository(WorkerSiteZoneAssignmentEntity).save({
    id: assignmentId,
    workerId,
    siteId: site.id,
    siteContractorId: participationId,
    zoneIds: [zoneId],
    status: WorkerSiteZoneAssignmentStatus.APPROVED,
    validFrom: new Date(permissionValidFrom),
    validUntil: new Date(permissionValidUntil),
    requestedByUserId: managerAuth.user.id,
    siteManagerDecidedByUserId: managerAuth.user.id,
  });

  return {
    fixturePassword,
    adminAuth,
    managerAuth,
    site,
    zoneId,
    contractorId,
    participationId,
    contractorPermission,
    workerId,
    assignmentId,
    permissionValidFrom,
    permissionValidUntil,
  };
}

interface LockObservationRow {
  waiting_pid: number;
  wait_event_type: string | null;
  wait_event: string | null;
  state: string | null;
  blocked_by_t1: boolean;
  has_ungranted_lock: boolean;
  t1_holds_representative_assignment_row_lock: boolean;
}

async function observeBackendWaitingOnRepresentativeRowLock(
  waitingPid: number,
  holdingPid: number,
  stopSignal: { stopped: boolean },
): Promise<{ status: 'waiting_on_t1_lock'; observation: LockObservationRow }> {
  const deadline = Date.now() + 1500;
  while (!stopSignal.stopped && Date.now() < deadline) {
    const rows = (await database.dataSource.query(
      `SELECT
         sa.pid::int AS waiting_pid,
         sa.wait_event_type AS wait_event_type,
         sa.wait_event AS wait_event,
         sa.state AS state,
         ($2::int = ANY(pg_blocking_pids(sa.pid))) AS blocked_by_t1,
         EXISTS (
           SELECT 1
           FROM pg_locks w
           WHERE w.pid = sa.pid
             AND NOT w.granted
         ) AS has_ungranted_lock,
         EXISTS (
           SELECT 1
           FROM pg_locks h
           WHERE h.pid = $2::int
             AND h.granted
             AND h.relation = to_regclass('contractor_representative_assignment')
             AND h.mode <> 'AccessShareLock'
         ) AS t1_holds_representative_assignment_row_lock
       FROM pg_stat_activity sa
       WHERE sa.pid = $1::int`,
      [waitingPid, holdingPid],
    )) as LockObservationRow[];

    const row = rows[0];
    if (row && row.wait_event_type === 'Lock' && row.has_ungranted_lock && row.blocked_by_t1) {
      return { status: 'waiting_on_t1_lock', observation: row };
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 15);
      timer.unref();
    });
  }

  throw new Error(
    `Backend PID ${waitingPid} did not enter Lock wait blocked by T1 PID ${holdingPid} within observation window`,
  );
}

test('grantWorker rejects a global Contractor grant without the exact Site representative assignment with 0 permission or fact writes', async () => {
  const suffix = randomUUID().slice(0, 8);
  const services = createRealAccessServices();
  const seeded = await seedSiteContractorAndApprovedWorkerAssignment(suffix, services);

  const ungrantedRep = await services.usersService.create(
    {
      username: `rep-ungranted-${suffix}`,
      displayName: 'Representative Without Target Contractor Grant',
      temporaryPassword: seeded.fixturePassword,
      roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: seeded.site.id }],
    },
    seeded.adminAuth.context,
  );
  await database.dataSource.getRepository(ContractorRepresentativeGrantEntity).save({
    id: randomUUID(),
    userId: ungrantedRep.id,
    contractorId: seeded.contractorId,
  });

  const repLogin = await services.authService.login(
    `rep-ungranted-${suffix}`,
    seeded.fixturePassword,
  );
  const repAuth = await services.authenticateBearer(repLogin.accessToken);

  const rejectedRequestId = randomUUID();
  await assert.rejects(
    () =>
      services.setupService.grantWorker(
        repAuth.user,
        seeded.site.id,
        {
          requestId: rejectedRequestId,
          workerAssignmentId: seeded.assignmentId,
          contractorZonePermissionId: seeded.contractorPermission.id,
          validFrom: seeded.permissionValidFrom,
          validUntil: seeded.permissionValidUntil,
        },
        repAuth.context,
      ),
    (error: unknown) => error instanceof PublicHttpException && error.getStatus() === 409,
  );

  assert.equal(
    await database.dataSource
      .getRepository(WorkerZonePermissionEntity)
      .countBy({ id: rejectedRequestId }),
    0,
  );
  const workerFacts = (await database.dataSource.query(
    "SELECT fact_id FROM mf06_authority_fact WHERE source_kind = 'WORKER_PERMISSION' AND source_id = $1",
    [rejectedRequestId],
  )) as Array<{ fact_id: string }>;
  assert.deepEqual(workerFacts, []);
  const permissionGaps = (await database.dataSource.query(
    "SELECT gap_id FROM mf06_authority_gap WHERE source_kind = 'WORKER_PERMISSION'",
  )) as Array<{ gap_id: string }>;
  assert.deepEqual(permissionGaps, []);
});

test('grantWorker locks the exact Site representative assignment until worker_zone_permission INSERT commits before a concurrent DELETE', async () => {
  const suffix = randomUUID().slice(0, 8);
  const services = createRealAccessServices();
  const seeded = await seedSiteContractorAndApprovedWorkerAssignment(suffix, services);

  const repUser = await services.usersService.create(
    {
      username: `rep-granted-${suffix}`,
      displayName: 'Authorized Contractor Representative',
      temporaryPassword: seeded.fixturePassword,
      roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: seeded.site.id }],
    },
    seeded.adminAuth.context,
  );
  const representativeAssignmentId = randomUUID();
  await database.dataSource.getRepository(ContractorRepresentativeAssignmentEntity).save({
    id: representativeAssignmentId,
    userId: repUser.id,
    contractorId: seeded.contractorId,
    siteId: seeded.site.id,
  });

  const repLogin = await services.authService.login(
    `rep-granted-${suffix}`,
    seeded.fixturePassword,
  );
  const repAuth = await services.authenticateBearer(repLogin.accessToken);

  type RequireRepresentativeFn = (
    manager: EntityManager,
    actor: WorkforceActor,
    siteId: string,
    contractorId: string,
  ) => Promise<void>;

  const originalRequireRepresentative = (
    Reflect.get(services.setupService, 'requireRepresentative') as RequireRepresentativeFn
  ).bind(services.setupService);

  const t1ReachedPostAuth = createDeferred<{ t1Pid: number }>();
  const releaseT1BeforeInsert = createDeferred<void>();
  const t2DeleteStarted = createDeferred<void>();
  const stopPolling = { stopped: false };
  let interceptOnce = true;

  Reflect.set(
    services.setupService,
    'requireRepresentative',
    async (
      manager: EntityManager,
      actor: WorkforceActor,
      siteId: string,
      contractorId: string,
    ): Promise<void> => {
      await originalRequireRepresentative(manager, actor, siteId, contractorId);
      if (interceptOnce) {
        interceptOnce = false;
        const [pidRow] = (await manager.query('SELECT pg_backend_pid()::int AS pid')) as Array<{
          pid: number;
        }>;
        assert.ok(pidRow?.pid, 'Expected T1 PostgreSQL backend PID');
        t1ReachedPostAuth.resolve({ t1Pid: pidRow.pid });
        const holdDeadline = createDeadline(
          4000,
          'Timed out holding T1 after requireRepresentative',
        );
        try {
          await Promise.race([releaseT1BeforeInsert.promise, holdDeadline.promise]);
        } finally {
          holdDeadline.cancel();
        }
      }
    },
  );

  let runner2: QueryRunner | undefined;
  let t1GrantTask: Promise<{ id: string }> | undefined;
  let t2DeleteTask:
    Promise<{ status: 'deleted_before_t1_release'; deletedCount: number }> | undefined;

  const workerRequestId = randomUUID();

  try {
    t1GrantTask = services.setupService.grantWorker(
      repAuth.user,
      seeded.site.id,
      {
        requestId: workerRequestId,
        workerAssignmentId: seeded.assignmentId,
        contractorZonePermissionId: seeded.contractorPermission.id,
        validFrom: seeded.permissionValidFrom,
        validUntil: seeded.permissionValidUntil,
      },
      repAuth.context,
    );

    const reachDeadline = createDeadline(
      4000,
      'T1 did not reach requireRepresentative within deadline',
    );
    let t1Pid: number;
    try {
      const reached = await Promise.race([
        t1ReachedPostAuth.promise,
        t1GrantTask.then((result) => {
          throw new Error(
            `T1 completed before post-requireRepresentative gate with result ${result.id}`,
          );
        }),
        reachDeadline.promise,
      ]);
      t1Pid = reached.t1Pid;
    } finally {
      reachDeadline.cancel();
    }

    runner2 = database.dataSource.createQueryRunner();
    await runner2.connect();
    const [t2PidRow] = (await runner2.query('SELECT pg_backend_pid()::int AS pid')) as Array<{
      pid: number;
    }>;
    const t2Pid = t2PidRow?.pid;
    assert.ok(t2Pid, 'Expected T2 PostgreSQL backend PID');
    assert.notEqual(t2Pid, t1Pid, 'T1 and T2 must execute on distinct PostgreSQL backends');

    await runner2.startTransaction();
    // Deliberately unattributed synthetic fixture deletion. No invented trusted
    // operation/hash/actor or fabricated authority witness for this scheduler.

    const activeRunner2 = runner2;
    t2DeleteTask = (async () => {
      t2DeleteStarted.resolve();
      const deletedRows = (await activeRunner2.query(
        `WITH deleted AS (
           DELETE FROM contractor_representative_assignment
           WHERE id = $1 AND user_id = $2 AND contractor_id = $3 AND site_id = $4
           RETURNING id
         )
         SELECT id FROM deleted`,
        [representativeAssignmentId, repUser.id, seeded.contractorId, seeded.site.id],
      )) as Array<{ id: string }>;
      await activeRunner2.commitTransaction();
      return {
        status: 'deleted_before_t1_release' as const,
        deletedCount: deletedRows.length,
      };
    })();

    await t2DeleteStarted.promise;

    const scheduleOutcome = await Promise.race([
      t2DeleteTask,
      observeBackendWaitingOnRepresentativeRowLock(t2Pid, t1Pid, stopPolling),
    ]);
    stopPolling.stopped = true;

    const assignmentCountWhileT1Held = await database.dataSource
      .getRepository(ContractorRepresentativeAssignmentEntity)
      .countBy({ id: representativeAssignmentId });
    const workerPermissionCountWhileT1Held = await database.dataSource
      .getRepository(WorkerZonePermissionEntity)
      .countBy({ id: workerRequestId });

    releaseT1BeforeInsert.resolve();
    const [t1Result, t2Result] = await Promise.all([t1GrantTask, t2DeleteTask]);
    assert.equal(t1Result.id, workerRequestId);
    assert.equal(t2Result.deletedCount, 1);

    assert.equal(
      scheduleOutcome.status,
      'waiting_on_t1_lock',
      `Expected T2 DELETE (pid=${t2Pid}) on contractor_representative_assignment (${representativeAssignmentId}) to block on T1 (pid=${t1Pid}) row lock until worker_zone_permission (${workerRequestId}) committed, but T2 completed its DELETE and committed while T1 was still paused before worker_zone_permission INSERT (assignmentCountWhileT1Held=${assignmentCountWhileT1Held}, workerPermissionCountWhileT1Held=${workerPermissionCountWhileT1Held})`,
    );
    assert.equal(scheduleOutcome.observation.wait_event_type, 'Lock');
    assert.equal(scheduleOutcome.observation.has_ungranted_lock, true);
    assert.equal(scheduleOutcome.observation.blocked_by_t1, true);
    assert.equal(scheduleOutcome.observation.t1_holds_representative_assignment_row_lock, true);
    assert.equal(assignmentCountWhileT1Held, 1);
    assert.equal(workerPermissionCountWhileT1Held, 0);

    assert.equal(
      await database.dataSource
        .getRepository(ContractorRepresentativeAssignmentEntity)
        .countBy({ id: representativeAssignmentId }),
      0,
    );
    assert.equal(
      await database.dataSource
        .getRepository(WorkerZonePermissionEntity)
        .countBy({ id: workerRequestId }),
      1,
    );
  } finally {
    stopPolling.stopped = true;
    releaseT1BeforeInsert.resolve();
    t1ReachedPostAuth.resolve({ t1Pid: -1 });
    Reflect.set(services.setupService, 'requireRepresentative', originalRequireRepresentative);
    await Promise.allSettled([
      ...(t1GrantTask ? [t1GrantTask] : []),
      ...(t2DeleteTask ? [t2DeleteTask] : []),
    ]);
    if (runner2) {
      try {
        if (runner2.isTransactionActive) {
          await runner2.rollbackTransaction();
        }
      } finally {
        if (!runner2.isReleased) {
          await runner2.release();
        }
      }
    }
  }
});
