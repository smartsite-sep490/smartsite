import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Mf06RetryableWorkError } from '../../src/modules/safety/assessments/mf06-assessment-worker.service.js';
import { Mf06ZoneEntryAssessmentWorkPort } from '../../src/modules/safety/assessments/mf06-zone-entry-assessment-work.port.js';
import { after, before, test } from 'node:test';
import { Mf06AssessmentStore } from '../../src/modules/safety/assessments/mf06-assessment-store.service.js';
import {
  Mf06CandidateMetadataService,
  type Mf06CandidateProfileReader,
} from '../../src/modules/safety/assessments/mf06-candidate-metadata.service.js';
import { Mf06ClaimContextReader } from '../../src/modules/safety/assessments/mf06-claim-context.reader.js';
import type {
  Mf06FacePreparation,
  Mf06FacePreparationResult,
} from '../../src/modules/safety/assessments/mf06-face-preparation.js';
import type { Mf06JobClaim } from '../../src/modules/safety/assessments/mf06-job-lease.service.js';
// NOTE FOR ROOT EXECUTION IN T:
// - When placed at `apps/backend/test/integration/mf06-workport.integration.test.ts`:
//   * importWorkPort from `../../src/modules/safety/assessments/mf06-zone-entry-assessment-work.port.js` (or candidate location)
//   * import helpers from `../support/mf06-workport-fixture.js` (from `helper-v1.ts`)

import {
  WORKPORT_SYNTHETIC_REGION_VERSION,
  assertExactSnapshotTablesShareLocked,
  buildCorrelatedFacePreparationResult,
  createWorkPortAuthorityFixture,
  rotateJobLeaseInDb,
  seedWorkPortJobClaim,
} from '../support/mf06-workport-fixture.js';

let fx: Awaited<ReturnType<typeof createWorkPortAuthorityFixture>>;

before(async () => {
  fx = await createWorkPortAuthorityFixture();
});

after(async () => {
  if (fx) await fx.dispose();
});

test('WorkPort PG integration: qualified NONE/PROHIBITED skip Face, AUTHORIZATION_REQUIRED stays fail-closed UNAVAILABLE with deep-immutable Face state, and scope/lease edges fail closed', async (t) => {
  t.diagnostic(`ownedWorkPortSchema=${fx.schema}`);

  const claimContextReader = new Mf06ClaimContextReader(fx.db);
  const store = new Mf06AssessmentStore(fx.db);

  let facePrepareCalls = 0;
  let profileLookupCalls = 0;
  let nextFaceHandler:
    ((claim: Mf06JobClaim, signal: AbortSignal) => Promise<Mf06FacePreparationResult>) | null =
    null;

  const syntheticWorkerId = randomUUID();
  const syntheticProfileId = randomUUID();
  const syntheticProfileRevision = randomUUID();
  const syntheticConsentId = randomUUID();

  const profileReader: Mf06CandidateProfileReader = {
    findCurrentForSafety: async (manager, siteId, reference, lockForFinalization) => {
      profileLookupCalls += 1;
      assert.equal(lockForFinalization, true);
      assert.equal(siteId.toLowerCase(), fx.siteId.toLowerCase());
      assert.equal(reference.profileRevision.toLowerCase(), syntheticProfileRevision.toLowerCase());
      await assertExactSnapshotTablesShareLocked(manager, fx.schema);
      return {
        state: 'ELIGIBLE_METADATA',
        siteId: fx.siteId,
        workerId: syntheticWorkerId,
        profileId: syntheticProfileId,
        profileRevision: syntheticProfileRevision,
        consentId: syntheticConsentId,
      };
    },
  };

  const candidateMetadata = new Mf06CandidateMetadataService(profileReader, 'SYNTHETIC_TEST');

  const facePreparation: Pick<Mf06FacePreparation, 'prepare'> = {
    prepare: async (claim, signal) => {
      facePrepareCalls += 1;
      assert(nextFaceHandler, 'Unexpected facePreparation.prepare invocation');
      return nextFaceHandler(claim, signal);
    },
  };

  const workPort = new Mf06ZoneEntryAssessmentWorkPort(
    fx.db,
    claimContextReader,
    {
      prepareForEvent: async (context) => {
        const result = await fx.reader.prepareForEvent(context);
        t.diagnostic(
          'authorityPrepare=' +
            JSON.stringify({
              status: result.status,
              reason: result.status === 'UNAVAILABLE' ? result.reason : null,
            }),
        );
        return result;
      },
      revalidate: async (manager, context, prepared) => {
        const result = await fx.reader.revalidate(manager, context, prepared);
        t.diagnostic(
          'authorityRevalidate=' +
            JSON.stringify({
              status: result.status,
              reason: result.status === 'UNAVAILABLE' ? result.reason : null,
            }),
        );
        return result;
      },
    },
    facePreparation,
    candidateMetadata,
    store,
  );
  const signal = new AbortController().signal;

  // Case 1: Qualified NONE policy -> ALLOWED / POLICY_NONE without invoking FacePreparation.
  {
    const seeded = await seedWorkPortJobClaim(fx.db, {
      siteId: fx.siteId,
      zoneId: fx.zoneNoneId,
      cameraId: fx.cameraId,
      regionId: fx.regionNoneId,
      geometryVersion: WORKPORT_SYNTHETIC_REGION_VERSION,
      capturedAt: fx.capturedAt,
    });
    const matched = await claimContextReader.readForClaim(seeded.claim, signal);
    assert.equal(matched.status, 'MATCHED');

    facePrepareCalls = 0;
    const prepared = await workPort.prepare(seeded.claim, signal);
    assert.equal(facePrepareCalls, 0, 'NONE policy must not invoke FacePreparation');

    const res = await fx.db.transaction('SERIALIZABLE', async (manager) => {
      const finalized = await workPort.finalize(manager, seeded.claim, prepared, signal);
      await assertExactSnapshotTablesShareLocked(manager, fx.schema);
      return finalized;
    });
    assert.equal(res.state, 'RECORDED');
    if (res.state !== 'RECORDED') return;
    t.diagnostic(
      'noneResult=' +
        JSON.stringify({ outcome: res.assessment.outcome, reason: res.assessment.reasonCode }),
    );
    assert.equal(res.assessment.outcome, 'ALLOWED');
    assert.equal(res.assessment.reasonCode, 'POLICY_NONE');
    assert.equal(res.assessment.provenance, 'SYNTHETIC_TEST');
    assert.equal(res.assessment.workerId, null);
    assert.equal(res.assessment.profileRevision, null);
    assert.equal(res.assessment.frameSha256, null);
    assert.equal(res.assessment.cropSha256, null);
    assert.ok(res.assessment.authorityArtifact?.sha256);

    const replayed = await store.replay(seeded.requestId, seeded.requestId, fx.siteId);
    assert.deepEqual(replayed, res.assessment);
  }

  // Case 2: Qualified PROHIBITED_FOR_ALL policy -> DENIED / POLICY_PROHIBITED without invoking FacePreparation.
  {
    const seeded = await seedWorkPortJobClaim(fx.db, {
      siteId: fx.siteId,
      zoneId: fx.zoneProhibitedId,
      cameraId: fx.cameraId,
      regionId: fx.regionProhibitedId,
      geometryVersion: WORKPORT_SYNTHETIC_REGION_VERSION,
      capturedAt: fx.capturedAt,
    });
    const matched = await claimContextReader.readForClaim(seeded.claim, signal);
    assert.equal(matched.status, 'MATCHED');

    facePrepareCalls = 0;
    const prepared = await workPort.prepare(seeded.claim, signal);
    assert.equal(facePrepareCalls, 0, 'PROHIBITED_FOR_ALL policy must not invoke FacePreparation');

    const res = await fx.db.transaction('SERIALIZABLE', async (manager) => {
      const finalized = await workPort.finalize(manager, seeded.claim, prepared, signal);
      await assertExactSnapshotTablesShareLocked(manager, fx.schema);
      return finalized;
    });
    assert.equal(res.state, 'RECORDED');
    if (res.state !== 'RECORDED') return;
    assert.equal(res.assessment.outcome, 'DENIED');
    assert.equal(res.assessment.reasonCode, 'POLICY_PROHIBITED');
    assert.equal(res.assessment.provenance, 'SYNTHETIC_TEST');
    assert.equal(res.assessment.workerId, null);
    assert.equal(res.assessment.profileRevision, null);
    assert.ok(res.assessment.authorityArtifact?.sha256);
  }

  // Case 3: Qualified AUTHORIZATION_REQUIRED invokes Face & real Mf06CandidateMetadataService,
  // preserves deep immutability against caller mutation, and stays fail-closed UNAVAILABLE (IDENTITY_UNAVAILABLE).
  {
    const seeded = await seedWorkPortJobClaim(fx.db, {
      siteId: fx.siteId,
      zoneId: fx.zoneAuthId,
      cameraId: fx.cameraId,
      regionId: fx.regionAuthId,
      geometryVersion: WORKPORT_SYNTHETIC_REGION_VERSION,
      capturedAt: fx.capturedAt,
    });
    const callerMutableCropBytes = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02]);
    let callerMutableResponseRef: Record<string, unknown> | null = null;
    let expectedCropSha256 = '';

    nextFaceHandler = async (claim, innerSignal) => {
      const context = await claimContextReader.readForClaim(claim, innerSignal);
      assert.equal(context.status, 'MATCHED');
      if (context.status !== 'MATCHED') throw new Error('Expected MATCHED context');
      const built = buildCorrelatedFacePreparationResult(
        context,
        callerMutableCropBytes,
        seeded.frameSha256,
        syntheticProfileRevision,
      );
      callerMutableResponseRef = built.callerMutableResponse;
      expectedCropSha256 = built.cropSha256;
      return built.faceResult;
    };

    facePrepareCalls = 0;
    profileLookupCalls = 0;
    const prepared = await workPort.prepare(seeded.claim, signal);
    assert.equal(facePrepareCalls, 1, 'AUTHORIZATION_REQUIRED must invoke FacePreparation');

    // Mutate caller-owned Buffer and response object after prepare() to prove WorkPort privately copied/froze them.
    callerMutableCropBytes[0] = callerMutableCropBytes[0]! ^ 0xff;
    assert(callerMutableResponseRef);
    (callerMutableResponseRef as Record<string, unknown>).state = 'UNAVAILABLE';

    const res = await fx.db.transaction('SERIALIZABLE', async (manager) => {
      const finalized = await workPort.finalize(manager, seeded.claim, prepared, signal);
      await assertExactSnapshotTablesShareLocked(manager, fx.schema);
      return finalized;
    });
    assert.equal(
      profileLookupCalls,
      1,
      'Expected real Mf06CandidateMetadataService.revalidate to reach profileReader',
    );
    assert.equal(res.state, 'RECORDED');
    if (res.state !== 'RECORDED') return;
    assert.equal(res.assessment.outcome, 'UNAVAILABLE');
    assert.equal(res.assessment.reasonCode, 'IDENTITY_UNAVAILABLE');
    assert.equal(res.assessment.provenance, 'SYNTHETIC_TEST');
    assert.equal(res.assessment.workerId, null);
    assert.equal(res.assessment.profileRevision, null);
    assert.equal(res.assessment.frameSha256, seeded.frameSha256);
    assert.equal(res.assessment.cropSha256, expectedCropSha256);
    assert.ok(res.assessment.authorityArtifact?.sha256);
  }

  // Case 4: Region version mismatch against archived REGION rows -> AUTHORITY_UNAVAILABLE without FacePreparation.
  {
    const seededMismatch = await seedWorkPortJobClaim(fx.db, {
      siteId: fx.siteId,
      zoneId: fx.zoneAuthId,
      cameraId: fx.cameraId,
      regionId: fx.regionAuthId,
      geometryVersion: WORKPORT_SYNTHETIC_REGION_VERSION + 1,
      capturedAt: fx.capturedAt,
    });
    const matched = await claimContextReader.readForClaim(seededMismatch.claim, signal);
    assert.equal(matched.status, 'MATCHED');

    facePrepareCalls = 0;
    const prepared = await workPort.prepare(seededMismatch.claim, signal);
    assert.equal(facePrepareCalls, 0, 'Authority scope mismatch must not invoke FacePreparation');

    const res = await fx.db.transaction('SERIALIZABLE', async (manager) => {
      const finalized = await workPort.finalize(manager, seededMismatch.claim, prepared, signal);
      await assertExactSnapshotTablesShareLocked(manager, fx.schema);
      return finalized;
    });
    assert.equal(res.state, 'RECORDED');
    if (res.state !== 'RECORDED') return;
    assert.equal(res.assessment.outcome, 'UNAVAILABLE');
    assert.equal(res.assessment.reasonCode, 'AUTHORITY_UNAVAILABLE');
    assert.equal(res.assessment.provenance, 'UNAVAILABLE');
    assert.equal(res.assessment.authorityArtifact, null);
  }

  // Case 5: Forged handle, rotated lease with stale handle, and superseded claim -> STALE / fresh lease succeeds.
  {
    const seeded = await seedWorkPortJobClaim(fx.db, {
      siteId: fx.siteId,
      zoneId: fx.zoneNoneId,
      cameraId: fx.cameraId,
      regionId: fx.regionNoneId,
      geometryVersion: WORKPORT_SYNTHETIC_REGION_VERSION,
      capturedAt: fx.capturedAt,
    });
    const prepared1 = await workPort.prepare(seeded.claim, signal);

    const forgedRes = await fx.db.transaction('SERIALIZABLE', (manager) =>
      workPort.finalize(manager, seeded.claim, { ...(prepared1 as object) }, signal),
    );
    assert.deepEqual(forgedRes, { state: 'UNAVAILABLE', reason: 'UNTRUSTED_PREPARED_HANDLE' });
    assert.equal(await store.replay(seeded.requestId, seeded.requestId, fx.siteId), null);

    const newClaim = await rotateJobLeaseInDb(fx.db, seeded.requestId);
    assert.deepEqual(await claimContextReader.readForClaim(seeded.claim, signal), {
      status: 'UNAVAILABLE',
      reason: 'CLAIM_NOT_ACTIVE',
    });

    const staleHandleOnNewClaim = await fx.db.transaction('SERIALIZABLE', (manager) =>
      workPort.finalize(manager, newClaim, prepared1, signal),
    );
    assert.deepEqual(staleHandleOnNewClaim, {
      state: 'UNAVAILABLE',
      reason: 'UNTRUSTED_PREPARED_HANDLE',
    });

    const staleClaimPrepared = await workPort.prepare(seeded.claim, signal);
    const staleClaimFinalized = await fx.db.transaction('SERIALIZABLE', (manager) =>
      workPort.finalize(manager, seeded.claim, staleClaimPrepared, signal),
    );
    assert.deepEqual(staleClaimFinalized, { state: 'STALE', reason: 'CLAIM_NOT_ACTIVE' });
    assert.equal(await store.replay(seeded.requestId, seeded.requestId, fx.siteId), null);

    const prepared2 = await workPort.prepare(newClaim, signal);
    const freshFinalized = await fx.db.transaction('SERIALIZABLE', (manager) =>
      workPort.finalize(manager, newClaim, prepared2, signal),
    );
    assert.equal(freshFinalized.state, 'RECORDED');
    if (freshFinalized.state === 'RECORDED') {
      assert.equal(freshFinalized.assessment.outcome, 'ALLOWED');
      assert.equal(freshFinalized.assessment.reasonCode, 'POLICY_NONE');
    }
  }
  // An adapter abort without outer cancellation must not mint a reusable prepared result.
  {
    const seeded = await seedWorkPortJobClaim(fx.db, {
      siteId: fx.siteId,
      zoneId: fx.zoneAuthId,
      cameraId: fx.cameraId,
      regionId: fx.regionAuthId,
      capturedAt: fx.capturedAt,
    });
    nextFaceHandler = async () => ({ state: 'UNAVAILABLE', reason: 'ABORTED' });
    await assert.rejects(
      workPort.prepare(seeded.claim, signal),
      (error) => error instanceof Mf06RetryableWorkError && error.code === 'RESOLVER_UNAVAILABLE',
    );
    assert.equal(await store.replay(seeded.requestId, seeded.requestId, fx.siteId), null);
  }
  // A real post-fence row-lock timeout rolls back without appending an assessment.
  {
    const seeded = await seedWorkPortJobClaim(fx.db, {
      siteId: fx.siteId,
      zoneId: fx.zoneNoneId,
      cameraId: fx.cameraId,
      regionId: fx.regionNoneId,
      capturedAt: fx.capturedAt,
    });
    const prepared = await workPort.prepare(seeded.claim, signal);
    const blocker = fx.db.createQueryRunner();
    await blocker.connect();
    await blocker.startTransaction();
    try {
      await blocker.query(
        'SELECT request_id FROM zone_entry_assessment_request WHERE request_id=$1 FOR UPDATE',
        [seeded.requestId],
      );
      await assert.rejects(
        fx.db.transaction('SERIALIZABLE', (manager) =>
          workPort.finalize(manager, seeded.claim, prepared, signal),
        ),
        (error) => {
          const failure = error as { code?: string; driverError?: { code?: string } };
          return (failure.driverError?.code ?? failure.code) === '55P03';
        },
      );
    } finally {
      if (blocker.isTransactionActive) await blocker.rollbackTransaction();
      await blocker.release();
    }
    assert.equal(await store.replay(seeded.requestId, seeded.requestId, fx.siteId), null);
  }
  // Post-claim cutover release invalidation (RELEASE_UNAVAILABLE) rejects as retryable DATABASE_UNAVAILABLE without finalize or assessment row.
  {
    const seeded = await seedWorkPortJobClaim(fx.db, {
      siteId: fx.siteId,
      zoneId: fx.zoneNoneId,
      cameraId: fx.cameraId,
      regionId: fx.regionNoneId,
      geometryVersion: WORKPORT_SYNTHETIC_REGION_VERSION,
      capturedAt: fx.capturedAt,
    });
    const releaseUnavailableWorkPort = new Mf06ZoneEntryAssessmentWorkPort(
      fx.db,
      claimContextReader,
      {
        prepareForEvent: async () => ({
          status: 'UNAVAILABLE' as const,
          reason: 'RELEASE_UNAVAILABLE',
        }),
        revalidate: (manager, context, prepared) =>
          fx.reader.revalidate(manager, context, prepared),
      },
      facePreparation,
      candidateMetadata,
      store,
    );
    facePrepareCalls = 0;
    profileLookupCalls = 0;
    await assert.rejects(
      releaseUnavailableWorkPort.prepare(seeded.claim, signal),
      (error) => error instanceof Mf06RetryableWorkError && error.code === 'DATABASE_UNAVAILABLE',
    );
    assert.equal(facePrepareCalls, 0);
    assert.equal(profileLookupCalls, 0);
    const rows = (await fx.db.query(
      `SELECT COUNT(*)::int AS count FROM "${fx.schema.replaceAll('"', '""')}"."zone_entry_assessment" WHERE request_id = $1`,
      [seeded.requestId],
    )) as { count: number }[];
    assert.equal(Number(rows[0]?.count ?? -1), 0);
  }
});
