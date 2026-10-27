/**
 * Unit tests only: exercises JS parser, (canonical, raw] static boundary checks, and SQL result handling.
 * Does NOT establish PostgreSQL EXTRACT(EPOCH) numeric precision or 20-table lock fence guarantees.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EntityManager } from 'typeorm';
import type { MainAuthorityArchive } from '../src/modules/zones/main-authority-archive-codec.js';
import {
  parseAuthorityInstantNanoseconds,
  resolveSameMillisecondCaptureWindow,
  verifySubMillisecondAuthorityBridgeInTx,
} from '../src/modules/zones/main-authority-capture-time.js';

const CANONICAL_T = '2026-10-21T10:00:00.123Z';
const EPOCH_ID = '11111111-1111-4111-8111-111111111111';

function makeArchive(
  rows: readonly Record<string, unknown>[] = [],
  capturedAt = CANONICAL_T,
): MainAuthorityArchive {
  return {
    format: 'MF06_MAIN_AUTHORITY_ARCHIVE_V2',
    sha256: 'a'.repeat(64),
    payload: {
      version: 'MF06_MAIN_AUTHORITY_ARCHIVE_V2',
      context: {
        siteId: '22222222-2222-4222-8222-222222222222',
        zoneId: '33333333-3333-4333-8333-333333333333',
        workerId: null,
        capturedAt,
        purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
      },
      archivedAt: '2026-10-21T10:00:01.000000Z',
      baseline: {
        epochId: EPOCH_ID,
        capturedAt: '2026-10-21T09:00:00.000000Z',
        declaredWriterManifestHash: 'b'.repeat(64),
        sourceRegistryHash: 'c'.repeat(64),
        snapshotHash: 'd'.repeat(64),
      },
      sources: [
        {
          sourceKind: 'SYNTHETIC_SOURCE',
          tableName: 'synthetic_table',
          fields: ['id', 'valid_from', 'valid_until', 'revoked_at', 'joined_at', 'left_at'],
          rows,
        },
      ],
    },
  };
}

function makeManager(
  isTransactionActive: boolean,
  queryImpl?: (sql: string, params?: unknown[]) => Promise<unknown>,
): { manager: EntityManager; calls: Array<{ sql: string; params: unknown[] }> } {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const manager = {
    queryRunner: { isTransactionActive },
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return queryImpl ? queryImpl(sql, params) : [];
    },
  } as unknown as EntityManager;
  return { manager, calls };
}

test('parseAuthorityInstantNanoseconds & resolveSameMillisecondCaptureWindow handle 9 digits, colonless TZ, pre-1970, and invalid inputs', () => {
  assert.equal(parseAuthorityInstantNanoseconds('2026-02-29T10:00:00.123Z'), null);
  assert.equal(parseAuthorityInstantNanoseconds('2026-10-21T10:00:60.123Z'), null);
  assert.equal(parseAuthorityInstantNanoseconds('2026-10-21T10:00:00.123-00:00'), null);
  assert.equal(parseAuthorityInstantNanoseconds('2026-10-21T10:00:00.123-0000'), null);
  assert.equal(parseAuthorityInstantNanoseconds('2026-10-21T10:00:00.1234567890Z'), null);

  const utcNs = parseAuthorityInstantNanoseconds('2026-10-21T10:00:00.123456789Z');
  const colonlessNs = parseAuthorityInstantNanoseconds('2026-10-21T17:00:00.123456789+0700');
  const plusZeroNs = parseAuthorityInstantNanoseconds('2026-10-21T10:00:00.123456789+0000');
  assert.equal(utcNs, colonlessNs);
  assert.equal(utcNs, plusZeroNs);

  const sameBucket = resolveSameMillisecondCaptureWindow(
    CANONICAL_T,
    '2026-10-21T17:00:00.123999999+0700',
  );
  assert.ok(sameBucket);
  assert.equal(sameBucket.rawNs - sameBucket.canonicalNs, 999_999n);
  assert.equal(
    resolveSameMillisecondCaptureWindow(CANONICAL_T, '2026-10-21T10:00:00.122999999Z'),
    null,
  );
  assert.equal(
    resolveSameMillisecondCaptureWindow(CANONICAL_T, '2026-10-21T10:00:00.124000000Z'),
    null,
  );
  assert.equal(
    resolveSameMillisecondCaptureWindow('2026-10-21T10:00:00.123400Z', CANONICAL_T),
    null,
  );

  const pre1970 = resolveSameMillisecondCaptureWindow(
    '1969-12-31T23:59:59.123Z',
    '1969-12-31T23:59:59.123456789Z',
  );
  assert.deepEqual(pre1970, {
    canonicalNs: -877_000_000n,
    rawNs: -876_543_211n,
  });
});

test('verifySubMillisecondAuthorityBridgeInTx requires active TX on exact canonical equality and enforces (canonical, raw] static boundaries', async () => {
  const archive = makeArchive();
  const inactive = makeManager(false);
  assert.equal(
    await verifySubMillisecondAuthorityBridgeInTx(inactive.manager, archive, CANONICAL_T),
    false,
  );

  const active = makeManager(true);
  assert.equal(
    await verifySubMillisecondAuthorityBridgeInTx(
      active.manager,
      archive,
      '2026-10-21T10:00:00.123000000Z',
    ),
    true,
  );
  assert.equal(active.calls.length, 0);

  const rawT = '2026-10-21T10:00:00.123456789Z';
  for (const field of [
    'valid_from',
    'valid_until',
    'revoked_at',
    'joined_at',
    'left_at',
  ] as const) {
    const insideArchive = makeArchive([{ id: '1', [field]: '2026-10-21T10:00:00.123456Z' }]);
    const tx = makeManager(true);
    assert.equal(
      await verifySubMillisecondAuthorityBridgeInTx(tx.manager, insideArchive, rawT),
      false,
    );
    assert.equal(tx.calls.length, 0);
  }

  const boundaryAtCanonicalOrAfterRaw = makeArchive([
    {
      id: '1',
      valid_from: '2026-10-21T10:00:00.123000Z',
      valid_until: '2026-10-21T10:00:00.123457Z',
    },
  ]);
  const okTx = makeManager(true, async () => [
    { not_future: true, before_close: true, before_gap: true, no_revision: true, no_gap: true },
  ]);
  assert.equal(
    await verifySubMillisecondAuthorityBridgeInTx(
      okTx.manager,
      boundaryAtCanonicalOrAfterRaw,
      rawT,
    ),
    true,
  );
  assert.equal(okTx.calls.length, 1);
  assert.match(okTx.calls[0]!.sql, /JOIN authorization_history_baseline b USING \(epoch_id\)/);
  assert.deepEqual(okTx.calls[0]!.params, [EPOCH_ID, '1792576800123000000', '1792576800123456789']);

  for (const flag of [
    'not_future',
    'before_close',
    'before_gap',
    'no_revision',
    'no_gap',
  ] as const) {
    const failTx = makeManager(true, async () => [
      {
        not_future: true,
        before_close: true,
        before_gap: true,
        no_revision: true,
        no_gap: true,
        [flag]: false,
      },
    ]);
    assert.equal(
      await verifySubMillisecondAuthorityBridgeInTx(failTx.manager, archive, rawT),
      false,
    );
  }
});
