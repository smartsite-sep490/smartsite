import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ZoneRestrictionPolicy, ZoneType } from '../src/database/entities/enums.js';
import type { ResolvedObservationContext } from '../src/modules/zones/observation-context-resolver.service.js';
import {
  AlertCandidateEvaluator,
  summarizeIdentityEvidenceByTrack,
  type EvaluationEvent,
} from '../src/modules/safety/alerts/alert-candidate-evaluator.js';

const cameraId = '11111111-1111-4111-8111-111111111111';
const siteId = '22222222-2222-4222-8222-222222222222';
const streamSessionId = '33333333-3333-4333-8333-333333333333';
const zoneId = '44444444-4444-4444-8444-444444444444';
const regionId = '55555555-5555-4555-8555-555555555555';
const geometryVersion = 1;

for (const [item, subtype] of [
  ['GLOVES', 'PPE_GLOVES_MISSING'],
  ['BOOTS', 'PPE_BOOTS_MISSING'],
  ['GOGGLES', 'PPE_GOGGLES_MISSING'],
] as const) {
  test(`explicit ${item} missing has its own subtype, only where required`, () => {
    const observation = {
      type: 'PPE',
      trackId: 101,
      ppeItem: item,
      status: 'MISSING',
      regionId,
      geometryVersion,
    };
    // Exercise the runtime boundary, including the pre-expansion legacy type.
    const event = createBaseEvent([observation] as unknown as EvaluationEvent['observations']);
    const evaluator = new AlertCandidateEvaluator();
    const lookup = () => createTestContext({ requiredPpe: [item] });
    const result = evaluator.evaluate(event, lookup);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.candidateSubtype, subtype);
    assert.equal(result[0]?.details.ppeItem, item);
    assert.equal(evaluator.evaluate(event, () => createTestContext()).length, 0);
    const presentEvent = createBaseEvent([
      { ...observation, status: 'PRESENT' },
    ] as unknown as EvaluationEvent['observations']);
    assert.equal(evaluator.evaluate(presentEvent, lookup).length, 0);
  });
}

test('unexpected PPE cannot fall through into vest alerts even with invalid policy input', () => {
  const event = createBaseEvent([
    {
      type: 'PPE',
      trackId: 101,
      ppeItem: 'UNSUPPORTED',
      status: 'MISSING',
      regionId,
      geometryVersion,
    },
  ] as unknown as EvaluationEvent['observations']);
  const result = new AlertCandidateEvaluator().evaluate(event, () =>
    createTestContext({ requiredPpe: ['UNSUPPORTED'] }),
  );
  assert.equal(result.length, 0);
});

function createTestContext(overrides?: {
  requiredPpe?: string[];
  restrictionPolicy?: ZoneRestrictionPolicy;
  zoneId?: string;
  regionId?: string;
  geometryVersion?: number;
}): ResolvedObservationContext {
  const currentZoneId = overrides?.zoneId ?? zoneId;
  const currentRegionId = overrides?.regionId ?? regionId;
  const currentGeometryVersion = overrides?.geometryVersion ?? geometryVersion;
  return {
    cameraId,
    siteId,
    regionId: currentRegionId,
    zoneId: currentZoneId,
    zone: {
      id: currentZoneId,
      siteId,
      code: 'ZONE-1',
      name: 'Test Zone',
      type: ZoneType.RESTRICTED,
      restrictionPolicy: overrides?.restrictionPolicy ?? ZoneRestrictionPolicy.NONE,
      requiredPpe: overrides?.requiredPpe ?? [],
      configurationLocked: false,
      createdAt: new Date(),
    },
    geometryVersion: currentGeometryVersion,
  };
}

function createBaseEvent(observations: EvaluationEvent['observations']): EvaluationEvent {
  return {
    streamSessionId,
    cameraExternalId: 'CAM-01',
    observations,
  };
}

function identityConflictEvent(identities: EvaluationEvent['observations']): EvaluationEvent {
  return createBaseEvent([
    { type: 'PERSON', trackId: 101 },
    ...identities,
    {
      type: 'PPE',
      trackId: 101,
      ppeItem: 'HARD_HAT',
      status: 'MISSING',
      regionId,
      geometryVersion,
    },
    { type: 'ZONE_ENTRY', trackId: 101, regionId, geometryVersion },
  ]);
}

test('identity summaries require exactly one same-event PERSON, irrespective of observation order', () => {
  const identity = {
    type: 'IDENTITY_CANDIDATE',
    trackId: 7,
    status: 'CANDIDATE',
    candidateWorkerId: 'A',
    similarityScore: 0.9,
    qualityScore: 0.8,
  } as const;
  const personSets: EvaluationEvent['observations'][] = [
    [],
    [{ type: 'PERSON', trackId: 8 }],
    [
      { type: 'PERSON', trackId: 7 },
      { type: 'PERSON', trackId: 7 },
    ],
    [
      { type: 'PERSON', trackId: 7, boundingBox: { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.5 } },
      { type: 'PERSON', trackId: 7 },
    ],
  ];
  for (const persons of personSets) {
    const claims: EvaluationEvent['observations'] = [
      identity,
      { type: 'IDENTITY_CANDIDATE', trackId: 7, status: 'UNKNOWN', qualityScore: 0.8 },
      { type: 'IDENTITY_CANDIDATE', trackId: 7, status: 'UNAVAILABLE', qualityScore: 0.8 },
    ];
    for (const claim of claims) {
      const eventObservations = [claim, ...persons];
      for (const ordered of [eventObservations, [...eventObservations].reverse()]) {
        const original = structuredClone(ordered);
        assert.equal(summarizeIdentityEvidenceByTrack(ordered).size, 0);
        assert.deepEqual(ordered, original);
      }
    }
  }
});

test('identity summaries are event-local and do not carry a PERSON into the next event', () => {
  const identity = {
    type: 'IDENTITY_CANDIDATE',
    trackId: 7,
    status: 'CANDIDATE',
    candidateWorkerId: 'A',
  } as const;
  assert.equal(
    summarizeIdentityEvidenceByTrack([{ type: 'PERSON', trackId: 7 }, identity]).get(7)
      ?.candidateWorkerId,
    'A',
  );
  assert.equal(summarizeIdentityEvidenceByTrack([identity]).size, 0);
});

test('duplicate PERSONs on another track do not suppress a unique subject technical summary', () => {
  const observations: EvaluationEvent['observations'] = [
    { type: 'PERSON', trackId: 0 },
    { type: 'IDENTITY_CANDIDATE', trackId: 0, status: 'CANDIDATE', candidateWorkerId: 'A' },
    { type: 'PERSON', trackId: 8 },
    { type: 'PERSON', trackId: 8 },
    { type: 'IDENTITY_CANDIDATE', trackId: 8, status: 'CANDIDATE', candidateWorkerId: 'B' },
  ];
  for (const ordered of [observations, [...observations].reverse()]) {
    const summaries = summarizeIdentityEvidenceByTrack(ordered);
    assert.equal(summaries.size, 1);
    // A crop box is not required for a technical summary; this is never verified identity.
    assert.equal(summaries.get(0)?.candidateWorkerId, 'A');
    assert.equal(summaries.has(8), false);
  }
});

test('unbound identity leaves PPE/Zone alerts intact and passes no Worker candidate to authorization', () => {
  const evaluator = new AlertCandidateEvaluator();
  const context = createTestContext({
    requiredPpe: ['HARD_HAT'],
    restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
  });
  for (const persons of [
    [],
    [
      { type: 'PERSON', trackId: 101 },
      { type: 'PERSON', trackId: 101 },
    ],
  ] satisfies EvaluationEvent['observations'][]) {
    const event = createBaseEvent([
      ...persons,
      {
        type: 'IDENTITY_CANDIDATE',
        trackId: 101,
        status: 'CANDIDATE',
        candidateWorkerId: 'A',
        similarityScore: 0.9,
        qualityScore: 0.8,
      },
      {
        type: 'PPE',
        trackId: 101,
        ppeItem: 'HARD_HAT',
        status: 'MISSING',
        regionId,
        geometryVersion,
      },
      { type: 'ZONE_ENTRY', trackId: 101, regionId, geometryVersion },
    ]);
    const original = structuredClone(event);
    let lookups = 0;
    const candidates = evaluator.evaluate(event, context, ({ candidateWorkerId }) => {
      lookups += 1;
      assert.equal(candidateWorkerId, undefined);
      return {
        status: 'UNAVAILABLE',
        candidateSubtype: 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE',
        reasonCode: 'IDENTITY_UNAVAILABLE',
      };
    });
    assert.equal(lookups, 1);
    assert.deepEqual(candidates.map((candidate) => candidate.candidateSubtype).sort(), [
      'PPE_HARD_HAT_MISSING',
      'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE',
    ]);
    for (const candidate of candidates) {
      assert.equal(candidate.candidateWorkerId, undefined);
      assert.equal(candidate.identitySimilarityScore, undefined);
      assert.equal(candidate.identityQualityScore, undefined);
    }
    assert.deepEqual(event, original);
    // Also retain the actual policy evaluator's UNKNOWN != DENIED behavior.
    assert.deepEqual(
      evaluator
        .evaluate(event, context)
        .map((candidate) => candidate.candidateSubtype)
        .sort(),
      ['PPE_HARD_HAT_MISSING', 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE'],
    );
  }
});

test('conflicting Worker candidates cannot select the last identity for PPE or Zone alerts', () => {
  const evaluator = new AlertCandidateEvaluator();
  const context = createTestContext({
    requiredPpe: ['HARD_HAT'],
    restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
  });
  const identities: EvaluationEvent['observations'] = [
    {
      type: 'IDENTITY_CANDIDATE',
      trackId: 101,
      status: 'CANDIDATE',
      candidateWorkerId: 'A',
      similarityScore: 0.81,
      qualityScore: 0.91,
    },
    {
      type: 'IDENTITY_CANDIDATE',
      trackId: 101,
      status: 'CANDIDATE',
      candidateWorkerId: 'B',
      similarityScore: 0.82,
      qualityScore: 0.92,
    },
  ];
  const original = structuredClone(identities);
  for (const ordered of [identities, [...identities].reverse()]) {
    const candidates = evaluator.evaluate(identityConflictEvent(ordered), context);
    assert.equal(candidates.length, 2);
    assert.deepEqual(candidates.map((c) => c.candidateSubtype).sort(), [
      'PPE_HARD_HAT_MISSING',
      'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE',
    ]);
    for (const candidate of candidates) {
      assert.equal(candidate.candidateWorkerId, undefined);
      assert.equal(candidate.identitySimilarityScore, undefined);
      assert.equal(candidate.identityQualityScore, undefined);
    }
  }
  assert.deepEqual(identities, original);
});

test('candidate and unavailable/unknown claims for one track remain ambiguous in either order', () => {
  const evaluator = new AlertCandidateEvaluator();
  const context = createTestContext({ requiredPpe: ['HARD_HAT'] });
  for (const status of ['UNKNOWN', 'UNAVAILABLE'] as const) {
    const identities: EvaluationEvent['observations'] = [
      {
        type: 'IDENTITY_CANDIDATE',
        trackId: 101,
        status: 'CANDIDATE',
        candidateWorkerId: 'A',
        similarityScore: 0.9,
        qualityScore: 0.8,
      },
      { type: 'IDENTITY_CANDIDATE', trackId: 101, status },
    ];
    for (const ordered of [identities, [...identities].reverse()]) {
      const [candidate] = evaluator.evaluate(identityConflictEvent(ordered), context);
      assert.equal(candidate!.candidateWorkerId, undefined);
      assert.equal(candidate!.identitySimilarityScore, undefined);
      assert.equal(candidate!.identityQualityScore, undefined);
    }
  }
});

test('agreeing Worker candidates retain only scores that agree, independent of order', () => {
  const evaluator = new AlertCandidateEvaluator();
  const context = createTestContext({ requiredPpe: ['HARD_HAT'] });
  const identities: EvaluationEvent['observations'] = [
    {
      type: 'IDENTITY_CANDIDATE',
      trackId: 101,
      status: 'CANDIDATE',
      candidateWorkerId: 'A',
      similarityScore: 0.8,
      qualityScore: 0.9,
    },
    {
      type: 'IDENTITY_CANDIDATE',
      trackId: 101,
      status: 'CANDIDATE',
      candidateWorkerId: 'A',
      similarityScore: 0.95,
      qualityScore: 0.9,
    },
  ];
  for (const ordered of [identities, [...identities].reverse()]) {
    const [candidate] = evaluator.evaluate(identityConflictEvent(ordered), context);
    assert.equal(candidate!.candidateWorkerId, 'A');
    assert.equal(candidate!.identitySimilarityScore, undefined);
    assert.equal(candidate!.identityQualityScore, 0.9);
  }
});

test('identical duplicate claims and unrelated tracks do not change candidate metadata', () => {
  const evaluator = new AlertCandidateEvaluator();
  const context = createTestContext({ requiredPpe: ['HARD_HAT'] });
  const identity = {
    type: 'IDENTITY_CANDIDATE',
    trackId: 101,
    status: 'CANDIDATE',
    candidateWorkerId: 'A',
    similarityScore: 0.8,
    qualityScore: 0.9,
  } as const;
  const alone = evaluator.evaluate(identityConflictEvent([identity]), context);
  const duplicated = evaluator.evaluate(
    identityConflictEvent([
      identity,
      { ...identity },
      { ...identity, trackId: 202, candidateWorkerId: 'B' },
    ]),
    context,
  );
  assert.deepEqual(duplicated, alone);
  assert.equal(duplicated[0]!.candidateWorkerId, 'A');
  assert.equal(duplicated[0]!.identitySimilarityScore, 0.8);
  assert.equal(duplicated[0]!.identityQualityScore, 0.9);
});

test('Case 1: PERSON only returns empty candidates', () => {
  const evaluator = new AlertCandidateEvaluator();
  const context = createTestContext({ requiredPpe: ['HARD_HAT'] });
  const event = createBaseEvent([{ type: 'PERSON', trackId: 101, confidence: 0.95 }]);

  const candidates = evaluator.evaluate(event, context);
  assert.deepEqual(candidates, []);
});

test('Case 2: IDENTITY_CANDIDATE only returns empty candidates', () => {
  const evaluator = new AlertCandidateEvaluator();
  const context = createTestContext({ requiredPpe: ['HARD_HAT'] });
  const event = createBaseEvent([
    {
      type: 'IDENTITY_CANDIDATE',
      trackId: 101,
      status: 'CANDIDATE',
      candidateWorkerId: 'WORKER-001',
      similarityScore: 0.94,
      qualityScore: 0.88,
    },
  ]);

  const candidates = evaluator.evaluate(event, context);
  assert.deepEqual(candidates, []);
});

test('Case 3: PPE PRESENT returns empty candidates', () => {
  const evaluator = new AlertCandidateEvaluator();
  const context = createTestContext({ requiredPpe: ['HARD_HAT', 'SAFETY_VEST'] });
  const event = createBaseEvent([
    {
      type: 'PPE',
      trackId: 101,
      ppeItem: 'HARD_HAT',
      status: 'PRESENT',
      regionId,
      geometryVersion,
    },
  ]);

  const candidates = evaluator.evaluate(event, context);
  assert.deepEqual(candidates, []);
});

test('Case 4: PPE MISSING HARD_HAT when Zone requires only SAFETY_VEST returns empty candidates', () => {
  const evaluator = new AlertCandidateEvaluator();
  const context = createTestContext({ requiredPpe: ['SAFETY_VEST'] }); // Hard hat not required
  const event = createBaseEvent([
    {
      type: 'PPE',
      trackId: 101,
      ppeItem: 'HARD_HAT',
      status: 'MISSING',
      regionId,
      geometryVersion,
    },
  ]);

  const candidates = evaluator.evaluate(event, context);
  assert.deepEqual(candidates, []);
});

test('Case 5: PPE MISSING HARD_HAT when Zone requires HARD_HAT returns PPE_HARD_HAT_MISSING', () => {
  const evaluator = new AlertCandidateEvaluator();
  const context = createTestContext({ requiredPpe: ['HARD_HAT'] });
  const event = createBaseEvent([
    {
      type: 'PPE',
      trackId: 101,
      ppeItem: 'HARD_HAT',
      status: 'MISSING',
      regionId,
      geometryVersion,
      confidence: 0.85,
    },
  ]);

  const candidates = evaluator.evaluate(event, context);
  assert.equal(candidates.length, 1);
  const candidate = candidates[0]!;
  assert.equal(candidate.alertType, 'PPE_VIOLATION');
  assert.equal(candidate.candidateSubtype, 'PPE_HARD_HAT_MISSING');
  assert.equal(candidate.cameraId, cameraId);
  assert.equal(candidate.streamSessionId, streamSessionId);
  assert.equal(candidate.zoneId, zoneId);
  assert.equal(candidate.trackId, 101);
  assert.equal(
    candidate.groupingKey,
    `PPE_HARD_HAT_MISSING:${cameraId}:${streamSessionId}:${zoneId}:101`,
  );
  assert.equal(candidate.candidateWorkerId, undefined);
});

test('Case 6: PPE MISSING SAFETY_VEST when Zone requires SAFETY_VEST returns PPE_SAFETY_VEST_MISSING', () => {
  const evaluator = new AlertCandidateEvaluator();
  const context = createTestContext({ requiredPpe: ['SAFETY_VEST'] });
  const event = createBaseEvent([
    {
      type: 'PPE',
      trackId: 102,
      ppeItem: 'SAFETY_VEST',
      status: 'MISSING',
      regionId,
      geometryVersion,
      confidence: 0.9,
    },
  ]);

  const candidates = evaluator.evaluate(event, context);
  assert.equal(candidates.length, 1);
  const candidate = candidates[0]!;
  assert.equal(candidate.alertType, 'PPE_VIOLATION');
  assert.equal(candidate.candidateSubtype, 'PPE_SAFETY_VEST_MISSING');
  assert.equal(candidate.trackId, 102);
  assert.equal(
    candidate.groupingKey,
    `PPE_SAFETY_VEST_MISSING:${cameraId}:${streamSessionId}:${zoneId}:102`,
  );
});

test('MF06: ZONE_ENTRY in a NONE policy zone does not create an intrusion candidate', () => {
  const evaluator = new AlertCandidateEvaluator();
  const context = createTestContext({ restrictionPolicy: ZoneRestrictionPolicy.NONE });
  const event = createBaseEvent([
    { type: 'ZONE_ENTRY', trackId: 103, regionId, geometryVersion, confidence: 0.92 },
  ]);

  assert.deepEqual(evaluator.evaluate(event, context), []);
});

test('Case 7: ZONE_ENTRY in PROHIBITED_FOR_ALL returns ZONE_ENTRY_PROHIBITED', () => {
  const evaluator = new AlertCandidateEvaluator();
  const context = createTestContext({
    restrictionPolicy: ZoneRestrictionPolicy.PROHIBITED_FOR_ALL,
  });
  const event = createBaseEvent([
    {
      type: 'ZONE_ENTRY',
      trackId: 103,
      regionId,
      geometryVersion,
      confidence: 0.92,
    },
  ]);

  const candidates = evaluator.evaluate(event, context);
  assert.equal(candidates.length, 1);
  const candidate = candidates[0]!;
  assert.equal(candidate.alertType, 'RESTRICTED_ZONE_INTRUSION');
  assert.equal(candidate.candidateSubtype, 'ZONE_ENTRY_PROHIBITED');
  assert.equal(candidate.trackId, 103);
  assert.equal(
    candidate.groupingKey,
    `ZONE_ENTRY_PROHIBITED:${cameraId}:${streamSessionId}:${zoneId}:103`,
  );
});

test('Case 8: ZONE_ENTRY in AUTHORIZATION_REQUIRED returns ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE and never UNAUTHORIZED', () => {
  const evaluator = new AlertCandidateEvaluator();
  const context = createTestContext({
    restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
  });
  const event = createBaseEvent([
    {
      type: 'ZONE_ENTRY',
      trackId: 104,
      regionId,
      geometryVersion,
      confidence: 0.88,
    },
  ]);

  const candidates = evaluator.evaluate(event, context);
  assert.equal(candidates.length, 1);
  const candidate = candidates[0]!;
  assert.equal(candidate.alertType, 'RESTRICTED_ZONE_INTRUSION');
  assert.equal(candidate.candidateSubtype, 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE');
  assert.notEqual(candidate.candidateSubtype as string, 'ZONE_ENTRY_UNAUTHORIZED');
  assert.equal(candidate.trackId, 104);
  assert.equal(
    candidate.groupingKey,
    `ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE:${cameraId}:${streamSessionId}:${zoneId}:104`,
  );
});

test('MF06 authorization lookup suppresses allowed entry and emits UNAUTHORIZED for a denied worker', () => {
  const evaluator = new AlertCandidateEvaluator();
  const context = createTestContext({
    restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
  });
  const event = createBaseEvent([
    { type: 'PERSON', trackId: 110 },
    { type: 'PERSON', trackId: 111 },
    {
      type: 'IDENTITY_CANDIDATE',
      trackId: 110,
      status: 'CANDIDATE',
      candidateWorkerId: 'WORKER-ALLOW',
      similarityScore: 0.98,
    },
    { type: 'ZONE_ENTRY', trackId: 110, regionId, geometryVersion },
    {
      type: 'IDENTITY_CANDIDATE',
      trackId: 111,
      status: 'CANDIDATE',
      candidateWorkerId: 'WORKER-DENY',
      similarityScore: 0.97,
    },
    { type: 'ZONE_ENTRY', trackId: 111, regionId, geometryVersion },
  ]);

  const candidates = evaluator.evaluate(event, context, ({ trackId }) =>
    trackId === 110
      ? { status: 'ALLOWED', workerId: 'worker-allow', reasonCode: 'VALID_ALLOW' }
      : {
          status: 'DENIED',
          workerId: 'worker-deny',
          candidateSubtype: 'ZONE_ENTRY_UNAUTHORIZED',
          reasonCode: 'EXPLICIT_DENY',
          reason: 'Denied',
        },
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.trackId, 111);
  assert.equal(candidates[0]!.candidateSubtype, 'ZONE_ENTRY_UNAUTHORIZED');
  assert.equal(candidates[0]!.candidateWorkerId, 'WORKER-DENY');
});

test('Case 9: Candidate identity for same track is attached into evidence fields only', () => {
  const evaluator = new AlertCandidateEvaluator();
  const context = createTestContext({ requiredPpe: ['HARD_HAT'] });
  const event = createBaseEvent([
    { type: 'PERSON', trackId: 105 },
    {
      type: 'PPE',
      trackId: 105,
      ppeItem: 'HARD_HAT',
      status: 'MISSING',
      regionId,
      geometryVersion,
    },
    {
      type: 'IDENTITY_CANDIDATE',
      trackId: 105, // Same trackId
      status: 'CANDIDATE',
      candidateWorkerId: 'WORKER-ABC',
      similarityScore: 0.89,
      qualityScore: 0.93,
    },
    {
      type: 'IDENTITY_CANDIDATE',
      trackId: 999, // Different trackId
      status: 'CANDIDATE',
      candidateWorkerId: 'WORKER-OTHER',
      similarityScore: 0.99,
    },
  ]);

  const candidates = evaluator.evaluate(event, context);
  assert.equal(candidates.length, 1);
  const candidate = candidates[0]!;
  assert.equal(candidate.trackId, 105);
  // Identity attached to same trackId only
  assert.equal(candidate.candidateWorkerId, 'WORKER-ABC');
  assert.equal(candidate.identitySimilarityScore, 0.89);
  assert.equal(candidate.identityQualityScore, 0.93);
  // Must not have top-level authoritative workerId
  assert.equal((candidate as unknown as Record<string, unknown>)['workerId'], undefined);
});

test('Case 10: Duplicate candidate grouping keys within one event collapse to one candidate', () => {
  const evaluator = new AlertCandidateEvaluator();
  const context = createTestContext({
    restrictionPolicy: ZoneRestrictionPolicy.PROHIBITED_FOR_ALL,
  });
  const event = createBaseEvent([
    {
      type: 'ZONE_ENTRY',
      trackId: 106,
      regionId,
      geometryVersion,
      confidence: 0.7,
    },
    {
      type: 'ZONE_ENTRY',
      trackId: 106, // Duplicate observation for same track and zone
      regionId,
      geometryVersion,
      confidence: 0.95,
    },
  ]);

  const candidates = evaluator.evaluate(event, context);
  assert.equal(candidates.length, 1);
  assert.equal(
    candidates[0]!.groupingKey,
    `ZONE_ENTRY_PROHIBITED:${cameraId}:${streamSessionId}:${zoneId}:106`,
  );
});

test('Boundary: observation with mismatching regionId is never evaluated against a single context', () => {
  const evaluator = new AlertCandidateEvaluator();
  const validContext = createTestContext({
    regionId: 'region-a',
    requiredPpe: ['HARD_HAT'],
  });

  const event = createBaseEvent([
    {
      type: 'PPE',
      trackId: 201,
      ppeItem: 'HARD_HAT',
      status: 'MISSING',
      regionId: 'region-a', // Matches context
      geometryVersion,
    },
    {
      type: 'PPE',
      trackId: 202,
      ppeItem: 'HARD_HAT',
      status: 'MISSING',
      regionId: 'region-b-other', // Mismatches context -> must NOT get false alert
      geometryVersion,
    },
  ]);

  const candidates = evaluator.evaluate(event, validContext);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.trackId, 201);
  assert.equal(candidates[0]!.details['regionId'], 'region-a');
});

test('Boundary: observation with mismatching geometryVersion is strictly rejected when context specifies version', () => {
  const evaluator = new AlertCandidateEvaluator();
  const contextWithVersion: ResolvedObservationContext = {
    ...createTestContext({
      regionId: 'region-a',
      restrictionPolicy: ZoneRestrictionPolicy.PROHIBITED_FOR_ALL,
    }),
    geometryVersion: 1,
  };

  const event = createBaseEvent([
    {
      type: 'ZONE_ENTRY',
      trackId: 203,
      regionId: 'region-a',
      geometryVersion: 1, // Matches version
    },
    {
      type: 'ZONE_ENTRY',
      trackId: 204,
      regionId: 'region-a',
      geometryVersion: 2, // Stale/mismatching version -> must NOT create candidate
    },
  ]);

  const candidates = evaluator.evaluate(event, contextWithVersion);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.trackId, 203);
});

test('Multi-context: event with multiple mixed regionId/geometryVersion observations evaluates per-observation context correctly', () => {
  const evaluator = new AlertCandidateEvaluator();

  const contextZone1 = createTestContext({
    zoneId: 'zone-1',
    regionId: 'region-1',
    geometryVersion: 1,
    requiredPpe: ['HARD_HAT'],
  });
  contextZone1.geometryVersion = 1;

  const contextZone2 = createTestContext({
    zoneId: 'zone-2',
    regionId: 'region-2',
    geometryVersion: 2,
    requiredPpe: ['SAFETY_VEST'],
  });
  contextZone2.geometryVersion = 2;

  const contextZone3 = createTestContext({
    zoneId: 'zone-3',
    regionId: 'region-3',
    geometryVersion: 1,
    restrictionPolicy: ZoneRestrictionPolicy.PROHIBITED_FOR_ALL,
  });
  contextZone3.geometryVersion = 1;

  const contexts = [contextZone1, contextZone2, contextZone3];

  const event = createBaseEvent([
    {
      type: 'PPE',
      trackId: 301,
      ppeItem: 'HARD_HAT',
      status: 'MISSING',
      regionId: 'region-1',
      geometryVersion: 1, // Matches Zone 1
    },
    {
      type: 'PPE',
      trackId: 301,
      ppeItem: 'SAFETY_VEST',
      status: 'MISSING',
      regionId: 'region-2',
      geometryVersion: 2, // Matches Zone 2
    },
    {
      type: 'ZONE_ENTRY',
      trackId: 301,
      regionId: 'region-3',
      geometryVersion: 1, // Matches Zone 3
    },
    {
      type: 'PPE',
      trackId: 301,
      ppeItem: 'HARD_HAT',
      status: 'MISSING',
      regionId: 'region-4-unresolved', // Unresolved region -> ignored
      geometryVersion: 1,
    },
  ]);

  const candidates = evaluator.evaluate(event, contexts);
  assert.equal(candidates.length, 3);

  const keys = candidates.map((c) => c.groupingKey).sort();
  const expectedKeys = [
    `PPE_HARD_HAT_MISSING:${cameraId}:${streamSessionId}:zone-1:301`,
    `PPE_SAFETY_VEST_MISSING:${cameraId}:${streamSessionId}:zone-2:301`,
    `ZONE_ENTRY_PROHIBITED:${cameraId}:${streamSessionId}:zone-3:301`,
  ].sort();

  assert.deepEqual(keys, expectedKeys);
});

test('Strict Stale-Version Boundary: observation with matching regionId but stale geometryVersion is strictly rejected', () => {
  const evaluator = new AlertCandidateEvaluator();
  const context: ResolvedObservationContext = {
    ...createTestContext({
      regionId: 'region-exact',
      requiredPpe: ['HARD_HAT'],
    }),
    geometryVersion: 1, // Explicit resolved version is 1
  };

  const staleEvent = createBaseEvent([
    {
      type: 'PPE',
      trackId: 401,
      ppeItem: 'HARD_HAT',
      status: 'MISSING',
      regionId: 'region-exact', // Matches regionId
      geometryVersion: 2, // STALE / different geometryVersion (2 != 1)
    },
  ]);

  // 1. Single context must reject stale version
  const singleResult = evaluator.evaluate(staleEvent, context);
  assert.equal(singleResult.length, 0);

  // 2. Map lookup must reject stale version (must NOT fall back to bare regionId)
  const mapContext = new Map<string, ResolvedObservationContext>([
    ['region-exact', context], // Permissive bare key in map
  ]);
  const mapResult = evaluator.evaluate(staleEvent, mapContext);
  assert.equal(mapResult.length, 0);

  // 3. Array context must reject stale version
  const arrayResult = evaluator.evaluate(staleEvent, [context]);
  assert.equal(arrayResult.length, 0);
});

test('Strict Boundary: caller wiring mistake where Map or callback returns mismatched context is strictly rejected', () => {
  const evaluator = new AlertCandidateEvaluator();
  const mismatchedContext = createTestContext({
    regionId: 'region-WRONG', // Internal context has WRONG regionId
    geometryVersion: 99, // Internal context has WRONG geometryVersion
    requiredPpe: ['HARD_HAT'],
  });

  const event = createBaseEvent([
    {
      type: 'PPE',
      trackId: 501,
      ppeItem: 'HARD_HAT',
      status: 'MISSING',
      regionId: 'region-target',
      geometryVersion: 1,
    },
  ]);

  // 1. Map where key matches 'region-target:1' but value contains mismatched context
  const faultyMap = new Map<string, ResolvedObservationContext>([
    ['region-target:1', mismatchedContext],
  ]);
  const mapResult = evaluator.evaluate(event, faultyMap);
  assert.equal(mapResult.length, 0);

  // 2. Callback that accidentally returns mismatched context
  const faultyCallback = () => mismatchedContext;
  const callbackResult = evaluator.evaluate(event, faultyCallback);
  assert.equal(callbackResult.length, 0);
});
