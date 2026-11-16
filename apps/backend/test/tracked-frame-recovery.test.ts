import assert from 'node:assert/strict';
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
