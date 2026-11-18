import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { MAIN_AUTHORITY_SOURCES } from '../../src/common/configuration/main-authority-sources.js';
import {
  MAIN_AUTHORITY_ARCHIVE_FORMAT,
  sealMainAuthorityArchive,
} from '../../src/modules/zones/main-authority-archive-codec.js';
import { Mf06AssessmentStore } from '../../src/modules/safety/assessments/mf06-assessment-store.service.js';
import type { Mf06ClaimContextLookup } from '../../src/modules/safety/assessments/mf06-claim-context.reader.js';
import { Mf06DeniedEpisodeProjection } from '../../src/modules/safety/alerts/mf06-denied-episode-projection.js';

/** Synthetic persistence exercise only; the test injects a trusted result, not an operational release. */
export async function proveInitialDenialProjection(
  db: DataSource,
  context: Extract<Mf06ClaimContextLookup, { status: 'MATCHED' }>,
  api: string,
  token: string,
  frameSha256: string,
) {
  const capturedAt = context.authorityCapturedAt!;
  const scope = {
    siteId: context.siteId,
    zoneId: context.request.zoneId,
    workerId: null,
    capturedAt,
    purpose: 'INITIAL_OBSERVATION_ASSESSMENT' as const,
  };
  const archive = sealMainAuthorityArchive(
    {
      version: MAIN_AUTHORITY_ARCHIVE_FORMAT,
      context: scope,
      archivedAt: capturedAt,
      baseline: {
        epochId: randomUUID(),
        capturedAt,
        declaredWriterManifestHash: '0'.repeat(64),
        sourceRegistryHash: '1'.repeat(64),
        snapshotHash: '2'.repeat(64),
      },
      sources: MAIN_AUTHORITY_SOURCES.map(([sourceKind, tableName, fields]) => ({
        sourceKind,
        tableName,
        fields,
        rows:
          sourceKind === 'SITE'
            ? [{ id: scope.siteId, access_policy_version: 1 }]
            : sourceKind === 'ZONE_POLICY'
              ? [
                  {
                    id: scope.zoneId,
                    site_id: scope.siteId,
                    restriction_policy: 'PROHIBITED_FOR_ALL',
                    required_ppe: ['HARD_HAT', 'SAFETY_VEST'],
                    configuration_locked: true,
                  },
                ]
              : [],
      })),
    },
    scope,
  );
  assert.equal(archive.status, 'VALID');
  assert.ok(archive.status === 'VALID');
  const projection = new Mf06DeniedEpisodeProjection(db, { maxRecipients: 8 });
  const store = new Mf06AssessmentStore(db, async (manager, assessment) => {
    await projection.project(manager, assessment.siteId, assessment.assessmentId);
  });
  const input = {
    claim: {
      requestId: context.claim.requestId,
      leaseToken: context.claim.leaseToken,
      headRevision: context.claim.headRevision,
    },
    commandId: randomUUID(),
    siteId: scope.siteId,
    bindingHash: context.request.storedBindingHash,
    evaluatorVersion: 'synthetic-notification-test',
    outcome: 'DENIED' as const,
    reasonCode: 'POLICY_PROHIBITED' as const,
    provenance: 'TRUSTED_SERVICE' as const,
    workerId: null,
    profileRevision: null,
    frameSha256: null,
    cropSha256: null,
    authorityArtifact: archive.archive,
  };
  const before = await db.query(
    'SELECT count(*)::int AS count FROM user_notification WHERE site_id=$1',
    [scope.siteId],
  );
  // Prove failure after projection rolls back assessment, job and episode writes together.
  await assert.rejects(
    db.transaction('SERIALIZABLE', async (manager) => {
      assert.equal((await store.finalizeInTransaction(manager, input)).state, 'RECORDED');
      throw new Error('SIMULATED_ROLLBACK');
    }),
    /SIMULATED_ROLLBACK/,
  );
  assert.deepEqual(
    await db.query('SELECT assessment_id FROM zone_entry_assessment WHERE request_id=$1', [
      input.claim.requestId,
    ]),
    [],
  );
  const saved = await db.transaction('SERIALIZABLE', (manager) =>
    store.finalizeInTransaction(manager, input),
  );
  assert.equal(saved.state, 'RECORDED');
  assert.ok(saved.state === 'RECORDED');
  const assessmentId = saved.assessment.assessmentId;
  for (let i = 0; i < 2; i++) {
    const replay = await db.transaction<
      Awaited<ReturnType<Mf06DeniedEpisodeProjection['project']>>
    >('SERIALIZABLE', (manager) => projection.project(manager, scope.siteId, assessmentId));
    assert.equal(replay.state, 'REPLAY');
  }
  const alerts = await db.query<{ id: string; episode_id: string }[]>(
    "SELECT id,episode_id FROM safety_alert WHERE site_id=$1 AND alert_type='RESTRICTED_ZONE_INTRUSION'",
    [scope.siteId],
  );
  assert.equal(alerts.length, 1);
  const alert = alerts[0]!;
  const mappings = await db.query(
    'SELECT event_id,person_observation_index FROM alert_detection_mapping WHERE alert_id=$1',
    [alert.id],
  );
  assert.deepEqual(mappings, [
    {
      event_id: context.request.eventId,
      person_observation_index: context.subject!.personObservationIndex,
    },
  ]);
  assert.deepEqual(
    await db.query('SELECT count(*)::int AS count FROM user_notification WHERE site_id=$1', [
      scope.siteId,
    ]),
    before,
  );
  const path =
    api +
    '/sites/' +
    scope.siteId +
    '/safety-episodes/' +
    alert.episode_id +
    '/findings/' +
    alert.id +
    '/events/' +
    context.request.eventId +
    '/frame?evidenceIndex=0&personObservationIndex=';
  const headers = { authorization: 'Bearer ' + token };
  const image = await fetch(path + context.subject!.personObservationIndex, { headers });
  assert.equal(image.status, 200, await image.clone().text());
  assert.equal(image.headers.get('x-smartsite-frame-sha256'), frameSha256);
  assert.ok((await image.arrayBuffer()).byteLength > 0);
  assert.equal(
    (await fetch(path + (context.subject!.personObservationIndex + 1), { headers })).status,
    404,
  );
}
