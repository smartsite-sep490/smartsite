import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Mf06FacePreparationResult } from '../src/modules/safety/assessments/mf06-face-preparation.js';
import {
  snapshotWorkFace,
  type MatchedClaimContext,
} from '../src/modules/safety/assessments/mf06-work-preparation.js';

test('reject oversized prepared crop before copying bytes or reading further preparation data', () => {
  let contextReads = 0;
  const oversized = {
    state: 'PREPARED_UNATTESTED',
    media: { crop: { bytes: Buffer.alloc(2 * 1024 * 1024 + 1) } },
    get context() {
      contextReads++;
      throw new Error('Must reject the resource boundary first');
    },
  } as unknown as Mf06FacePreparationResult;
  assert.deepEqual(snapshotWorkFace(oversized, {} as MatchedClaimContext), {
    state: 'UNAVAILABLE',
    reason: 'MEDIA_UNAVAILABLE',
  });
  assert.equal(contextReads, 0);
});
