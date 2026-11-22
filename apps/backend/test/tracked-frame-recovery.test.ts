import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import { TrackedFrameAdmission } from '../src/integrations/ai/tracked-frame-admission.js';
import { TrackedFrameRecovery } from '../src/integrations/ai/tracked-frame-recovery.js';

const cameraId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const generationId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const sessionId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const frames = [
  { frameId: 'dddddddd-dddd-dddd-dddd-dddddddddddd', sequence: '1' },
  { frameId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', sequence: '2' },
];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
for (const phase of ['expiry', 'admission'] as const) {
  test(
    `shutdown drains the current ${phase} transaction without starting another frame`,
    { timeout: 2000 },
    async () => {
      const started = deferred();
      const release = deferred();
      let transactions = 0;
      let finished = 0;
      const source = {
        async query(sql: string) {
          if (sql.includes('tracking_pending_until<=clock_timestamp()')) {
            return phase === 'expiry'
              ? frames.map((frame) => ({ ...frame, cameraId, generationId, sessionId }))
              : [];
          }
          if (sql.includes('FROM camera_worker_generation')) {
            return [{ cameraId, generationId, streamSessionId: sessionId }];
          }
          assert.match(sql, /ORDER BY tracking_source_sequence,event_id/);
          return frames;
        },
        async transaction() {
          if (++transactions === 1) {
            started.resolve();
            await release.promise;
          }
          finished += 1;
          return phase === 'expiry' ? { frames: 1, parts: 0 } : { kind: 'SEALED' };
        },
      } as unknown as DataSource;
      const admission = new TrackedFrameAdmission(
        {} as ConstructorParameters<typeof TrackedFrameAdmission>[0],
        {
          firstFramePolicy: 'FIRST_COMMITTED_CAPTURE',
          maxCaptureGapMs: 1000,
          maxSourceSequenceGap: '1',
          maxSegmentRows: 10,
        },
        {
          async project() {
            throw new Error('Unexpected projection');
          },
        },
      );
      const recovery = new TrackedFrameRecovery(source, admission, {
        cameraIds: [cameraId],
        intervalMs: 10,
        maxFramesPerCamera: 2,
      });

      recovery.onApplicationBootstrap();
      await started.promise;
      let stopped = false;
      const shutdown = recovery.onModuleDestroy().then(() => {
        stopped = true;
      });
      try {
        await Promise.resolve();
        assert.equal(stopped, false);
        assert.equal(finished, 0);
      } finally {
        release.resolve();
        await shutdown;
      }
      assert.equal(finished, 1);
      assert.equal(transactions, 1);
    },
  );
}

test(
  'TrackedFrameRecovery validates sourceGap options and leaves notified=false when onGap returns false',
  { timeout: 3000 },
  async () => {
    let sweepPhase: 'start' | 'confirm' = 'start';
    const source = {
      async query() {
        sweepPhase = 'start';
        return [];
      },
    } as unknown as DataSource;
    const dummyAdmission = {
      async readCurrentScope() {
        return undefined;
      },
      async recoverPending() {
        return [];
      },
      async recheckSourceGap() {
        return false;
      },
    } as unknown as TrackedFrameAdmission;

    assert.throws(
      () =>
        new TrackedFrameRecovery(source, dummyAdmission, {
          cameraIds: [cameraId],
          intervalMs: 20,
          maxFramesPerCamera: 2,
          sourceGap: { minPersistentMs: 19, onGap: () => true },
        }),
    );
    assert.throws(
      () =>
        new TrackedFrameRecovery(source, dummyAdmission, {
          cameraIds: [cameraId],
          intervalMs: 20,
          maxFramesPerCamera: 2,
          sourceGap: { minPersistentMs: 20.5, onGap: () => true },
        }),
    );

    // Covers: scope rotation between recoverPending & notify (suppressed),
    // recheckSourceGap=false (suppressed), onGap returning false (notified stays false -> retried),
    // and onGap returning true (suppressed on subsequent sweeps).
    let mode: 'rotate-before-notify' | 'recheck-false' | 'notify-false-then-true' =
      'rotate-before-notify';
    let notifyCallCount = 0;
    const resumedDone = deferred();
    const notifiedKeys: string[] = [];

    const admission = {
      async readCurrentScope() {
        if (sweepPhase === 'confirm' && mode === 'rotate-before-notify') {
          sweepPhase = 'start';
          return { cameraId, generationId: randomUUID(), streamSessionId: sessionId };
        }
        sweepPhase = 'start';
        return { cameraId, generationId, streamSessionId: sessionId };
      },
      async recoverPending() {
        sweepPhase = 'confirm';
        return [{ frameId: frames[0]!.frameId, kind: 'PENDING_PREDECESSOR', reason: 'SOURCE_GAP' }];
      },
      async recheckSourceGap() {
        return mode !== 'recheck-false';
      },
    } as unknown as TrackedFrameAdmission;

    const recovery = new TrackedFrameRecovery(source, admission, {
      cameraIds: [cameraId],
      intervalMs: 5,
      maxFramesPerCamera: 2,
      sourceGap: {
        minPersistentMs: 15,
        onGap(signal) {
          notifyCallCount++;
          notifiedKeys.push(`${signal.generationId}:${signal.frameId}`);
          if (notifyCallCount === 1) return false;
          resumedDone.resolve();
          return true;
        },
      },
    });

    const keepAlive = setInterval(() => {}, 25);
    recovery.onApplicationBootstrap();
    try {
      await new Promise((resolve) => setTimeout(resolve, 35));
      assert.equal(notifyCallCount, 0);

      mode = 'recheck-false';
      await new Promise((resolve) => setTimeout(resolve, 35));
      assert.equal(notifyCallCount, 0);

      mode = 'notify-false-then-true';
      await resumedDone.promise;
      const countAfterTrue = notifyCallCount;
      await new Promise((resolve) => setTimeout(resolve, 35));
      assert.equal(notifyCallCount, 2);
      assert.equal(notifyCallCount, countAfterTrue);
      assert.deepEqual(notifiedKeys, [
        `${generationId}:${frames[0]!.frameId}`,
        `${generationId}:${frames[0]!.frameId}`,
      ]);
    } finally {
      clearInterval(keepAlive);
      await recovery.onModuleDestroy();
    }
  },
);
