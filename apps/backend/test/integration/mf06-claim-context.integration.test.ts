import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Mf06ClaimContextReader } from '../../src/modules/safety/assessments/mf06-claim-context.reader.js';
import type { Mf06JobClaim } from '../../src/modules/safety/assessments/mf06-job-lease.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { storeVersionFixture } from '../support/mf06-store-version.fixture.js';

const isolated = createIsolatedTestDatabase();
const db = isolated.dataSource;
const reader = new Mf06ClaimContextReader(db);

before(() => isolated.initialize());
after(() => isolated.dispose());

test('real PG canonical70 claim context binds active job, rejects wrong token/revision without mutation, and resists pg_temp shadow', async () => {
  const { input, requestId } = await storeVersionFixture(db, 'V2', '1.2.0');
  const [jobRow] = (await db.query(
    'SELECT status, attempt_count, head_revision, lease_token, lease_expires_at, deadline_at FROM zone_entry_assessment_job WHERE request_id = $1',
    [requestId],
  )) as {
    status: string;
    attempt_count: number;
    head_revision: number;
    lease_token: string;
    lease_expires_at: Date;
    deadline_at: Date;
  }[];
  assert.ok(jobRow);

  const claim: Mf06JobClaim = {
    requestId: input.claim.requestId,
    leaseToken: input.claim.leaseToken,
    headRevision: input.claim.headRevision,
    attemptCount: jobRow.attempt_count,
    leaseExpiresAt: jobRow.lease_expires_at.toISOString(),
    deadlineAt: jobRow.deadline_at.toISOString(),
  };

  const matched = await reader.readForClaim(claim);
  assert.equal(matched.status, 'MATCHED');
  if (matched.status !== 'MATCHED') return;

  assert.equal(matched.siteId, input.siteId);
  assert.equal(matched.request.siteId, input.siteId);
  assert.equal(matched.request.requestId, requestId);
  assert.equal(matched.subject?.trackId, 7);
  assert.equal(matched.frameReference?.sequenceNumber, 7);
  assert.equal(matched.frameReference?.sha256, 'a'.repeat(64));
  assert.equal(matched.frameReference?.payloadHash, matched.request.payloadHash);
  assert.match(matched.contextDigest, /^[0-9a-f]{64}$/);
  assert.match(matched.claimContextDigest, /^[0-9a-f]{64}$/);
  assert.equal('workerId' in matched, false);
  assert.equal('outcome' in matched, false);

  const wrongToken = await reader.readForClaim({ ...claim, leaseToken: randomUUID() });
  assert.deepEqual(wrongToken, { status: 'UNAVAILABLE', reason: 'CLAIM_NOT_ACTIVE' });

  const wrongRevision = await reader.readForClaim({ ...claim, headRevision: 1 });
  assert.deepEqual(wrongRevision, { status: 'UNAVAILABLE', reason: 'CLAIM_NOT_ACTIVE' });

  const [unchangedJob] = (await db.query(
    'SELECT status, attempt_count, head_revision, lease_token FROM zone_entry_assessment_job WHERE request_id = $1',
    [requestId],
  )) as {
    status: string;
    attempt_count: number;
    head_revision: number;
    lease_token: string;
  }[];
  assert.deepEqual(unchangedJob, {
    status: 'CLAIMED',
    attempt_count: 1,
    head_revision: 2,
    lease_token: input.claim.leaseToken,
  });

  // Temporary tables in pg_temp must not shadow selected-schema relations
  await db.query(
    'CREATE TEMP TABLE IF NOT EXISTS zone_entry_assessment_job (LIKE zone_entry_assessment_job)',
  );
  await db.query(
    'CREATE TEMP TABLE IF NOT EXISTS zone_entry_assessment_request (LIKE zone_entry_assessment_request)',
  );
  const afterTempShadow = await reader.readForClaim(claim);
  assert.deepEqual(afterTempShadow, matched);
});
