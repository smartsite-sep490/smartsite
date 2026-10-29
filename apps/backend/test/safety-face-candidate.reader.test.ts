import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataSource, EntityManager } from 'typeorm';
import type { SafetyFaceCandidateTemplate } from '../src/modules/safety/assessments/safety-identity-resolver.port.js';
import { SafetyFaceCandidateReader } from '../src/modules/workforce/safety-face-candidate.reader.js';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const REV_1 = '22222222-2222-4222-8222-222222222222';
const REV_2 = '33333333-3333-4333-8333-333333333333';
const HASH_1 = 'a'.repeat(64);
const HASH_2 = 'b'.repeat(64);
const MODEL_VERSION = 'ArcFace-R100-glint360k-v1';
const FERNET_1 = `gAAAAAB${'A'.repeat(133)}`;
const FERNET_2 = `gAAAAAB${'B'.repeat(133)}`;
const SCHEMA = 'tenant_mf06';

type CandidateRow = {
  profileReferenceHash: unknown;
  profileRevision: unknown;
  encryptedTemplate: unknown;
};

type CapturedQuery = {
  sql: string;
  params: unknown[] | undefined;
};

function makeFakeDb(options?: {
  schema?: unknown;
  rows?: CandidateRow[] | ((sql: string, params: unknown[] | undefined) => unknown);
  onQuery?: (sql: string, params: unknown[] | undefined) => void;
  transactionError?: Error;
}) {
  const schema = options && 'schema' in options ? options.schema : SCHEMA;
  const queries: CapturedQuery[] = [];
  let transactionCount = 0;
  let isolationLevel: string | undefined;

  const manager = {
    queryRunner: { isTransactionActive: true, isReleased: false },
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      options?.onQuery?.(sql, params);
      if (/^\s*SET\s+TRANSACTION\s+READ\s+ONLY\b/i.test(sql)) return [];
      if (/^\s*SET\s+LOCAL\s+statement_timeout\b/i.test(sql)) return [];
      if (typeof options?.rows === 'function') {
        return options.rows(sql, params);
      }
      return options?.rows ?? [];
    },
  } as unknown as EntityManager;

  const db = {
    driver: {
      schema,
      options: { type: 'postgres', schema },
    },
    async transaction(
      isolationOrCb: string | ((em: EntityManager) => Promise<unknown>),
      maybeCb?: (em: EntityManager) => Promise<unknown>,
    ) {
      transactionCount += 1;
      if (options?.transactionError) throw options.transactionError;
      const cb = typeof isolationOrCb === 'function' ? isolationOrCb : maybeCb!;
      isolationLevel = typeof isolationOrCb === 'string' ? isolationOrCb : undefined;
      return cb(manager);
    },
  } as unknown as DataSource;

  return {
    db,
    queries,
    getTransactionCount: () => transactionCount,
    getIsolationLevel: () => isolationLevel,
  };
}

test('1. returns frozen eligible candidate copies and empty AVAILABLE in REPEATABLE READ READ ONLY with 1500ms timeout and schema-qualified relations', async () => {
  const mutableRow: CandidateRow = {
    profileReferenceHash: HASH_1,
    profileRevision: REV_1,
    encryptedTemplate: FERNET_1,
  };
  const secondRow: CandidateRow = {
    profileReferenceHash: HASH_2,
    profileRevision: REV_2,
    encryptedTemplate: FERNET_2,
  };
  const { db, queries, getTransactionCount, getIsolationLevel } = makeFakeDb({
    rows: [mutableRow, secondRow],
  });
  const reader = new SafetyFaceCandidateReader(db);
  const res = await reader.readForSafety(SITE_ID, MODEL_VERSION, new AbortController().signal);

  assert.equal(getTransactionCount(), 1);
  assert.equal(getIsolationLevel(), 'REPEATABLE READ');
  assert.ok(queries.some((q) => /SET\s+TRANSACTION\s+READ\s+ONLY/i.test(q.sql)));
  assert.ok(queries.some((q) => /SET\s+LOCAL\s+statement_timeout\s*=\s*'1500ms'/i.test(q.sql)));

  const selectQuery = queries.find(
    (q) => /face_profile/i.test(q.sql) && /safety_face_consent/i.test(q.sql),
  );
  assert.ok(selectQuery, 'Expected candidate selection SQL query');
  assert.deepEqual(selectQuery.params, [SITE_ID, MODEL_VERSION]);
  assert.match(selectQuery.sql, /"tenant_mf06"\."?face_profile"?/);
  assert.match(selectQuery.sql, /"tenant_mf06"\."?worker"?/);
  assert.equal(
    (selectQuery.sql.match(/"tenant_mf06"\."safety_face_consent"(?=\s)/g) ?? []).length >= 2,
    true,
  );
  assert.match(selectQuery.sql, /"tenant_mf06"\."?safety_face_consent_revocation"?/);
  assert.match(selectQuery.sql, /SUPERVISED_WORKER_CONFIRMATION/);
  assert.match(selectQuery.sql, /SAFETY_MF06/);
  assert.match(
    selectQuery.sql,
    /octet_length\([^)]*encrypted_template\)\s+BETWEEN\s+100\s+AND\s+32768/i,
  );
  assert.match(selectQuery.sql, /ORDER\s+BY\s+p\."?id"?\b/i);
  assert.match(selectQuery.sql, /LIMIT\s+33\b/i);
  assert.doesNotMatch(selectQuery.sql, /\bFOR\s+(UPDATE|SHARE)\b/i);

  assert.equal(res.status, 'AVAILABLE');
  if (res.status !== 'AVAILABLE') return;
  assert.equal(Object.isFrozen(res), true);
  assert.equal(Object.isFrozen(res.candidates), true);
  assert.equal(res.candidates.length, 2);
  assert.equal(Object.isFrozen(res.candidates[0]), true);

  mutableRow.encryptedTemplate = 'mutated-after-read';
  const expected: readonly SafetyFaceCandidateTemplate[] = [
    {
      profileReferenceHash: HASH_1,
      profileRevision: REV_1,
      encryptedTemplate: FERNET_1,
    },
    {
      profileReferenceHash: HASH_2,
      profileRevision: REV_2,
      encryptedTemplate: FERNET_2,
    },
  ];
  assert.deepEqual(res.candidates, expected);
  for (const item of res.candidates) {
    assert.deepEqual(Object.keys(item).sort(), [
      'encryptedTemplate',
      'profileReferenceHash',
      'profileRevision',
    ]);
  }

  const emptyDb = makeFakeDb({ rows: [] });
  const emptyRes = await new SafetyFaceCandidateReader(emptyDb.db).readForSafety(
    SITE_ID,
    MODEL_VERSION,
    new AbortController().signal,
  );
  assert.deepEqual(emptyRes, { status: 'AVAILABLE', candidates: [] });
  if (emptyRes.status === 'AVAILABLE') {
    assert.equal(Object.isFrozen(emptyRes.candidates), true);
  }
});

test('2. fails closed without running SQL on invalid siteId, modelVersion, signal, or missing/invalid driver schema', async () => {
  const { db, queries, getTransactionCount } = makeFakeDb({
    rows: [{ profileReferenceHash: HASH_1, profileRevision: REV_1, encryptedTemplate: FERNET_1 }],
  });
  const reader = new SafetyFaceCandidateReader(db);
  const validSignal = new AbortController().signal;

  for (const [badSite, badModel] of [
    ['not-a-uuid', MODEL_VERSION],
    ['', MODEL_VERSION],
    [SITE_ID, ''],
    [SITE_ID, '   '],
    [SITE_ID, ` ${MODEL_VERSION}`],
    [SITE_ID, `${MODEL_VERSION} `],
    [SITE_ID, 'm'.repeat(129)],
  ] as const) {
    const res = await reader.readForSafety(badSite, badModel, validSignal);
    assert.deepEqual(res, { status: 'UNAVAILABLE', reason: 'INVALID_SCOPE' });
  }

  const badSignalRes = await reader.readForSafety(
    SITE_ID,
    MODEL_VERSION,
    null as unknown as AbortSignal,
  );
  assert.equal(badSignalRes.status, 'UNAVAILABLE');
  assert.ok(['INVALID_SCOPE', 'ABORTED'].includes(badSignalRes.reason));

  const aborted = new AbortController();
  aborted.abort();
  const abortedRes = await reader.readForSafety(SITE_ID, MODEL_VERSION, aborted.signal);
  assert.deepEqual(abortedRes, { status: 'UNAVAILABLE', reason: 'ABORTED' });

  assert.equal(getTransactionCount(), 0);
  assert.equal(queries.length, 0);

  for (const badSchema of [
    undefined,
    null,
    '',
    'public\0bad',
    'pg_temp',
    'pg_temp_1',
    'pg_catalog',
    'x'.repeat(64),
    'é'.repeat(32),
    'information_schema',
  ]) {
    const badSchemaDb = makeFakeDb({ schema: badSchema, rows: [] });
    const schemaRes = await new SafetyFaceCandidateReader(badSchemaDb.db).readForSafety(
      SITE_ID,
      MODEL_VERSION,
      validSignal,
    );
    assert.deepEqual(schemaRes, { status: 'UNAVAILABLE', reason: 'READ_UNAVAILABLE' });
    assert.equal(badSchemaDb.getTransactionCount(), 0);
    assert.equal(badSchemaDb.queries.length, 0);
  }
});

test('3. refuses 33-row limit overflow, duplicate hash or revision, and null or malformed candidate rows', async () => {
  const signal = new AbortController().signal;
  const thirtyThreeRows: CandidateRow[] = Array.from({ length: 33 }, (_, index) => ({
    profileReferenceHash: (index + 1).toString(16).padStart(64, '0'),
    profileRevision: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
    encryptedTemplate: FERNET_1,
  }));
  const limitReader = new SafetyFaceCandidateReader(makeFakeDb({ rows: thirtyThreeRows }).db);
  assert.deepEqual(await limitReader.readForSafety(SITE_ID, MODEL_VERSION, signal), {
    status: 'UNAVAILABLE',
    reason: 'CANDIDATE_LIMIT',
  });

  const getterRow = {
    profileReferenceHash: HASH_1,
    profileRevision: REV_1,
    get encryptedTemplate() {
      return FERNET_1;
    },
  } as unknown as CandidateRow;

  const invalidRowSets: CandidateRow[][] = [
    [
      { profileReferenceHash: HASH_1, profileRevision: REV_1, encryptedTemplate: FERNET_1 },
      { profileReferenceHash: HASH_1, profileRevision: REV_2, encryptedTemplate: FERNET_2 },
    ],
    [
      { profileReferenceHash: HASH_1, profileRevision: REV_1, encryptedTemplate: FERNET_1 },
      {
        profileReferenceHash: HASH_2,
        profileRevision: REV_1.toUpperCase(),
        encryptedTemplate: FERNET_2,
      },
    ],
    [{ profileReferenceHash: HASH_1, profileRevision: REV_1, encryptedTemplate: null }],
    [{ profileReferenceHash: HASH_1, profileRevision: REV_1, encryptedTemplate: 'short-token' }],
    [
      {
        profileReferenceHash: HASH_1,
        profileRevision: REV_1,
        encryptedTemplate: 'g'.repeat(32769),
      },
    ],
    [
      {
        profileReferenceHash: HASH_1,
        profileRevision: REV_1,
        encryptedTemplate: `${'A'.repeat(120)}!invalid!`,
      },
    ],
    [{ profileReferenceHash: 'A'.repeat(64), profileRevision: REV_1, encryptedTemplate: FERNET_1 }],
    [
      {
        profileReferenceHash: HASH_1,
        profileRevision: 'not-a-uuid',
        encryptedTemplate: FERNET_1,
      },
    ],
    [getterRow],
  ];

  for (const rows of invalidRowSets) {
    const reader = new SafetyFaceCandidateReader(makeFakeDb({ rows }).db);
    const res = await reader.readForSafety(SITE_ID, MODEL_VERSION, signal);
    assert.deepEqual(res, { status: 'UNAVAILABLE', reason: 'INVALID_CANDIDATE' });
  }
});

test('transient PostgreSQL errors survive the candidate boundary, while cancellation wins', async () => {
  for (const code of ['40001', '40P01', '55P03', '57014', '55000']) {
    const error = Object.assign(new Error('Synthetic transient SQL error'), {
      driverError: { code },
    });
    const reader = new SafetyFaceCandidateReader(makeFakeDb({ transactionError: error }).db);
    await assert.rejects(
      reader.readForSafety(SITE_ID, MODEL_VERSION, new AbortController().signal),
      (value) => value === error,
    );
  }
  const controller = new AbortController();
  const db = makeFakeDb({
    onQuery() {
      controller.abort();
      throw Object.assign(new Error('Synthetic timeout during abort'), { code: '57014' });
    },
  });
  assert.deepEqual(
    await new SafetyFaceCandidateReader(db.db).readForSafety(
      SITE_ID,
      MODEL_VERSION,
      controller.signal,
    ),
    { status: 'UNAVAILABLE', reason: 'ABORTED' },
  );
});

test('4. maps query or transaction errors to READ_UNAVAILABLE without leaking templates and honors mid-read abort', async () => {
  const signal = new AbortController().signal;
  const failingTxDb = makeFakeDb({
    transactionError: new Error(`PG failed while reading ${FERNET_1}`),
  });
  const txErrorRes = await new SafetyFaceCandidateReader(failingTxDb.db).readForSafety(
    SITE_ID,
    MODEL_VERSION,
    signal,
  );
  assert.deepEqual(txErrorRes, { status: 'UNAVAILABLE', reason: 'READ_UNAVAILABLE' });
  assert.equal(JSON.stringify(txErrorRes).includes(FERNET_1), false);

  const failingQueryDb = makeFakeDb({
    rows: () => {
      throw new Error(`statement timeout on ${FERNET_2}`);
    },
  });
  const queryErrorRes = await new SafetyFaceCandidateReader(failingQueryDb.db).readForSafety(
    SITE_ID,
    MODEL_VERSION,
    signal,
  );
  assert.deepEqual(queryErrorRes, { status: 'UNAVAILABLE', reason: 'READ_UNAVAILABLE' });
  assert.equal(JSON.stringify(queryErrorRes).includes(FERNET_2), false);

  const midReadController = new AbortController();
  const abortingDb = makeFakeDb({
    rows: [{ profileReferenceHash: HASH_1, profileRevision: REV_1, encryptedTemplate: FERNET_1 }],
    onQuery: (sql) => {
      if (/face_profile/i.test(sql)) {
        midReadController.abort();
      }
    },
  });
  const abortedMidRead = await new SafetyFaceCandidateReader(abortingDb.db).readForSafety(
    SITE_ID,
    MODEL_VERSION,
    midReadController.signal,
  );
  assert.deepEqual(abortedMidRead, { status: 'UNAVAILABLE', reason: 'ABORTED' });
});
