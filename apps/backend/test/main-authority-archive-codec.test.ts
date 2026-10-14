import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { MAIN_AUTHORITY_SOURCES } from '../src/common/configuration/main-authority-sources.js';
import {
  MAIN_AUTHORITY_ARCHIVE_FORMAT,
  sealMainAuthorityArchive,
  decodeStoredMainAuthorityArchive,
  type MainAuthorityArchiveContext,
  type MainAuthorityArchivePayload,
} from '../src/modules/zones/main-authority-archive-codec.js';

test('retained MAIN revoked and expired assignment metadata remain readable without granting authority', () => {
  for (const status of ['REVOKED', 'EXPIRED']) {
    const f = createArchiveFixture();
    const source = f.payload.sources.find((item) => item.sourceKind === 'ASSIGNMENT');
    assert.ok(source);
    const extraRow = {
      id: randomUUID(),
      worker_id: randomUUID(),
      site_id: f.siteId,
      site_contractor_id: null,
      status,
      version: 1,
      valid_from: '2026-10-10T00:00:00.000001Z',
      valid_until: '2026-10-10T00:00:00.000002Z',
    };
    const payload = {
      ...f.payload,
      sources: f.payload.sources.map((item) =>
        item === source ? { ...item, rows: [...item.rows, extraRow] } : item,
      ),
    };
    const result = sealMainAuthorityArchive(payload, f.context);
    assert.equal(result.status, 'VALID');
    if (result.status !== 'VALID') throw new Error('Expected validated archive');
    assert.equal(result.authorityCoverageEstablished, false);
    assert.equal(result.identityEstablished, false);
  }
});

// -----------------------------------------------------------------------------
// Fixture Builders
// -----------------------------------------------------------------------------

function buildValid15Sources(
  siteId: string,
  zoneId: string,
  workerId: string | null = null,
  options: {
    cameraId?: string;
    regionId?: string;
    extraSiteRows?: Record<string, unknown>[];
    extraZoneRows?: Record<string, unknown>[];
  } = {},
): MainAuthorityArchivePayload['sources'] {
  const contractorId = randomUUID();
  const cameraId = options.cameraId ?? randomUUID();
  const regionId = options.regionId ?? randomUUID();

  return MAIN_AUTHORITY_SOURCES.map(([sourceKind, tableName, fields]) => {
    let rows: Record<string, unknown>[] = [];

    switch (sourceKind) {
      case 'SITE':
        rows = [{ id: siteId, access_policy_version: 1 }, ...(options.extraSiteRows ?? [])];
        break;
      case 'ZONE_POLICY':
        rows = [
          {
            id: zoneId,
            site_id: siteId,
            restriction_policy: 'AUTHORIZATION_REQUIRED',
            required_ppe: [],
            configuration_locked: false,
          },
          ...(options.extraZoneRows ?? []),
        ];
        break;
      case 'WORKER':
        if (workerId !== null) {
          rows = [
            {
              id: workerId,
              site_id: siteId,
              contractor_id: contractorId,
              user_id: null,
              is_active: true,
            },
          ];
        }
        break;
      case 'CAMERA':
        if (options.cameraId) {
          rows = [
            {
              id: cameraId,
              site_id: siteId,
              external_id: 'CAM-01',
              status: 'ACTIVE',
              configuration_version: 1,
            },
          ];
        }
        break;
      case 'REGION':
        if (options.regionId && options.cameraId) {
          rows = [
            {
              id: regionId,
              camera_id: cameraId,
              zone_id: zoneId,
              polygon: [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
              ],
              coordinate_space: 'NORMALIZED_0_1',
              version: 1,
              is_active: true,
            },
          ];
        }
        break;
      default:
        rows = [];
        break;
    }

    return {
      sourceKind,
      tableName,
      fields,
      rows,
    };
  });
}

interface Fixture {
  siteId: string;
  zoneId: string;
  workerId: string | null;
  context: MainAuthorityArchiveContext;
  payload: MainAuthorityArchivePayload;
}

function createArchiveFixture(
  options: { workerId?: string | null; cameraId?: string; regionId?: string } = {},
): Fixture {
  const siteId = randomUUID();
  const zoneId = randomUUID();
  const workerId = options.workerId === undefined ? null : options.workerId;

  const context: MainAuthorityArchiveContext = {
    siteId,
    zoneId,
    workerId,
    capturedAt: '2026-10-12T00:00:01.000000+00:00',
    purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  };

  const payload: MainAuthorityArchivePayload = {
    version: MAIN_AUTHORITY_ARCHIVE_FORMAT,
    context,
    archivedAt: '2026-10-12T00:00:02.000000+00:00',
    baseline: {
      epochId: randomUUID(),
      capturedAt: '2026-10-12T00:00:00.000000+00:00',
      declaredWriterManifestHash: 'a'.repeat(64),
      sourceRegistryHash: 'b'.repeat(64),
      snapshotHash: 'c'.repeat(64),
    },
    sources: buildValid15Sources(siteId, zoneId, workerId, options),
  };

  return { siteId, zoneId, workerId, context, payload };
}

// -----------------------------------------------------------------------------
// Test Suite: Main Authority Archive Codec
// -----------------------------------------------------------------------------

test('1. positive seal for policy-only context with null worker returns VALID with frozen payload and flags false', () => {
  const f = createArchiveFixture({ workerId: null });
  const result = sealMainAuthorityArchive(f.payload, f.context);

  assert.equal(result.status, 'VALID');
  if (result.status !== 'VALID') return;

  assert.equal(result.authorityCoverageEstablished, false);
  assert.equal(result.identityEstablished, false);
  assert.equal(result.archive.format, MAIN_AUTHORITY_ARCHIVE_FORMAT);
  assert.equal(result.archive.sha256, computeCanonicalPayloadHash(f.payload));
  assert.deepEqual(result.archive.payload, f.payload);
  assert.equal(Object.isFrozen(result.archive.payload), true);
});

test('2. positive seal for worker-scoped context returns VALID with coherent worker and site binding', () => {
  const workerId = randomUUID();
  const f = createArchiveFixture({ workerId });
  const result = sealMainAuthorityArchive(f.payload, f.context);

  assert.equal(result.status, 'VALID');
  if (result.status !== 'VALID') return;

  assert.equal(result.authorityCoverageEstablished, false);
  assert.equal(result.identityEstablished, false);
  assert.equal(result.archive.sha256, computeCanonicalPayloadHash(f.payload));
  assert.equal(result.archive.payload.context.workerId, workerId);
});

test('3. roundtrip decodeStoredMainAuthorityArchive validates exact context, digest, and payload', () => {
  const f = createArchiveFixture({ workerId: null });
  const sha256 = computeCanonicalPayloadHash(f.payload);
  const envelope = {
    format: MAIN_AUTHORITY_ARCHIVE_FORMAT,
    sha256,
    payload: f.payload,
  };

  const decoded = decodeStoredMainAuthorityArchive(envelope, { ...f.context, sha256 });

  assert.equal(decoded.status, 'VALID');
  if (decoded.status !== 'VALID') return;

  assert.equal(decoded.authorityCoverageEstablished, false);
  assert.equal(decoded.identityEstablished, false);
  assert.equal(decoded.archive.sha256, sha256);
  assert.deepEqual(decoded.archive.payload, f.payload);
});

test('4. format and version validation rejects unknown versions with UNSUPPORTED_VERSION', () => {
  const f = createArchiveFixture();

  const cases: { name: string; run: () => unknown }[] = [
    {
      name: 'payload older version V0',
      run: () =>
        sealMainAuthorityArchive(
          { ...f.payload, version: 'MF06_MAIN_AUTHORITY_ARCHIVE_V0' },
          f.context,
        ),
    },
    {
      name: 'payload newer version V2',
      run: () =>
        sealMainAuthorityArchive(
          { ...f.payload, version: 'MF06_MAIN_AUTHORITY_ARCHIVE_V2' },
          f.context,
        ),
    },
    {
      name: 'payload missing version',
      run: () => {
        const { version, ...missing } = f.payload;
        void version;
        return sealMainAuthorityArchive(missing, f.context);
      },
    },
    {
      name: 'decode envelope format unknown',
      run: () => {
        const sha256 = computeCanonicalPayloadHash(f.payload);
        return decodeStoredMainAuthorityArchive(
          { format: 'UNKNOWN_ENVELOPE_FORMAT', sha256, payload: f.payload },
          { ...f.context, sha256 },
        );
      },
    },
  ];

  for (const { name, run } of cases) {
    assert.deepEqual(
      run(),
      { status: 'UNAVAILABLE', reason: 'UNSUPPORTED_VERSION' },
      `failed for ${name}`,
    );
  }
});

test('5. digest and hash integrity verification rejects tampered archives with DIGEST_MISMATCH', () => {
  const f = createArchiveFixture();
  const originalSha = computeCanonicalPayloadHash(f.payload);

  const cases: {
    name: string;
    envelope: unknown;
    expected: MainAuthorityArchiveContext & { sha256: string };
  }[] = [
    {
      name: 'expected sha does not match envelope sha',
      envelope: { format: MAIN_AUTHORITY_ARCHIVE_FORMAT, sha256: originalSha, payload: f.payload },
      expected: { ...f.context, sha256: 'f'.repeat(64) },
    },
    {
      name: 'envelope sha does not match computed payload hash',
      envelope: {
        format: MAIN_AUTHORITY_ARCHIVE_FORMAT,
        sha256: '0'.repeat(64),
        payload: f.payload,
      },
      expected: { ...f.context, sha256: '0'.repeat(64) },
    },
    {
      name: 'tampered payload content with original sha claimed',
      envelope: {
        format: MAIN_AUTHORITY_ARCHIVE_FORMAT,
        sha256: originalSha,
        payload: { ...f.payload, archivedAt: '2026-10-12T00:00:03.000000+00:00' },
      },
      expected: { ...f.context, sha256: originalSha },
    },
  ];

  for (const { name, envelope, expected } of cases) {
    const result = decodeStoredMainAuthorityArchive(envelope, expected);
    assert.deepEqual(
      result,
      { status: 'UNAVAILABLE', reason: 'DIGEST_MISMATCH' },
      `failed for ${name}`,
    );
  }
});

test('6. context binding mismatch against expected parameters returns BINDING_MISMATCH', () => {
  const f = createArchiveFixture({ workerId: randomUUID() });

  const cases: { name: string; context: MainAuthorityArchiveContext }[] = [
    { name: 'siteId mismatch', context: { ...f.context, siteId: randomUUID() } },
    { name: 'zoneId mismatch', context: { ...f.context, zoneId: randomUUID() } },
    {
      name: 'workerId mismatch (different uuid)',
      context: { ...f.context, workerId: randomUUID() },
    },
    {
      name: 'workerId mismatch (null expected vs uuid actual)',
      context: { ...f.context, workerId: null },
    },
    {
      name: 'capturedAt mismatch',
      context: { ...f.context, capturedAt: '2026-10-12T00:00:01.000001+00:00' },
    },
    { name: 'purpose mismatch', context: { ...f.context, purpose: 'RETROSPECTIVE_REVIEW' } },
  ];

  for (const { name, context } of cases) {
    const sealResult = sealMainAuthorityArchive(f.payload, context);
    assert.deepEqual(
      sealResult,
      { status: 'UNAVAILABLE', reason: 'BINDING_MISMATCH' },
      `seal failed for ${name}`,
    );

    const sha256 = computeCanonicalPayloadHash(f.payload);
    const decodeResult = decodeStoredMainAuthorityArchive(
      { format: MAIN_AUTHORITY_ARCHIVE_FORMAT, sha256, payload: f.payload },
      { ...context, sha256 },
    );
    assert.deepEqual(
      decodeResult,
      { status: 'UNAVAILABLE', reason: 'BINDING_MISMATCH' },
      `decode failed for ${name}`,
    );
  }
});

test('7. offset-aware microsecond timestamp ordering enforces PRE_BASELINE and INVALID_TIME', () => {
  const f = createArchiveFixture();

  // Subcase 1: capturedAt earlier than baseline capturedAt -> PRE_BASELINE
  const preBaselinePayload: MainAuthorityArchivePayload = {
    ...f.payload,
    context: {
      ...f.context,
      capturedAt: '2026-10-11T23:59:59.999999+00:00', // earlier than baseline 2026-10-12T00:00:00.000000+00:00
    },
  };
  assert.deepEqual(
    sealMainAuthorityArchive(preBaselinePayload, preBaselinePayload.context),
    { status: 'UNAVAILABLE', reason: 'PRE_BASELINE' },
    'failed for capturedAt < baseline.capturedAt',
  );

  // Subcase 2: archivedAt earlier than capturedAt -> INVALID_TIME
  const retroArchivedPayload: MainAuthorityArchivePayload = {
    ...f.payload,
    archivedAt: '2026-10-12T00:00:00.500000+00:00', // earlier than capturedAt 00:00:01.000000
  };
  assert.deepEqual(
    sealMainAuthorityArchive(retroArchivedPayload, retroArchivedPayload.context),
    { status: 'UNAVAILABLE', reason: 'INVALID_TIME' },
    'failed for archivedAt < context.capturedAt',
  );

  // Subcase 3: Invalid timestamp formats / precision > 6 / invalid calendars
  const invalidTimeStrings = [
    '2026-10-12T00:00:01.1234567+00:00', // fractions > 6 digits
    '2026-10-12 00:00:01+00', // missing T separator
    '2026-02-30T00:00:01.000000+00:00', // invalid calendar date Feb 30
    '2026-10-12T23:59:60.000000+00:00', // leap second
    'infinity', // infinity string
    '-infinity',
    'NaN',
  ];

  for (const badTime of invalidTimeStrings) {
    const badTimePayload: MainAuthorityArchivePayload = {
      ...f.payload,
      context: { ...f.context, capturedAt: badTime },
    };
    const badContext: MainAuthorityArchiveContext = { ...f.context, capturedAt: badTime };
    assert.deepEqual(
      sealMainAuthorityArchive(badTimePayload, badContext),
      { status: 'UNAVAILABLE', reason: 'INVALID_TIME' },
      `failed for bad timestamp: ${badTime}`,
    );
  }
});

test('8. scope coherence requires matching Site and Zone ownership and rejects foreign workers', () => {
  const f = createArchiveFixture({ workerId: randomUUID() });

  const cases: { name: string; sources: MainAuthorityArchivePayload['sources'] }[] = [
    {
      name: 'zone row belongs to a different site_id',
      sources: f.payload.sources.map((s) =>
        s.sourceKind === 'ZONE_POLICY'
          ? {
              ...s,
              rows: [
                {
                  id: f.zoneId,
                  site_id: randomUUID(),
                  restriction_policy: 'AUTHORIZATION_REQUIRED',
                  required_ppe: [],
                  configuration_locked: false,
                },
              ],
            }
          : s,
      ),
    },
    {
      name: 'site block has no row for context.siteId',
      sources: f.payload.sources.map((s) =>
        s.sourceKind === 'SITE'
          ? { ...s, rows: [{ id: randomUUID(), access_policy_version: 1 }] }
          : s,
      ),
    },
    {
      name: 'zone block has no row for context.zoneId',
      sources: f.payload.sources.map((s) =>
        s.sourceKind === 'ZONE_POLICY'
          ? {
              ...s,
              rows: [
                {
                  id: randomUUID(),
                  site_id: f.siteId,
                  restriction_policy: 'AUTHORIZATION_REQUIRED',
                  required_ppe: [],
                  configuration_locked: false,
                },
              ],
            }
          : s,
      ),
    },
    {
      name: 'worker row belongs to a different site_id',
      sources: f.payload.sources.map((s) =>
        s.sourceKind === 'WORKER'
          ? {
              ...s,
              rows: [
                {
                  id: f.workerId!,
                  site_id: randomUUID(),
                  contractor_id: randomUUID(),
                  user_id: null,
                  is_active: true,
                },
              ],
            }
          : s,
      ),
    },
    {
      name: 'context declared workerId but worker block is empty',
      sources: f.payload.sources.map((s) => (s.sourceKind === 'WORKER' ? { ...s, rows: [] } : s)),
    },
  ];

  for (const { name, sources } of cases) {
    const payload = { ...f.payload, sources };
    assert.deepEqual(
      sealMainAuthorityArchive(payload, f.context),
      { status: 'UNAVAILABLE', reason: 'SOURCE_SCOPE_MISMATCH' },
      `failed for ${name}`,
    );
  }
});

test('9. camera and region references must remain coherent when present', () => {
  const cameraId = randomUUID();
  const regionId = randomUUID();
  const f = createArchiveFixture({ cameraId, regionId });

  const cases: { name: string; sources: MainAuthorityArchivePayload['sources'] }[] = [
    {
      name: 'camera row belongs to a different site_id',
      sources: f.payload.sources.map((s) =>
        s.sourceKind === 'CAMERA'
          ? {
              ...s,
              rows: [
                {
                  id: cameraId,
                  site_id: randomUUID(),
                  external_id: 'CAM-01',
                  status: 'ACTIVE',
                  configuration_version: 1,
                },
              ],
            }
          : s,
      ),
    },
    {
      name: 'region row belongs to a different zone_id',
      sources: f.payload.sources.map((s) =>
        s.sourceKind === 'REGION'
          ? {
              ...s,
              rows: [
                {
                  id: regionId,
                  camera_id: cameraId,
                  zone_id: randomUUID(),
                  polygon: [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 1],
                  ],
                  coordinate_space: 'NORMALIZED_0_1',
                  version: 1,
                  is_active: true,
                },
              ],
            }
          : s,
      ),
    },
    {
      name: 'region row references missing camera_id not in camera block',
      sources: f.payload.sources.map((s) =>
        s.sourceKind === 'REGION'
          ? {
              ...s,
              rows: [
                {
                  id: regionId,
                  camera_id: randomUUID(),
                  zone_id: f.zoneId,
                  polygon: [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 1],
                  ],
                  coordinate_space: 'NORMALIZED_0_1',
                  version: 1,
                  is_active: true,
                },
              ],
            }
          : s,
      ),
    },
  ];

  for (const { name, sources } of cases) {
    const payload = { ...f.payload, sources };
    assert.deepEqual(
      sealMainAuthorityArchive(payload, f.context),
      { status: 'UNAVAILABLE', reason: 'SOURCE_SCOPE_MISMATCH' },
      `failed for ${name}`,
    );
  }
});

test('10. source registry validation enforces exact 15 masks, names, and field lists', () => {
  const f = createArchiveFixture();

  const cases: { name: string; sources: MainAuthorityArchivePayload['sources'] }[] = [
    {
      name: 'missing one source block (only 14 blocks)',
      sources: f.payload.sources.filter((s) => s.sourceKind !== 'CAMERA'),
    },
    {
      name: 'extra unknown source block (16 blocks)',
      sources: [
        ...f.payload.sources,
        { sourceKind: 'EXTRA_TABLE', tableName: 'extra', fields: ['id'], rows: [] },
      ],
    },
    {
      name: 'duplicate source block (two SITE blocks)',
      sources: [...f.payload.sources, f.payload.sources[2]!],
    },
    {
      name: 'incorrect tableName for SITE (sites instead of site)',
      sources: f.payload.sources.map((s) =>
        s.sourceKind === 'SITE' ? { ...s, tableName: 'sites' } : s,
      ),
    },
    {
      name: 'altered field list in mask (missing access_policy_version)',
      sources: f.payload.sources.map((s) =>
        s.sourceKind === 'SITE' ? { ...s, fields: ['id'] } : s,
      ),
    },
  ];

  for (const { name, sources } of cases) {
    const payload = { ...f.payload, sources };
    assert.deepEqual(
      sealMainAuthorityArchive(payload, f.context),
      { status: 'UNAVAILABLE', reason: 'SOURCE_REGISTRY_MISMATCH' },
      `failed for ${name}`,
    );
  }
});

test('11. rejection of forbidden, secret, and unmasked row attributes with MALFORMED_ARCHIVE', () => {
  const f = createArchiveFixture();

  const cases: { name: string; sources: MainAuthorityArchivePayload['sources'] }[] = [
    {
      name: 'app_user row contains forbidden password_hash',
      sources: f.payload.sources.map((s) =>
        s.sourceKind === 'USER_ACCOUNT'
          ? {
              ...s,
              rows: [
                {
                  id: randomUUID(),
                  is_active: true,
                  must_change_password: false,
                  created_at: '2026-10-12T00:00:00.000000+00:00',
                  password_hash: '$2b$12$syntheticsecret',
                },
              ],
            }
          : s,
      ),
    },
    {
      name: 'site row contains unknown secret field',
      sources: f.payload.sources.map((s) =>
        s.sourceKind === 'SITE'
          ? { ...s, rows: [{ id: f.siteId, access_policy_version: 1, secret_token: 'secret' }] }
          : s,
      ),
    },
    {
      name: 'raw face template or embedding bytes in row',
      sources: f.payload.sources.map((s) =>
        s.sourceKind === 'WORKER'
          ? {
              ...s,
              rows: [
                {
                  id: randomUUID(),
                  site_id: f.siteId,
                  contractor_id: randomUUID(),
                  user_id: null,
                  is_active: true,
                  face_embedding: [0.1, 0.2],
                },
              ],
            }
          : s,
      ),
    },
  ];

  for (const { name, sources } of cases) {
    const payload = { ...f.payload, sources };
    assert.deepEqual(
      sealMainAuthorityArchive(payload, f.context),
      { status: 'UNAVAILABLE', reason: 'MALFORMED_ARCHIVE' },
      `failed for ${name}`,
    );
  }
});

test('12. resource limits enforce max 2048 total rows and 2 MiB archive size', () => {
  const f = createArchiveFixture();

  // Subcase 1: Total rows across all 15 blocks exceeds 2048 (e.g. 2049 rows)
  const excessiveRows = Array.from({ length: 2049 }, () => ({
    id: randomUUID(),
    is_active: true,
  }));
  const tooManyRowsSources = f.payload.sources.map((s) =>
    s.sourceKind === 'CONTRACTOR' ? { ...s, rows: excessiveRows } : s,
  );
  assert.deepEqual(
    sealMainAuthorityArchive({ ...f.payload, sources: tooManyRowsSources }, f.context),
    { status: 'UNAVAILABLE', reason: 'RESOURCE_LIMIT' },
    'failed for total rows > 2048',
  );

  // Subcase 2: Archive payload exceeds 2 MiB in serialized byte size
  const largeString = 'x'.repeat(2 * 1024 * 1024 + 100);
  const oversizedPayload = {
    ...f.payload,
    baseline: {
      ...f.payload.baseline,
      snapshotHash: largeString,
    },
  };
  assert.deepEqual(
    sealMainAuthorityArchive(oversizedPayload, f.context),
    { status: 'UNAVAILABLE', reason: 'RESOURCE_LIMIT' },
    'failed for payload size > 2 MiB',
  );
});

test('13. object safety rejects prototype pollution, getters, cycles, and unsafe integers', () => {
  const f = createArchiveFixture();

  const cases: { name: string; payload: unknown }[] = [
    {
      name: 'prototype pollution attempt via __proto__',
      payload: JSON.parse(
        '{"__proto__": {"polluted": true}, "version": "MF06_MAIN_AUTHORITY_ARCHIVE_V1"}',
      ),
    },
    {
      name: 'number exceeds MAX_SAFE_INTEGER',
      payload: {
        ...f.payload,
        sources: f.payload.sources.map((s) =>
          s.sourceKind === 'SITE'
            ? {
                ...s,
                rows: [{ id: f.siteId, access_policy_version: Number.MAX_SAFE_INTEGER + 100 }],
              }
            : s,
        ),
      },
    },
    {
      name: 'payload is an array instead of an object',
      payload: [f.payload],
    },
    {
      name: 'payload is null',
      payload: null,
    },
  ];

  for (const { name, payload } of cases) {
    assert.deepEqual(
      sealMainAuthorityArchive(payload, f.context),
      { status: 'UNAVAILABLE', reason: 'MALFORMED_ARCHIVE' },
      `failed for ${name}`,
    );
  }
});

test('14. value type validation enforces UUID format, positive versions, and closed enums', () => {
  const f = createArchiveFixture();

  const cases: { name: string; sources: MainAuthorityArchivePayload['sources'] }[] = [
    {
      name: 'non-positive integer version (zero)',
      sources: f.payload.sources.map((s) =>
        s.sourceKind === 'SITE' ? { ...s, rows: [{ id: f.siteId, access_policy_version: 0 }] } : s,
      ),
    },
    {
      name: 'non-positive integer version (negative)',
      sources: f.payload.sources.map((s) =>
        s.sourceKind === 'SITE' ? { ...s, rows: [{ id: f.siteId, access_policy_version: -2 }] } : s,
      ),
    },
    {
      name: 'floating point version',
      sources: f.payload.sources.map((s) =>
        s.sourceKind === 'SITE'
          ? { ...s, rows: [{ id: f.siteId, access_policy_version: 1.5 }] }
          : s,
      ),
    },
    {
      name: 'malformed non-UUID in id field',
      sources: f.payload.sources.map((s) =>
        s.sourceKind === 'SITE'
          ? { ...s, rows: [{ id: 'not-a-valid-uuid-string', access_policy_version: 1 }] }
          : s,
      ),
    },
    {
      name: 'non-boolean type in is_active',
      sources: f.payload.sources.map((s) =>
        s.sourceKind === 'CONTRACTOR'
          ? { ...s, rows: [{ id: randomUUID(), is_active: 'true' }] }
          : s,
      ),
    },
    {
      name: 'invalid enum value in restriction_policy',
      sources: f.payload.sources.map((s) =>
        s.sourceKind === 'ZONE_POLICY'
          ? {
              ...s,
              rows: [
                {
                  id: f.zoneId,
                  site_id: f.siteId,
                  restriction_policy: 'OPEN_TO_ALL',
                  required_ppe: [],
                  configuration_locked: false,
                },
              ],
            }
          : s,
      ),
    },
  ];

  for (const { name, sources } of cases) {
    const payload = { ...f.payload, sources };
    assert.deepEqual(
      sealMainAuthorityArchive(payload, f.context),
      { status: 'UNAVAILABLE', reason: 'MALFORMED_ARCHIVE' },
      `failed for ${name}`,
    );
  }
});

test('JSON accessors, toJSON, sparse arrays and cyclic input are rejected without invoking hooks', () => {
  const f = createArchiveFixture();
  let hooks = 0;
  const getter = { ...f.payload };
  Object.defineProperty(getter, 'archivedAt', {
    enumerable: true,
    get() {
      hooks++;
      return f.payload.archivedAt;
    },
  });
  const method = {
    ...f.payload,
    toJSON() {
      hooks++;
      return f.payload;
    },
  };
  const cyclic: Record<string, unknown> = { ...f.payload };
  cyclic.loop = cyclic;
  const hole = { ...f.payload, sources: new Array(15) };
  for (const candidate of [getter, method, cyclic, hole])
    assert.deepEqual(sealMainAuthorityArchive(candidate, f.context), {
      status: 'UNAVAILABLE',
      reason: 'MALFORMED_ARCHIVE',
    });
  assert.equal(hooks, 0);
});

test('zero-fraction native timestamps, equivalent offsets and microsecond boundaries remain exact', () => {
  const f = createArchiveFixture();
  const zero = { ...f.payload, context: { ...f.context, capturedAt: '2026-10-12T00:00:01Z' } };
  assert.equal(sealMainAuthorityArchive(zero, f.context).status, 'VALID');
  const offset = {
    ...f.payload,
    context: { ...f.context, capturedAt: '2026-10-12T07:00:01.000001+07:00' },
    baseline: { ...f.payload.baseline, capturedAt: '2026-10-12T00:00:01.000000Z' },
  };
  const expected = { ...f.context, capturedAt: '2026-10-12T00:00:01.000001Z' };
  const result = sealMainAuthorityArchive(offset, expected);
  assert.equal(result.status, 'VALID');
  if (result.status !== 'VALID') assert.fail('Expected archive integrity');
  assert.equal(result.archive.payload.context.capturedAt, offset.context.capturedAt);
  const lateBase = {
    ...offset,
    baseline: { ...offset.baseline, capturedAt: '2026-10-12T00:00:01.000002Z' },
  };
  assert.deepEqual(sealMainAuthorityArchive(lateBase, expected), {
    status: 'UNAVAILABLE',
    reason: 'PRE_BASELINE',
  });
});

test('2048 total rows are accepted while duplicate source IDs and hidden properties are rejected', () => {
  const f = createArchiveFixture();
  const rows = Array.from({ length: 2046 }, () => ({ id: randomUUID(), is_active: true }));
  const full = {
    ...f.payload,
    sources: f.payload.sources.map((source) =>
      source.sourceKind === 'CONTRACTOR' ? { ...source, rows } : source,
    ),
  };
  assert.equal(sealMainAuthorityArchive(full, f.context).status, 'VALID');
  const duplicate = {
    ...f.payload,
    sources: f.payload.sources.map((source) =>
      source.sourceKind === 'SITE' ? { ...source, rows: [...source.rows, ...source.rows] } : source,
    ),
  };
  assert.deepEqual(sealMainAuthorityArchive(duplicate, f.context), {
    status: 'UNAVAILABLE',
    reason: 'MALFORMED_ARCHIVE',
  });
  const hidden = { ...f.payload };
  Object.defineProperty(hidden, 'privateHidden', { value: 'not-serialized', enumerable: false });
  assert.deepEqual(sealMainAuthorityArchive(hidden, f.context), {
    status: 'UNAVAILABLE',
    reason: 'MALFORMED_ARCHIVE',
  });
});
