import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import {
  AccessAuditEntity,
  ContractorEntity,
  ContractorRepresentativeGrantEntity,
  ContractorSiteParticipationEntity,
  FaceEnrollmentSessionEntity,
  FaceEnrollmentSessionStatus,
  FaceProfileEntity,
  SiteEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
  WorkerEntity,
  WorkerGatePermissionEntity,
  WorkerSiteZoneAssignmentEntity,
  WorkerSiteZoneAssignmentStatus,
  ZoneEntity,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/index.js';
import type { MainConfigurationCommandContext } from '../../src/common/configuration/main-configuration-authority.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import {
  ContractorOperationsService,
  type CreateContractorWorkerCommand,
  type CreateWorkerSiteZoneAssignmentCommand,
} from '../../src/modules/workforce/directory/contractor-operations.service.js';
import { MainWorkforceCreateService } from '../../src/modules/workforce/main-workforce-create.service.js';
import { MainAssignmentCommandService } from '../../src/modules/zones/main-assignment-command.service.js';
import { ContractorWorkerAccountsService } from '../../src/modules/workforce/directory/contractor-worker-accounts.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';
import { verifyPassword } from '../../src/modules/auth/password.js';
import { WorkforceConfigurationService } from '../../src/modules/workforce/directory/workforce-configuration.service.js';
import { createTestConfig } from '../support/config.js';
import { FaceEnrollmentService } from '../../src/modules/workforce/identity/face-enrollment.service.js';
import { evaluateWorkerAccess } from '../../src/modules/workforce/access/worker-access-evaluation.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { cleanupSiteAccess } from '../support/cleanup-site-access.js';
import { assignTestShift } from '../support/assigned-shift.js';

const isolatedDatabase = createIsolatedTestDatabase({ canonical: true });
const dataSource = isolatedDatabase.dataSource;

after(async () => {
  await isolatedDatabase.dispose();
});

const publicError = (code: string) => (error: unknown) =>
  error instanceof PublicHttpException && error.publicPayload.code === code;

const actorContext = (actor: { id: string }): MainConfigurationCommandContext => ({
  actorUserId: actor.id,
  reauthorize: async (manager) => {
    const current = await manager
      .getRepository(UserEntity)
      .findOne({ where: { id: actor.id }, lock: { mode: 'pessimistic_read' } });
    if (current?.mustChangePassword)
      throw new PublicHttpException(403, {
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Password change required',
      });
  },
});

// Approval and certificates are outside this suite. Access tests seed an
// already-approved assignment without invoking the Site Manager workflow.
test('MF01: contractor onboarding, assignment requests, consent and current entry conditions', async (t) => {
  await isolatedDatabase.initialize();
  const siteId = randomUUID();
  const otherSiteId = randomUUID();
  const contractorId = randomUUID();
  const otherContractorId = randomUUID();
  const participationId = randomUUID();
  const representativeId = randomUUID();
  const outsiderId = randomUUID();
  const otherSiteRepresentativeId = randomUUID();
  const workerAccountId = randomUUID();
  const zoneId = randomUUID();
  const otherZoneId = randomUUID();
  const from = new Date(Date.now() - 3_600_000);
  const until = new Date(Date.now() + 3_600_000);
  const parentUntil = new Date(Date.now() + 7_200_000);
  const representative = {
    id: representativeId,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId }],
  };
  const outsider = { ...representative, id: outsiderId };
  const otherSiteRepresentative = {
    id: otherSiteRepresentativeId,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: otherSiteId }],
  };
  const workerActor = {
    id: workerAccountId,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.WORKER, siteId }],
  };
  const operations = new ContractorOperationsService(dataSource);
  const creation = new MainWorkforceCreateService(dataSource);
  const assignments = new MainAssignmentCommandService(dataSource);
  const createWorker = (
    actor: { id: string },
    contractorId: string,
    input: CreateContractorWorkerCommand,
  ) => creation.createWorker(contractorId, input, actorContext(actor));
  const requestAssignment = (
    actor: { id: string },
    workerId: string,
    input: CreateWorkerSiteZoneAssignmentCommand,
  ) => assignments.publicRequest(workerId, input, actorContext(actor));
  const users = new UsersService(dataSource, new SiteConfigurationService(dataSource));
  const accounts = new ContractorWorkerAccountsService(dataSource, operations, users);
  const createdAccountIds: string[] = [];
  const workerInput = { siteId, externalId: randomUUID(), displayName: 'Synthetic MF01 worker' };
  let qualityFails = false;
  let completionFails = false;
  let sampleCalls = 0;
  const enrollment = new FaceEnrollmentService(dataSource, operations, {
    async assessSampleQuality() {
      return qualityFails
        ? { status: 'QUALITY_FAILED' as const, reasonCode: 'FACE_BLURRY' }
        : { status: 'ACCEPTED' as const, reasonCode: 'FACE_QUALITY_ACCEPTED' };
    },
    async submitSample(input) {
      sampleCalls += 1;
      return { acceptedSampleCount: input.sampleIndex };
    },
    async completeEnrollment(sessionId) {
      if (completionFails) throw new Error('Synthetic enrollment model failure');
      return {
        profileReference: `synthetic_${sessionId}`,
        modelVersion: 'synthetic-mf01-v1',
        encryptedTemplate: 'gAAAA' + 'a'.repeat(150) + '==',
      };
    },
  });
  const sample = { mimetype: 'image/jpeg', buffer: Buffer.from('synthetic-jpeg'), size: 14 };
  try {
    for (const id of [siteId, otherSiteId])
      await dataSource
        .getRepository(SiteEntity)
        .save({ id, code: id, name: 'Synthetic MF01 Site' });
    for (const id of [representativeId, outsiderId, otherSiteRepresentativeId, workerAccountId])
      await dataSource.getRepository(UserEntity).save({
        id,
        username: id,
        displayName: 'Synthetic MF01 user',
        passwordHash: 'synthetic-not-a-login-hash',
        isActive: true,
        mustChangePassword: false,
      });
    for (const actor of [representative, outsider, otherSiteRepresentative])
      await dataSource.getRepository(UserRoleAssignmentEntity).save({
        id: randomUUID(),
        userId: actor.id,
        ...actor.roleAssignments[0],
      });
    await dataSource.getRepository(UserRoleAssignmentEntity).save({
      id: randomUUID(),
      userId: workerAccountId,
      role: UserRole.WORKER,
      siteId,
    });
    for (const id of [contractorId, otherContractorId])
      await dataSource.getRepository(ContractorEntity).save({
        id,
        code: id,
        name: 'Synthetic MF01 contractor',
        isActive: true,
      });
    await dataSource.getRepository(ContractorSiteParticipationEntity).save({
      id: participationId,
      contractorId,
      siteId,
      validFrom: from,
      validUntil: parentUntil,
      isActive: true,
    });
    for (const userId of [representativeId, otherSiteRepresentativeId])
      await dataSource.getRepository(ContractorRepresentativeGrantEntity).save({
        id: randomUUID(),
        userId,
        contractorId,
      });
    for (const [id, scope] of [
      [zoneId, siteId],
      [otherZoneId, otherSiteId],
    ])
      await dataSource.getRepository(ZoneEntity).save({
        id,
        siteId: scope,
        code: id,
        name: 'Synthetic MF01 Zone',
        type: ZoneType.RESTRICTED,
        restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
        requiredPpe: [],
        configurationLocked: false,
      });

    const worker = await createWorker(representative, contractorId, workerInput);
    assert.ok(worker);
    await t.test(
      'representative creates a Worker owned by the correct Contractor and Site',
      async () => {
        const stored = await dataSource
          .getRepository(WorkerEntity)
          .findOneByOrFail({ id: worker.id });
        assert.equal(stored.contractorId, contractorId);
        assert.equal(stored.siteId, siteId);
        assert.equal(stored.displayName, workerInput.displayName);
      },
    );
    await t.test(
      'duplicate Worker code is rejected by the actual PostgreSQL constraint',
      async () => {
        await assert.rejects(
          createWorker(representative, contractorId, workerInput),
          publicError('CONFLICT'),
        );
        assert.equal(await dataSource.getRepository(WorkerEntity).countBy({ siteId }), 1);
      },
    );
    await t.test('missing name is rejected without creating a Worker', async () => {
      await assert.rejects(
        createWorker(representative, contractorId, {
          ...workerInput,
          externalId: randomUUID(),
          displayName: ' ',
        }),
        publicError('VALIDATION_FAILED'),
      );
      assert.equal(await dataSource.getRepository(WorkerEntity).countBy({ siteId }), 1);
    });
    await t.test('same-Site role does not grant access to another Contractor', async () => {
      await assert.rejects(
        createWorker(outsider, contractorId, workerInput),
        publicError('FORBIDDEN'),
      );
      await assert.rejects(
        createWorker(representative, otherContractorId, workerInput),
        publicError('FORBIDDEN'),
      );
    });
    await t.test('a Contractor grant does not grant access to another Site', async () => {
      await assert.rejects(
        createWorker(representative, contractorId, {
          ...workerInput,
          siteId: otherSiteId,
        }),
        publicError('FORBIDDEN'),
      );
    });
    await t.test('inactive Contractor and expired participation prevent onboarding', async () => {
      await dataSource.getRepository(ContractorEntity).update(contractorId, { isActive: false });
      try {
        await assert.rejects(
          createWorker(representative, contractorId, workerInput),
          publicError('FORBIDDEN'),
        );
      } finally {
        await dataSource.getRepository(ContractorEntity).update(contractorId, { isActive: true });
      }
      await dataSource
        .getRepository(ContractorSiteParticipationEntity)
        .update(participationId, { validUntil: new Date(Date.now() - 60_000) });
      try {
        await assert.rejects(
          createWorker(representative, contractorId, workerInput),
          publicError('FORBIDDEN'),
        );
      } finally {
        await dataSource
          .getRepository(ContractorSiteParticipationEntity)
          .update(participationId, { validUntil: parentUntil });
      }
    });

    const accountInput = {
      siteId,
      externalId: `ACC-${randomUUID()}`,
      displayName: 'Synthetic MF01 account Worker',
      username: `worker-${randomUUID().slice(0, 8)}`,
      temporaryPassword: 'SyntheticWorker123!',
    };
    await t.test(
      'creates a Worker account with automatic code and default password, allowing immediate sign-in and optional password change',
      async () => {
        const input = {
          siteId,
          displayName: 'Synthetic automatic Worker',
          username: `auto-${randomUUID().slice(0, 8)}`,
        };
        const result = await accounts.create(
          representative,
          contractorId,
          input,
          actorContext(representative),
        );
        createdAccountIds.push(result.account.id);
        assert.match(result.worker.externalId, /^W[0-9]{6,}$/);
        const stored = await dataSource
          .getRepository(WorkerEntity)
          .findOneByOrFail({ id: result.worker.id });
        assert.equal(stored.externalId, result.worker.externalId);
        assert.equal(stored.contractorId, contractorId);
        const account = await dataSource
          .getRepository(UserEntity)
          .findOneByOrFail({ id: result.account.id });
        assert.equal(await verifyPassword('12345678', account.passwordHash), true);
        assert.notEqual(account.passwordHash, '12345678');
        assert.equal(result.account.mustChangePassword, false);
        assert.equal('temporaryPassword' in result.account, false);
        const auth = new AuthService(
          dataSource,
          new AuthTokenService(new JwtService(), createTestConfig()),
        );
        const login = await auth.login(input.username, '12345678', AuthClientType.MOBILE);
        assert.equal(login.user.mustChangePassword, false);
        await assert.rejects(
          auth.changePassword(login.user.id, '12345678', '12345678'),
          publicError('VALIDATION_FAILED'),
        );
        await auth.changePassword(login.user.id, '12345678', 'PermanentDefaultWorker123!');
        await assert.rejects(auth.authenticate(login.accessToken));
        await assert.rejects(auth.login(input.username, '12345678', AuthClientType.MOBILE));
        assert.equal(
          (await auth.login(input.username, 'PermanentDefaultWorker123!', AuthClientType.MOBILE))
            .user.mustChangePassword,
          false,
        );
        for (const externalId of ['', ' ', null, 123])
          await assert.rejects(
            accounts.create(
              representative,
              contractorId,
              { ...input, externalId } as never,
              actorContext(representative),
            ),
            publicError('VALIDATION_FAILED'),
          );
        await assert.rejects(
          accounts.create(representative, contractorId, input, actorContext(representative)),
          publicError('CONFLICT'),
        );
        assert.equal(
          await dataSource.getRepository(UserEntity).countBy({ username: input.username }),
          1,
        );
        assert.equal(
          await dataSource.getRepository(WorkerEntity).countBy({ userId: result.account.id }),
          1,
        );
        const unchanged = await dataSource
          .getRepository(UserEntity)
          .findOneByOrFail({ id: result.account.id });
        assert.equal(
          await verifyPassword('PermanentDefaultWorker123!', unchanged.passwordHash),
          true,
        );
        assert.equal(unchanged.mustChangePassword, false);
      },
    );
    await t.test('concurrent automatic Worker codes are unique and skip legacy codes', async () => {
      const [next] = await dataSource.query<{ number: string }[]>(
        'SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END::text AS number FROM worker_code_seq',
      );
      const reserved = `W${next!.number.padStart(6, '0')}`;
      await createWorker(representative, contractorId, {
        siteId,
        externalId: reserved,
        displayName: 'Synthetic legacy code',
      });
      const inputs = Array.from({ length: 6 }, () => ({
        siteId,
        displayName: 'Synthetic concurrent auto Worker',
        username: `auto-${randomUUID().slice(0, 12)}`,
        temporaryPassword: accountInput.temporaryPassword,
      }));
      const outcomes = await Promise.allSettled(
        inputs.map((input) =>
          accounts.create(representative, contractorId, input, actorContext(representative)),
        ),
      );
      const codes: string[] = [];
      for (const outcome of outcomes) {
        if (outcome.status === 'fulfilled') {
          createdAccountIds.push(outcome.value.account.id);
          codes.push(outcome.value.worker.externalId);
        }
      }
      assert.equal(outcomes.filter((o) => o.status === 'rejected').length, 0);
      assert.equal(new Set(codes).size, inputs.length);
      assert.ok(codes.every((code) => /^W[0-9]{6,}$/.test(code) && code !== reserved));
    });
    await t.test(
      'onboarding options contain only active Contractors granted to the representative at this Site',
      async () => {
        assert.deepEqual(
          (await accounts.options(representative, siteId)).contractors.map((c) => c.id),
          [contractorId],
        );
        assert.deepEqual(await accounts.options(outsider, siteId), { contractors: [] });
        await assert.rejects(
          accounts.options(representative, otherSiteId),
          publicError('FORBIDDEN'),
        );
      },
    );
    await t.test(
      'representative creates a linked login account with only the Worker Site role and a hashed temporary password',
      async () => {
        const result = await accounts.create(
          representative,
          contractorId,
          accountInput,
          actorContext(representative),
        );
        createdAccountIds.push(result.account.id);
        assert.equal(result.worker.userId, result.account.id);
        assert.equal(result.worker.contractorId, contractorId);
        assert.equal(result.worker.siteId, siteId);
        assert.deepEqual(result.account.roleAssignments, [{ role: UserRole.WORKER, siteId }]);
        assert.equal(result.account.mustChangePassword, false);
        assert.equal('passwordHash' in result.account, false);
        assert.equal('temporaryPassword' in result.account, false);
        const stored = await dataSource
          .getRepository(UserEntity)
          .findOneByOrFail({ id: result.account.id });
        assert.notEqual(stored.passwordHash, accountInput.temporaryPassword);
        assert.equal(
          await verifyPassword(accountInput.temporaryPassword, stored.passwordHash),
          true,
        );
        const audit = await dataSource
          .getRepository(AccessAuditEntity)
          .findOneByOrFail({ entityId: result.worker.id, action: 'WORKER_ACCOUNT_CREATED' });
        assert.equal(audit.actorAccountId, representativeId);
        assert.deepEqual(audit.changes, { contractorId, userId: result.account.id });
      },
    );
    await t.test(
      'Worker can sign in and optionally change the password while keeping its linked identity',
      async () => {
        const auth = new AuthService(
          dataSource,
          new AuthTokenService(new JwtService(), createTestConfig()),
        );
        const login = await auth.login(
          accountInput.username,
          accountInput.temporaryPassword,
          AuthClientType.MOBILE,
        );
        assert.equal(login.user.mustChangePassword, false);
        const linkedWorker = await dataSource
          .getRepository(WorkerEntity)
          .findOneByOrFail({ userId: login.user.id, siteId });
        assert.equal(linkedWorker.contractorId, contractorId);
        await auth.changePassword(
          login.user.id,
          accountInput.temporaryPassword,
          'PermanentWorker123!',
        );
        await assert.rejects(auth.authenticate(login.accessToken));
        const next = await auth.login(
          accountInput.username,
          'PermanentWorker123!',
          AuthClientType.MOBILE,
        );
        assert.equal(next.user.mustChangePassword, false);
        assert.deepEqual(next.user.roleAssignments, [{ role: UserRole.WORKER, siteId }]);
      },
    );
    await t.test(
      'Worker, wrong-Site representative, missing Contractor grant and temporary-password representative cannot provision accounts',
      async () => {
        for (const actor of [outsider, workerActor, otherSiteRepresentative])
          await assert.rejects(
            accounts.create(actor, contractorId, accountInput, actorContext(actor)),
            publicError('FORBIDDEN'),
          );
        await dataSource
          .getRepository(UserEntity)
          .update(representativeId, { mustChangePassword: true });
        try {
          await assert.rejects(
            accounts.create(
              { ...representative, mustChangePassword: true },
              contractorId,
              accountInput,
              actorContext(representative),
            ),
            publicError('PASSWORD_CHANGE_REQUIRED'),
          );
        } finally {
          await dataSource
            .getRepository(UserEntity)
            .update(representativeId, { mustChangePassword: false });
        }
        await assert.rejects(
          accounts.create(
            representative,
            otherContractorId,
            accountInput,
            actorContext(representative),
          ),
          publicError('FORBIDDEN'),
        );
        await assert.rejects(
          accounts.create(
            representative,
            contractorId,
            { ...accountInput, siteId: otherSiteId },
            actorContext(representative),
          ),
          publicError('FORBIDDEN'),
        );
      },
    );
    await t.test(
      'explicit default Worker password is supported without relaxing general account or permanent password policies',
      async () => {
        const input = {
          ...accountInput,
          username: `default-${randomUUID().slice(0, 8)}`,
          externalId: randomUUID(),
          temporaryPassword: '12345678',
        };
        const result = await accounts.create(
          representative,
          contractorId,
          input,
          actorContext(representative),
        );
        createdAccountIds.push(result.account.id);
        const account = await dataSource
          .getRepository(UserEntity)
          .findOneByOrFail({ id: result.account.id });
        assert.equal(await verifyPassword('12345678', account.passwordHash), true);
        assert.equal(result.account.mustChangePassword, false);
        await assert.rejects(
          users.create({
            username: `admin-${randomUUID().slice(0, 8)}`,
            displayName: 'Synthetic admin',
            temporaryPassword: '12345678',
            roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
          }),
          publicError('VALIDATION_FAILED'),
        );
        await assert.rejects(
          users.resetPassword(result.account.id, { temporaryPassword: '12345678' }),
          publicError('VALIDATION_FAILED'),
        );
      },
    );
    await t.test(
      'caller-supplied roles and other weak or malformed passwords are rejected',
      async () => {
        await assert.rejects(
          accounts.create(
            representative,
            contractorId,
            Object.assign({}, accountInput, { roleAssignments: [{ role: 'ADMIN', siteId: null }] }),
            actorContext(representative),
          ),
          publicError('VALIDATION_FAILED'),
        );
        for (const temporaryPassword of ['weak', '87654321', '', null, 12345678])
          await assert.rejects(
            accounts.create(
              representative,
              contractorId,
              {
                ...accountInput,
                temporaryPassword,
              } as never,
              actorContext(representative),
            ),
            publicError('VALIDATION_FAILED'),
          );
      },
    );
    await t.test(
      'duplicate Worker code rolls back its new account and role; retry never resets an existing password',
      async () => {
        const duplicateUsername = `duplicate-${randomUUID().slice(0, 8)}`;
        await assert.rejects(
          accounts.create(
            representative,
            contractorId,
            {
              ...accountInput,
              username: duplicateUsername,
            },
            actorContext(representative),
          ),
          publicError('CONFLICT'),
        );
        assert.equal(
          await dataSource.getRepository(UserEntity).countBy({ username: duplicateUsername }),
          0,
        );
        await assert.rejects(
          accounts.create(
            representative,
            contractorId,
            {
              ...accountInput,
              externalId: randomUUID(),
            },
            actorContext(representative),
          ),
          publicError('CONFLICT'),
        );
        const stored = await dataSource
          .getRepository(UserEntity)
          .findOneByOrFail({ username: accountInput.username });
        assert.equal(await verifyPassword('PermanentWorker123!', stored.passwordHash), true);
        assert.equal(
          await dataSource
            .getRepository(WorkerEntity)
            .countBy({ siteId, externalId: accountInput.externalId }),
          1,
        );
      },
    );
    await t.test(
      'concurrent creation creates one account, one role and one linked Worker',
      async () => {
        const input = {
          ...accountInput,
          username: `race-${randomUUID().slice(0, 8)}`,
          externalId: randomUUID(),
        };
        const outcomes = await Promise.allSettled([
          accounts.create(representative, contractorId, input, actorContext(representative)),
          accounts.create(representative, contractorId, input, actorContext(representative)),
        ]);
        const success = outcomes.filter((o) => o.status === 'fulfilled');
        assert.equal(success.length, 1);
        if (success[0]?.status === 'fulfilled') {
          const id = success[0].value.account.id;
          createdAccountIds.push(id);
          assert.equal(
            await dataSource.getRepository(UserRoleAssignmentEntity).countBy({ userId: id }),
            1,
          );
        }
        const failure = outcomes.find((o) => o.status === 'rejected');
        assert.ok(failure?.status === 'rejected' && publicError('CONFLICT')(failure.reason));
        assert.equal(
          await dataSource.getRepository(UserEntity).countBy({ username: input.username }),
          1,
        );
        assert.equal(
          await dataSource
            .getRepository(WorkerEntity)
            .countBy({ siteId, externalId: input.externalId }),
          1,
        );
      },
    );
    await t.test(
      'inactive Contractor and expired participation prevent account creation and disappear from options',
      async () => {
        const input = {
          ...accountInput,
          username: `inactive-${randomUUID().slice(0, 8)}`,
          externalId: randomUUID(),
        };
        await dataSource.getRepository(ContractorEntity).update(contractorId, { isActive: false });
        try {
          await assert.rejects(
            accounts.create(representative, contractorId, input, actorContext(representative)),
            publicError('FORBIDDEN'),
          );
          assert.deepEqual(await accounts.options(representative, siteId), { contractors: [] });
        } finally {
          await dataSource.getRepository(ContractorEntity).update(contractorId, { isActive: true });
        }
        await dataSource
          .getRepository(ContractorSiteParticipationEntity)
          .update(participationId, { validUntil: new Date(Date.now() - 60_000) });
        try {
          await assert.rejects(
            accounts.create(representative, contractorId, input, actorContext(representative)),
            publicError('FORBIDDEN'),
          );
          assert.deepEqual(await accounts.options(representative, siteId), { contractors: [] });
        } finally {
          await dataSource
            .getRepository(ContractorSiteParticipationEntity)
            .update(participationId, { validUntil: parentUntil });
        }
        assert.equal(
          await dataSource.getRepository(UserEntity).countBy({ username: input.username }),
          0,
        );
      },
    );
    await t.test(
      'revocation during password preparation is rechecked before account writes',
      async () => {
        const input = {
          ...accountInput,
          username: `revoked-${randomUUID().slice(0, 8)}`,
          externalId: randomUUID(),
        };
        const grant = await dataSource
          .getRepository(ContractorRepresentativeGrantEntity)
          .findOneByOrFail({ userId: representativeId, contractorId });
        const prepare = users.prepareWorkerAccount.bind(users);
        users.prepareWorkerAccount = async (value) => {
          const prepared = await prepare(value);
          await dataSource.getRepository(ContractorRepresentativeGrantEntity).delete(grant.id);
          return prepared;
        };
        try {
          await assert.rejects(
            accounts.create(representative, contractorId, input, actorContext(representative)),
            publicError('FORBIDDEN'),
          );
          assert.equal(
            await dataSource.getRepository(UserEntity).countBy({ username: input.username }),
            0,
          );
        } finally {
          users.prepareWorkerAccount = prepare;
          await dataSource.getRepository(ContractorRepresentativeGrantEntity).save(grant);
        }
      },
    );

    const request = {
      siteId,
      zoneIds: [zoneId],
      validFrom: from.toISOString(),
      validUntil: until.toISOString(),
    };
    await t.test('assignment requires an expiry and an increasing interval', async () => {
      await assert.rejects(
        requestAssignment(representative, worker.id, { ...request, validUntil: null }),
        /expiry/,
      );
      await assert.rejects(
        requestAssignment(representative, worker.id, {
          ...request,
          validUntil: request.validFrom,
        }),
        publicError('VALIDATION_FAILED'),
      );
    });
    await t.test(
      'assignment rejects another Site Zone, duplicate Zones and out-of-participation dates',
      async () => {
        await assert.rejects(
          requestAssignment(representative, worker.id, {
            ...request,
            zoneIds: [otherZoneId],
          }),
          publicError('FORBIDDEN'),
        );
        await assert.rejects(
          requestAssignment(representative, worker.id, {
            ...request,
            zoneIds: [zoneId, zoneId],
          }),
          /unique/,
        );
        await assert.rejects(
          requestAssignment(representative, worker.id, {
            ...request,
            validUntil: new Date(+parentUntil + 60_000).toISOString(),
          }),
          /participation interval/,
        );
      },
    );
    await t.test(
      'suspended Worker and unauthorized representative cannot request assignments',
      async () => {
        await assert.rejects(
          requestAssignment(outsider, worker.id, request),
          publicError('FORBIDDEN'),
        );
        await dataSource.getRepository(WorkerEntity).update(worker.id, { isActive: false });
        try {
          await assert.rejects(
            requestAssignment(representative, worker.id, request),
            publicError('FORBIDDEN'),
          );
        } finally {
          await dataSource.getRepository(WorkerEntity).update(worker.id, { isActive: true });
        }
        assert.equal(
          await dataSource
            .getRepository(WorkerSiteZoneAssignmentEntity)
            .countBy({ workerId: worker.id }),
          0,
        );
      },
    );
    const assignment = await requestAssignment(representative, worker.id, request);
    await t.test(
      'valid assignment stays pending and records the requester and audit history',
      async () => {
        assert.equal(assignment.status, WorkerSiteZoneAssignmentStatus.PENDING);
        assert.equal(assignment.requestedByUserId, representativeId);
        assert.equal(assignment.siteContractorId, participationId);
        assert.deepEqual(assignment.zoneIds, [zoneId]);
        const audit = await dataSource
          .getRepository(AccessAuditEntity)
          .findOneByOrFail({ entityId: assignment.id, action: 'WORKER_ASSIGNMENT_REQUESTED' });
        assert.equal(audit.actorAccountId, representativeId);
        assert.equal(audit.siteId, siteId);
      },
    );

    const session = await enrollment.start(representative, worker.id, {
      consentVersion: 'synthetic-v1',
    });
    await t.test(
      'capture and quality checks require Worker consent; invalid tokens cannot confirm it',
      async () => {
        await assert.rejects(
          enrollment.submitSample(representative, session.id, sample),
          /confirm consent/,
        );
        await assert.rejects(
          enrollment.assessSampleQuality(representative, worker.id, sample, 'front'),
          /consent/,
        );
        await assert.rejects(
          enrollment.confirmConsent(session.id, {
            consentToken: 'f'.repeat(64),
            workerConfirmed: true,
          }),
          publicError('NOT_FOUND'),
        );
        await assert.rejects(
          enrollment.confirmConsent(session.id, {
            consentToken: session.consentToken,
            workerConfirmed: false as true,
          }),
          publicError('VALIDATION_FAILED'),
        );
        assert.equal(sampleCalls, 0);
        assert.equal(
          (
            await dataSource
              .getRepository(FaceEnrollmentSessionEntity)
              .findOneByOrFail({ id: session.id })
          ).consentedAt,
          null,
        );
      },
    );
    await enrollment.confirmConsent(session.id, {
      consentToken: session.consentToken,
      workerConfirmed: true,
    });
    await t.test('quality failure never activates a face profile', async () => {
      qualityFails = true;
      try {
        assert.deepEqual(
          await enrollment.assessSampleQuality(representative, worker.id, sample, 'front'),
          { status: 'QUALITY_FAILED', reasonCode: 'FACE_BLURRY' },
        );
        assert.equal(
          await dataSource.getRepository(FaceProfileEntity).countBy({ workerId: worker.id }),
          0,
        );
      } finally {
        qualityFails = false;
      }
    });
    await t.test(
      'another actor cannot submit into the enrolling representative session',
      async () => {
        await assert.rejects(
          enrollment.submitSample(outsider, session.id, sample),
          publicError('FORBIDDEN'),
        );
        assert.equal(sampleCalls, 0);
      },
    );
    await t.test('fewer than three samples cannot complete enrollment', async () => {
      await enrollment.submitSample(representative, session.id, sample);
      await assert.rejects(
        enrollment.complete(representative, session.id),
        /three accepted samples/,
      );
      assert.equal(
        await dataSource.getRepository(FaceProfileEntity).countBy({ workerId: worker.id }),
        0,
      );
    });
    await enrollment.submitSample(representative, session.id, sample);
    await enrollment.submitSample(representative, session.id, sample);
    const profile = await enrollment.complete(representative, session.id);
    await t.test(
      'successful enrollment stores consent, creator and completed status without exposing ciphertext',
      async () => {
        assert.equal(profile.status, 'ACTIVE');
        assert.equal(profile.createdByUserId, representativeId);
        assert.equal(profile.consentMethod, 'SUPERVISED_WORKER_CONFIRMATION');
        const stored = await dataSource
          .getRepository(FaceEnrollmentSessionEntity)
          .findOneByOrFail({ id: session.id });
        assert.equal(stored.status, FaceEnrollmentSessionStatus.COMPLETED);
        assert.equal(stored.acceptedSampleCount, 3);
        assert.equal(
          (await enrollment.getProfile(representative, worker.id)).encryptedTemplate,
          undefined,
        );
      },
    );
    await t.test(
      'failed re-enrollment marks the new session failed and preserves the earlier profile',
      async () => {
        const retry = await enrollment.start(representative, worker.id, {
          consentVersion: 'synthetic-v2',
        });
        await enrollment.confirmConsent(retry.id, {
          consentToken: retry.consentToken,
          workerConfirmed: true,
        });
        for (let i = 0; i < 3; i++) await enrollment.submitSample(representative, retry.id, sample);
        completionFails = true;
        try {
          await assert.rejects(
            enrollment.complete(representative, retry.id),
            /Synthetic enrollment model failure/,
          );
          assert.equal(
            (
              await dataSource
                .getRepository(FaceEnrollmentSessionEntity)
                .findOneByOrFail({ id: retry.id })
            ).status,
            FaceEnrollmentSessionStatus.FAILED,
          );
          assert.equal((await enrollment.getProfile(representative, worker.id)).id, profile.id);
        } finally {
          completionFails = false;
        }
      },
    );
    await t.test(
      'the linked Worker can start their own enrollment and expired consent cannot be used',
      async () => {
        await dataSource.getRepository(WorkerEntity).update(worker.id, { userId: workerAccountId });
        const ownSession = await enrollment.start(workerActor, worker.id, {
          consentVersion: 'synthetic-v3',
        });
        await dataSource
          .getRepository(FaceEnrollmentSessionEntity)
          .update(ownSession.id, { expiresAt: new Date(Date.now() - 60_000) });
        await assert.rejects(
          enrollment.confirmConsent(ownSession.id, {
            consentToken: ownSession.consentToken,
            workerConfirmed: true,
          }),
          /unavailable/,
        );
        await enrollment.cancel(workerActor, ownSession.id);
      },
    );

    const evaluate = async (gate = 'gate1', scope = siteId) =>
      dataSource.transaction(async (manager) => {
        const current = await manager
          .getRepository(WorkerEntity)
          .findOneByOrFail({ id: worker.id });
        return evaluateWorkerAccess(manager, current, scope, gate, 'IN');
      });
    await t.test(
      'pending assignment cannot grant entry even after successful face enrollment',
      async () => {
        assert.equal((await evaluate()).decision.authorization, 'DENIED');
      },
    );
    await dataSource
      .getRepository(WorkerSiteZoneAssignmentEntity)
      .update(assignment.id, { status: WorkerSiteZoneAssignmentStatus.APPROVED });
    await dataSource.getRepository(WorkerGatePermissionEntity).save({
      id: randomUUID(),
      workerId: worker.id,
      siteId,
      gateId: 'gate1',
      workerAssignmentId: assignment.id,
      validFrom: from,
      validUntil: until,
      createdByUserId: representativeId,
    });
    await t.test(
      'approved assignment and gate grant still require a current Worker schedule',
      async () => {
        assert.equal((await evaluate()).decision.reasonCode, 'NO_SCHEDULE');
      },
    );
    await assignTestShift(dataSource, siteId, worker.id);
    await t.test(
      'current approved assignment and gate grant permit entry; other gates and Sites do not',
      async () => {
        assert.equal((await evaluate()).decision.authorization, 'ALLOWED');
        assert.equal((await evaluate('gate2')).decision.reasonCode, 'GATE_MISMATCH');
        assert.equal((await evaluate('gate1', otherSiteId)).decision.reasonCode, 'SITE_MISMATCH');
      },
    );
    await t.test('Worker suspension and Contractor suspension immediately deny entry', async () => {
      const profile = {
        externalId: worker.externalId,
        displayName: worker.displayName,
        isActive: true,
      };
      await accounts.update(
        representative,
        siteId,
        contractorId,
        worker.id,
        {
          ...profile,
          isActive: false,
          expectedSnapshot: profile,
        },
        actorContext(representative),
      );
      try {
        assert.equal((await evaluate()).decision.reasonCode, 'WORKER_INACTIVE');
        assert.equal(
          await dataSource
            .getRepository(WorkerSiteZoneAssignmentEntity)
            .countBy({ id: assignment.id }),
          1,
        );
      } finally {
        await accounts.update(
          representative,
          siteId,
          contractorId,
          worker.id,
          {
            ...profile,
            expectedSnapshot: { ...profile, isActive: false },
          },
          actorContext(representative),
        );
      }
      assert.equal((await evaluate()).decision.authorization, 'ALLOWED');
      await dataSource.getRepository(ContractorEntity).update(contractorId, { isActive: false });
      try {
        assert.equal((await evaluate()).decision.reasonCode, 'CONTRACTOR_INACTIVE');
      } finally {
        await dataSource.getRepository(ContractorEntity).update(contractorId, { isActive: true });
      }
    });
    await t.test(
      'expired participation denies entry while preserving Worker and assignment history',
      async () => {
        await dataSource
          .getRepository(ContractorSiteParticipationEntity)
          .update(participationId, { validUntil: new Date(Date.now() - 60_000) });
        try {
          assert.equal(
            (await evaluate()).decision.reasonCode,
            'CONTRACTOR_SITE_PARTICIPATION_INVALID',
          );
          assert.equal(await dataSource.getRepository(WorkerEntity).countBy({ id: worker.id }), 1);
          assert.equal(
            await dataSource
              .getRepository(WorkerSiteZoneAssignmentEntity)
              .countBy({ id: assignment.id }),
            1,
          );
        } finally {
          await dataSource
            .getRepository(ContractorSiteParticipationEntity)
            .update(participationId, { validUntil: parentUntil });
        }
      },
    );
    await t.test('expired and revoked assignments deny entry', async () => {
      await dataSource
        .getRepository(WorkerSiteZoneAssignmentEntity)
        .update(assignment.id, { validUntil: new Date(Date.now() - 60_000) });
      try {
        assert.equal((await evaluate()).decision.authorization, 'DENIED');
      } finally {
        await dataSource
          .getRepository(WorkerSiteZoneAssignmentEntity)
          .update(assignment.id, { validUntil: until });
      }
      await dataSource
        .getRepository(WorkerSiteZoneAssignmentEntity)
        .update(assignment.id, { status: WorkerSiteZoneAssignmentStatus.REVOKED });
      assert.equal((await evaluate()).decision.authorization, 'DENIED');
    });

    await t.test('Contractor Representative manages only its own worker profiles', async (mt) => {
      const managed = await createWorker(representative, contractorId, {
        siteId,
        externalId: randomUUID(),
        displayName: 'Synthetic managed worker',
      });
      const snapshot = {
        externalId: managed.externalId,
        displayName: managed.displayName,
        isActive: true,
      };
      const updateInput = {
        ...snapshot,
        displayName: 'Synthetic corrected worker',
        expectedSnapshot: snapshot,
      };
      const foreignWorker = await dataSource.getRepository(WorkerEntity).save({
        id: randomUUID(),
        siteId,
        contractorId: otherContractorId,
        externalId: randomUUID(),
        displayName: 'Synthetic other contractor worker',
        isActive: true,
      });
      await mt.test('roster includes own workers and excludes other contractors', async () => {
        const workforce = new WorkforceConfigurationService(dataSource);
        const result = await workforce.list(
          {
            ...representative,
            username: representativeId,
            displayName: 'Synthetic representative',
            isActive: true,
          },
          siteId,
          0,
          100,
        );
        assert.ok(result.items.some((w) => w.id === managed.id));
        assert.ok(result.items.every((w) => w.contractorId === contractorId));
      });
      await mt.test(
        'denies wrong roles, missing grants, other Sites and other contractors',
        async () => {
          for (const actor of [outsider, workerActor, otherSiteRepresentative])
            await assert.rejects(
              accounts.update(
                actor,
                siteId,
                contractorId,
                managed.id,
                updateInput,
                actorContext(actor),
              ),
              publicError('FORBIDDEN'),
            );
          const representativeRole = await dataSource
            .getRepository(UserRoleAssignmentEntity)
            .findOneByOrFail({ userId: representativeId, siteId });
          await dataSource.getRepository(UserRoleAssignmentEntity).delete(representativeRole.id);
          try {
            await assert.rejects(
              accounts.update(
                { ...representative, roleAssignments: [] },
                siteId,
                contractorId,
                managed.id,
                updateInput,
                actorContext(representative),
              ),
              publicError('FORBIDDEN'),
            );
          } finally {
            await dataSource.getRepository(UserRoleAssignmentEntity).save(representativeRole);
          }
          await dataSource
            .getRepository(UserEntity)
            .update(representativeId, { mustChangePassword: true });
          try {
            await assert.rejects(
              accounts.update(
                { ...representative, mustChangePassword: true },
                siteId,
                contractorId,
                managed.id,
                updateInput,
                actorContext(representative),
              ),
              publicError('PASSWORD_CHANGE_REQUIRED'),
            );
          } finally {
            await dataSource
              .getRepository(UserEntity)
              .update(representativeId, { mustChangePassword: false });
          }
          await assert.rejects(
            accounts.update(
              representative,
              otherSiteId,
              contractorId,
              managed.id,
              updateInput,
              actorContext(representative),
            ),
            publicError('FORBIDDEN'),
          );
          await assert.rejects(
            accounts.update(
              representative,
              siteId,
              otherContractorId,
              foreignWorker.id,
              updateInput,
              actorContext(representative),
            ),
            publicError('FORBIDDEN'),
          );
          await assert.rejects(
            accounts.update(
              representative,
              siteId,
              contractorId,
              foreignWorker.id,
              updateInput,
              actorContext(representative),
            ),
            publicError('NOT_FOUND'),
          );
        },
      );
      await mt.test('rejects invalid and security-sensitive input', async () => {
        for (const extra of [
          { userId: workerAccountId },
          { contractorId: otherContractorId },
          { roleAssignments: [{ role: UserRole.ADMIN, siteId: null }] },
          { displayName: ' ' },
          { isActive: 'false' },
          { expectedSnapshot: undefined },
          { expectedSnapshot: { ...snapshot, userId: workerAccountId } },
        ])
          await assert.rejects(
            accounts.update(
              representative,
              siteId,
              contractorId,
              managed.id,
              {
                ...updateInput,
                ...extra,
              } as never,
              actorContext(representative),
            ),
            publicError('VALIDATION_FAILED'),
          );
      });
      await mt.test(
        'any authorized Representative of the same contractor can edit; audit records that actor',
        async () => {
          const grant = await dataSource.getRepository(ContractorRepresentativeGrantEntity).save({
            id: randomUUID(),
            userId: outsiderId,
            contractorId,
          });
          try {
            const beforeSite = await dataSource
              .getRepository(SiteEntity)
              .findOneByOrFail({ id: siteId });
            const result = await accounts.update(
              outsider,
              siteId,
              contractorId,
              managed.id,
              updateInput,
              actorContext(outsider),
            );
            assert.equal(result.displayName, updateInput.displayName);
            assert.equal(result.contractorId, contractorId);
            const audit = await dataSource.getRepository(AccessAuditEntity).findOneByOrFail({
              entityId: managed.id,
              action: 'WORKER_PROFILE_UPDATED',
            });
            assert.equal(audit.actorAccountId, outsiderId);
            assert.ok(audit.changes);
            assert.deepEqual(audit.changes.before, snapshot);
            assert.equal(
              (audit.changes.after as typeof snapshot).displayName,
              updateInput.displayName,
            );
            const afterSite = await dataSource
              .getRepository(SiteEntity)
              .findOneByOrFail({ id: siteId });
            assert.equal(afterSite.accessPolicyVersion, beforeSite.accessPolicyVersion + 1);
            await accounts.update(
              outsider,
              siteId,
              contractorId,
              managed.id,
              updateInput,
              actorContext(outsider),
            );
            assert.equal(
              await dataSource.getRepository(AccessAuditEntity).countBy({
                entityId: managed.id,
                action: 'WORKER_PROFILE_UPDATED',
              }),
              1,
            );
          } finally {
            await dataSource.getRepository(ContractorRepresentativeGrantEntity).delete(grant.id);
          }
        },
      );
      await mt.test(
        'rejects stale changes and duplicate codes without partial updates',
        async () => {
          await assert.rejects(
            accounts.update(
              representative,
              siteId,
              contractorId,
              managed.id,
              {
                ...updateInput,
                isActive: false,
              },
              actorContext(representative),
            ),
            publicError('CONFLICT'),
          );
          await assert.rejects(
            accounts.update(
              representative,
              siteId,
              contractorId,
              managed.id,
              {
                ...updateInput,
                externalId: worker.externalId,
                isActive: false,
                expectedSnapshot: { ...snapshot, displayName: updateInput.displayName },
              },
              actorContext(representative),
            ),
            publicError('CONFLICT'),
          );
          const stored = await dataSource
            .getRepository(WorkerEntity)
            .findOneByOrFail({ id: managed.id });
          assert.equal(stored.externalId, snapshot.externalId);
          assert.equal(stored.isActive, true);
        },
      );
      await mt.test(
        'denies writes when contractor or participation is no longer active',
        async () => {
          await dataSource
            .getRepository(ContractorEntity)
            .update(contractorId, { isActive: false });
          try {
            await assert.rejects(
              accounts.update(
                representative,
                siteId,
                contractorId,
                managed.id,
                updateInput,
                actorContext(representative),
              ),
              publicError('FORBIDDEN'),
            );
          } finally {
            await dataSource
              .getRepository(ContractorEntity)
              .update(contractorId, { isActive: true });
          }
          await dataSource
            .getRepository(ContractorSiteParticipationEntity)
            .update(participationId, {
              validUntil: new Date(Date.now() - 60_000),
            });
          try {
            await assert.rejects(
              accounts.update(
                representative,
                siteId,
                contractorId,
                managed.id,
                updateInput,
                actorContext(representative),
              ),
              publicError('FORBIDDEN'),
            );
          } finally {
            await dataSource
              .getRepository(ContractorSiteParticipationEntity)
              .update(participationId, {
                validUntil: parentUntil,
              });
          }
        },
      );
      await mt.test('two concurrent edits cannot overwrite one another', async () => {
        const expectedSnapshot = { ...snapshot, displayName: updateInput.displayName };
        const results = await Promise.allSettled(
          ['Synthetic concurrent A', 'Synthetic concurrent B'].map((displayName) =>
            accounts.update(
              representative,
              siteId,
              contractorId,
              managed.id,
              {
                ...expectedSnapshot,
                displayName,
                expectedSnapshot,
              },
              actorContext(representative),
            ),
          ),
        );
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        const rejected = results.find((r) => r.status === 'rejected');
        assert.ok(rejected?.status === 'rejected' && publicError('CONFLICT')(rejected.reason));
        assert.equal(
          await dataSource.getRepository(AccessAuditEntity).countBy({
            entityId: managed.id,
            action: 'WORKER_PROFILE_UPDATED',
          }),
          2,
        );
      });
    });
  } finally {
    await cleanupSiteAccess(dataSource, [siteId, otherSiteId]);
    await dataSource.query('DELETE FROM worker_schedule WHERE site_id = $1', [siteId]);
    await dataSource.query('DELETE FROM shift WHERE site_id = $1', [siteId]);
    await dataSource.query('DELETE FROM schedule_version WHERE site_id = $1', [siteId]);
    await dataSource.query(
      'DELETE FROM face_profile WHERE worker_id IN (SELECT id FROM worker WHERE site_id = $1)',
      [siteId],
    );
    await dataSource.query(
      'DELETE FROM face_enrollment_session WHERE worker_id IN (SELECT id FROM worker WHERE site_id = $1)',
      [siteId],
    );
    await dataSource.getRepository(WorkerGatePermissionEntity).delete({ siteId });
    await dataSource.getRepository(WorkerSiteZoneAssignmentEntity).delete({ siteId });
    await dataSource.getRepository(WorkerEntity).delete({ siteId });
    await dataSource.getRepository(ContractorRepresentativeGrantEntity).delete({ contractorId });
    await dataSource.getRepository(ContractorSiteParticipationEntity).delete({ siteId });
    await dataSource.getRepository(ZoneEntity).delete({ siteId });
    await dataSource.getRepository(ZoneEntity).delete({ siteId: otherSiteId });
    await dataSource.getRepository(ContractorEntity).delete(contractorId);
    await dataSource.getRepository(ContractorEntity).delete(otherContractorId);
    await dataSource.getRepository(UserRoleAssignmentEntity).delete({ siteId });
    await dataSource.getRepository(UserRoleAssignmentEntity).delete({ siteId: otherSiteId });
    await dataSource.getRepository(SiteEntity).delete(siteId);
    await dataSource.getRepository(SiteEntity).delete(otherSiteId);
    for (const id of [
      ...createdAccountIds,
      representativeId,
      outsiderId,
      otherSiteRepresentativeId,
      workerAccountId,
    ])
      await dataSource.getRepository(UserEntity).delete(id);
    await isolatedDatabase.dispose();
  }
});
