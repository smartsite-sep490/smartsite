import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Mf06ZoneEntryAssessmentWorkPort } from '../../src/modules/safety/assessments/mf06-zone-entry-assessment-work.port.js';
import { Mf06ClaimContextReader } from '../../src/modules/safety/assessments/mf06-claim-context.reader.js';
import { Mf06JobLeaseService } from '../../src/modules/safety/assessments/mf06-job-lease.service.js';
import { Mf06AssessmentStore } from '../../src/modules/safety/assessments/mf06-assessment-store.service.js';
import {
  sealMainAuthorityArchive,
  type MainAuthorityArchiveContext,
} from '../../src/modules/zones/main-authority-archive-codec.js';
import type { MainQualifiedAuthorityPrepared } from '../../src/modules/zones/main-qualified-authority.reader.js';
import { finalizeMainAuthoritySnapshot } from '../../src/modules/zones/main-authority-read-snapshot.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { storeVersionFixture } from '../support/mf06-store-version.fixture.js';

const owned = createIsolatedTestDatabase();
const db = owned.dataSource;
before(async () => {
  await owned.initialize();
  // Empty lock targets only. No real qualification/cutover is installed or claimed.
  await db.query('CREATE TABLE authorization_history_epoch (placeholder boolean)');
  await db.query('CREATE TABLE authorization_history_control (placeholder boolean)');
});
after(() => owned.dispose());

async function fixture(policy: 'NONE' | 'PROHIBITED_FOR_ALL' | 'AUTHORIZATION_REQUIRED') {
  const f = await storeVersionFixture(db, 'V2', '1.3.0');
  const [job] = await db.query('SELECT * FROM zone_entry_assessment_job WHERE request_id=$1', [
    f.requestId,
  ]);
  const claim = {
    ...f.input.claim,
    attemptCount: job.attempt_count,
    leaseExpiresAt: job.lease_expires_at.toISOString(),
    deadlineAt: job.deadline_at.toISOString(),
  };
  const reader = new Mf06ClaimContextReader(db);
  const context = await reader.readForClaim(claim);
  assert.equal(context.status, 'MATCHED');
  if (context.status !== 'MATCHED') throw Error('Expected owned context');
  const r = context.request;
  const archiveContext: MainAuthorityArchiveContext = {
    siteId: r.siteId,
    zoneId: r.zoneId,
    workerId: null,
    capturedAt: r.capturedAt,
    purpose: r.requestedPurpose,
  };
  const sealed = sealMainAuthorityArchive(
    {
      ...f.archive.payload,
      context: archiveContext,
      sources: f.archive.payload.sources.map((source) => ({
        ...source,
        rows:
          source.sourceKind === 'ZONE_POLICY'
            ? source.rows.map((row) => ({ ...row, restriction_policy: policy }))
            : source.sourceKind === 'CAMERA'
              ? [
                  {
                    id: r.cameraId,
                    site_id: r.siteId,
                    external_id: r.cameraExternalId,
                    status: 'ACTIVE',
                    configuration_version: 1,
                  },
                ]
              : source.sourceKind === 'REGION'
                ? [
                    {
                      id: r.regionId,
                      camera_id: r.cameraId,
                      zone_id: r.zoneId,
                      polygon: [
                        [0, 0],
                        [1, 0],
                        [0, 1],
                      ],
                      coordinate_space: 'NORMALIZED_0_1',
                      version: r.geometryVersion,
                      is_active: true,
                    },
                  ]
                : source.rows,
      })),
    },
    archiveContext,
  );
  assert.equal(sealed.status, 'VALID', JSON.stringify(sealed));
  if (sealed.status !== 'VALID') throw Error('Expected synthetic archive');
  // Injected authority result tests SQL composition, NOT the qualified authority reader.
  const prepared = {
    status: 'QUALIFIED',
    archive: sealed.archive,
    epochId: sealed.archive.payload.baseline.epochId,
    provenance: 'SYNTHETIC_TEST',
    operationalAuthorityCoverageEstablished: false,
    syntheticCutoverMechanicsVerified: true,
    identityEstablished: false,
  } as MainQualifiedAuthorityPrepared;
  let faceCalls = 0;
  let revoke = false;
  const port = new Mf06ZoneEntryAssessmentWorkPort(
    db,
    reader,
    {
      prepareForEvent: async () => prepared,
      revalidate: async () =>
        revoke ? { status: 'UNAVAILABLE', reason: 'AUTHORITY_UNAVAILABLE' } : prepared,
    },
    {
      prepare: async () => {
        faceCalls++;
        return { state: 'UNAVAILABLE', reason: 'PREPARATION_FAILED' } as never;
      },
    },
    {
      revalidate: async () => {
        throw Error('No candidate metadata should be read');
      },
    },
    new Mf06AssessmentStore(db),
  );
  const signal = new AbortController().signal;
  const handle = await port.prepare(claim, signal);
  const finalize = () =>
    finalizeMainAuthoritySnapshot(db, (manager) => port.finalize(manager, claim, handle, signal));
  return {
    ...f,
    claim,
    finalize,
    faceCalls: () => faceCalls,
    revoke: () => {
      revoke = true;
    },
  };
}

for (const [policy, outcome, reason] of [
  ['NONE', 'ALLOWED', 'POLICY_NONE'],
  ['PROHIBITED_FOR_ALL', 'DENIED', 'POLICY_PROHIBITED'],
  ['AUTHORIZATION_REQUIRED', 'UNAVAILABLE', 'IDENTITY_UNAVAILABLE'],
] as const) {
  test(`synthetic authority + real SQL: ${policy} saves one bounded assessment`, async () => {
    const f = await fixture(policy);
    const result = await f.finalize();
    assert.equal(result.state, 'RECORDED');
    if (result.state !== 'RECORDED') throw Error(JSON.stringify(result));
    assert.equal(result.assessment.outcome, outcome);
    assert.equal(result.assessment.reasonCode, reason);
    assert.equal(result.assessment.provenance, 'SYNTHETIC_TEST');
    assert.equal(result.assessment.workerId, null);
    assert.equal(f.faceCalls(), policy === 'AUTHORIZATION_REQUIRED' ? 1 : 0);
    const [counts] = await db.query(
      'SELECT count(*)::int AS n FROM zone_entry_assessment WHERE request_id=$1',
      [f.requestId],
    );
    assert.equal(counts.n, 1);
  });
}

test('cancelled SQL lease after preparation prevents assessment and artifact writes', async () => {
  const f = await fixture('PROHIBITED_FOR_ALL');
  const leases = new Mf06JobLeaseService(db, {
    leaseSeconds: 30,
    maxAttempts: 3,
    retryDelaySeconds: 1,
  });
  assert.equal(await leases.cancel(f.claim), 'CANCELLED');
  const result = await f.finalize();
  assert.deepEqual(result, { state: 'STALE', reason: 'CLAIM_NOT_ACTIVE' });
  const [counts] = await db.query(
    'SELECT (SELECT count(*)::int FROM zone_entry_assessment WHERE request_id=$1) AS assessments, (SELECT count(*)::int FROM zone_entry_authority_artifact WHERE request_id=$1) AS artifacts',
    [f.requestId],
  );
  assert.deepEqual(counts, { assessments: 0, artifacts: 0 });
});

test('authority unavailable on final recheck saves UNAVAILABLE without an authority artifact', async () => {
  const f = await fixture('PROHIBITED_FOR_ALL');
  f.revoke();
  const result = await f.finalize();
  assert.equal(result.state, 'RECORDED');
  if (result.state !== 'RECORDED') throw Error(JSON.stringify(result));
  assert.equal(result.assessment.outcome, 'UNAVAILABLE');
  assert.equal(result.assessment.reasonCode, 'AUTHORITY_UNAVAILABLE');
  assert.equal(result.assessment.authorityArtifact, null);
});
