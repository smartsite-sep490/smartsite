import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { after, test } from 'node:test';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { AuthModule } from '../../src/modules/auth/auth.module.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import {
  UserRole,
  UserEntity,
  WorkerEntity,
  SafetyAlertEntity,
  AlertStatus,
  UserRoleAssignmentEntity,
  AuthSessionEntity,
  AuthClientType,
  AiObservationEventEntity,
} from '../../src/database/entities/index.js';
import { ObservationIdentityController } from '../../src/modules/safety/identity/observation-identity.controller.js';
import { ObservationIdentityAccessGuard } from '../../src/modules/safety/identity/observation-identity-access.guard.js';
import { ObservationIdentityContextService } from '../../src/modules/safety/identity/observation-identity-context.service.js';
import { ObservationIdentityResolutionService } from '../../src/modules/safety/identity/observation-identity-resolution.service.js';
import { ZoneAccessManagementService } from '../../src/modules/zones/zone-access-management.service.js';
import { createTestConfig } from '../support/config.js';
import { observationIdentityFixture } from '../support/observation-identity-fixture.js';
import dataSource from '../support/test-data-source.js';

after(async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
});

test('identity HTTP with real sessions and PostgreSQL preserves subject scope, correction audit, expiry replay and revocation', async () => {
  const f = await observationIdentityFixture();
  let app: NestExpressApplication | undefined;
  try {
    const [actorId, adminId] = f.actorIds as [string, string];
    const password = 'SyntheticReview1!';
    const passwordHash = await hashPassword(password);
    await dataSource.getRepository(UserEntity).update(f.actorIds, { passwordHash });
    await dataSource.getRepository(UserRoleAssignmentEntity).insert([
      { id: randomUUID(), userId: actorId, role: UserRole.SAFETY_OFFICER, siteId: f.siteId },
      { id: randomUUID(), userId: adminId, role: UserRole.ADMIN, siteId: null },
    ]);
    const foreignWorkerId = randomUUID();
    f.workerIds.push(foreignWorkerId);
    await dataSource.getRepository(WorkerEntity).insert({
      id: foreignWorkerId,
      siteId: f.otherSiteId,
      externalId: 'FOREIGN-WORKER',
      displayName: 'Synthetic other-Site Worker',
      isActive: true,
    });
    const config = createTestConfig({ LOG_FORMAT: 'json', HTTP_RATE_LIMIT_LIMIT: '1000' });
    const reader = {
      ...f.reader,
      async listForReview(siteId: string, offset: number, limit: number) {
        const [items, total] = await dataSource.getRepository(WorkerEntity).findAndCount({
          where: { siteId },
          order: { externalId: 'ASC', id: 'ASC' },
          skip: offset,
          take: limit,
        });
        return { items, total };
      },
    };
    const service = new ObservationIdentityResolutionService(dataSource, f.evidence, reader);
    const context = new ObservationIdentityContextService(
      service,
      f.evidence,
      new ZoneAccessManagementService(dataSource),
      reader,
    );
    const module = await Test.createTestingModule({
      imports: [AppModule, AuthModule],
      controllers: [ObservationIdentityController],
      providers: [
        ObservationIdentityAccessGuard,
        { provide: ObservationIdentityResolutionService, useValue: service },
        { provide: ObservationIdentityContextService, useValue: context },
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(config)
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useValue(createLoggerParams(config, { write: () => undefined }))
      .overrideProvider(getDataSourceToken())
      .useValue(dataSource)
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bufferLogs: true,
      bodyParser: false,
    });
    await configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const auth = app.get(AuthService);
    const username = await dataSource.getRepository(UserEntity).findOneByOrFail({ id: actorId });
    const admin = await dataSource.getRepository(UserEntity).findOneByOrFail({ id: adminId });
    const actor = await auth.login(username.username, password, AuthClientType.MOBILE);
    const administrator = await auth.login(admin.username, password, AuthClientType.MOBILE);
    const prefix = `${await app.getUrl()}/api/v1/sites/${f.siteId}/safety-alerts/${f.alertIds[0]!}/detections/${f.eventId}/identity-subjects`;
    const headers = {
      Authorization: `Bearer ${actor.accessToken}`,
      'Content-Type': 'application/json',
    };
    const get = (url = prefix) => fetch(url, { headers });
    const post = (input: unknown, index = 0, url = prefix) =>
      fetch(`${url}/${index}/decisions`, { method: 'POST', headers, body: JSON.stringify(input) });
    assert.equal(
      (await fetch(prefix, { headers: { Authorization: `Bearer ${administrator.accessToken}` } }))
        .status,
      403,
    );
    assert.equal((await get(prefix.replace(f.siteId, f.otherSiteId))).status, 403);
    assert.equal((await get(prefix.replace(f.alertIds[0]!, randomUUID()))).status, 404);
    assert.equal((await get(prefix.replace(f.eventId, randomUUID()))).status, 404);
    const initialContext = await get();
    assert.equal(initialContext.status, 200);
    const initial = (await initialContext.json()) as {
      subjects: { revision: number; canResolve: boolean; latestManualDecision: unknown }[];
    };
    assert.deepEqual(
      initial.subjects.map((s) => [s.revision, s.canResolve, s.latestManualDecision]),
      [
        [0, true, null],
        [0, true, null],
      ],
    );
    const workers = await get(`${prefix}/workers?offset=0&limit=1`);
    assert.equal(workers.status, 200);
    const picker = (await workers.json()) as { items: Record<string, unknown>[]; total: number };
    assert.equal(picker.total, 2);
    assert.equal(picker.items.length, 1);
    assert.deepEqual(Object.keys(picker.items[0]!).sort(), [
      'displayName',
      'externalId',
      'id',
      'isActive',
      'siteId',
    ]);
    assert.equal((await post(f.resolve(0, randomUUID()))).status, 404);
    assert.equal((await post(f.resolve(0, foreignWorkerId))).status, 404);
    await dataSource
      .getRepository(WorkerEntity)
      .update({ id: f.workerIds[1]! }, { isActive: false });
    const inactive = await post(f.resolve(0, f.workerIds[1]!));
    assert.equal(inactive.status, 409);
    assert.equal(((await inactive.json()) as { message: string }).message, 'Worker is inactive');
    const command = f.resolve();
    const created = await post(command);
    assert.equal(created.status, 201);
    const recorded = (await created.json()) as {
      recordedDecision: {
        id: string;
        revision: number;
        subjectRef: { personObservationIndex: number };
        workerId: string;
      };
      latestRevision: number;
      replayed: boolean;
    };
    assert.equal(recorded.recordedDecision.id, command.commandId);
    assert.equal(recorded.recordedDecision.subjectRef.personObservationIndex, 0);
    assert.equal(recorded.latestRevision, 1);
    assert.equal(recorded.replayed, false);
    for (const secret of ['commandHash', 'resolutionId', 'rawPayload', 'local://', 'passwordHash'])
      assert.ok(!JSON.stringify(recorded).includes(secret));
    const stale = await post(f.resolve());
    assert.equal(stale.status, 409);
    assert.equal(
      ((await stale.json()) as { message: string }).message,
      'Observation identity revision is stale',
    );
    assert.deepEqual(await (await get(`${prefix}/1/decisions`)).json(), { items: [], total: 0 });
    await unlink(f.filePath);
    const expired = (await (await get()).json()) as {
      subjects: { canResolve: boolean; canClear: boolean }[];
    };
    assert.deepEqual(
      expired.subjects.map((s) => [s.canResolve, s.canClear]),
      [
        [false, true],
        [false, false],
      ],
    );
    const clear = {
      commandId: randomUUID(),
      expectedRevision: 1,
      expectedEventHash: f.hash,
      action: 'CLEAR',
      reason: 'Incorrect synthetic identity withdrawn.',
    };
    assert.equal((await post(clear)).status, 201);
    const retry = await post(command);
    assert.equal(retry.status, 201);
    const replay = (await retry.json()) as typeof recorded;
    assert.equal(replay.replayed, true);
    assert.equal(replay.recordedDecision.revision, 1);
    assert.equal(replay.latestRevision, 2);
    const history = (await (await get(`${prefix}/0/decisions`)).json()) as {
      items: { revision: number; action: string; subjectRef: { personObservationIndex: number } }[];
      total: number;
    };
    assert.equal(history.total, 2);
    assert.deepEqual(
      history.items.map((d) => [d.revision, d.action, d.subjectRef.personObservationIndex]),
      [
        [1, 'RESOLVE', 0],
        [2, 'CLEAR', 0],
      ],
    );
    assert.equal(
      (await dataSource.getRepository(SafetyAlertEntity).findOneByOrFail({ id: f.alertIds[0]! }))
        .status,
      AlertStatus.CLOSED,
    );
    await dataSource.query(
      "UPDATE observation_identity_resolution SET subject_ref=jsonb_set(subject_ref,'{payloadHash}',to_jsonb($1::text)) WHERE event_id=$2 AND person_observation_index=0",
      ['a'.repeat(64), f.eventId],
    );
    await dataSource
      .getRepository(AiObservationEventEntity)
      .update({ eventId: f.eventId }, { rawPayload: { corrupt: true } });
    const corruptResponse = await get();
    assert.equal(corruptResponse.status, 200);
    const corrupt = (await corruptResponse.json()) as {
      subjects: {
        subjectRef: unknown;
        trackId: unknown;
        latestManualDecision: unknown;
        resolveBlockReason: string;
        clearBlockReason: string;
      }[];
    };
    assert.deepEqual(
      corrupt.subjects.map((s) => [
        s.subjectRef,
        s.trackId,
        s.latestManualDecision,
        s.resolveBlockReason,
        s.clearBlockReason,
      ]),
      [[null, null, null, 'STATE_INCONSISTENT', 'STATE_INCONSISTENT']],
    );
    assert.equal((await get(`${prefix}/0/decisions`)).status, 409);
    assert.equal((await post(command)).status, 409);
    await dataSource
      .getRepository(UserRoleAssignmentEntity)
      .update({ userId: actorId, role: UserRole.SAFETY_OFFICER }, { siteId: f.otherSiteId });
    assert.equal((await post(command)).status, 403);
    assert.equal((await get(`${prefix}/0/decisions`)).status, 403);
    await dataSource.getRepository(UserEntity).update({ id: actorId }, { isActive: false });
    assert.equal((await get()).status, 401);
  } finally {
    // Nest owns the injected pool on shutdown; clean synthetic rows before closing it.
    await dataSource
      .getRepository(AuthSessionEntity)
      .delete(f.actorIds.map((userId) => ({ userId })));
    await dataSource
      .getRepository(UserRoleAssignmentEntity)
      .delete(f.actorIds.map((userId) => ({ userId })));
    await f.cleanup();
    if (app) await app.close();
  }
});
