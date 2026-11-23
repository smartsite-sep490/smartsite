import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import type { TrackedFrameKey } from '../src/integrations/ai/tracked-frame-admission.js';
import { TrackedFrameAdmission } from '../src/integrations/ai/tracked-frame-admission.js';
import { TrackedFrameRecovery } from '../src/integrations/ai/tracked-frame-recovery.js';
import { TrackedSourceGapResume } from '../src/integrations/ai/tracked-source-gap-resume.js';

const camera1 = '11111111-1111-4111-8111-111111111111';
const camera2 = '22222222-2222-4222-8222-222222222222';

function makeKey(
  cameraId = camera1,
  generationId = randomUUID(),
  streamSessionId = randomUUID(),
  frameId = randomUUID(),
): TrackedFrameKey {
  return { cameraId, generationId, streamSessionId, frameId };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

test('TrackedSourceGapResume validates constructor bounds and ignores unconfigured cameras', () => {
  const noopService = {
    resumeAfterSourceGap: async () => {
      throw new Error('unexpected');
    },
  };
  const noopRecheck = async () => false;

  assert.throws(() => new TrackedSourceGapResume(noopService, noopRecheck, [], 3));
  assert.throws(() => new TrackedSourceGapResume(noopService, noopRecheck, [camera1, camera1], 3));
  assert.throws(() => new TrackedSourceGapResume(noopService, noopRecheck, [camera1], 0));
  assert.throws(() => new TrackedSourceGapResume(noopService, noopRecheck, [camera1], 4));
  assert.throws(() => new TrackedSourceGapResume(noopService, noopRecheck, [camera1], 1.5));

  let rechecks = 0;
  const coordinator = new TrackedSourceGapResume(
    noopService,
    async () => {
      rechecks++;
      return true;
    },
    [camera1],
    3,
  );
  assert.equal(coordinator.notify(makeKey(camera2)), true);
  assert.equal(rechecks, 0);
});

test('notify dedupes same generation, denies stale recheck, and forwards recheck callback', async () => {
  const resumed: Array<{ cameraId: string; generationId: string; streamSessionId: string }> = [];
  const checkStarted = deferred();
  const checkGate = deferred<boolean>();
  const resumedDone = deferred();
  let recheckCalls = 0;
  let callbackResult: boolean | undefined;

  const coordinator = new TrackedSourceGapResume(
    {
      async resumeAfterSourceGap(key, gapStillCurrent) {
        resumed.push({
          cameraId: key.cameraId,
          generationId: key.generationId,
          streamSessionId: key.streamSessionId,
        });
        callbackResult = await gapStillCurrent();
        resumedDone.resolve();
        return {
          state: 'STARTED',
          commandId: randomUUID(),
          sourceRevision: 1,
          configurationVersion: 1,
          viewRevision: 1,
          bundleSha256: 'a'.repeat(64),
          currentGenerationId: randomUUID(),
        };
      },
    },
    async () => {
      recheckCalls++;
      if (recheckCalls === 1) {
        checkStarted.resolve();
        return checkGate.promise;
      }
      return true;
    },
    [camera1],
    3,
  );

  const key1 = makeKey(camera1);
  assert.equal(coordinator.notify(key1), true);
  // Duplicate notification for the same generation (even with a different frameId) while in-flight.
  assert.equal(coordinator.notify({ ...key1, frameId: randomUUID() }), true);

  await checkStarted.promise;
  checkGate.resolve(true);
  await resumedDone.promise;
  await coordinator.onModuleDestroy();

  assert.equal(resumed.length, 1);
  assert.deepEqual(resumed[0], {
    cameraId: key1.cameraId,
    generationId: key1.generationId,
    streamSessionId: key1.streamSessionId,
  });
  assert.equal(callbackResult, true);
  assert.equal(recheckCalls, 2);

  // Stale/denied recheck never invokes resumeAfterSourceGap, and rejected recheck never throws unhandled.
  let staleResumes = 0;
  const staleRecheckSettled = deferred();
  const rejectedRecheckSettled = deferred();
  const coordinator2 = new TrackedSourceGapResume(
    {
      async resumeAfterSourceGap() {
        staleResumes++;
        throw new Error('must not resume');
      },
    },
    async (k) => {
      if (k.frameId === key1.frameId) {
        staleRecheckSettled.resolve();
        return false;
      }
      rejectedRecheckSettled.resolve();
      throw new Error('recheck failed');
    },
    [camera1],
    3,
  );
  assert.equal(coordinator2.notify(key1), true);
  await staleRecheckSettled.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(coordinator2.notify(makeKey(camera1)), true);
  await rejectedRecheckSettled.promise;
  await coordinator2.onModuleDestroy();
  assert.equal(staleResumes, 0);
});

test('notify returns false when another generation is busy and allows retry once idle, while other cameras stay independent', async () => {
  const gen1Started = deferred();
  const gen1Gate = deferred();
  const cam2Started = deferred();
  const cam2Gate = deferred();
  const gen2Done = deferred();
  const resumed: string[] = [];
  const gen1 = makeKey(camera1);
  const gen2 = makeKey(camera1);
  const cam2Gen1 = makeKey(camera2);

  const coordinator = new TrackedSourceGapResume(
    {
      async resumeAfterSourceGap(key) {
        resumed.push(key.generationId);
        if (key.generationId === gen1.generationId) {
          gen1Started.resolve();
          await gen1Gate.promise;
        } else if (key.cameraId === camera2) {
          cam2Started.resolve();
          await cam2Gate.promise;
        } else if (key.generationId === gen2.generationId) {
          gen2Done.resolve();
        }
        return {
          state: 'STARTED',
          commandId: randomUUID(),
          sourceRevision: 1,
          configurationVersion: 1,
          viewRevision: 1,
          bundleSha256: 'a'.repeat(64),
          currentGenerationId: randomUUID(),
        };
      },
    },
    async () => true,
    [camera1, camera2],
    3,
  );

  assert.equal(coordinator.notify(gen1), true);
  await gen1Started.promise;

  // Same camera + different generation while active -> false; duplicate gen1 -> true; other camera -> true.
  assert.equal(coordinator.notify(gen2), false);
  assert.equal(coordinator.notify(gen1), true);
  assert.equal(coordinator.notify(cam2Gen1), true);
  await cam2Started.promise;

  gen1Gate.resolve();
  cam2Gate.resolve();
  await flushMicrotasks();
  await new Promise((resolve) => setTimeout(resolve, 10));

  // Previously busy new generation was NOT marked attempted and now resumes cleanly.
  assert.equal(coordinator.notify(gen2), true);
  await gen2Done.promise;
  await coordinator.onModuleDestroy();

  assert.deepEqual(resumed, [gen1.generationId, cam2Gen1.generationId, gen2.generationId]);
});

test(
  'real TrackedFrameRecovery + TrackedSourceGapResume leaves notified=false while busy and retries new generation when idle',
  { timeout: 3000 },
  async () => {
    const gen1 = makeKey(camera1);
    const gen2 = makeKey(camera1);
    const gen1Started = deferred();
    const gen1Gate = deferred();
    const gen2Done = deferred();
    const resumed: string[] = [];
    const gapCalls: Array<{ generationId: string; notified: boolean }> = [];

    const coordinator = new TrackedSourceGapResume(
      {
        async resumeAfterSourceGap(key) {
          resumed.push(key.generationId);
          if (key.generationId === gen1.generationId) {
            gen1Started.resolve();
            await gen1Gate.promise;
          } else if (key.generationId === gen2.generationId) {
            gen2Done.resolve();
          }
          return {
            state: 'STARTED',
            commandId: randomUUID(),
            sourceRevision: 1,
            configurationVersion: 1,
            viewRevision: 1,
            bundleSha256: 'a'.repeat(64),
            currentGenerationId: randomUUID(),
          };
        },
      },
      async () => true,
      [camera1],
      3,
    );

    // Drive gen1 into active resume first.
    assert.equal(coordinator.notify(gen1), true);
    await gen1Started.promise;

    let rechecks = 0;
    const fakeDb = {
      async query() {
        return [];
      },
    } as unknown as DataSource;
    const admission = {
      async readCurrentScope() {
        return {
          cameraId: gen2.cameraId,
          generationId: gen2.generationId,
          streamSessionId: gen2.streamSessionId,
        };
      },
      async recoverPending() {
        return [{ frameId: gen2.frameId, kind: 'PENDING_PREDECESSOR', reason: 'SOURCE_GAP' }];
      },
      async recheckSourceGap() {
        rechecks++;
        return true;
      },
    } as unknown as TrackedFrameAdmission;

    const busyNotificationSeen = deferred();
    const recovery = new TrackedFrameRecovery(fakeDb, admission, {
      cameraIds: [camera1],
      intervalMs: 5,
      maxFramesPerCamera: 2,
      sourceGap: {
        minPersistentMs: 15,
        onGap(signal) {
          const result = coordinator.notify(signal);
          gapCalls.push({ generationId: signal.generationId, notified: result });
          if (result === false) busyNotificationSeen.resolve();
          return result;
        },
      },
    });

    const keepAlive = setInterval(() => {}, 25);
    recovery.onApplicationBootstrap();
    try {
      await busyNotificationSeen.promise;
      // Wait one more sweep cycle while gen1 is still busy to confirm notified remained false and kept retrying.
      await flushMicrotasks();
      gen1Gate.resolve();
      await gen2Done.promise;
      const callsAtGen2Done = gapCalls.length;
      await new Promise((resolve) => setTimeout(resolve, 35));
      assert.ok(gapCalls.some((c) => c.generationId === gen2.generationId && c.notified === false));
      assert.equal(
        gapCalls.filter((c) => c.generationId === gen2.generationId && c.notified === true).length,
        1,
      );
      assert.equal(gapCalls.length, callsAtGen2Done);
      assert.ok(rechecks >= 2);
      assert.deepEqual(resumed, [gen1.generationId, gen2.generationId]);
    } finally {
      clearInterval(keepAlive);
      gen1Gate.resolve();
      await recovery.onModuleDestroy();
      await coordinator.onModuleDestroy();
    }
  },
);

test('enforces max 3 starts per camera per process and never blind-retries thrown/ambiguous outcomes', async () => {
  const attempts: string[] = [];
  const c2Done = deferred();
  let throwFirst = true;

  const coordinator = new TrackedSourceGapResume(
    {
      async resumeAfterSourceGap(key) {
        attempts.push(key.generationId);
        if (key.cameraId === camera2) c2Done.resolve();
        if (throwFirst) {
          throwFirst = false;
          throw new Error('ambiguous gateway timeout');
        }
        return {
          state: 'STARTED',
          commandId: randomUUID(),
          sourceRevision: 1,
          configurationVersion: 1,
          viewRevision: 1,
          bundleSha256: 'a'.repeat(64),
          currentGenerationId: randomUUID(),
        };
      },
    },
    async () => true,
    [camera1, camera2],
    3,
  );

  const g1 = makeKey(camera1);
  const g2 = makeKey(camera1);
  const g3 = makeKey(camera1);
  const g4 = makeKey(camera1);
  const c2 = makeKey(camera2);

  // Attempt 1 throws -> no blind retry on re-notify, counts toward max 3 budget.
  assert.equal(coordinator.notify(g1), true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(coordinator.notify(g1), true);
  await flushMicrotasks();
  assert.equal(attempts.filter((id) => id === g1.generationId).length, 1);

  assert.equal(coordinator.notify(g2), true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(coordinator.notify(g3), true);
  await new Promise((resolve) => setTimeout(resolve, 10));

  // 4th distinct generation exceeds maxStarts=3 -> returns true without resuming.
  assert.equal(coordinator.notify(g4), true);
  await flushMicrotasks();
  assert.deepEqual(attempts, [g1.generationId, g2.generationId, g3.generationId]);

  // Camera 2 retains its own independent budget.
  assert.equal(coordinator.notify(c2), true);
  await c2Done.promise;
  await coordinator.onModuleDestroy();
  assert.deepEqual(attempts, [g1.generationId, g2.generationId, g3.generationId, c2.generationId]);
});

test('onModuleDestroy drains started operations and blocks new recovery notifications', async () => {
  const started = deferred();
  const gate = deferred();
  let calls = 0;
  let drained = false;

  const coordinator = new TrackedSourceGapResume(
    {
      async resumeAfterSourceGap() {
        calls++;
        started.resolve();
        await gate.promise;
        return {
          state: 'STARTED',
          commandId: randomUUID(),
          sourceRevision: 1,
          configurationVersion: 1,
          viewRevision: 1,
          bundleSha256: 'a'.repeat(64),
          currentGenerationId: randomUUID(),
        };
      },
    },
    async () => true,
    [camera1, camera2],
    3,
  );

  assert.equal(coordinator.notify(makeKey(camera1)), true);
  await started.promise;

  const stop = coordinator.onModuleDestroy().then(() => {
    drained = true;
  });
  await flushMicrotasks();
  assert.equal(drained, false);

  // During shutdown, notify returns true without starting another camera operation.
  assert.equal(coordinator.notify(makeKey(camera2)), true);
  await flushMicrotasks();
  assert.equal(calls, 1);
  assert.equal(drained, false);

  gate.resolve();
  await stop;
  assert.equal(drained, true);
  assert.equal(calls, 1);
});

test('shutdown while initial recheck waits never calls service; gapStillCurrent returns false pre/post await while issued owner drains commit', async () => {
  // 1) Shutdown while initial recheck is pending -> no service call even when recheck resolves true.
  const initialStarted = deferred();
  const initialGate = deferred<boolean>();
  let serviceCalls1 = 0;
  const coordinator1 = new TrackedSourceGapResume(
    {
      async resumeAfterSourceGap() {
        serviceCalls1++;
        throw new Error('must not call service after shutdown during initial recheck');
      },
    },
    async () => {
      initialStarted.resolve();
      return initialGate.promise;
    },
    [camera1],
    3,
  );
  assert.equal(coordinator1.notify(makeKey(camera1)), true);
  await initialStarted.promise;
  let drained1 = false;
  const stop1 = coordinator1.onModuleDestroy().then(() => {
    drained1 = true;
  });
  await flushMicrotasks();
  assert.equal(drained1, false);
  initialGate.resolve(true);
  await stop1;
  assert.equal(drained1, true);
  assert.equal(serviceCalls1, 0);

  // 2) Shutdown mid-flight during service gapStillCurrent recheck (post-await) returns false, while started commit drains.
  const secondRecheckStarted = deferred();
  const secondRecheckGate = deferred<boolean>();
  const commitGate = deferred();
  let recheckCalls2 = 0;
  let postAwaitResult: boolean | undefined;
  let preAwaitResult: boolean | undefined;
  let commitCompleted = false;

  const coordinator2 = new TrackedSourceGapResume(
    {
      async resumeAfterSourceGap(_key, gapStillCurrent) {
        // Post-await: shutdown arrives while second recheck is awaiting -> callback returns false.
        postAwaitResult = await gapStillCurrent();
        // Pre-await: stopping is already true -> callback returns false without extra recheck.
        preAwaitResult = await gapStillCurrent();
        await commitGate.promise;
        commitCompleted = true;
        return {
          state: 'STARTED',
          commandId: randomUUID(),
          sourceRevision: 1,
          configurationVersion: 1,
          viewRevision: 1,
          bundleSha256: 'a'.repeat(64),
          currentGenerationId: randomUUID(),
        };
      },
    },
    async () => {
      recheckCalls2++;
      if (recheckCalls2 === 1) return true;
      secondRecheckStarted.resolve();
      return secondRecheckGate.promise;
    },
    [camera1],
    3,
  );
  assert.equal(coordinator2.notify(makeKey(camera1)), true);
  await secondRecheckStarted.promise;
  let drained2 = false;
  const stop2 = coordinator2.onModuleDestroy().then(() => {
    drained2 = true;
  });
  await flushMicrotasks();
  assert.equal(drained2, false);
  secondRecheckGate.resolve(true);
  await flushMicrotasks();
  assert.equal(drained2, false);
  commitGate.resolve();
  await stop2;
  assert.equal(drained2, true);
  assert.equal(commitCompleted, true);
  assert.equal(postAwaitResult, false);
  assert.equal(preAwaitResult, false);
  assert.equal(recheckCalls2, 2);
});
