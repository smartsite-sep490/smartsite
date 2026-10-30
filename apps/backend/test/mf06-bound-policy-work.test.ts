import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { EntityManager } from 'typeorm';
import { MAIN_AUTHORITY_V2_SOURCES } from '../src/common/configuration/main-team-authority-sources.js';
import {
  MAIN_AUTHORITY_ARCHIVE_FORMAT_V2,
  sealMainAuthorityArchive,
} from '../src/modules/zones/main-authority-archive-codec.js';
import type { Mf06AssessmentWorkPort } from '../src/modules/safety/assessments/mf06-assessment-worker.service.js';

async function fixture(policy = 'PROHIBITED_FOR_ALL', environment = 'test', upperScope = false) {
  const { Mf06BoundPolicyAssessmentWorkPort } = await import(
    new URL(
      '../src/modules/safety/assessments/mf06-bound-policy-assessment-work.js',
      import.meta.url,
    ).href
  );
  const siteId = randomUUID(),
    zoneId = randomUUID(),
    requestId = randomUUID();
  const request = {
    requestId,
    siteId,
    zoneId,
    capturedAt: '2026-10-30T00:00:01.000Z',
    requestedPurpose: 'INITIAL_OBSERVATION_ASSESSMENT',
    storedBindingHash: 'b'.repeat(64),
    subjectBindingStatus: 'BOUND',
    executionAdmission: { classification: 'LIVE' },
  };
  const context = {
    status: 'MATCHED',
    siteId,
    request,
    contextDigest: 'c'.repeat(64),
    claimContextDigest: 'd'.repeat(64),
    subject: { capturedAt: request.capturedAt },
  };
  const authorityContext = {
    siteId,
    zoneId,
    workerId: null,
    capturedAt: request.capturedAt,
    purpose: request.requestedPurpose,
  };
  const sealed = sealMainAuthorityArchive(
    {
      version: MAIN_AUTHORITY_ARCHIVE_FORMAT_V2,
      context: authorityContext,
      archivedAt: '2026-10-30T00:00:02.000Z',
      baseline: {
        epochId: randomUUID(),
        capturedAt: '2026-10-30T00:00:00.000Z',
        declaredWriterManifestHash: 'a'.repeat(64),
        sourceRegistryHash: 'b'.repeat(64),
        snapshotHash: 'c'.repeat(64),
      },
      sources: MAIN_AUTHORITY_V2_SOURCES.map(([sourceKind, tableName, fields]) => ({
        sourceKind,
        tableName,
        fields,
        rows:
          sourceKind === 'SITE'
            ? [{ id: siteId, access_policy_version: 1 }]
            : sourceKind === 'ZONE_POLICY'
              ? [
                  {
                    id: upperScope ? zoneId.toUpperCase() : zoneId,
                    site_id: upperScope ? siteId.toUpperCase() : siteId,
                    restriction_policy: policy,
                    required_ppe: [],
                    configuration_locked: true,
                  },
                ]
              : [],
      })),
    },
    authorityContext as never,
  );
  assert.equal(sealed.status, 'VALID');
  if (sealed.status !== 'VALID') throw Error('Invalid owned archive fixture');
  const qualified = {
    status: 'QUALIFIED',
    archive: sealed.archive,
    epochId: sealed.archive.payload.baseline.epochId,
    provenance: 'SYNTHETIC_TEST',
    operationalAuthorityCoverageEstablished: false,
    syntheticCutoverMechanicsVerified: true,
  };
  let current = context;
  let preparedAuthority: unknown = qualified;
  let checkedAuthority: unknown = qualified;
  const manager = {} as EntityManager;
  const inputs: Record<string, unknown>[] = [];
  let authorityCalls = 0;
  const work = new Mf06BoundPolicyAssessmentWorkPort(
    {
      readForClaim: async () => context,
      revalidateForClaim: async (m: EntityManager) => {
        assert.equal(m, manager);
        return current;
      },
    },
    {
      prepareForEvent: async (c: unknown) => {
        assert.deepEqual(c, authorityContext);
        return preparedAuthority;
      },
      revalidate: async (m: EntityManager, input: Record<string, unknown>, p: unknown) => {
        assert.equal(m, manager);
        assert.equal(p, qualified);
        assert.equal(input.epochId, qualified.epochId);
        authorityCalls++;
        return checkedAuthority;
      },
    },
    {
      finalizeInTransaction: async (m: EntityManager, input: Record<string, unknown>) => {
        assert.equal(m, manager);
        inputs.push(input);
        return { state: 'RECORDED', assessment: {} };
      },
    },
    environment,
  ) as Mf06AssessmentWorkPort;
  const claim = {
    requestId,
    leaseToken: randomUUID(),
    headRevision: 2,
    attemptCount: 1,
    leaseExpiresAt: '2026-10-30T00:01:00Z',
    deadlineAt: '2026-10-30T00:02:00Z',
  };
  const signal = new AbortController().signal;
  return {
    work,
    claim,
    signal,
    manager,
    inputs,
    context,
    qualified,
    setCurrent: (c: typeof context) => {
      current = c;
    },
    setPreparedAuthority: (v: unknown) => {
      preparedAuthority = v;
    },
    setCheckedAuthority: (v: unknown) => {
      checkedAuthority = v;
    },
    authorityCalls: () => authorityCalls,
  };
}

for (const [policy, outcome, reason] of [
  ['NONE', 'ALLOWED', 'POLICY_NONE'],
  ['PROHIBITED_FOR_ALL', 'DENIED', 'POLICY_PROHIBITED'],
  ['AUTHORIZATION_REQUIRED', 'UNAVAILABLE', 'IDENTITY_UNAVAILABLE'],
])
  test(`bound policy WorkPort ${policy} preserves identity boundary`, async () => {
    const f = await fixture(policy);
    assert.equal(f.work.finalizationScope, 'AUTHORITY_SNAPSHOT');
    const p = await f.work.prepare(f.claim, f.signal);
    assert.equal((await f.work.finalize(f.manager, f.claim, p, f.signal)).state, 'RECORDED');
    assert.equal(f.inputs[0]!.outcome, outcome);
    assert.equal(f.inputs[0]!.reasonCode, reason);
    assert.equal(f.inputs[0]!.workerId, null);
    assert.equal(f.inputs[0]!.profileRevision, null);
    assert.deepEqual(f.inputs[0]!.authorityArtifact, f.qualified.archive);
  });

test('changed claim snapshot or copied preparation handle cannot append', async () => {
  const f = await fixture();
  const p = await f.work.prepare(f.claim, f.signal);
  assert.equal(
    (await f.work.finalize(f.manager, f.claim, { ...(p as object) }, f.signal)).state,
    'UNAVAILABLE',
  );
  f.setCurrent({ ...f.context, claimContextDigest: 'e'.repeat(64) });
  assert.equal((await f.work.finalize(f.manager, f.claim, p, f.signal)).state, 'UNAVAILABLE');
  assert.equal(f.inputs.length, 0);
  assert.equal(f.authorityCalls(), 0);
});

test('unavailable or revalidation-drifted history records unavailable, never policy denial', async () => {
  const f = await fixture();
  f.setCheckedAuthority({ status: 'UNAVAILABLE', reason: 'CUTOVER_STATE_DRIFT' });
  const p = await f.work.prepare(f.claim, f.signal);
  await f.work.finalize(f.manager, f.claim, p, f.signal);
  assert.equal(f.inputs[0]!.outcome, 'UNAVAILABLE');
  assert.equal(f.inputs[0]!.reasonCode, 'AUTHORITY_UNAVAILABLE');
  assert.equal(f.inputs[0]!.authorityArtifact, null);
});

test('synthetic qualification cannot produce a production policy result', async () => {
  const f = await fixture('PROHIBITED_FOR_ALL', 'production');
  const p = await f.work.prepare(f.claim, f.signal);
  await f.work.finalize(f.manager, f.claim, p, f.signal);
  assert.equal(f.inputs[0]!.outcome, 'UNAVAILABLE');
  assert.equal(f.inputs[0]!.authorityArtifact, null);
});

test('microsecond precision loss is refused before historical policy lookup', async () => {
  const f = await fixture();
  f.context.subject.capturedAt = '2026-10-30T00:00:01.000001Z';
  const p = await f.work.prepare(f.claim, f.signal);
  assert.equal((await f.work.finalize(f.manager, f.claim, p, f.signal)).state, 'UNAVAILABLE');
  assert.equal(f.inputs.length, 0);
});

test('database unavailability requests retry rather than recording an unavailable policy', async () => {
  const f = await fixture();
  f.setPreparedAuthority({ status: 'UNAVAILABLE', reason: 'DATABASE_UNAVAILABLE' });
  await assert.rejects(f.work.prepare(f.claim, f.signal), /DATABASE_UNAVAILABLE/);
  assert.equal(f.inputs.length, 0);
});

test('canonical UUID scope matching accepts uppercase archived Zone identifiers', async () => {
  const f = await fixture('PROHIBITED_FOR_ALL', 'test', true);
  const p = await f.work.prepare(f.claim, f.signal);
  await f.work.finalize(f.manager, f.claim, p, f.signal);
  assert.equal(f.inputs[0]!.reasonCode, 'POLICY_PROHIBITED');
});

test('cancelled finalization cannot append an assessment', async () => {
  const f = await fixture();
  const p = await f.work.prepare(f.claim, f.signal);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.work.finalize(f.manager, f.claim, p, controller.signal));
  assert.equal(f.inputs.length, 0);
});

test('non-live admission cannot enter initial policy assessment', async () => {
  const f = await fixture();
  f.context.request.executionAdmission.classification = 'REVIEW_ONLY';
  const p = await f.work.prepare(f.claim, f.signal);
  assert.equal((await f.work.finalize(f.manager, f.claim, p, f.signal)).state, 'UNAVAILABLE');
  assert.equal(f.inputs.length, 0);
});
