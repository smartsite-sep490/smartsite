import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Mf06AssessmentStore } from '../../src/modules/safety/assessments/mf06-assessment-store.service.js';
import { Mf06AssessmentWorkerRuntime } from '../../src/modules/safety/assessments/mf06-assessment-worker-runtime.service.js';
import { MF06_WORKPORT_EVALUATOR_VERSION } from '../../src/modules/safety/assessments/mf06-zone-entry-assessment-work.port.js';
import { createTestConfig } from '../support/config.js';
import {
  WORKPORT_SYNTHETIC_REGION_VERSION,
  createWorkPortAuthorityFixture,
  seedWorkPortJobClaim,
} from '../support/mf06-workport-fixture.js';

interface JobStatusRow {
  request_id: string;
  status: string;
  attempt_count: number;
  head_revision: number;
  lease_token: string | null;
  lease_expires_at: Date | null;
  last_error_code: string | null;
}

interface AssessmentRow {
  request_id: string;
  outcome: string;
  reason_code: string;
  provenance: string;
  evaluator_version: string;
  worker_id: string | null;
  profile_revision: string | null;
  frame_sha256: string | null;
  crop_sha256: string | null;
  authority_artifact_id: string | null;
  claim_head_revision: number;
}

let fx: Awaited<ReturnType<typeof createWorkPortAuthorityFixture>> | undefined;
let runtime: Mf06AssessmentWorkerRuntime | undefined;

before(async () => {
  fx = await createWorkPortAuthorityFixture();
});

after(async () => {
  try {
    if (runtime) {
      await runtime.onModuleDestroy();
      runtime = undefined;
    }
  } finally {
    if (fx) {
      await fx.dispose();
      fx = undefined;
    }
  }
});

async function transitionSeededClaimToPending(
  fixture: Awaited<ReturnType<typeof createWorkPortAuthorityFixture>>,
  requestId: string,
): Promise<void> {
  await fixture.db.query(
    `UPDATE zone_entry_assessment_job
        SET status = 'PENDING',
            head_revision = head_revision + 1,
            lease_token = NULL,
            lease_expires_at = NULL,
            last_error_code = NULL,
            next_attempt_at = clock_timestamp() - interval '1 second',
            updated_at = clock_timestamp()
      WHERE request_id = $1 AND status = 'CLAIMED'`,
    [requestId],
  );
  const [row] = (await fixture.db.query(
    `SELECT request_id, status, attempt_count, head_revision, lease_token, lease_expires_at, last_error_code
       FROM zone_entry_assessment_job
      WHERE request_id = $1`,
    [requestId],
  )) as JobStatusRow[];
  assert.ok(row, `Expected seeded job row for ${requestId}`);
  assert.equal(row.status, 'PENDING');
  assert.equal(Number(row.attempt_count), 1);
  assert.equal(Number(row.head_revision), 3);
  assert.equal(row.lease_token, null);
  assert.equal(row.lease_expires_at, null);
  assert.equal(row.last_error_code, null);
}

async function waitForSucceededJobs(
  fixture: Awaited<ReturnType<typeof createWorkPortAuthorityFixture>>,
  requestIds: readonly string[],
  timeoutMs = 8_000,
): Promise<Map<string, JobStatusRow>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = (await fixture.db.query(
      `SELECT request_id, status, attempt_count, head_revision, lease_token, lease_expires_at, last_error_code
         FROM zone_entry_assessment_job
        WHERE request_id = ANY($1::uuid[])`,
      [requestIds],
    )) as JobStatusRow[];
    if (rows.length === requestIds.length && rows.every((row) => row.status === 'SUCCEEDED')) {
      return new Map(rows.map((row) => [row.request_id, row]));
    }
    if (rows.some((row) => row.status === 'FAILED' || row.status === 'CANCELLED')) {
      assert.fail(`Unexpected terminal failure in runtime job rows: ${JSON.stringify(rows)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const latest = await fixture.db.query(
    `SELECT request_id, status, attempt_count, head_revision, last_error_code
       FROM zone_entry_assessment_job
      WHERE request_id = ANY($1::uuid[])`,
    [requestIds],
  );
  assert.fail(`Timed out waiting for runtime jobs to succeed: ${JSON.stringify(latest)}`);
}

test('Mf06AssessmentWorkerRuntime PG integration: claims PENDING jobs across NONE, PROHIBITED_FOR_ALL, and unconfigured AUTHORIZATION_REQUIRED, then drains cleanly before schema dispose', async (t) => {
  assert.ok(fx);
  t.diagnostic(`ownedRuntimeSchema=${fx.schema}`);
  assert.equal(fx.manifest.provenance, 'SYNTHETIC_TEST');

  const seededNone = await seedWorkPortJobClaim(fx.db, {
    siteId: fx.siteId,
    zoneId: fx.zoneNoneId,
    cameraId: fx.cameraId,
    regionId: fx.regionNoneId,
    geometryVersion: WORKPORT_SYNTHETIC_REGION_VERSION,
    capturedAt: fx.capturedAt,
  });
  const seededProhibited = await seedWorkPortJobClaim(fx.db, {
    siteId: fx.siteId,
    zoneId: fx.zoneProhibitedId,
    cameraId: fx.cameraId,
    regionId: fx.regionProhibitedId,
    geometryVersion: WORKPORT_SYNTHETIC_REGION_VERSION,
    capturedAt: fx.capturedAt,
  });
  const seededAuth = await seedWorkPortJobClaim(fx.db, {
    siteId: fx.siteId,
    zoneId: fx.zoneAuthId,
    cameraId: fx.cameraId,
    regionId: fx.regionAuthId,
    geometryVersion: WORKPORT_SYNTHETIC_REGION_VERSION,
    capturedAt: fx.capturedAt,
  });

  const requestIds = [seededNone.requestId, seededProhibited.requestId, seededAuth.requestId];
  for (const requestId of requestIds) {
    await transitionSeededClaimToPending(fx, requestId);
  }

  const config = createTestConfig({
    MF06_WORKER_ENABLED: 'true',
    MF06_CUTOVER_MANIFEST_PATH: fx.config.manifestPath,
    MF06_CUTOVER_MANIFEST_SHA256: fx.config.reviewedManifestSha256,
    MF06_CUTOVER_RELEASE_ROOT: fx.config.releaseRoot,
    MF06_CUTOVER_RELEASE_COMMIT: fx.config.releaseCommit,
  });

  runtime = new Mf06AssessmentWorkerRuntime(fx.db, config);
  await runtime.onModuleInit();

  const jobsByRequest = await waitForSucceededJobs(fx, requestIds);
  for (const requestId of requestIds) {
    const job = jobsByRequest.get(requestId);
    assert.ok(job);
    assert.equal(job.status, 'SUCCEEDED');
    assert.equal(Number(job.attempt_count), 2);
    assert.equal(Number(job.head_revision), 5);
    assert.equal(job.lease_token, null);
    assert.equal(job.lease_expires_at, null);
    assert.equal(job.last_error_code, null);
  }

  const assessments = (await fx.db.query(
    `SELECT request_id, outcome, reason_code, provenance, evaluator_version,
            worker_id, profile_revision, frame_sha256, crop_sha256,
            authority_artifact_id, claim_head_revision
       FROM zone_entry_assessment
      WHERE request_id = ANY($1::uuid[])`,
    [requestIds],
  )) as AssessmentRow[];
  assert.equal(assessments.length, 3);
  const byRequest = new Map(assessments.map((row) => [row.request_id, row]));
  const store = new Mf06AssessmentStore(fx.db);

  for (const [requestId, expectedOutcome, expectedReason] of [
    [seededNone.requestId, 'ALLOWED', 'POLICY_NONE'],
    [seededProhibited.requestId, 'DENIED', 'POLICY_PROHIBITED'],
    [seededAuth.requestId, 'UNAVAILABLE', 'IDENTITY_UNAVAILABLE'],
  ] as const) {
    const row = byRequest.get(requestId);
    assert.ok(row);
    assert.equal(row.outcome, expectedOutcome);
    assert.equal(row.reason_code, expectedReason);
    assert.equal(row.provenance, 'SYNTHETIC_TEST');
    assert.equal(row.evaluator_version, MF06_WORKPORT_EVALUATOR_VERSION);
    assert.equal(row.worker_id, null);
    assert.equal(row.profile_revision, null);
    assert.equal(row.frame_sha256, null);
    assert.equal(row.crop_sha256, null);
    assert.ok(row.authority_artifact_id);
    assert.equal(Number(row.claim_head_revision), 4);
    const replayed = await store.replay(requestId, requestId, fx.siteId);
    assert.ok(replayed);
    assert.equal(replayed.outcome, expectedOutcome);
    assert.equal(replayed.reasonCode, expectedReason);
    assert.equal(replayed.provenance, 'SYNTHETIC_TEST');
    assert.ok(replayed.authorityArtifact?.sha256);
  }

  // Drain and stop lifecycle owner before schema disposal.
  await runtime.onModuleDestroy();
  runtime = undefined;
});
