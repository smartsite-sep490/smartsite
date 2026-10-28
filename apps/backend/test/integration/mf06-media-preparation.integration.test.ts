import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import sharp from 'sharp';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { storeVersionFixture } from '../support/mf06-store-version.fixture.js';
import { Mf06ClaimContextReader } from '../../src/modules/safety/assessments/mf06-claim-context.reader.js';
import { prepareMf06FaceMedia } from '../../src/modules/safety/assessments/mf06-media-preparation.js';
import { Mf06AssessmentStore } from '../../src/modules/safety/assessments/mf06-assessment-store.service.js';

const isolated = createIsolatedTestDatabase();
const db = isolated.dataSource;
before(() => isolated.initialize());
after(() => isolated.dispose());

for (const expireAfterPreparation of [false, true]) {
  test(`real claim and JPEG preparation ${expireAfterPreparation ? 'cannot append after lease expiry' : 'append an unavailable result without identity'}`, async (t) => {
    const bytes = await sharp({
      create: { width: 640, height: 480, channels: 3, background: '#346789' },
    })
      .jpeg()
      .toBuffer();
    const frameSha256 = createHash('sha256').update(bytes).digest('hex');
    const { input, requestId } = await storeVersionFixture(db, 'V2', '1.3.0', frameSha256);
    if (expireAfterPreparation) {
      await db.query(
        "UPDATE zone_entry_assessment_job SET lease_expires_at=statement_timestamp()+interval '2 seconds',head_revision=head_revision+1 WHERE request_id=$1",
        [requestId],
      );
      input.claim.headRevision += 1;
    }
    const [job] = await db.query(
      'SELECT attempt_count,lease_expires_at,deadline_at FROM zone_entry_assessment_job WHERE request_id=$1',
      [requestId],
    );
    const claim = {
      ...input.claim,
      attemptCount: job.attempt_count,
      leaseExpiresAt: job.lease_expires_at.toISOString(),
      deadlineAt: job.deadline_at.toISOString(),
    };
    const reader = new Mf06ClaimContextReader(db);
    const context = await reader.readForClaim(claim);
    assert.equal(context.status, 'MATCHED');
    if (context.status !== 'MATCHED' || !context.frameReference)
      throw new Error('Missing frame context');
    const base = process.platform === 'win32' ? 'D:/Ky9-FPT/SmartSiteData/temp' : tmpdir();
    await mkdir(base, { recursive: true });
    const root = await mkdtemp(join(base, 'mf06-pg-media-'));
    t.diagnostic(`Synthetic JPEG retained at ${root}`);
    const reference = context.frameReference;
    await writeFile(
      join(
        root,
        `${reference.streamSessionId}_${reference.sequenceNumber}_${reference.eventId}.jpg`,
      ),
      bytes,
    );
    const prepared = await prepareMf06FaceMedia(
      context,
      root,
      randomUUID(),
      'SYNTHETIC_NO_FACE_MODEL',
      new AbortController().signal,
    );
    assert.equal(prepared.state, 'BOUND_UNATTESTED');
    if (prepared.state !== 'BOUND_UNATTESTED') throw new Error('Missing prepared crop');
    assert.equal(prepared.invocation.requestId, requestId);
    assert.equal(prepared.invocation.frameSha256, frameSha256);
    assert.equal(
      prepared.crop.cropSha256,
      createHash('sha256').update(prepared.crop.bytes).digest('hex'),
    );
    const decoded = await sharp(prepared.crop.bytes).metadata();
    assert.equal(decoded.width, 192);
    assert.equal(decoded.height, 336);
    if (expireAfterPreparation) {
      await db.query(
        'SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM lease_expires_at-clock_timestamp()))+0.02) FROM zone_entry_assessment_job WHERE request_id=$1',
        [requestId],
      );
      assert.deepEqual(await reader.readForClaim(claim), {
        status: 'UNAVAILABLE',
        reason: 'CLAIM_NOT_ACTIVE',
      });
    }
    const result = await new Mf06AssessmentStore(db).finalize({
      ...input,
      reasonCode: 'IDENTITY_UNAVAILABLE',
      authorityArtifact: null,
      frameSha256,
      cropSha256: prepared.crop.cropSha256,
    });
    assert.equal(result.state, expireAfterPreparation ? 'STALE' : 'RECORDED');
    const [{ count }] = await db.query(
      'SELECT count(*)::int AS count FROM zone_entry_assessment WHERE request_id=$1',
      [requestId],
    );
    assert.equal(count, expireAfterPreparation ? 0 : 1);
    if (result.state === 'RECORDED') {
      assert.equal(result.assessment.outcome, 'UNAVAILABLE');
      assert.equal(result.assessment.workerId, null);
      assert.equal(result.assessment.frameSha256, frameSha256);
    }
  });
}
