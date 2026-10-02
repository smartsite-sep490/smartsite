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
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import {
  parseObservationIdentityContextResponse,
  parseObservationIdentityDecisionPage,
  parseObservationIdentityMutationResponse,
  parseObservationIdentityWorkerPage,
} from '@smartsite/contracts/management';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { createLoggerParams } from '../../src/observability/logger.js';
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
  AlertDetectionMappingEntity,
} from '../../src/database/entities/index.js';
import { SafetyAlertEvidenceService } from '../../src/modules/safety/alerts/safety-alert-evidence.service.js';
import { createTestConfig } from '../support/config.js';
import { observationIdentityFixture } from '../support/observation-identity-fixture.js';
import dataSource from '../support/test-data-source.js';

after(async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
});

test('identity HTTP with real sessions and PostgreSQL preserves subject scope, correction audit, expiry replay and revocation', async () => {
  const f = await observationIdentityFixture();
  const laterEventId = randomUUID();
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
    // Exercise actual AppModule registration and the existing Workforce service, not a fixture reader.
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SafetyAlertEvidenceService)
      .useValue(f.evidence)
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
    const secondSession = await auth.login(username.username, password, AuthClientType.MOBILE);
    assert.notEqual(secondSession.accessToken, actor.accessToken);
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
    const initial = parseObservationIdentityContextResponse(await initialContext.json());
    assert.ok(initial, 'Real HTTP context must satisfy the browser contract');
    assert.deepEqual(
      initial.subjects.map((s) => [s.revision, s.canResolve, s.latestManualDecision]),
      [
        [0, true, null],
        [0, true, null],
      ],
    );
    const workers = await get(`${prefix}/workers?offset=0&limit=1`);
    assert.equal(workers.status, 200);
    const picker = parseObservationIdentityWorkerPage(await workers.json(), f.siteId);
    assert.ok(picker, 'Real HTTP picker must satisfy the browser contract and Site scope');
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
    // Two authenticated sessions with the same revision must not silently overwrite each other.
    const competingCommands = [f.resolve(), f.resolve()];
    const competingResponses = await Promise.all([
      post(competingCommands[0]),
      fetch(`${prefix}/0/decisions`, {
        method: 'POST',
        headers: {
          ...headers,
          Authorization: `Bearer ${secondSession.accessToken}`,
        },
        body: JSON.stringify(competingCommands[1]),
      }),
    ]);
    assert.deepEqual(competingResponses.map((response) => response.status).sort(), [201, 409]);
    const winner = competingResponses.findIndex((response) => response.status === 201);
    const command = competingCommands[winner]!;
    const created = competingResponses[winner]!;
    const conflictResponse = competingResponses[1 - winner]!;
    const competingConflict = (await conflictResponse.json()) as {
      code: string;
      message: string;
      requestId: string;
    };
    assert.equal(competingConflict.code, 'CONFLICT');
    assert.equal(competingConflict.message, 'Observation identity revision is stale');
    assert.equal(typeof competingConflict.requestId, 'string');
    assert.equal(created.status, 201);
    const recorded = parseObservationIdentityMutationResponse(await created.json());
    assert.ok(recorded, 'Real HTTP command response must satisfy the browser contract');
    assert.equal(recorded.recordedDecision.id, command.commandId);
    assert.equal(recorded.recordedDecision.subjectRef.personObservationIndex, 0);
    assert.equal(recorded.latestRevision, 1);
    assert.equal(recorded.replayed, false);
    const initialHistory = parseObservationIdentityDecisionPage(
      await (await get(`${prefix}/0/decisions`)).json(),
    );
    assert.ok(initialHistory);
    assert.equal(initialHistory.total, 1, 'The losing session must not append an audit decision');
    assert.equal(initialHistory.items[0]!.id, command.commandId);
    for (const secret of ['commandHash', 'resolutionId', 'rawPayload', 'local://', 'passwordHash'])
      assert.ok(!JSON.stringify(recorded).includes(secret));
    const stale = await post(f.resolve());
    assert.equal(stale.status, 409);
    assert.equal(
      ((await stale.json()) as { message: string }).message,
      'Observation identity revision is stale',
    );
    assert.deepEqual(await (await get(`${prefix}/1/decisions`)).json(), { items: [], total: 0 });
    await dataSource
      .getRepository(WorkerEntity)
      .update({ id: f.workerIds[1]! }, { isActive: true });
    const correctedResponse = await post(f.resolve(1, f.workerIds[1]!));
    assert.equal(correctedResponse.status, 201);
    const corrected = parseObservationIdentityMutationResponse(await correctedResponse.json());
    assert.ok(corrected);
    assert.equal(corrected.recordedDecision.workerId, f.workerIds[1]);
    assert.equal(corrected.latestRevision, 2);
    const sharedContext = parseObservationIdentityContextResponse(
      await (await get(prefix.replace(f.alertIds[0]!, f.alertIds[1]!))).json(),
    );
    assert.ok(sharedContext);
    assert.equal(sharedContext.subjects[0]!.latestManualDecision?.workerId, f.workerIds[1]);
    assert.equal(sharedContext.subjects[0]!.revision, 2);
    assert.equal(sharedContext.subjects[1]!.latestManualDecision, null);
    assert.equal(sharedContext.subjects[1]!.revision, 0);
    // The same camera/session/Track IDs in another event are not manual identity proof.
    const laterRaw = { ...f.raw, eventId: laterEventId, evidence: [] };
    const originalEvent = await dataSource
      .getRepository(AiObservationEventEntity)
      .findOneByOrFail({ eventId: f.eventId });
    await dataSource.getRepository(AiObservationEventEntity).insert({
      ...originalEvent,
      eventId: laterEventId,
      rawPayload: laterRaw,
      payloadHash: computeCanonicalPayloadHash(laterRaw),
    });
    await dataSource
      .getRepository(AlertDetectionMappingEntity)
      .insert({ alertId: f.alertIds[0]!, eventId: laterEventId });
    const laterContext = parseObservationIdentityContextResponse(
      await (await get(prefix.replace(f.eventId, laterEventId))).json(),
    );
    assert.ok(laterContext);
    assert.deepEqual(
      laterContext.subjects.map((subject) => [subject.revision, subject.latestManualDecision]),
      [
        [0, null],
        [0, null],
      ],
    );
    await unlink(f.filePath);
    const expired = parseObservationIdentityContextResponse(await (await get()).json());
    assert.ok(expired);
    assert.deepEqual(
      expired.subjects.map((s) => [s.canResolve, s.canClear]),
      [
        [false, true],
        [false, false],
      ],
    );
    const clear = {
      commandId: randomUUID(),
      expectedRevision: 2,
      expectedEventHash: f.hash,
      action: 'CLEAR',
      reason: 'Incorrect synthetic identity withdrawn.',
    };
    const clearResponse = await post(clear);
    assert.equal(clearResponse.status, 201);
    const cleared = parseObservationIdentityMutationResponse(await clearResponse.json());
    assert.ok(cleared);
    assert.equal(cleared.recordedDecision.workerId, null);
    assert.equal(cleared.latestRevision, 3);
    const retry = await post(command);
    assert.equal(retry.status, 201);
    const replay = parseObservationIdentityMutationResponse(await retry.json());
    assert.ok(replay);
    assert.equal(replay.replayed, true);
    assert.equal(replay.recordedDecision.revision, 1);
    assert.equal(replay.latestRevision, 3);
    const secondSessionRetry = await fetch(`${prefix}/0/decisions`, {
      method: 'POST',
      headers: { ...headers, Authorization: `Bearer ${secondSession.accessToken}` },
      body: JSON.stringify(command),
    });
    assert.equal(secondSessionRetry.status, 201);
    const secondSessionReplay = parseObservationIdentityMutationResponse(
      await secondSessionRetry.json(),
    );
    assert.ok(secondSessionReplay);
    assert.equal(secondSessionReplay.replayed, true);
    assert.equal(secondSessionReplay.recordedDecision.id, command.commandId);
    assert.equal(secondSessionReplay.recordedDecision.revision, 1);
    assert.equal(secondSessionReplay.latestRevision, 3);
    const history = parseObservationIdentityDecisionPage(
      await (await get(`${prefix}/0/decisions`)).json(),
    );
    assert.ok(history);
    assert.equal(history.total, 3);
    assert.deepEqual(
      history.items.map((d) => [d.revision, d.action, d.subjectRef.personObservationIndex]),
      [
        [1, 'RESOLVE', 0],
        [2, 'RESOLVE', 0],
        [3, 'CLEAR', 0],
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
    const corrupt = parseObservationIdentityContextResponse(await corruptResponse.json());
    assert.ok(corrupt, 'Unavailable/corrupt-state context must still satisfy the browser contract');
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
    await dataSource.getRepository(AlertDetectionMappingEntity).delete({ eventId: laterEventId });
    await dataSource.getRepository(AiObservationEventEntity).delete({ eventId: laterEventId });
    await f.cleanup();
    if (app) await app.close();
  }
});
