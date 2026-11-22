import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EntityManager } from 'typeorm';
import {
  Mf06AssessmentStore,
  type Mf06RecordedAssessment,
} from '../src/modules/safety/assessments/mf06-assessment-store.service.js';

test('notification classification accepts only a trusted initial denial with matching archived policy', async () => {
  const prototype = Mf06AssessmentStore.prototype as unknown as {
    readNotificationDenialInTransaction?: (
      manager: EntityManager,
      siteId: string,
      assessmentId: string,
    ) => Promise<{ candidateSubtype: string } | null>;
  };
  assert.equal(typeof prototype.readNotificationDenialInTransaction, 'function');
  const base = {
    outcome: 'DENIED',
    provenance: 'TRUSTED_SERVICE',
    purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
    siteId: 'site-a',
    zoneId: 'zone-a',
    reasonCode: 'POLICY_PROHIBITED',
    authorityArtifact: {
      payload: {
        sources: [
          {
            sourceKind: 'ZONE_POLICY',
            rows: [{ id: 'zone-a', site_id: 'site-a', restriction_policy: 'PROHIBITED_FOR_ALL' }],
          },
        ],
      },
    },
  };
  let current = base;
  const store = Object.create(Mf06AssessmentStore.prototype) as Mf06AssessmentStore;
  store.readRecordedInTransaction = async () => current as unknown as Mf06RecordedAssessment;
  const read = () =>
    prototype.readNotificationDenialInTransaction!.call(
      store,
      {} as EntityManager,
      base.siteId,
      'assessment-a',
    );
  assert.equal((await read())?.candidateSubtype, 'ZONE_ENTRY_PROHIBITED');
  for (const change of [
    { provenance: 'SYNTHETIC_TEST' },
    { purpose: 'RETROSPECTIVE_REVIEW' },
    { outcome: 'UNAVAILABLE' },
    { reasonCode: 'UNAUTHORIZED' },
    { zoneId: 'zone-other' },
  ]) {
    current = { ...base, ...change };
    assert.equal(await read(), null);
  }
});
