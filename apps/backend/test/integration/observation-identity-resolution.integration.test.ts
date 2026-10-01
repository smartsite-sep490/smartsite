import { observationIdentityFixture } from '../support/observation-identity-fixture.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { after, test } from 'node:test';
import type { EntityManager } from 'typeorm';
import {
  AiObservationEventEntity,
  AlertStatus,
  SafetyAlertEntity,
  WorkerEntity,
  ObservationIdentityResolutionEntity,
  CameraEntity,
} from '../../src/database/entities/index.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import { ObservationIdentityResolutionService } from '../../src/modules/safety/identity/observation-identity-resolution.service.js';
import { ObservationIdentityContextService } from '../../src/modules/safety/identity/observation-identity-context.service.js';
import { ZoneAccessManagementService } from '../../src/modules/zones/zone-access-management.service.js';
import { ObservationIdentityReview1790899200000 } from '../../src/database/migrations/1790899200000-ObservationIdentityReview.js';
import dataSource from '../support/test-data-source.js';

after(async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
});
const publicError = (code: string, message?: string) => (error: unknown) =>
  error instanceof PublicHttpException &&
  error.publicPayload.code === code &&
  (!message || error.publicPayload.message === message);

for (const operation of ['replay', 'resolve', 'clear', 'history'] as const) {
  test(`inconsistent persisted PERSON reference blocks ${operation} without changing audit`, async () => {
    const f = await observationIdentityFixture();
    try {
      const command = f.resolve();
      await f.decide(command);
      const heads = dataSource.getRepository(ObservationIdentityResolutionEntity);
      const head = await heads.findOneByOrFail({ eventId: f.eventId, personObservationIndex: 0 });
      await heads.update({ id: head.id }, { subjectRef: { ...head.subjectRef, trackId: 8 } });
      const attempt = () =>
        operation === 'replay'
          ? f.decide(command)
          : operation === 'resolve'
            ? f.decide(f.resolve(1))
            : operation === 'clear'
              ? f.decide({
                  commandId: randomUUID(),
                  action: 'CLEAR',
                  expectedRevision: 1,
                  expectedEventHash: f.hash,
                  reason: 'Withdraw inconsistent synthetic review.',
                })
              : f.service.listDecisions(f.siteId, f.alertIds[0]!, f.eventId, 0);
      await assert.rejects(
        attempt,
        publicError('CONFLICT', 'Observation identity scope is inconsistent'),
      );
      assert.equal((await heads.findOneByOrFail({ id: head.id })).revision, 1);
      assert.equal(
        (
          (await dataSource.query(
            'SELECT count(*)::int AS count FROM observation_identity_decision WHERE resolution_id=$1',
            [head.id],
          )) as { count: number }[]
        )[0]!.count,
        1,
      );
    } finally {
      await f.cleanup();
    }
  });
}

test('Camera deletion never bypasses original PERSON matching in historical review', async () => {
  const f = await observationIdentityFixture();
  try {
    const command = f.resolve();
    await f.decide(command);
    const heads = dataSource.getRepository(ObservationIdentityResolutionEntity);
    const head = await heads.findOneByOrFail({ eventId: f.eventId, personObservationIndex: 0 });
    await dataSource.getRepository(CameraEntity).delete({ id: head.subjectRef.cameraId });
    await heads.update({ id: head.id }, { subjectRef: { ...head.subjectRef, trackId: 8 } });
    const operations = [
      () => f.service.listDecisions(f.siteId, f.alertIds[0]!, f.eventId, 0),
      () => f.decide(command),
      () =>
        f.decide({
          commandId: randomUUID(),
          action: 'CLEAR',
          expectedRevision: 1,
          expectedEventHash: f.hash,
          reason: 'Withdraw mismatched historical review.',
        }),
    ];
    for (const operation of operations)
      await assert.rejects(
        operation,
        publicError('CONFLICT', 'Observation identity scope is inconsistent'),
      );
    assert.equal((await heads.findOneByOrFail({ id: head.id })).revision, 1);
  } finally {
    await f.cleanup();
  }
});

test('Camera SET NULL retains historical replay/history/CLEAR but never permits a new resolution', async () => {
  const f = await observationIdentityFixture();
  try {
    const command = f.resolve();
    await f.decide(command);
    const event = await dataSource
      .getRepository(AiObservationEventEntity)
      .findOneByOrFail({ eventId: f.eventId });
    await dataSource.getRepository(CameraEntity).delete({ id: event.resolvedCameraId! });
    assert.equal(
      (
        await dataSource
          .getRepository(AiObservationEventEntity)
          .findOneByOrFail({ eventId: f.eventId })
      ).resolvedCameraId,
      null,
    );
    assert.equal((await f.service.listDecisions(f.siteId, f.alertIds[0]!, f.eventId, 0)).total, 1);
    assert.equal((await f.decide(command)).replayed, true);
    assert.equal(
      (
        await f.decide({
          commandId: randomUUID(),
          action: 'CLEAR',
          expectedRevision: 1,
          expectedEventHash: f.hash,
          reason: 'Withdraw historical identity review.',
        })
      ).latestHead.revision,
      2,
    );
    await assert.rejects(
      () => f.decide(f.resolve(), 1),
      publicError('CONFLICT', 'Observation identity evidence is inconsistent'),
    );
  } finally {
    await f.cleanup();
  }
});

test('manual A→B→CLEAR is exact-observation audit; expired media permits clear and replay', async () => {
  const f = await observationIdentityFixture();
  try {
    const initial = f.resolve();
    const a = await f.decide(initial);
    assert.equal(a.decision.workerId, f.workerIds[0]);
    assert.equal(a.decision.verificationMethod, 'MANUAL');
    assert.equal(a.decision.scope, 'EXACT_OBSERVATION');
    const b = await f.decide(f.resolve(1, f.workerIds[1]!), 0, f.actorIds[0], f.alertIds[1]);
    assert.equal(b.latestHead.revision, 2);
    await unlink(f.filePath);
    await dataSource
      .getRepository(WorkerEntity)
      .update({ id: f.workerIds[1]! }, { isActive: false });
    await dataSource
      .getRepository(AiObservationEventEntity)
      .update({ eventId: f.eventId }, { rawPayload: { corrupted: true } });
    const clear = await f.decide({
      commandId: randomUUID(),
      action: 'CLEAR',
      expectedRevision: 2,
      expectedEventHash: f.hash,
      reason: 'Incorrect review withdrawn.',
    });
    assert.equal(clear.decision.workerId, null);
    assert.equal(clear.latestHead.revision, 3);
    const replay = await f.decide(initial);
    assert.equal(replay.replayed, true);
    assert.equal(replay.decision.workerId, f.workerIds[0]);
    assert.equal(replay.decision.revision, 1);
    assert.equal(replay.latestHead.revision, 3);
    const page = await f.service.listDecisions(f.siteId, f.alertIds[0]!, f.eventId, 0, 1, 1);
    assert.equal(page.total, 3);
    assert.equal(page.items[0]?.revision, 2);
    assert.deepEqual(await f.service.listDecisions(f.siteId, f.alertIds[0]!, f.eventId, 1), {
      items: [],
      total: 0,
    });
    assert.equal(
      (await dataSource.getRepository(SafetyAlertEntity).findOneByOrFail({ id: f.alertIds[0]! }))
        .status,
      AlertStatus.CLOSED,
    );
    assert.deepEqual(
      (
        await dataSource
          .getRepository(AiObservationEventEntity)
          .findOneByOrFail({ eventId: f.eventId })
      ).rawPayload,
      { corrupted: true },
    );
  } finally {
    await f.cleanup();
  }
});

test('first-insert concurrency and simultaneous identical retries commit only one decision', async () => {
  const f = await observationIdentityFixture();
  try {
    const results = await Promise.allSettled([f.decide(f.resolve()), f.decide(f.resolve())]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const loser = results.find((r) => r.status === 'rejected');
    assert.ok(
      loser?.status === 'rejected' &&
        publicError('CONFLICT', 'Observation identity revision is stale')(loser.reason),
    );
    const input = f.resolve();
    const retries = await Promise.all([f.decide(input, 1), f.decide(input, 1)]);
    assert.deepEqual(retries.map((r) => r.replayed).sort(), [false, true]);
    assert.equal((await f.service.listDecisions(f.siteId, f.alertIds[0]!, f.eventId, 1)).total, 1);
  } finally {
    await f.cleanup();
  }
});

test('command reuse binds actor/body/subject; wrong scope and changed media never create decisions', async () => {
  const f = await observationIdentityFixture();
  try {
    const input = f.resolve();
    await f.decide(input);
    await assert.rejects(
      f.decide({ ...input, reason: 'Different retry body.' }),
      publicError('CONFLICT'),
    );
    await assert.rejects(f.decide(input, 0, f.actorIds[1]), publicError('CONFLICT'));
    await assert.rejects(f.decide(input, 1), publicError('CONFLICT'));
    await assert.rejects(
      f.service.decide(f.otherSiteId, f.alertIds[0]!, f.eventId, 0, f.actorIds[0]!, f.resolve(1)),
      publicError('NOT_FOUND'),
    );
    await writeFile(f.filePath, Buffer.from([0xff, 0xd8, 0x02, 0xff, 0xd9]));
    await assert.rejects(f.decide(f.resolve(1)), publicError('CONFLICT'));
    assert.equal((await f.service.listDecisions(f.siteId, f.alertIds[0]!, f.eventId, 0)).total, 1);
  } finally {
    await f.cleanup();
  }
});

test('unavailable/missing/inactive Worker reader fails closed and preserves empty audit', async () => {
  const f = await observationIdentityFixture();
  try {
    const unavailable = new ObservationIdentityResolutionService(dataSource, f.evidence);
    await assert.rejects(
      unavailable.decide(f.siteId, f.alertIds[0]!, f.eventId, 0, f.actorIds[0]!, f.resolve()),
      publicError('SERVICE_UNAVAILABLE'),
    );
    await assert.rejects(f.decide(f.resolve(0, randomUUID())), publicError('NOT_FOUND'));
    await dataSource
      .getRepository(WorkerEntity)
      .update({ id: f.workerIds[0]! }, { isActive: false });
    await assert.rejects(f.decide(f.resolve()), publicError('CONFLICT', 'Worker is inactive'));
    await assert.rejects(
      f.decide({
        commandId: randomUUID(),
        action: 'CLEAR',
        expectedRevision: 0,
        expectedEventHash: f.hash,
        reason: 'Nothing to clear yet.',
      }),
      publicError('CONFLICT'),
    );
    assert.equal((await f.service.listDecisions(f.siteId, f.alertIds[0]!, f.eventId, 0)).total, 0);
  } finally {
    await f.cleanup();
  }
});

test('audit rows reject UPDATE/DELETE and populated migration down refuses atomically', async () => {
  const f = await observationIdentityFixture();
  try {
    const result = await f.decide(f.resolve());
    await assert.rejects(
      dataSource.query('UPDATE observation_identity_decision SET reason = $1 WHERE id = $2', [
        'Overwrite audit.',
        result.decision.id,
      ]),
      (error: unknown) =>
        (error as { driverError?: { code?: string } }).driverError?.code === '23514',
    );
    await assert.rejects(
      dataSource.query('DELETE FROM observation_identity_decision WHERE id = $1', [
        result.decision.id,
      ]),
      (error: unknown) =>
        (error as { driverError?: { code?: string } }).driverError?.code === '23514',
    );
    const runner = dataSource.createQueryRunner();
    try {
      await assert.rejects(new ObservationIdentityReview1790899200000().down(runner));
    } finally {
      await runner.release();
    }
    assert.equal((await f.service.listDecisions(f.siteId, f.alertIds[0]!, f.eventId, 0)).total, 1);
    assert.equal(
      (
        await dataSource.query('SELECT revision FROM observation_identity_resolution WHERE id=$1', [
          result.latestHead.id,
        ])
      )[0].revision,
      1,
    );
  } finally {
    await f.cleanup();
  }
});

test('replay rejects changed persisted event hash and cross-Site mappings', async () => {
  const f = await observationIdentityFixture();
  try {
    const input = f.resolve();
    await f.decide(input);
    await dataSource
      .getRepository(AiObservationEventEntity)
      .update({ eventId: f.eventId }, { payloadHash: 'a'.repeat(64) });
    await assert.rejects(f.decide(input), publicError('CONFLICT'));
    await dataSource
      .getRepository(AiObservationEventEntity)
      .update({ eventId: f.eventId }, { payloadHash: f.hash });
    await dataSource
      .getRepository(SafetyAlertEntity)
      .update({ id: f.alertIds[1]! }, { siteId: f.otherSiteId });
    await assert.rejects(f.decide(input), publicError('CONFLICT'));
    await assert.rejects(
      f.service.listDecisions(f.siteId, f.alertIds[0]!, f.eventId, 0),
      publicError('CONFLICT'),
    );
  } finally {
    await f.cleanup();
  }
});

test('new resolution rejects inconsistent timestamp/raw, while CLEAR only uses persisted subject scope', async () => {
  const f = await observationIdentityFixture();
  try {
    await dataSource
      .getRepository(AiObservationEventEntity)
      .update({ eventId: f.eventId }, { capturedAt: new Date('2026-10-02T00:00:00Z') });
    await assert.rejects(f.decide(f.resolve()), publicError('CONFLICT'));
    await dataSource
      .getRepository(AiObservationEventEntity)
      .update({ eventId: f.eventId }, { capturedAt: new Date(f.raw.capturedAt) });
    await f.decide(f.resolve());
    await dataSource
      .getRepository(AiObservationEventEntity)
      .update({ eventId: f.eventId }, { rawPayload: { corrupt: true } });
    await assert.rejects(f.decide(f.resolve(1)), publicError('CONFLICT'));
    await f.decide({
      commandId: randomUUID(),
      action: 'CLEAR',
      expectedRevision: 1,
      expectedEventHash: f.hash,
      reason: 'Withdraw incorrect identity.',
    });
    await assert.rejects(
      f.decide({
        commandId: randomUUID(),
        action: 'CLEAR',
        expectedRevision: 2,
        expectedEventHash: f.hash,
        reason: 'Already withdrawn identity.',
      }),
      publicError('CONFLICT'),
    );
  } finally {
    await f.cleanup();
  }
});

test('Worker row remains locked until resolution transaction commits', async () => {
  const f = await observationIdentityFixture();
  let releaseReader!: () => void;
  const released = new Promise<void>((resolve) => {
    releaseReader = resolve;
  });
  let lockedReader!: () => void;
  const locked = new Promise<void>((resolve) => {
    lockedReader = resolve;
  });
  const reader = {
    ...f.reader,
    async findForReview(manager: EntityManager, site: string, worker: string, lock: boolean) {
      const result = await f.reader.findForReview(manager, site, worker, lock);
      lockedReader();
      await released;
      return result;
    },
  };
  const service = new ObservationIdentityResolutionService(dataSource, f.evidence, reader);
  const updateRunner = dataSource.createQueryRunner();
  const pending = service.decide(
    f.siteId,
    f.alertIds[0]!,
    f.eventId,
    0,
    f.actorIds[0]!,
    f.resolve(),
  );
  try {
    await locked;
    await updateRunner.startTransaction();
    await updateRunner.query("SET LOCAL lock_timeout = '100ms'");
    await assert.rejects(
      updateRunner.manager
        .getRepository(WorkerEntity)
        .update({ id: f.workerIds[0]! }, { isActive: false }),
      (error: unknown) =>
        (error as { driverError?: { code?: string } }).driverError?.code === '55P03',
    );
    await updateRunner.rollbackTransaction();
    releaseReader();
    assert.equal((await pending).latestHead.revision, 1);
    await dataSource
      .getRepository(WorkerEntity)
      .update({ id: f.workerIds[0]! }, { isActive: false });
    await assert.rejects(f.decide(f.resolve(1)), publicError('CONFLICT', 'Worker is inactive'));
  } finally {
    releaseReader();
    await pending.catch(() => undefined);
    if (updateRunner.isTransactionActive) await updateRunner.rollbackTransaction();
    await updateRunner.release();
    await f.cleanup();
  }
});

test('database constraints bind head pointer/revision and audit scope; empty down is reversible', async () => {
  const f = await observationIdentityFixture();
  try {
    const a = await f.decide(f.resolve());
    const b = await f.decide(f.resolve(), 1);
    await assert.rejects(
      dataSource.query(
        'UPDATE observation_identity_resolution SET current_decision_id=$1 WHERE id=$2',
        [b.decision.id, a.latestHead.id],
      ),
      (error: unknown) =>
        (error as { driverError?: { code?: string } }).driverError?.code === '23503',
    );
    await assert.rejects(
      dataSource.query('UPDATE observation_identity_resolution SET revision=2 WHERE id=$1', [
        a.latestHead.id,
      ]),
      (error: unknown) =>
        (error as { driverError?: { code?: string } }).driverError?.code === '23503',
    );
    const insertAudit = (site: string, evidenceIndex: number | null) =>
      dataSource.query(
        `INSERT INTO observation_identity_decision(id,resolution_id,site_id,actor_user_id,revision,expected_revision,command_hash,action,worker_id,evidence_index,evidence_sha256,reason) VALUES($1,$2,$3,$4,2,1,$5,'RESOLVE',$6,$7,$8,'Synthetic SQL constraint test.')`,
        [
          randomUUID(),
          a.latestHead.id,
          site,
          f.actorIds[0],
          'b'.repeat(64),
          f.workerIds[0],
          evidenceIndex,
          'c'.repeat(64),
        ],
      );
    await assert.rejects(
      insertAudit(f.otherSiteId, 0),
      (error: unknown) =>
        (error as { driverError?: { code?: string } }).driverError?.code === '23503',
    );
    await assert.rejects(
      insertAudit(f.siteId, null),
      (error: unknown) =>
        (error as { driverError?: { code?: string } }).driverError?.code === '23514',
    );
    await assert.rejects(
      f.service.listDecisions(f.siteId, f.alertIds[0]!, f.eventId, 0, 0, 101),
      publicError('VALIDATION_FAILED'),
    );
  } finally {
    await f.cleanup();
  }
  const runner = dataSource.createQueryRunner();
  await runner.startTransaction();
  try {
    const migration = new ObservationIdentityReview1790899200000();
    await migration.down(runner);
    assert.equal(
      (await runner.query("SELECT to_regclass('observation_identity_decision') AS name"))[0].name,
      null,
    );
    await migration.up(runner);
    assert.equal(
      (await runner.query("SELECT to_regclass('observation_identity_decision') AS name"))[0].name,
      'observation_identity_decision',
    );
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
});

test('failed head advance rolls back both first head and appended decision', async () => {
  const f = await observationIdentityFixture();
  try {
    await dataSource.query(
      `CREATE FUNCTION identity_test_reject_head_advance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic transaction rollback' USING ERRCODE='23514'; END $$`,
    );
    await dataSource.query(
      `CREATE TRIGGER identity_test_head_advance BEFORE UPDATE ON observation_identity_resolution FOR EACH ROW EXECUTE FUNCTION identity_test_reject_head_advance()`,
    );
    await assert.rejects(
      f.decide(f.resolve()),
      (error: unknown) =>
        (error as { driverError?: { code?: string } }).driverError?.code === '23514',
    );
    assert.equal(
      (
        await dataSource.query(
          'SELECT count(*)::int AS count FROM observation_identity_resolution WHERE event_id=$1',
          [f.eventId],
        )
      )[0].count,
      0,
    );
    assert.equal(
      (
        await dataSource.query('SELECT count(*)::int AS count FROM observation_identity_decision')
      )[0].count,
      0,
    );
  } finally {
    await dataSource.query(
      'DROP TRIGGER IF EXISTS identity_test_head_advance ON observation_identity_resolution',
    );
    await dataSource.query('DROP FUNCTION IF EXISTS identity_test_reject_head_advance()');
    await f.cleanup();
  }
});

test('maximum persisted revision cannot advance or overflow the audit integer', async () => {
  const f = await observationIdentityFixture();
  try {
    const initial = await f.decide(f.resolve());
    const maxId = randomUUID();
    await dataSource.query(
      `INSERT INTO observation_identity_decision(id,resolution_id,site_id,actor_user_id,revision,expected_revision,command_hash,action,worker_id,evidence_index,evidence_sha256,reason) VALUES($1,$2,$3,$4,2147483646,2147483645,$5,'RESOLVE',$6,0,$7,'Synthetic penultimate revision fixture.')`,
      [
        maxId,
        initial.latestHead.id,
        f.siteId,
        f.actorIds[0],
        'd'.repeat(64),
        f.workerIds[0],
        'e'.repeat(64),
      ],
    );
    await dataSource.query(
      'UPDATE observation_identity_resolution SET revision=2147483646,current_decision_id=$1 WHERE id=$2',
      [maxId, initial.latestHead.id],
    );
    const final = await f.decide(f.resolve(2147483646));
    assert.equal(final.latestHead.revision, 2147483647);
    await assert.rejects(
      f.decide(f.resolve(2147483646)),
      publicError('CONFLICT', 'Observation identity revision is stale'),
    );
    await assert.rejects(f.decide(f.resolve(2147483647)), publicError('VALIDATION_FAILED'));
    assert.equal(
      (
        await dataSource.query('SELECT revision FROM observation_identity_resolution WHERE id=$1', [
          initial.latestHead.id,
        ])
      )[0].revision,
      2147483647,
    );
  } finally {
    await f.cleanup();
  }
});

test('real scoped context snapshot returns latest manual head and preserves CLEAR after raw corruption', async () => {
  const f = await observationIdentityFixture();
  try {
    const result = await f.decide(f.resolve());
    const contextService = new ObservationIdentityContextService(
      f.service,
      f.evidence,
      new ZoneAccessManagementService(dataSource),
    );
    const context = await contextService.get(f.siteId, f.alertIds[1]!, f.eventId);
    assert.equal(context.subjects.length, 2);
    assert.equal(context.subjects[0]?.latestManualDecision?.id, result.decision.id);
    assert.equal(context.subjects[0]?.canClear, true);
    assert.equal(context.subjects[0]?.resolveBlockReason, 'WORKER_READER_UNAVAILABLE');
    assert.equal(context.subjects[1]?.latestManualDecision, null);
    await dataSource
      .getRepository(AiObservationEventEntity)
      .update({ eventId: f.eventId }, { rawPayload: { corrupted: true } });
    const corrupt = await contextService.get(f.siteId, f.alertIds[0]!, f.eventId);
    assert.equal(corrupt.subjects.length, 1);
    assert.equal(corrupt.subjects[0]?.subjectRefSource, 'PERSISTED_REVIEW');
    assert.equal(corrupt.subjects[0]?.canClear, true);
    assert.equal(corrupt.subjects[0]?.canResolve, false);
    await assert.rejects(
      contextService.get(f.otherSiteId, f.alertIds[0]!, f.eventId),
      publicError('NOT_FOUND'),
    );
    assert.equal(JSON.stringify(corrupt).includes('local://'), false);
  } finally {
    await f.cleanup();
  }
});
